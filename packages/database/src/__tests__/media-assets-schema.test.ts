import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import {
  mediaAssets, mediaBindings, mediaCleanupJobs, mediaQuotas, mediaUploadSessions,
} from "../schema/media-assets"

/**
 * ENH-07-01: media schema contract (static inspection, not real SQL execution).
 *
 * The important guarantees are encoded in the schema itself: every asset row is
 * tenant-scoped, binding is same-tenant via a composite FK, quotas can be
 * unconfigured but never implied, and the legacy `media` table is untouched.
 */
const migration = readFileSync(
  new URL("../../../../supabase/migrations/20261021140000_media_assets.sql", import.meta.url),
  "utf8",
)

const columnNames = (columns: unknown): string[] =>
  ((columns as Array<{ name: string }> | undefined) ?? []).map(column => column.name)

describe("ENH-07-01: media asset schema", () => {
  it("scopes every asset by a non-null tenant and unique provider identity", () => {
    const config = getTableConfig(mediaAssets)
    const tenant = config.columns.find(column => column.name === "tenant_id")
    expect(tenant?.notNull).toBe(true)
    expect(config.columns.find(column => column.name === "state")?.notNull).toBe(true)
    expect(config.columns.find(column => column.name === "publication")?.notNull).toBe(true)
    expect(config.columns.find(column => column.name === "consent")?.notNull).toBe(true)
    const metadata = config.columns.find(column => column.name === "metadata")
    expect(metadata?.notNull).toBe(true)

    const identity = config.indexes.find(index => index.config.name === "media_assets_tenant_provider_public_id_key")
    expect(identity?.config.unique).toBe(true)
    expect(columnNames(identity?.config.columns)).toEqual(["tenant_id", "provider", "provider_public_id"])
    expect(migration).toContain("media_assets_tenant_provider_public_id_key")
  })

  it("carries the complete state/publication/consent vocabulary in schema and migration", () => {
    expect(getTableConfig(mediaAssets).checks.map(check => check.name).sort()).toEqual([
      "media_assets_bytes_check",
      "media_assets_consent_check",
      "media_assets_kind_check",
      "media_assets_provider_public_id_check",
      "media_assets_publication_check",
      "media_assets_state_check",
    ])
    for (const state of ["legacy_unverified", "pending", "processing", "ready", "quarantined", "failed", "deleted"]) {
      expect(migration).toContain(state)
    }
    expect(migration).toContain("publication IN")
    expect(migration).toContain("consent IN")
  })

  it("enforces same-tenant bindings with a composite foreign key", () => {
    const config = getTableConfig(mediaBindings)
    const fk = config.foreignKeys.find(key => key.getName() === "media_bindings_asset_tenant_fk")
    expect(fk).toBeDefined()
    const reference = fk!.reference()
    expect(columnNames(reference.columns)).toEqual(["asset_id", "tenant_id"])
    expect(columnNames(reference.foreignColumns)).toEqual(["id", "tenant_id"])
    expect(migration).toContain("FOREIGN KEY (asset_id, tenant_id) REFERENCES public.media_assets (id, tenant_id)")
    expect(migration).toContain("media_assets_id_tenant_key")
  })

  it("keeps upload sessions quota-reserved, expiring and tenant-scoped", () => {
    const config = getTableConfig(mediaUploadSessions)
    expect(config.columns.find(column => column.name === "reserved_bytes")?.notNull).toBe(true)
    expect(config.columns.find(column => column.name === "expires_at")?.notNull).toBe(true)
    expect(config.checks.map(check => check.name)).toContain("media_upload_sessions_bytes_check")
    const due = config.indexes.find(index => index.config.name === "media_upload_sessions_due_idx")
    expect(due?.config.where).toBeDefined()
    expect(migration).toContain("WHERE state = 'reserved'")
  })

  it("keeps quota limits nullable (unconfigured must refuse) and arithmetic non-negative", () => {
    const config = getTableConfig(mediaQuotas)
    expect(config.columns.find(column => column.name === "limit_bytes")?.notNull).toBe(false)
    expect(config.columns.find(column => column.name === "used_bytes")?.notNull).toBe(true)
    expect(config.checks.map(check => check.name)).toContain("media_quotas_bytes_check")
    expect(migration).toContain("limit_bytes bigint,")
  })

  it("bounds cleanup attempts and keeps the provider identity on the job", () => {
    const config = getTableConfig(mediaCleanupJobs)
    expect(config.checks.map(check => check.name).sort()).toEqual([
      "media_cleanup_jobs_action_check",
      "media_cleanup_jobs_attempts_check",
      "media_cleanup_jobs_state_check",
    ])
    expect(config.columns.find(column => column.name === "provider_public_id")?.notNull).toBe(true)
    expect(migration).toContain("attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8)")
  })
})

describe("ENH-07-01: migration discipline", () => {
  it("is additive and never rewrites or promotes the legacy media table", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.media_assets")
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS")
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i)
    // `media_assets` etc. are new; the legacy table itself is not altered.
    expect(migration).not.toMatch(/ALTER TABLE public\.media\s/)
    expect(migration).not.toMatch(/INSERT INTO public\.media\b/i)
  })

  it("forces RLS and grants only the server roles", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).toContain("REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated")
    expect(migration).toContain("TO ssl")
    expect(migration).toContain("TO service_role")
    expect(migration).not.toMatch(/GRANT .* TO anon/i)
  })
})
