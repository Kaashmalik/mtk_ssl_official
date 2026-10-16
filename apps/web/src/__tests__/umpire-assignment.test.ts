import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { auditLogs, matches } from "@mtk/database"
import { assignUmpire, approveUmpireAssignment, getUmpiresForTenant } from "@/app/actions/matches"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), tenant: vi.fn(), myTenant: vi.fn(),
  where: vi.fn(), limit: vi.fn(), set: vi.fn(), updateWhere: vi.fn(), returning: vi.fn(), context: vi.fn(),
  transaction: vi.fn(), execute: vi.fn(), match: vi.fn(), user: vi.fn(), member: vi.fn(), league: vi.fn(),
  update: vi.fn(), directUpdate: vi.fn(), insert: vi.fn(), values: vi.fn(), revalidate: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: mocks.permission, resolveActiveTenantId: mocks.tenant }))
vi.mock("@mtk/database", async original => ({
  ...await original<typeof import("@mtk/database")>(), withTenantContext: mocks.context,
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: mocks.where })) })),
    update: mocks.directUpdate, transaction: mocks.transaction },
}))
const MATCH = "00000000-0000-4000-8000-000000000001"
const U1 = "00000000-0000-4000-8000-000000000002"
const U2 = "00000000-0000-4000-8000-000000000004"
const TENANT = "00000000-0000-4000-8000-000000000003"
const OWNER = "00000000-0000-4000-8000-000000000009"
const dialect = new PgDialect()
const fixture = { id: MATCH, tenantId: TENANT, umpire1Id: null, umpire2Id: null, status: "scheduled",
  teamAId: U1, teamBId: U2, tournamentId: null, venueId: null }
const actor = { id: OWNER, clerkId: "clerk", isActive: true }
const ownerMember = { userId: OWNER, tenantId: TENANT, role: "league_owner", status: "active" }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.myTenant.mockResolvedValue({ id: TENANT })
  mocks.permission.mockResolvedValue(undefined)
  mocks.context.mockImplementation(async (_context, run) => run())
  mocks.match.mockResolvedValue(fixture)
  mocks.user.mockImplementation(async ({ where }) => {
    const [id] = dialect.sqlToQuery(where).params
    return id === "clerk" || id === OWNER ? actor : { id, isActive: true }
  })
  mocks.member.mockImplementation(async ({ where }) => {
    const [id] = dialect.sqlToQuery(where).params
    return id === OWNER ? ownerMember : { userId: id, tenantId: TENANT, role: "scorer", status: "active" }
  })
  mocks.league.mockResolvedValue({ id: TENANT, isActive: true })
  mocks.execute.mockResolvedValue([])
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.directUpdate.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: mocks.updateWhere })
  mocks.updateWhere.mockReturnValue({ returning: mocks.returning })
  mocks.returning.mockImplementation(async () => [{ ...fixture, ...mocks.set.mock.calls.at(-1)![0] }])
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockResolvedValue(undefined)
  mocks.transaction.mockImplementation(async run => run({ execute: mocks.execute,
    query: { matches: { findFirst: mocks.match }, users: { findFirst: mocks.user },
      tenants: { findFirst: mocks.league }, userTenantRoles: { findFirst: mocks.member } },
    update: mocks.update, insert: mocks.insert,
  }))
  mocks.where.mockReturnValue({ limit: mocks.limit })
  mocks.limit.mockResolvedValue([])
})

describe("Member-bound umpire assignment (COMP-06)", () => {
  it.each(["primary", "secondary"] as const)("sets %s only, with an atomic before/after audit", async slot => {
    const result = await assignUmpire(MATCH, slot, U1)
    const field = slot === "primary" ? "umpire1Id" : "umpire2Id"
    expect(result).toMatchObject({ success: true, match: { [field]: U1 } })
    expect(mocks.permission).toHaveBeenCalledWith("match:update", TENANT)
    expect(mocks.context).toHaveBeenCalledWith({ userId: "clerk", tenantId: TENANT }, expect.any(Function))
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(matches)
    expect(mocks.directUpdate).not.toHaveBeenCalled()
    expect(mocks.set).toHaveBeenCalledWith({ [field]: U1, updatedAt: expect.any(Date),
      umpireApprovalRequired: true, umpireApprovedAt: null })
    expect(dialect.sqlToQuery(mocks.updateWhere.mock.calls[0][0]).params).toEqual([MATCH, TENANT])
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(auditLogs)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, actorId: OWNER,
      actorRole: "league_owner", method: "MATCH_UMPIRE_ASSIGN", payload: {
        matchId: MATCH, slot, before: { umpire1Id: null, umpire2Id: null, umpireApprovedAt: undefined },
        after: { umpire1Id: null, umpire2Id: null, [field]: U1, umpireApprovalRequired: true, umpireApprovedAt: null },
      } }))
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard", "layout")
  })
  it("locks match then sorted users, league and sorted memberships before reauthorization", async () => {
    await assignUmpire(MATCH, "secondary", U2)
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks).toHaveLength(4)
    expect(locks[0].params).toEqual([MATCH, TENANT])
    expect(locks[0].sql).toContain("FOR UPDATE")
    expect(locks[1].params).toEqual([OWNER, U2].sort())
    expect(locks[1].sql).toContain("ORDER BY")
    expect(locks[1].sql).toContain("FOR UPDATE")
    expect(locks[2].params).toEqual([TENANT])
    expect(locks[2].sql).toContain("FOR SHARE")
    expect(locks[3].params).toEqual([TENANT, ...[OWNER, U2].sort()])
    expect(locks[3].sql).toContain("ORDER BY")
    expect(locks[3].sql).toContain("FOR UPDATE")
  })
  it("admits a candidate with ANY role but never a passed or unparseable expiry bound", async () => {
    mocks.member.mockImplementation(async ({ where }) => {
      const [id] = dialect.sqlToQuery(where).params
      if (id === OWNER) return ownerMember
      return { userId: id, tenantId: TENANT, role: "player", status: "active" }
    })
    await expect(assignUmpire(MATCH, "primary", U1)).resolves.toMatchObject({ success: true })
    mocks.member.mockImplementation(async ({ where }) => {
      const [id] = dialect.sqlToQuery(where).params
      if (id === OWNER) return ownerMember
      return { userId: id, tenantId: TENANT, role: "player", status: "active", expiresAt: "2020-01-01T00:00:00Z" }
    })
    await expect(assignUmpire(MATCH, "primary", U1)).rejects.toThrow("not an effective member")
    mocks.member.mockImplementation(async ({ where }) => {
      const [id] = dialect.sqlToQuery(where).params
      if (id === OWNER) return ownerMember
      return { userId: id, tenantId: TENANT, role: "player", status: "active", expiresAt: "not-a-date" }
    })
    await expect(assignUmpire(MATCH, "primary", U1)).rejects.toThrow("not an effective member")
    expect(mocks.update).toHaveBeenCalledTimes(1)
  })
  it("rejects one person filling both umpire slots", async () => {
    mocks.match.mockResolvedValue({ ...fixture, umpire1Id: U1 })
    await expect(assignUmpire(MATCH, "secondary", U1)).rejects.toThrow("cannot be both umpires")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("does not rewrite or audit an unchanged, still-authorized assignment", async () => {
    mocks.match.mockResolvedValue({ ...fixture, umpire1Id: U1 })
    await expect(assignUmpire(MATCH, "primary", U1)).resolves.toMatchObject({ success: true })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("clears a slot without validating an already-removed member", async () => {
    mocks.match.mockResolvedValue({ ...fixture, umpire1Id: U1, umpire2Id: U2 })
    const result = await assignUmpire(MATCH, "primary", null)
    expect(result).toMatchObject({ success: true, match: { umpire1Id: null } })
    // The other member slot stays occupied, so the consent requirement stays armed.
    expect(mocks.set).toHaveBeenCalledWith({ umpire1Id: null, updatedAt: expect.any(Date),
      umpireApprovalRequired: true, umpireApprovedAt: null })
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ method: "MATCH_UMPIRE_ASSIGN",
      payload: expect.objectContaining({ slot: "primary" }) }))
  })
  it("rejects a candidate without a role row or an inactive account", async () => {
    mocks.member.mockImplementation(async ({ where }) => {
      const [id] = dialect.sqlToQuery(where).params
      return id === OWNER ? ownerMember : undefined
    })
    await expect(assignUmpire(MATCH, "primary", U1)).rejects.toThrow("not an effective member")
    mocks.member.mockImplementation(async ({ where }) => {
      const [id] = dialect.sqlToQuery(where).params
      return id === OWNER ? ownerMember : { userId: id, tenantId: TENANT, role: "scorer", status: "suspended" }
    })
    await expect(assignUmpire(MATCH, "primary", U1)).rejects.toThrow("not an effective member")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("rechecks the owner's authority under lock", async () => {
    mocks.member.mockImplementation(async ({ where }) => {
      const [id] = dialect.sqlToQuery(where).params
      return id === OWNER ? { userId: OWNER, tenantId: TENANT, role: "scorer", status: "active" } : { userId: id, tenantId: TENANT, role: "scorer", status: "active" }
    })
    await expect(assignUmpire(MATCH, "primary", U1)).rejects.toThrow("access changed")
    mocks.member.mockImplementation(async ({ where }) => {
      const [id] = dialect.sqlToQuery(where).params
      return id === OWNER ? { ...ownerMember, expiresAt: "2020-01-01T00:00:00Z" } : { userId: id, tenantId: TENANT, role: "scorer", status: "active" }
    })
    await expect(assignUmpire(MATCH, "primary", U1)).rejects.toThrow("access changed")
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.directUpdate).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("the candidate list wraps the effective-member SELECT", async () => {
    const list = await getUmpiresForTenant()
    expect(list).toBeDefined()
    expect(mocks.permission).toHaveBeenCalledWith("match:update", TENANT)
  })
})
describe("Umpire assignment consent (COMP-06, mirrors scorer approval)", () => {
  const approved = { ...fixture, umpire1Id: U1, umpireApprovalRequired: true, umpireApprovedAt: new Date("2026-01-02T00:00:00Z") }

  it("a same-value re-assignment preserves existing consent", async () => {
    mocks.match.mockResolvedValue({ ...approved })
    await assignUmpire(MATCH, "primary", U1)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("clearing the last occupied member slot disarms the consent requirement", async () => {
    mocks.match.mockResolvedValue({ ...approved })
    await assignUmpire(MATCH, "primary", null)
    expect(mocks.set).toHaveBeenLastCalledWith(expect.objectContaining({ umpireApprovalRequired: false, umpireApprovedAt: null }))
  })
  it("the assigned umpire approves their pending assignment with a conditional, audited update", async () => {
    mocks.auth.mockResolvedValue({ userId: "umpire-clerk" })
    mocks.user.mockImplementation(async ({ where }) => {
      const [param] = dialect.sqlToQuery(where).params
      return param === "umpire-clerk" ? { id: U1, clerkId: "umpire-clerk", isActive: true } : actor
    })
    mocks.member.mockImplementation(async ({ where }) => {
      const [param] = dialect.sqlToQuery(where).params
      return param === OWNER ? ownerMember : { userId: U1, tenantId: TENANT, role: "player", status: "active" }
    })
    mocks.match.mockResolvedValue({ ...approved, umpireApprovedAt: null })
    mocks.returning.mockResolvedValueOnce([{ id: MATCH }])
    const result = await approveUmpireAssignment(MATCH)
    expect(result).toMatchObject({ success: true, matchId: MATCH, slot: "primary" })
    expect(mocks.set).toHaveBeenLastCalledWith(expect.objectContaining({ umpireApprovedAt: expect.any(Date) }))
    const where = dialect.sqlToQuery(mocks.updateWhere.mock.calls.at(-1)![0])
    expect(where.sql).toContain("umpire_approval_required")
    expect(where.sql).toContain("umpire_approved_at")
    expect(where.sql).toContain("umpire1_id")
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(auditLogs)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ method: "UMPIRE_ASSIGNMENT_APPROVE",
      payload: expect.objectContaining({ matchId: MATCH, slot: "primary" }) }))
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard", "layout")
  })
  it("a passed membership bound denies the assigned umpire's consent (SCORE-09)", async () => {
    mocks.auth.mockResolvedValue({ userId: "umpire-clerk" })
    mocks.user.mockImplementation(async ({ where }) => {
      const [param] = dialect.sqlToQuery(where).params
      return param === "umpire-clerk" ? { id: U1, clerkId: "umpire-clerk", isActive: true } : actor
    })
    mocks.member.mockImplementation(async ({ where }) => {
      const [param] = dialect.sqlToQuery(where).params
      return param === OWNER ? ownerMember
        : { userId: U1, tenantId: TENANT, role: "player", status: "active", expiresAt: "2020-01-01T00:00:00Z" }
    })
    mocks.match.mockResolvedValue({ ...approved, umpireApprovedAt: null })
    await expect(approveUmpireAssignment(MATCH)).rejects.toThrow("membership changed")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it.each([
    ["not occupying a member slot", { ...fixture, umpire1Id: "00000000-0000-4000-8000-000000000008", umpireApprovalRequired: true }],
    ["no outstanding consent requirement", { ...fixture, umpire1Id: U1, umpireApprovalRequired: false }],
    ["already approved", { ...approved }],
  ])("rejects consent when the match is %s", async (_label, match) => {
    mocks.auth.mockResolvedValue({ userId: "umpire-clerk" })
    mocks.user.mockImplementation(async ({ where }) => {
      const [param] = dialect.sqlToQuery(where).params
      return param === "umpire-clerk" ? { id: U1, clerkId: "umpire-clerk", isActive: true } : actor
    })
    mocks.member.mockImplementation(async ({ where }) => {
      const [param] = dialect.sqlToQuery(where).params
      return param === OWNER ? ownerMember : { userId: U1, tenantId: TENANT, role: "player", status: "active" }
    })
    mocks.match.mockResolvedValue(match)
    await expect(approveUmpireAssignment(MATCH)).rejects.toThrow()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("a concurrent assignment change wins the conditional update and voids the consent", async () => {
    mocks.auth.mockResolvedValue({ userId: "umpire-clerk" })
    mocks.user.mockImplementation(async ({ where }) => {
      const [param] = dialect.sqlToQuery(where).params
      return param === "umpire-clerk" ? { id: U1, clerkId: "umpire-clerk", isActive: true } : actor
    })
    mocks.member.mockImplementation(async ({ where }) => {
      const [param] = dialect.sqlToQuery(where).params
      return param === OWNER ? ownerMember : { userId: U1, tenantId: TENANT, role: "player", status: "active" }
    })
    mocks.match.mockResolvedValue({ ...approved, umpireApprovedAt: null })
    mocks.returning.mockResolvedValueOnce([])
    await expect(approveUmpireAssignment(MATCH)).rejects.toThrow("Match changed")
  })
  it("a member occupying no umpire slot can never approve on the assigned member's behalf", async () => {
    mocks.match.mockResolvedValue({ ...approved, umpireApprovedAt: null })
    await expect(approveUmpireAssignment(MATCH)).rejects.toThrow("not the assigned umpire")
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
