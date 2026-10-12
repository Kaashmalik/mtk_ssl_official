import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { auditLogs, notifications, teams, userInvites, userTenantRoles, users } from "@mtk/database"
import { acceptInvite, createInvite, getInvites, getInvitePreview, revokeInvite } from "@/app/actions/users-invites"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), provider: vi.fn(), context: vi.fn(), actor: vi.fn(), initial: vi.fn(),
  publicLeague: vi.fn(), publicTeam: vi.fn(), issuer: vi.fn(), recipient: vi.fn(), league: vi.fn(), member: vi.fn(),
  lockedInvite: vi.fn(), team: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
  update: vi.fn(), set: vi.fn(), where: vi.fn(), returning: vi.fn(), insert: vi.fn(), values: vi.fn(), insertReturn: vi.fn(),
  select: vi.fn(), listWhere: vi.fn(), order: vi.fn(), limit: vi.fn(), revalidate: vi.fn(), fetch: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, currentUser: mocks.provider }))
vi.mock("@/lib/dashboard-context", () => ({ getDashboardContext: mocks.context }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: {
  query: { users: { findFirst: mocks.actor }, userInvites: { findFirst: mocks.initial }, tenants: { findFirst: mocks.publicLeague }, teams: { findFirst: mocks.publicTeam } },
  transaction: mocks.transaction, select: mocks.select,
} }))
const A = "00000000-0000-4000-8000-000000000001"
const ALI = "00000000-0000-4000-8000-000000000002"
const OWNER = "00000000-0000-4000-8000-000000000003"
const INVITE = "00000000-0000-4000-8000-000000000004"
const TEAM = "00000000-0000-4000-8000-000000000005"
const B = "00000000-0000-4000-8000-000000000006"
const TOKEN = "a".repeat(43)
const HASH = createHash("sha256").update(TOKEN).digest("hex")
const invite = { id: INVITE, tenantId: A, invitedBy: OWNER, email: "ali@example.test", role: "scorer", status: "pending", teamId: null,
  tokenHash: HASH, expiresAt: new Date("2099-01-01T00:00:00Z") }
const ownerMember = { userId: OWNER, tenantId: A, role: "league_owner", status: "active" }
const recipient = { id: ALI, clerkId: "clerk-ali", isActive: true, email: "obsolete@application.test" }
const provider = { id: "clerk-ali", emailAddresses: [{ emailAddress: invite.email, verification: { status: "verified" } }] }
const dialect = new PgDialect()
const query = (value: any) => dialect.sqlToQuery(value)
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("RESEND_API_KEY", "")
  vi.stubEnv("WEB_APP_URL", "https://app.example.test")
  vi.stubGlobal("fetch", mocks.fetch)
  mocks.auth.mockResolvedValue({ userId: "clerk-ali" })
  mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: OWNER, role: "league_owner" } })
  mocks.actor.mockResolvedValue(recipient)
  mocks.initial.mockResolvedValue(invite)
  mocks.provider.mockResolvedValue(provider)
  mocks.issuer.mockResolvedValue({ id: OWNER, clerkId: "clerk-owner", isActive: true, displayName: "Owner" })
  mocks.recipient.mockResolvedValue(recipient)
  mocks.league.mockResolvedValue({ id: A, name: "League A", isActive: true })
  mocks.publicLeague.mockResolvedValue({ id: A, name: "League A", isActive: true })
  mocks.member.mockResolvedValueOnce(ownerMember).mockResolvedValue(null)
  mocks.lockedInvite.mockResolvedValue(invite)
  mocks.team.mockResolvedValueOnce({ id: TEAM, tenantId: A, managerId: null, isActive: true }).mockResolvedValue(null)
  mocks.publicTeam.mockResolvedValue({ id: TEAM, tenantId: A, name: "Team A", isActive: true })
  mocks.execute.mockResolvedValue([])
  mocks.update.mockReturnValue({ set: mocks.set }); mocks.set.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ returning: mocks.returning }); mocks.returning.mockResolvedValue([{ id: INVITE }])
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockImplementation(() => Object.assign(Promise.resolve(undefined), { returning: mocks.insertReturn }))
  mocks.insertReturn.mockResolvedValue([{ id: INVITE }])
  mocks.transaction.mockImplementation(async fn => fn({ execute: mocks.execute,
    query: { users: { findFirst: (input: any) => query(input.where).params[0] === OWNER ? mocks.issuer(input) : mocks.recipient(input) },
      userTenantRoles: { findFirst: mocks.member }, tenants: { findFirst: mocks.league }, userInvites: { findFirst: mocks.lockedInvite }, teams: { findFirst: mocks.team } },
    insert: mocks.insert, update: mocks.update,
  }))
  mocks.select.mockReturnValue({ from: () => ({ where: mocks.listWhere }) })
  mocks.listWhere.mockReturnValue({ orderBy: mocks.order }); mocks.order.mockReturnValue({ limit: mocks.limit }); mocks.limit.mockResolvedValue([])
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function issuing() { mocks.lockedInvite.mockResolvedValue(null); mocks.auth.mockResolvedValue({ userId: "clerk-owner" }) }
const create = () => createInvite({ tenantId: A, email: " ALI@example.test ", role: "scorer" })

describe("Verified recipient and transactional invitation acceptance", () => {
  it("accepts verified invited email despite stale application email; never alters global users/roles/arrays", async () => {
    expect(await acceptInvite(TOKEN)).toEqual({ success: true, role: "scorer", tenantId: A })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(userInvites)
    expect(mocks.update).not.toHaveBeenCalledWith(users)
    expect(mocks.insert.mock.calls.map(([table]) => table)).toEqual([userTenantRoles, auditLogs, notifications])
    expect(mocks.values.mock.calls[0][0]).toEqual({ userId: ALI, tenantId: A, role: "scorer", isPrimary: false })
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard", "layout")
  })
  it.each([null, { ...provider, id: "clerk-other" }, { ...provider, emailAddresses: [] },
    { ...provider, emailAddresses: [{ emailAddress: invite.email, verification: { status: "unverified" } }] },
    { ...provider, emailAddresses: [{ emailAddress: "other@example.test", verification: { status: "verified" } }] }])("rejects invalid/unverified provider identity %s before transactions", async identity => {
    mocks.provider.mockResolvedValue(identity)
    await expect(acceptInvite(TOKEN)).rejects.toThrow("Verify the invited email")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("provider failure never falls back to application email", async () => {
    mocks.actor.mockResolvedValue({ ...recipient, email: invite.email })
    mocks.provider.mockRejectedValue(new Error("Provider unavailable"))
    await expect(acceptInvite(TOKEN)).rejects.toThrow("Provider unavailable")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("locks issuer and recipient in order, league, memberships, then exact invitation", async () => {
    await acceptInvite(TOKEN)
    const locks = mocks.execute.mock.calls.map(([value]) => query(value))
    expect(locks).toHaveLength(4)
    expect(locks[0].params).toEqual([ALI, OWNER].sort())
    expect(locks[0].sql).toContain("ORDER BY")
    expect(locks[1].params).toEqual([A]); expect(locks[1].sql).toContain("FOR SHARE")
    expect(locks[2].params).toEqual([A, ...[ALI, OWNER].sort()])
    expect(locks[3].params).toEqual([INVITE, A]); expect(locks[3].sql).toContain("FOR UPDATE")
  })
  it.each([{ ...ownerMember, status: "suspended" }, { ...ownerMember, role: "scorer" },
    { ...ownerMember, tenantId: B }, { ...ownerMember, userId: ALI }, null])("rechecks issuer membership %s", async membership => {
    mocks.member.mockReset().mockResolvedValue(membership)
    await expect(acceptInvite(TOKEN)).rejects.toThrow("authority changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([{ id: OWNER, isActive: false }, { id: ALI, isActive: true }, null])("rechecks issuer account %s", async issuer => {
    mocks.issuer.mockResolvedValue(issuer)
    await expect(acceptInvite(TOKEN)).rejects.toThrow("authority changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([{ id: A, isActive: false }, { id: B, isActive: true }, null])("rechecks league %s", async league => {
    mocks.league.mockResolvedValue(league)
    await expect(acceptInvite(TOKEN)).rejects.toThrow("authority changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([{ ...recipient, isActive: false }, { ...recipient, clerkId: "different" }, { ...recipient, id: OWNER }, null])("rechecks recipient account %s", async account => {
    mocks.recipient.mockResolvedValue(account)
    await expect(acceptInvite(TOKEN)).rejects.toThrow("account access changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each(["accepted", "revoked", "expired"])("rejects locked invitation status %s", async status => {
    mocks.lockedInvite.mockResolvedValue({ ...invite, status })
    await expect(acceptInvite(TOKEN)).rejects.toThrow("expired, revoked or already used")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([{ expiresAt: new Date(0) }, { tenantId: B }, { invitedBy: ALI }, { tokenHash: "rotated" }, { id: B }])("rechecks locked invitation %s", async changes => {
    mocks.lockedInvite.mockResolvedValue({ ...invite, ...changes })
    await expect(acceptInvite(TOKEN)).rejects.toThrow("expired, revoked or already used")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("recipient email change between preview and claim cannot use earlier verification", async () => {
    mocks.lockedInvite.mockResolvedValue({ ...invite, email: "other@example.test" })
    await expect(acceptInvite(TOKEN)).rejects.toThrow("recipient changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("suspended recipient membership cannot be reactivated", async () => {
    mocks.member.mockReset().mockResolvedValueOnce(ownerMember).mockResolvedValue({ userId: ALI, tenantId: A, role: "scorer", status: "suspended" })
    await expect(acceptInvite(TOKEN)).rejects.toThrow("membership is suspended")
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it.each(["fan", "player", "coach", "team_manager", "league_owner", "super_admin"])("cannot promote, demote or swap existing role %s by hierarchy", async role => {
    mocks.member.mockReset().mockResolvedValueOnce(ownerMember).mockResolvedValue({ userId: ALI, tenantId: A, role, status: "active" })
    await expect(acceptInvite(TOKEN)).rejects.toThrow("Existing league role differs")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("same active role accepts without rewriting/versioning the membership", async () => {
    mocks.member.mockReset().mockResolvedValueOnce(ownerMember).mockResolvedValue({ userId: ALI, tenantId: A, role: "scorer", status: "active" })
    await acceptInvite(TOKEN)
    expect(mocks.insert).not.toHaveBeenCalledWith(userTenantRoles)
    expect(mocks.update).not.toHaveBeenCalledWith(userTenantRoles)
  })
  it("claim includes hash, exact tenant, pending status and wall-clock expiry after lock waits", async () => {
    await acceptInvite(TOKEN)
    expect(query(mocks.where.mock.calls[0][0]).params).toEqual([INVITE, A, HASH, "pending"])
    expect(query(mocks.where.mock.calls[0][0]).sql).toContain('"expires_at" > clock_timestamp()')
  })
  it("lost conditional claim has no grant/audit/notification side effects", async () => {
    mocks.returning.mockResolvedValue([])
    await expect(acceptInvite(TOKEN)).rejects.toThrow("expired, revoked or already used")
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("audit failure rejects success in the same transaction (real rollback remains a staging gate)", async () => {
    mocks.values.mockImplementation(value => {
      if (value.method === "INVITE_ACCEPT") return Promise.reject(new Error("Audit failed"))
      return Promise.resolve(undefined)
    })
    await expect(acceptInvite(TOKEN)).rejects.toThrow("Audit failed")
    expect(mocks.insert).not.toHaveBeenCalledWith(notifications)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("acceptance audits IDs and role without invitation secrets/email", async () => {
    await acceptInvite(TOKEN)
    const audit = mocks.values.mock.calls.find(([value]) => value.method === "INVITE_ACCEPT")![0]
    expect(audit).toMatchObject({ actorId: ALI, tenantId: A, payload: { inviteId: INVITE, issuerId: OWNER, role: "scorer", teamId: null, membershipCreated: true } })
    expect(JSON.stringify(audit)).not.toContain(TOKEN)
    expect(JSON.stringify(audit)).not.toContain(invite.email)
  })
  it.each([null, { ...invite, invitedBy: null }])("missing issuer/invite %s is unavailable", async row => {
    mocks.initial.mockResolvedValue(row)
    await expect(acceptInvite(TOKEN)).rejects.toThrow("unavailable")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each(["", "secret-token", "a".repeat(10000)])("invalid token cannot query the database", async token => {
    await expect(acceptInvite(token)).rejects.toThrow()
    expect(mocks.actor).not.toHaveBeenCalled()
    expect(await getInvitePreview(token)).toBeNull()
    expect(mocks.initial).not.toHaveBeenCalled()
  })
  it("requires authentication", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(acceptInvite(TOKEN)).rejects.toThrow("Sign in")
    expect(mocks.actor).not.toHaveBeenCalled()
  })
})

describe("Team resources are exact-league, active and assignment-safe", () => {
  const managerInvite = { ...invite, role: "team_manager", teamId: TEAM }
  beforeEach(() => { mocks.initial.mockResolvedValue(managerInvite); mocks.lockedInvite.mockResolvedValue(managerInvite) })
  it("grants manager membership and only the exact active team", async () => {
    await acceptInvite(TOKEN)
    expect(mocks.update.mock.calls.map(([table]) => table)).toEqual([userInvites, teams])
    expect(query(mocks.where.mock.calls[1][0]).params).toEqual([TEAM, A, true, ALI])
    expect(query(mocks.team.mock.calls[1][0].where).params).toEqual([A, ALI, TEAM])
  })
  it.each([null, { id: TEAM, tenantId: B, isActive: true, managerId: null },
    { id: TEAM, tenantId: A, isActive: false, managerId: null },
    { id: TEAM, tenantId: A, isActive: true, managerId: OWNER }])("rejects unavailable/cross-league/taken team %s before claim", async team => {
    mocks.team.mockReset().mockResolvedValue(team)
    await expect(acceptInvite(TOKEN)).rejects.toThrow("Invited team is unavailable")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("rejects a second team assignment instead of relying on arbitrary first-team lookup", async () => {
    mocks.team.mockReset().mockResolvedValueOnce({ id: TEAM, tenantId: A, isActive: true, managerId: null }).mockResolvedValue({ id: B })
    await expect(acceptInvite(TOKEN)).rejects.toThrow("already manage another team")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("conditional team-assignment failure rejects transaction success", async () => {
    mocks.returning.mockResolvedValueOnce([{ id: INVITE }]).mockResolvedValueOnce([])
    await expect(acceptInvite(TOKEN)).rejects.toThrow("Team assignment changed")
    expect(mocks.insert).not.toHaveBeenCalledWith(auditLogs)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each([{ role: "super_admin", teamId: null }, { role: "scorer", teamId: TEAM }, { role: "coach", teamId: TEAM }, { role: "team_manager", teamId: null }])("rejects privileged/unsupported scope %s", async changes => {
    mocks.lockedInvite.mockResolvedValue({ ...managerInvite, ...changes })
    await expect(acceptInvite(TOKEN)).rejects.toThrow()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe("Owner issuance, revocation and truthful synchronous dispatch", () => {
  beforeEach(issuing)
  it("saves normalized hashed-token invitation and atomic audit; unconfigured email stays explicit", async () => {
    const result = await create()
    expect(result.emailState).toBe("unconfigured")
    expect(result).not.toHaveProperty("emailDelivered")
    expect(mocks.fetch).not.toHaveBeenCalled()
    const value = mocks.values.mock.calls[0][0]
    const plain = new URL(result.link).searchParams.get("token")!
    expect(value).toMatchObject({ tenantId: A, invitedBy: OWNER, email: invite.email, role: "scorer", teamId: null })
    expect(value.tokenHash).toBe(createHash("sha256").update(plain).digest("hex"))
    expect(JSON.stringify(value)).not.toContain(plain)
    expect(query(mocks.execute.mock.calls[1][0]).sql).toContain("FOR UPDATE")
    expect(mocks.insert).toHaveBeenCalledWith(auditLogs)
  })
  it("provider acceptance is not delivery; request has bounded timeout/idempotency key", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-only")
    mocks.fetch.mockResolvedValue({ ok: true })
    expect((await create()).emailState).toBe("provider_accepted")
    const options = mocks.fetch.mock.calls[0][1]
    expect(options.headers["Idempotency-Key"]).toBe(`league-invite/${INVITE}`)
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })
  it("provider rejection does not delete the confirmed pending invitation", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-only"); mocks.fetch.mockResolvedValue({ ok: false, status: 422 })
    expect((await create()).emailState).toBe("failed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([408, 409, 500, 503])("provider HTTP %s leaves the delivery outcome unknown", async status => {
    vi.stubEnv("RESEND_API_KEY", "test-only"); mocks.fetch.mockResolvedValue({ ok: false, status })
    expect((await create()).emailState).toBe("unknown")
  })
  it("network/timeout ambiguity reports unknown and never logs link or provider errors", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-only"); mocks.fetch.mockRejectedValue(new Error(`Secret ${TOKEN}`))
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect((await create()).emailState).toBe("unknown")
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled()
  })
  it("duplicate live invitation cannot issue a second token/email", async () => {
    mocks.lockedInvite.mockResolvedValue(invite)
    await expect(create()).rejects.toThrow("live pending invite")
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled()
    expect(query(mocks.lockedInvite.mock.calls[0][0].where).params).toEqual([A, invite.email, "scorer", "pending"])
  })
  it.each(["scorer", "fan", "team_manager", "super_admin"])("denies management to context role %s", async role => {
    mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: OWNER, role } })
    await expect(create()).rejects.toThrow("Forbidden")
    await expect(getInvites(A)).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.select).not.toHaveBeenCalled()
  })
  it("workspace assertions stop stale create/list/revoke commands", async () => {
    await expect(createInvite({ tenantId: B, email: invite.email, role: "scorer" })).rejects.toThrow("Workspace changed")
    await expect(getInvites(B)).rejects.toThrow("Workspace changed")
    await expect(revokeInvite({ tenantId: B, inviteId: INVITE })).rejects.toThrow("Workspace changed")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("revocation conditionally changes only the active league invite with atomic audit", async () => {
    await revokeInvite({ tenantId: A, inviteId: INVITE })
    expect(query(mocks.where.mock.calls[0][0]).params).toEqual([INVITE, A, "pending"])
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(userInvites)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ method: "INVITE_REVOKE", tenantId: A }))
  })
  it("resolved/missing invite cannot be revoked or audited as success", async () => {
    mocks.returning.mockResolvedValue([])
    await expect(revokeInvite({ tenantId: A, inviteId: INVITE })).rejects.toThrow("already resolved")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("issuance rechecks role under lock before email or grant creation", async () => {
    mocks.member.mockReset().mockResolvedValue({ ...ownerMember, status: "suspended" })
    await expect(create()).rejects.toThrow("authority changed")
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("issuance rechecks the Clerk-to-database actor mapping under lock", async () => {
    mocks.issuer.mockResolvedValue({ id: OWNER, clerkId: "clerk-other", isActive: true })
    await expect(create()).rejects.toThrow("authority changed")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("creation audit failure means no email attempt/success", async () => {
    mocks.values.mockImplementation(value => value.method ? Promise.reject(new Error("Audit failed")) : { returning: mocks.insertReturn })
    await expect(create()).rejects.toThrow("Audit failed")
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("team-manager issuance requires an active unassigned team in the same league", async () => {
    mocks.team.mockReset().mockResolvedValue({ id: TEAM, tenantId: B, isActive: true, managerId: null })
    await expect(createInvite({ tenantId: A, email: invite.email, role: "team_manager", teamId: TEAM })).rejects.toThrow("Team is unavailable")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("private list is bounded/tenant-scoped and does not expose hashes or pretend expired links are pending", async () => {
    await getInvites(A)
    expect(query(mocks.listWhere.mock.calls[0][0]).params).toEqual([A])
    expect(mocks.limit).toHaveBeenCalledWith(100)
    const fields = mocks.select.mock.calls[0][0]
    expect(fields).not.toHaveProperty("tokenHash")
    expect(query(fields.status).sql).toContain("clock_timestamp()")
  })
})

describe("Preview privacy and stale/invalid link behavior", () => {
  it("signed-out bearer preview masks email and never exposes hashes/issuer IDs", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    expect(await getInvitePreview(TOKEN)).toMatchObject({ recipientHint: "a***@example.test", recipientEmail: null, tenantName: "League A" })
    expect(mocks.provider).not.toHaveBeenCalled()
    expect(await getInvitePreview(TOKEN)).not.toHaveProperty("tokenHash")
  })
  it("full invited email is only returned for the matching provider account", async () => {
    expect((await getInvitePreview(TOKEN))?.recipientEmail).toBe(invite.email)
    mocks.provider.mockResolvedValue({ ...provider, id: "other" })
    expect((await getInvitePreview(TOKEN))?.recipientEmail).toBeNull()
  })
  it.each(["accepted", "revoked", "expired"])("resolved status %s has no actionable preview", async status => {
    mocks.initial.mockResolvedValue({ ...invite, status })
    expect(await getInvitePreview(TOKEN)).toBeNull()
  })
  it("inactive league has no actionable preview", async () => {
    mocks.publicLeague.mockResolvedValue({ id: A, isActive: false })
    expect(await getInvitePreview(TOKEN)).toBeNull()
  })
  it("team preview requires exact same-league active resource", async () => {
    mocks.initial.mockResolvedValue({ ...invite, role: "team_manager", teamId: TEAM })
    mocks.publicTeam.mockResolvedValue({ id: TEAM, tenantId: B, isActive: true })
    expect(await getInvitePreview(TOKEN)).toBeNull()
  })
})
