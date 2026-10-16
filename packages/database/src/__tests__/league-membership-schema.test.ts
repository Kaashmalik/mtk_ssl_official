import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { userTenantRoles } from "../schema/user-tenant-roles"

const migration = readFileSync(new URL("../../../../supabase/migrations/20261012100136_league_membership_controls.sql", import.meta.url), "utf8")
describe("League membership expand migration and schema contracts (not real SQL execution)", () => {
  it("adds explicit league-only status and concurrency version", () => {
    expect(userTenantRoles.status.name).toBe("status")
    expect(userTenantRoles.status.default).toBe("active")
    expect(userTenantRoles.status.notNull).toBe(true)
    expect(userTenantRoles.version.default).toBe(0)
    expect(userTenantRoles.version.notNull).toBe(true)
  })
  it("declares database constraints rather than trusting enum types alone", () => {
    expect(getTableConfig(userTenantRoles).checks.map(check => check.name)).toEqual(["user_tenant_roles_status_check", "user_tenant_roles_version_check", "user_tenant_roles_expiry_check"])
    expect(migration).toContain("CHECK (status IN ('active', 'suspended'))")
    expect(migration).toContain("CHECK (version >= 0)")
  })
  it("backfills only absent legitimate memberships without copying global admin privilege", () => {
    expect(migration).toContain("ON CONFLICT (user_id, tenant_id) DO NOTHING")
    expect(migration).toContain("unnest(u.tenant_ids)")
    expect(migration).toContain("t.id = legacy.tenant_id")
    expect(migration).toContain("u.id = t.owner_id")
    expect(migration).toContain("WHEN u.role IN ('super_admin', 'league_owner') THEN 'fan'")
    expect(migration).toContain("WHEN t.owner_id = u.id THEN 'league_owner'")
    expect(migration).not.toMatch(/UPDATE\s+public\.users/i)
  })
  it("updates versions for every trusted writer, including invitation role changes", () => {
    expect(migration).toContain("NEW.version := OLD.version + 1")
    expect(migration).toContain("BEFORE UPDATE ON public.user_tenant_roles")
    expect(migration).toContain("SET search_path = ''")
    const versionFunction = migration.split("CREATE FUNCTION public.bump_league_membership_version()")[1].split("CREATE TRIGGER")[0]
    expect(versionFunction).not.toContain("SECURITY DEFINER")
  })
  it("direct authenticated membership mutation cannot bypass server/audit guards", () => {
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.user_tenant_roles FROM anon, authenticated")
    expect(migration).not.toMatch(/GRANT.*TO\s+anon/i)
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated")
  })
  it("RLS tenant resolution respects suspension/removal and account/league activation", () => {
    const helper = migration.split("CREATE OR REPLACE FUNCTION public.current_tenant_id()")[1].split("CREATE OR REPLACE FUNCTION public.is_super_admin()")[0]
    expect(helper).toContain("m.status = 'active'")
    expect(helper).toContain("u.is_active = true AND t.is_active = true")
    expect(helper).toContain("m.role <> 'super_admin'")
    expect(helper).not.toContain("tenant_ids")
    expect(helper).toContain("SET search_path = ''")
  })
  it("database platform override also requires an active account", () => {
    const helper = migration.split("CREATE OR REPLACE FUNCTION public.is_super_admin()")[1]
    expect(helper.match(/u\.role = 'super_admin' AND u\.is_active = true/g)).toHaveLength(2)
  })
  it("keeps the migration atomic and non-destructive", () => {
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i)
  })
  it("code pushes cannot automatically release this schema-dependent batch via the repository VPS job", () => {
    const workflow = readFileSync(new URL("../../../../.github/workflows/ci-cd.yaml", import.meta.url), "utf8")
    const deploy = workflow.split("  deploy-vps:")[1].split("  e2e:")[0]
    expect(deploy).toContain("if: github.ref == 'refs/heads/main' && vars.LEAGUE_MEMBERSHIP_CONTROLS_READY == 'true'")
  })
})
