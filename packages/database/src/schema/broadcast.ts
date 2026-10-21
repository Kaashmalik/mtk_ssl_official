import {
  pgTable, uuid, text, timestamp, boolean, integer, jsonb,
  index, uniqueIndex, check, foreignKey,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { tenants } from "./tenants"
import { users } from "./users"
import { matches } from "./matches"

/**
 * ENH-08-01/02: centrally owned broadcast plane.
 *
 * A provider connection belongs to exactly one league. Its credentials are
 * stored as an opaque encrypted/secret-manager reference, never a plaintext
 * access token. Destinations are provider objects (channel/playlist/page), not
 * privacy boundaries. Sessions deliberately keep `desired_state` separate from
 * `observed_state`; only provider observation can make a session "live".
 *
 * Jobs are the durable provider outbox, with one idempotency key per request.
 * Ingest leases fence competing workers. No provider call belongs in a DB
 * transaction.
 */

export const broadcastConnections = pgTable("broadcast_connections", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  displayName: text("display_name").notNull(),
  /** Opaque secret-manager/ciphertext reference. Never a plaintext token. */
  credentialRef: text("credential_ref").notNull(),
  scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("broadcast_connections_id_tenant_key").on(table.id, table.tenantId),
  uniqueIndex("broadcast_connections_tenant_provider_account_key").on(
    table.tenantId, table.provider, table.externalAccountId,
  ),
  index("broadcast_connections_tenant_status_idx").on(table.tenantId, table.status),
  check("broadcast_connections_provider_check",
    sql`${table.provider} IN ('youtube','facebook')`),
  check("broadcast_connections_status_check",
    sql`${table.status} IN ('active','expired','revoked')`),
  check("broadcast_connections_external_account_check",
    sql`length(${table.externalAccountId}) BETWEEN 1 AND 300`),
  check("broadcast_connections_credential_ref_check",
    sql`length(${table.credentialRef}) BETWEEN 1 AND 500`),
])

export const broadcastDestinations = pgTable("broadcast_destinations", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("broadcast_destinations_id_tenant_key").on(table.id, table.tenantId),
  uniqueIndex("broadcast_destinations_tenant_provider_external_key").on(
    table.tenantId, table.provider, table.externalId,
  ),
  index("broadcast_destinations_tenant_connection_idx").on(table.tenantId, table.connectionId),
  foreignKey({
    name: "broadcast_destinations_connection_tenant_fk",
    columns: [table.connectionId, table.tenantId],
    foreignColumns: [broadcastConnections.id, broadcastConnections.tenantId],
  }).onDelete("cascade"),
  check("broadcast_destinations_provider_check",
    sql`${table.provider} IN ('youtube','facebook')`),
  check("broadcast_destinations_kind_check",
    sql`${table.kind} IN ('channel','playlist','page')`),
  check("broadcast_destinations_external_id_check",
    sql`length(${table.externalId}) BETWEEN 1 AND 300`),
])

export const broadcastSessions = pgTable("broadcast_sessions", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  matchId: uuid("match_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  destinationId: uuid("destination_id").notNull(),
  provider: text("provider").notNull(),
  /** Ordered session part for one match; segmentation is explicit. */
  sessionNumber: integer("session_number").notNull().default(1),
  desiredState: text("desired_state").notNull().default("draft"),
  observedState: text("observed_state").notNull().default("unconfigured"),
  providerBroadcastId: text("provider_broadcast_id"),
  providerStreamId: text("provider_stream_id"),
  playbackVideoId: text("playback_video_id"),
  playbackAvailable: boolean("playback_available").notNull().default(false),
  /** Opaque stream-key/secret reference; never returned to a browser. */
  ingestSecretRef: text("ingest_secret_ref"),
  /** Provider request identity reused on retries to avoid duplicate creation. */
  idempotencyKey: text("idempotency_key").notNull(),
  revision: integer("revision").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  providerMetadata: jsonb("provider_metadata").notNull().default({}),
  scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("broadcast_sessions_id_tenant_key").on(table.id, table.tenantId),
  uniqueIndex("broadcast_sessions_match_session_key").on(table.matchId, table.sessionNumber),
  uniqueIndex("broadcast_sessions_tenant_idempotency_key").on(table.tenantId, table.idempotencyKey),
  index("broadcast_sessions_tenant_desired_idx").on(table.tenantId, table.desiredState, table.updatedAt),
  index("broadcast_sessions_lease_due_idx").on(table.leaseExpiresAt),
  foreignKey({
    name: "broadcast_sessions_match_tenant_fk",
    columns: [table.matchId, table.tenantId],
    foreignColumns: [matches.id, matches.tenantId],
  }).onDelete("cascade"),
  foreignKey({
    name: "broadcast_sessions_connection_tenant_fk",
    columns: [table.connectionId, table.tenantId],
    foreignColumns: [broadcastConnections.id, broadcastConnections.tenantId],
  }).onDelete("restrict"),
  foreignKey({
    name: "broadcast_sessions_destination_tenant_fk",
    columns: [table.destinationId, table.tenantId],
    foreignColumns: [broadcastDestinations.id, broadcastDestinations.tenantId],
  }).onDelete("restrict"),
  check("broadcast_sessions_provider_check",
    sql`${table.provider} IN ('youtube','facebook')`),
  check("broadcast_sessions_session_number_check", sql`${table.sessionNumber} > 0`),
  check("broadcast_sessions_desired_check", sql`${table.desiredState} IN
    ('draft','preparing','ready','starting','live','ending','ended','failed','cancelled')`),
  check("broadcast_sessions_observed_check", sql`${table.observedState} IN
    ('unconfigured','provisioning','ready','live','interrupted','ending','processing','replay_ready','failed','ended')`),
  check("broadcast_sessions_revision_check", sql`${table.revision} >= 0`),
  check("broadcast_sessions_idempotency_key_check",
    sql`length(${table.idempotencyKey}) BETWEEN 1 AND 200`),
])

export const broadcastJobs = pgTable("broadcast_jobs", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull(),
  action: text("action").notNull(),
  state: text("state").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(8),
  idempotencyKey: text("idempotency_key").notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("broadcast_jobs_tenant_idempotency_key").on(table.tenantId, table.idempotencyKey),
  index("broadcast_jobs_due_idx").on(table.state, table.nextAttemptAt),
  index("broadcast_jobs_session_idx").on(table.tenantId, table.sessionId, table.createdAt),
  foreignKey({
    name: "broadcast_jobs_session_tenant_fk",
    columns: [table.sessionId, table.tenantId],
    foreignColumns: [broadcastSessions.id, broadcastSessions.tenantId],
  }).onDelete("cascade"),
  check("broadcast_jobs_action_check", sql`${table.action} IN
    ('prepare','start','end','reconcile','archive')`),
  check("broadcast_jobs_state_check", sql`${table.state} IN
    ('pending','running','succeeded','failed','dead')`),
  check("broadcast_jobs_attempts_check",
    sql`${table.attempts} >= 0 AND ${table.attempts} <= ${table.maxAttempts}`),
])

export const broadcastArchives = pgTable("broadcast_archives", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull(),
  providerVideoId: text("provider_video_id"),
  status: text("status").notNull().default("pending"),
  durationSeconds: integer("duration_seconds"),
  availableAt: timestamp("available_at", { withTimezone: true }),
  retentionUntil: timestamp("retention_until", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("broadcast_archives_session_key").on(table.sessionId),
  index("broadcast_archives_tenant_status_idx").on(table.tenantId, table.status),
  foreignKey({
    name: "broadcast_archives_session_tenant_fk",
    columns: [table.sessionId, table.tenantId],
    foreignColumns: [broadcastSessions.id, broadcastSessions.tenantId],
  }).onDelete("cascade"),
  check("broadcast_archives_status_check", sql`${table.status} IN
    ('pending','processing','ready','failed','expired')`),
  check("broadcast_archives_duration_check",
    sql`${table.durationSeconds} IS NULL OR ${table.durationSeconds} >= 0`),
])
