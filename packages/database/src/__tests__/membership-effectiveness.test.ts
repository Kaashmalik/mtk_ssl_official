import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { userTenantRoles } from "../schema/user-tenant-roles"
import { membershipGrantsAccess, parseMembershipExpiry } from "../lib/membership-effectiveness"

const migration = readFileSync(new URL("../../../../supabase/migrations/20261016120000_membership_expiry_delegation.sql", import.meta.url), "utf8")
  // Windows checkouts use CRLF; the pinned substrings are written with \n.
  .replace(/\r\n/g, "\n")
const NOW = new Date("2026-10-16T12:00:00.000Z")

describe("Membership effectiveness policy (SCORE-09, pure decisions)", () => {
  it.each([
    ["active without a bound", { status: "active", expiresAt: null }, true],
    ["active with a future bound", { status: "active", expiresAt: "2026-10-16T12:00:00.001Z" }, true],
    ["active exactly at expiry (strictly greater required)", { status: "active", expiresAt: "2026-10-16T12:00:00.000Z" }, false],
    ["active but expired", { status: "active", expiresAt: "2026-10-16T11:59:59.999Z" }, false],
    ["suspended without a bound", { status: "suspended", expiresAt: null }, false],
    ["suspended with a future bound", { status: "suspended", expiresAt: "2027-01-01T00:00:00.000Z" }, false],
    ["missing membership", null, false],
  ])("grants access for %s: %p -> %p", (_name, membership, expected) => {
    expect(membershipGrantsAccess(membership as never, NOW)).toBe(expected)
  })

  it("fails closed on malformed bounds instead of treating them as unbounded", () => {
    expect(membershipGrantsAccess({ status: "active", expiresAt: "not-a-date" }, NOW)).toBe(false)
    expect(membershipGrantsAccess({ status: "active", expiresAt: "" }, NOW)).toBe(false)
    expect(membershipGrantsAccess({ status: "active", expiresAt: 42 as never }, NOW)).toBe(false)
    expect(parseMembershipExpiry("2026-10-16T13:00:00.000Z")).toEqual(new Date("2026-10-16T13:00:00.000Z"))
    expect(parseMembershipExpiry(undefined)).toBeNull()
  })

  it("defaults to the caller clock but always honors an explicit one", () => {
    const membership = { status: "active", expiresAt: "2099-01-01T00:00:00.000Z" }
    expect(membershipGrantsAccess(membership)).toBe(true)
    expect(membershipGrantsAccess(membership, new Date("2099-01-01T00:00:01.000Z"))).toBe(false)
  })
})

describe("Bounded membership schema and migration contracts (not executed PostgreSQL)", () => {
  it("adds an optional expiry and delegation provenance to memberships", () => {
    const config = getTableConfig(userTenantRoles)
    const column = (name: string) => config.columns.find(c => c.name === name)
    expect(column("expires_at")?.notNull).toBe(false)
    expect(column("delegated_by_user_id")?.notNull).toBe(false)
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS expires_at timestamptz")
    expect(migration).toContain("REFERENCES public.users(id) ON DELETE SET NULL")
  })

  it("keeps a bound chronologically sane via a database check", () => {
    const names = getTableConfig(userTenantRoles).checks.map(check => check.name)
    expect(names).toContain("user_tenant_roles_expiry_check")
    expect(migration).toContain("CHECK (expires_at IS NULL OR expires_at > created_at)")
    expect(migration).toContain("WHEN duplicate_object THEN NULL")
  })

  it("indexes bounded memberships per league for admin sweeps", () => {
    const partial = getTableConfig(userTenantRoles).indexes.find(i => i.config.name === "idx_user_tenant_roles_expires_at")
    expect(partial?.config.where).toBeDefined()
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_expires_at")
    expect(migration).toContain("WHERE expires_at IS NOT NULL")
  })

  it("is additive, idempotent and never destructive", () => {
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE|DROP COLUMN/i)
    expect(migration).toContain("Local and\n-- unapplied until the Batch 65 rollout gates are cleared")
  })
})
