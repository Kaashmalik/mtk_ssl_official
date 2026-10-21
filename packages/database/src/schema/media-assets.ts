import {
  pgTable, uuid, text, timestamp, bigint, integer, jsonb,
  index, uniqueIndex, check, foreignKey,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { tenants } from "./tenants"
import { users } from "./users"

/**
 * ENH-07-01: the verified media plane.
 *
 * The legacy `media` table stored a bare URL and let the client decide what was
 * public. These tables are the replacement contract:
 *
 *   media_assets        one row per provider asset identity/version + state
 *   media_upload_sessions  one authorized, quota-reserved upload
 *   media_bindings      same-tenant attachment to a domain resource
 *   media_consents      per-purpose consent, separate from publication
 *   media_processing_events  webhook dedup/quarantine journal
 *   media_cleanup_jobs  durable provider destruction/invalidation outbox
 *   media_quotas        atomic byte reservation, limit nullable = unconfigured
 *
 * `tenant_id` is NOT NULL on every asset/queue row. Bindings use a composite FK
 * to `(media_assets.id, media_assets.tenant_id)` so a cross-tenant attachment
 * fails in the database, not only in application code. Sensitive provider
 * metadata lives in `metadata` and must never enter a public projection.
 *
 * Legacy rows/URLs are NOT migrated into `media_assets` as approved assets:
 * they stay in `media` and read as `legacy_unverified` until an authoritative
 * re-check. Existing storage is preserved; this migration is additive.
 */

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("cloudinary"),
  /** Provider public id is the durable locator; never client-supplied. */
  providerPublicId: text("provider_public_id").notNull(),
  /** Provider-issued asset id / version, only after finalize. */
  providerAssetId: text("provider_asset_id"),
  providerVersion: integer("provider_version"),
  resourceType: text("resource_type").notNull().default("image"),
  kind: text("kind").notNull(),
  state: text("state").notNull().default("pending"),
  publication: text("publication").notNull().default("unpublished"),
  consent: text("consent").notNull().default("not_required"),
  mimeType: text("mime_type"),
  format: text("format"),
  bytes: bigint("bytes", { mode: "number" }),
  width: integer("width"),
  height: integer("height"),
  durationSeconds: integer("duration_seconds"),
  /** Server-only provider metadata; NEVER a public projection field. */
  metadata: jsonb("metadata").notNull().default({}),
  legacyUrl: text("legacy_url"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, table => [
  uniqueIndex("media_assets_tenant_provider_public_id_key").on(
    table.tenantId, table.provider, table.providerPublicId,
  ),
  // Target for composite same-tenant FKs (bindings, sessions, cleanup).
  uniqueIndex("media_assets_id_tenant_key").on(table.id, table.tenantId),
  index("media_assets_tenant_state_idx").on(table.tenantId, table.state, table.createdAt),
  index("media_assets_tenant_publication_idx").on(table.tenantId, table.publication),
  check("media_assets_kind_check", sql`${table.kind} IN ('image','video','audio')`),
  check("media_assets_state_check", sql`${table.state} IN
    ('legacy_unverified','pending','processing','ready','quarantined','failed','deleted')`),
  check("media_assets_publication_check", sql`${table.publication} IN
    ('unpublished','published','withdrawn')`),
  check("media_assets_consent_check", sql`${table.consent} IN
    ('not_required','pending','granted','withdrawn')`),
  check("media_assets_bytes_check", sql`${table.bytes} IS NULL OR ${table.bytes} >= 0`),
  check("media_assets_provider_public_id_check", sql`length(${table.providerPublicId}) BETWEEN 1 AND 300`),
])

export const mediaUploadSessions = pgTable("media_upload_sessions", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  state: text("state").notNull().default("reserved"),
  /** Intended attachment, fixed at authorize time so finalize cannot retarget it. */
  bindingType: text("binding_type"),
  resourceId: uuid("resource_id"),
  /** Unpredictable public id decided by the SERVER at authorize time. */
  provider: text("provider").notNull().default("cloudinary"),
  providerPublicId: text("provider_public_id").notNull(),
  providerFolder: text("provider_folder"),
  declaredMimeType: text("declared_mime_type").notNull(),
  declaredBytes: bigint("declared_bytes", { mode: "number" }).notNull(),
  /** Bytes held against the tenant quota until finalize/expiry. */
  reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull(),
  assetId: uuid("asset_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
}, table => [
  uniqueIndex("media_upload_sessions_tenant_provider_public_id_key").on(
    table.tenantId, table.provider, table.providerPublicId,
  ),
  index("media_upload_sessions_due_idx").on(table.expiresAt).where(sql`${table.state} = 'reserved'`),
  // NO ACTION: an asset is tombstoned, never hard-deleted while a session
  // references it. Tenant deletion still cascades both rows in one statement.
  foreignKey({
    name: "media_upload_sessions_asset_tenant_fk",
    columns: [table.assetId, table.tenantId],
    foreignColumns: [mediaAssets.id, mediaAssets.tenantId],
  }),
  check("media_upload_sessions_kind_check", sql`${table.kind} IN ('image','video','audio')`),
  check("media_upload_sessions_state_check", sql`${table.state} IN
    ('reserved','finalized','expired','cancelled')`),
  check("media_upload_sessions_binding_check", sql`
    (${table.bindingType} IS NULL AND ${table.resourceId} IS NULL)
    OR (${table.bindingType} IN ('tournament','venue','branding','team','player','match')
        AND ${table.resourceId} IS NOT NULL)`),
  check("media_upload_sessions_bytes_check", sql`${table.declaredBytes} > 0
    AND ${table.reservedBytes} > 0 AND ${table.reservedBytes} >= ${table.declaredBytes}`),
])

export const mediaBindings = pgTable("media_bindings", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull(),
  resourceType: text("resource_type").notNull(),
  /** Domain row id (tournament/venue/team/player/match/tenant). */
  resourceId: uuid("resource_id").notNull(),
  role: text("role").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  // Same-tenant at the database level: the asset's tenant must equal this row's.
  foreignKey({
    name: "media_bindings_asset_tenant_fk",
    columns: [table.assetId, table.tenantId],
    foreignColumns: [mediaAssets.id, mediaAssets.tenantId],
  }).onDelete("cascade"),
  uniqueIndex("media_bindings_asset_resource_role_key").on(
    table.assetId, table.resourceType, table.resourceId, table.role,
  ),
  index("media_bindings_resource_idx").on(table.tenantId, table.resourceType, table.resourceId),
  check("media_bindings_resource_type_check", sql`${table.resourceType} IN
    ('tournament','venue','branding','team','player','match')`),
  check("media_bindings_role_check", sql`${table.role} IN
    ('logo','banner','gallery','highlight','thumbnail','avatar')`),
])

export const mediaConsents = pgTable("media_consents", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull(),
  /** NULL = an asset-level consent not tied to one person. */
  subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "set null" }),
  purpose: text("purpose").notNull(),
  state: text("state").notNull().default("pending"),
  /** Evidence reference (document id), never raw identity documents. */
  evidenceRef: text("evidence_ref"),
  grantedAt: timestamp("granted_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({
    name: "media_consents_asset_tenant_fk",
    columns: [table.assetId, table.tenantId],
    foreignColumns: [mediaAssets.id, mediaAssets.tenantId],
  }).onDelete("cascade"),
  uniqueIndex("media_consents_subject_purpose_key").on(
    table.assetId, table.subjectUserId, table.purpose,
  ).where(sql`${table.subjectUserId} IS NOT NULL`),
  uniqueIndex("media_consents_asset_purpose_key").on(table.assetId, table.purpose)
    .where(sql`${table.subjectUserId} IS NULL`),
  check("media_consents_state_check", sql`${table.state} IN
    ('not_required','pending','granted','withdrawn')`),
  check("media_consents_withdrawal_check", sql`
    (${table.state} <> 'granted' OR ${table.grantedAt} IS NOT NULL)
    AND (${table.state} <> 'withdrawn' OR ${table.withdrawnAt} IS NOT NULL)`),
])

export const mediaProcessingEvents = pgTable("media_processing_events", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  /** NULL only while a malformed/unknown-tenant event is quarantined. */
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id"),
  provider: text("provider").notNull().default("cloudinary"),
  providerEventId: text("provider_event_id").notNull(),
  dedupKey: text("dedup_key").notNull(),
  payloadHash: text("payload_hash"),
  state: text("state").notNull().default("received"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
}, table => [
  uniqueIndex("media_processing_events_dedup_key").on(table.dedupKey),
  index("media_processing_events_asset_idx").on(table.assetId, table.receivedAt),
  check("media_processing_events_state_check", sql`${table.state} IN
    ('received','applied','quarantined','duplicate','failed')`),
])

export const mediaCleanupJobs = pgTable("media_cleanup_jobs", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  /** The tombstone row survives; the job also carries identity for orphan cleanup. */
  assetId: uuid("asset_id"),
  provider: text("provider").notNull().default("cloudinary"),
  providerPublicId: text("provider_public_id").notNull(),
  providerResourceType: text("provider_resource_type").notNull().default("image"),
  action: text("action").notNull(),
  state: text("state").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leaseToken: uuid("lease_token"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, table => [
  uniqueIndex("media_cleanup_jobs_asset_action_key").on(table.assetId, table.action),
  // Expired sessions/orphans have no asset row yet; provider identity still
  // deduplicates their cleanup jobs.
  uniqueIndex("media_cleanup_jobs_provider_public_action_key").on(
    table.tenantId, table.provider, table.providerPublicId, table.action,
  ),
  index("media_cleanup_jobs_due_idx").on(table.nextAttemptAt, table.id)
    .where(sql`${table.state} IN ('pending','leased')`),
  // NO ACTION: cleanup keeps the asset as evidence until provider destruction
  // is confirmed; the asset is never hard-deleted.
  foreignKey({
    name: "media_cleanup_jobs_asset_tenant_fk",
    columns: [table.assetId, table.tenantId],
    foreignColumns: [mediaAssets.id, mediaAssets.tenantId],
  }),
  check("media_cleanup_jobs_action_check", sql`${table.action} IN
    ('destroy_provider_asset','invalidate_delivery')`),
  check("media_cleanup_jobs_state_check", sql`${table.state} IN
    ('pending','leased','provider_destroyed','failed','dead_lettered')`),
  check("media_cleanup_jobs_attempts_check", sql`${table.attempts} BETWEEN 0 AND 8`),
])

export const mediaQuotas = pgTable("media_quotas", {
  /** One quota row per league; the row is locked for atomic reservation. */
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  /** NULL = no approved limit yet. Reservations are REFUSED, not unlimited. */
  limitBytes: bigint("limit_bytes", { mode: "number" }),
  usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
  reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("media_quotas_bytes_check", sql`
    (${table.limitBytes} IS NULL OR ${table.limitBytes} > 0)
    AND ${table.usedBytes} >= 0 AND ${table.reservedBytes} >= 0
    AND (${table.limitBytes} IS NULL OR ${table.usedBytes} + ${table.reservedBytes} <= ${table.limitBytes})`),
])

export type MediaAsset = typeof mediaAssets.$inferSelect
export type NewMediaAsset = typeof mediaAssets.$inferInsert
export type MediaUploadSession = typeof mediaUploadSessions.$inferSelect
export type NewMediaUploadSession = typeof mediaUploadSessions.$inferInsert
export type MediaBindingRow = typeof mediaBindings.$inferSelect
export type NewMediaBindingRow = typeof mediaBindings.$inferInsert
export type MediaConsent = typeof mediaConsents.$inferSelect
export type NewMediaConsent = typeof mediaConsents.$inferInsert
export type MediaProcessingEvent = typeof mediaProcessingEvents.$inferSelect
export type NewMediaProcessingEvent = typeof mediaProcessingEvents.$inferInsert
export type MediaCleanupJob = typeof mediaCleanupJobs.$inferSelect
export type NewMediaCleanupJob = typeof mediaCleanupJobs.$inferInsert
export type MediaQuota = typeof mediaQuotas.$inferSelect
export type NewMediaQuota = typeof mediaQuotas.$inferInsert
