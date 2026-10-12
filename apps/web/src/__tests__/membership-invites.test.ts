import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { userInvites, userTenantRoles, users } from "@mtk/database"
import { acceptInvite, createInvite } from "@/app/actions/users-invites"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), tenant: vi.fn(), permission: vi.fn(),
  limit: vi.fn(), select: vi.fn(), from: vi.fn(), where: vi.fn(),
  insert: vi.fn(), values: vi.fn(), returning: vi.fn(), transaction: vi.fn(),
  txLimit: vi.fn(), execute: vi.fn(), txUpdate: vi.fn(), txSet: vi.fn(), txWhere: vi.fn(), txReturn: vi.fn(),
  txInsert: vi.fn(), txValues: vi.fn(), fetch: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.tenant }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: mocks.permission }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(),
  db: { select: mocks.select, insert: mocks.insert, transaction: mocks.transaction },
  withTenantContext: async (_context: unknown, fn: () => Promise<unknown>) => fn(),
}))
const A = "00000000-0000-4000-8000-000000000001"
const ALI = "00000000-0000-4000-8000-000000000002"
const invite = { id: "invite", tenantId: A, email: "ali@example.test", role: "scorer", status: "pending", teamId: null,
  expiresAt: new Date("2099-01-01T00:00:00Z") }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("RESEND_API_KEY", "")
  vi.stubGlobal("fetch", mocks.fetch)
  vi.spyOn(console, "warn").mockImplementation(() => {})
  mocks.auth.mockResolvedValue({ userId: "clerk-ali" })
  mocks.tenant.mockResolvedValue({ id: A, name: "League A" })
  mocks.select.mockReturnValue({ from: mocks.from }); mocks.from.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ limit: mocks.limit })
  mocks.insert.mockReturnValue({ values: mocks.values }); mocks.values.mockReturnValue({ returning: mocks.returning })
  mocks.returning.mockResolvedValue([invite])
  mocks.execute.mockResolvedValue([])
  mocks.txUpdate.mockReturnValue({ set: mocks.txSet }); mocks.txSet.mockReturnValue({ where: mocks.txWhere })
  mocks.txWhere.mockImplementation(() => Object.assign(Promise.resolve(undefined), { returning: mocks.txReturn }))
  mocks.txReturn.mockResolvedValue([{ id: "invite" }])
  mocks.txInsert.mockReturnValue({ values: mocks.txValues }); mocks.txValues.mockResolvedValue(undefined)
  mocks.transaction.mockImplementation(async fn => fn({ execute: mocks.execute,
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.txLimit }) }) }),
    update: mocks.txUpdate, insert: mocks.txInsert,
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function acceptance(membership: unknown, isActive = true) {
  mocks.limit.mockResolvedValueOnce([invite]).mockResolvedValueOnce([{ id: ALI, email: invite.email }])
  mocks.txLimit.mockResolvedValueOnce([{ isActive }]).mockResolvedValueOnce(membership ? [membership] : [])
}
describe("Invitations cannot bypass league suspension; basic provider acceptance is truthful", () => {
  it("unconfigured email never reports acceptance or logs a secret", async () => {
    mocks.limit.mockResolvedValueOnce([{ id: ALI, email: invite.email }]).mockResolvedValueOnce([])
    const result = await createInvite({ email: invite.email, role: "scorer" })
    expect(result.emailAccepted).toBe(false)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
    expect(result.link).toContain("/accept-invite?token=")
  })
  it("provider success means accepted, never verified delivery", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-only")
    mocks.limit.mockResolvedValueOnce([{ id: ALI, email: invite.email }]).mockResolvedValueOnce([])
    mocks.fetch.mockResolvedValue({ ok: true })
    const result = await createInvite({ email: invite.email, role: "scorer" })
    expect(result.emailAccepted).toBe(true)
    expect(result).not.toHaveProperty("emailDelivered")
  })
  it("failed provider dispatch preserves pending invite without secret-bearing logs", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-only")
    mocks.limit.mockResolvedValueOnce([{ id: ALI, email: invite.email }]).mockResolvedValueOnce([])
    mocks.fetch.mockResolvedValue({ ok: false, status: 503 })
    const result = await createInvite({ email: invite.email, role: "scorer" })
    expect(result.emailAccepted).toBe(false)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(result.link)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(invite.email)
  })
  it("suspended membership cannot be reactivated or upgraded by accepting an old invite", async () => {
    acceptance({ id: "membership", role: "fan", status: "suspended" })
    await expect(acceptInvite("secret-token")).rejects.toThrow("membership is suspended")
    expect(mocks.txUpdate).toHaveBeenCalledExactlyOnceWith(userInvites)
    expect(mocks.txInsert).not.toHaveBeenCalled()
    // The conditional claim is in the same transaction; real rollback is a staging gate.
  })
  it("global account suspension is rechecked after the user lock", async () => {
    acceptance(null, false)
    await expect(acceptInvite("secret-token")).rejects.toThrow("account is inactive")
    expect(mocks.txUpdate).not.toHaveBeenCalled()
    expect(mocks.txInsert).not.toHaveBeenCalled()
  })
  it("claim predicate rechecks pending/tenant/expiry at the database, not just preview time", async () => {
    acceptance({ id: "membership", role: "league_owner", status: "active" })
    await acceptInvite("secret-token")
    const query = new PgDialect().sqlToQuery(mocks.txWhere.mock.calls[0][0])
    expect(query.params).toEqual(["invite", A, "pending"])
    expect(query.sql).toContain('"expires_at" > now()')
    const lock = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0])
    expect(lock.params).toEqual([ALI])
    expect(lock.sql).toContain("FOR UPDATE")
    expect(mocks.txUpdate).not.toHaveBeenCalledWith(userTenantRoles)
  })
  it("lost/expired/revoked atomic claim has no membership/notification side effects", async () => {
    acceptance(null)
    mocks.txReturn.mockResolvedValue([])
    await expect(acceptInvite("secret-token")).rejects.toThrow("already accepted")
    expect(mocks.txInsert).not.toHaveBeenCalled()
    expect(mocks.txUpdate).toHaveBeenCalledExactlyOnceWith(userInvites)
  })
  it("existing active owner is never demoted by a scorer invitation", async () => {
    acceptance({ id: "membership", role: "league_owner", status: "active" })
    await acceptInvite("secret-token")
    expect(mocks.txUpdate).not.toHaveBeenCalledWith(userTenantRoles)
    expect(mocks.txUpdate.mock.calls.map(([table]) => table)).toEqual([userInvites, users])
  })
})
