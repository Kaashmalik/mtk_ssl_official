import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import {
  broadcastArchives, broadcastConnections, broadcastDestinations,
  broadcastJobs, broadcastSessions,
} from "../schema/broadcast"

/**
 * ENH-08-01/02: static schema/migration discipline.
 *
 * These pins do not execute SQL. They prove the additive migration and Drizzle
 * definitions agree on the guarantees that matter: every row is tenant-scoped,
 * provider identity and destinations cannot cross a tenant, desired/observed
 * states are distinct, credentials are references, and archive/job retries are
 * bounded.
 */

const migration = readFileSync(
  new URL("../../../../supabase/migrations/20261021150000_broadcast_provider.sql", import.meta.url),
  "utf8",
)

const columnNames = (columns: unknown): string[] =>
  ((columns as Array<{ name: string }> | undefined) ?? []).map(column => column.name)

describe("ENH-08-01: provider ownership schema", () => {
  it("scopes every connection/destination to one tenant and provider identity", () => {
    const connection = getTableConfig(broadcastConnections)
    expect(connection.columns.find(column => column.name === "tenant_id")?.notNull).toBe(true)
    expect(connection.columns.find(column => column.name === "credential_ref")?.notNull).toBe(true)
    const identity = connection.indexes.find(index =>
      index.config.name === "broadcast_connections_tenant_provider_account_key")
    expect(identity?.config.unique).toBe(true)
    expect(columnNames(identity?.config.columns))
      .toEqual(["tenant_id", "provider", "external_account_id"])

    const destination = getTableConfig(broadcastDestinations)
    const fk = destination.foreignKeys.find(key =>
      key.getName() === "broadcast_destinations_connection_tenant_fk")
    expect(fk).toBeDefined()
    expect(columnNames(fk!.reference().columns)).toEqual(["connection_id", "tenant_id"])
    expect(columnNames(fk!.reference().foreignColumns)).toEqual(["id", "tenant_id"])
    expect(migration).toContain(
      "FOREIGN KEY (connection_id, tenant_id)\n    REFERENCES public.broadcast_connections (id, tenant_id)",
    )
  })

  it("keeps desired intent and observed provider truth as separate constrained columns", () => {
    const config = getTableConfig(broadcastSessions)
    expect(config.columns.find(column => column.name === "desired_state")?.notNull).toBe(true)
    expect(config.columns.find(column => column.name === "observed_state")?.notNull).toBe(true)
    expect(config.columns.find(column => column.name === "playback_available")?.notNull).toBe(true)
    expect(config.columns.find(column => column.name === "ingest_secret_ref")?.notNull).toBe(false)
    expect(config.checks.map(check => check.name)).toContain("broadcast_sessions_desired_check")
    expect(config.checks.map(check => check.name)).toContain("broadcast_sessions_observed_check")
    expect(migration).toContain("desired_state text NOT NULL DEFAULT 'draft'")
    expect(migration).toContain("observed_state text NOT NULL DEFAULT 'unconfigured'")
  })

  it("binds sessions to the exact tenant's match, connection and destination", () => {
    const config = getTableConfig(broadcastSessions)
    for (const name of [
      "broadcast_sessions_match_tenant_fk",
      "broadcast_sessions_connection_tenant_fk",
      "broadcast_sessions_destination_tenant_fk",
    ]) {
      expect(config.foreignKeys.find(key => key.getName() === name)).toBeDefined()
    }
    expect(migration).toContain("FOREIGN KEY (match_id, tenant_id)")
    expect(migration).toContain("REFERENCES public.matches (id, tenant_id)")
    expect(migration).toContain("UNIQUE INDEX IF NOT EXISTS broadcast_sessions_match_session_key")
  })
})

describe("ENH-08-02: durable jobs and archive references", () => {
  it("gives each provider request one tenant-scoped idempotency key", () => {
    const config = getTableConfig(broadcastJobs)
    const unique = config.indexes.find(index =>
      index.config.name === "broadcast_jobs_tenant_idempotency_key")
    expect(unique?.config.unique).toBe(true)
    expect(columnNames(unique?.config.columns)).toEqual(["tenant_id", "idempotency_key"])
    expect(config.checks.map(check => check.name)).toContain("broadcast_jobs_attempts_check")
    expect(migration).toContain("CONSTRAINT broadcast_jobs_attempts_check")
    expect(migration).toContain("CHECK (attempts >= 0 AND attempts <= max_attempts)")
  })

  it("keeps archive state tied to a session and never implies provider readiness", () => {
    const config = getTableConfig(broadcastArchives)
    expect(config.checks.map(check => check.name).sort()).toEqual([
      "broadcast_archives_duration_check",
      "broadcast_archives_status_check",
    ])
    expect(migration).toContain("status text NOT NULL DEFAULT 'pending'")
    expect(migration).toContain("'processing','ready','failed','expired'")
  })
})

describe("ENH-08: migration discipline", () => {
  it("is additive, transaction-wrapped and never rewrites legacy stream columns", () => {
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.broadcast_sessions")
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS")
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i)
    expect(migration).not.toMatch(/ALTER TABLE public\.matches\s/)
    expect(migration).not.toMatch(/INSERT INTO public\.matches\b/i)
    expect(migration).not.toMatch(/live_stream_url\s*=/i)
  })

  it("forces RLS and grants only server roles", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).toContain("REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated")
    expect(migration).toContain("TO ssl")
    expect(migration).toContain("TO service_role")
    expect(migration).not.toMatch(/GRANT .* TO anon/i)
  })
})
