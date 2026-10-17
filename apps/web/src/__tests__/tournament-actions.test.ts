import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { getTenantContext } from "@mtk/database"
import {
  advanceTournament,
  closeRegistration,
  createTournament,
  deleteTournament,
  generateFixtures,
  getTournament,
  getTournamentCopyOptions,
  getTournaments,
  openRegistration,
  setCompetitionLock,
  updateTournament,
} from "@/app/actions/tournaments"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveTenant: vi.fn(),
  authorize: vi.fn(),
  findUser: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  updateLocked: vi.fn(),
  remove: vi.fn(),
  find: vi.fn(),
  list: vi.fn(),
  revalidate: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
  txUser: vi.fn(),
  txLeague: vi.fn(),
  txMember: vi.fn(),
  txTournament: vi.fn(),
  txUpdate: vi.fn(),
  txSet: vi.fn(),
  txWhere: vi.fn(),
  txReturning: vi.fn(),
  txInsert: vi.fn(),
  txValues: vi.fn(),
  generate: vi.fn(),
  advance: vi.fn(),
  lockWriter: vi.fn(),
}))

vi.mock("@/lib/fixture-generation", () => ({ generateTournamentFixtures: mocks.generate }))
vi.mock("@/lib/tournament-advancement", () => ({ advanceKnockoutTournament: mocks.advance }))
vi.mock("@/lib/competition-locks", () => ({ setCompetitionLock: mocks.lockWriter }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({
  resolveActiveTenantId: mocks.resolveTenant,
  requirePermissionServer: mocks.authorize,
}))
vi.mock("@mtk/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mtk/database")>()
  return {
    ...actual,
    db: { query: { users: { findFirst: mocks.findUser } }, transaction: mocks.transaction },
    tournamentRepo: {
      insert: mocks.insert,
      updateById: mocks.update,
      updateWithLock: mocks.updateLocked,
      deleteById: mocks.remove,
      findById: mocks.find,
      findFiltered: mocks.list,
    },
  }
})

const CLERK_ID = "user_clerk_identity"
const USER_ID = "7daa50a3-aace-4bd7-aa82-e5a0c248c656"
const ACTIVE_TENANT = "a53bc9d0-e872-440b-b0af-db4a8918a25f"
const TOURNAMENT_ID = "61d9249f-8389-4627-9cac-7e2ff4c48174"
const input = { name: "Premium League", format: "league" as const }
const dialect = new PgDialect()

describe("Tournament action tenant and author boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ userId: CLERK_ID })
    mocks.resolveTenant.mockResolvedValue(ACTIVE_TENANT)
    mocks.authorize.mockResolvedValue(undefined)
    mocks.remove.mockResolvedValue(true)
    mocks.find.mockResolvedValue({ id: TOURNAMENT_ID })
    mocks.list.mockResolvedValue({ data: [], total: 0 })
    mocks.execute.mockResolvedValue([])
    mocks.txUser.mockResolvedValue({ id: USER_ID, clerkId: CLERK_ID, isActive: true })
    mocks.txLeague.mockResolvedValue({ id: ACTIVE_TENANT, isActive: true })
    mocks.txMember.mockResolvedValue({ userId: USER_ID, tenantId: ACTIVE_TENANT, role: "league_owner", status: "active" })
    mocks.txTournament.mockResolvedValue(undefined)
    mocks.txUpdate.mockReturnValue({ set: mocks.txSet })
    mocks.txSet.mockReturnValue({ where: mocks.txWhere })
    mocks.txWhere.mockReturnValue({ returning: mocks.txReturning })
    mocks.txReturning.mockResolvedValue([{ id: TOURNAMENT_ID }])
    mocks.txInsert.mockReturnValue({ values: mocks.txValues })
    mocks.txValues.mockImplementation(() => ({
      returning: mocks.txReturning,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
    }))
    mocks.generate.mockResolvedValue({ tournament: { id: TOURNAMENT_ID }, fixtures: [], rounds: [] })
    mocks.transaction.mockImplementation(async (fn: any) => fn({
      execute: mocks.execute, update: mocks.txUpdate, insert: mocks.txInsert,
      query: { users: { findFirst: mocks.txUser }, tenants: { findFirst: mocks.txLeague },
        userTenantRoles: { findFirst: mocks.txMember }, tournaments: { findFirst: mocks.txTournament } },
    }))
  })

  it("creates in the exact active league under the owner lock with an audit", async () => {
    const result = await createTournament(input)

    expect(mocks.resolveTenant).toHaveBeenCalledOnce()
    expect(mocks.authorize).toHaveBeenCalledWith("tournament:create", ACTIVE_TENANT)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    expect(mocks.txValues.mock.calls[0][0]).toMatchObject({
      name: input.name, slug: "premium-league", tenantId: ACTIVE_TENANT, createdBy: USER_ID,
    })
    expect(mocks.txValues.mock.calls[1][0]).toMatchObject({
      tenantId: ACTIVE_TENANT, actorId: USER_ID, actorRole: "league_owner", method: "TOURNAMENT_CREATE",
    })
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks.slice(0, 3).map((query) => query.params)).toEqual([[USER_ID], [ACTIVE_TENANT], [USER_ID, ACTIVE_TENANT]])
    expect(locks[0].sql).toContain("FOR UPDATE")
    expect(result).toEqual({ success: true, tournament: { id: TOURNAMENT_ID } })
    expect(mocks.revalidate).toHaveBeenCalled()
  })

  it("rejects unauthenticated callers before resolving a tenant", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(createTournament(input)).rejects.toThrow("Unauthorized")
    expect(mocks.resolveTenant).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("fails closed when there is no active tenant", async () => {
    mocks.resolveTenant.mockResolvedValue(null)
    await expect(createTournament(input)).rejects.toThrow("Tenant not found")
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("does not open a transaction when permission is denied for the active tenant", async () => {
    mocks.authorize.mockRejectedValue(new Error("Forbidden"))
    await expect(createTournament(input)).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("does not write a Clerk ID when account provisioning is incomplete", async () => {
    mocks.txUser.mockResolvedValue(undefined)
    await expect(createTournament(input)).rejects.toThrow("account not found")
    expect(mocks.txInsert).not.toHaveBeenCalled()
  })

  it("does not report success or revalidate when the insert returns no row", async () => {
    mocks.txReturning.mockResolvedValue([])
    await expect(createTournament(input)).rejects.toThrow("could not be created")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it("rejects a duplicate slug with a friendly error", async () => {
    mocks.txTournament.mockResolvedValue({ id: "other", tenantId: ACTIVE_TENANT, slug: "premium-league" })
    await expect(createTournament(input)).rejects.toThrow("already exists in this league")
    expect(mocks.txInsert).not.toHaveBeenCalled()
  })

  it("maps a unique-violation race to the friendly duplicate error", async () => {
    mocks.txReturning.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }))
    await expect(createTournament(input)).rejects.toThrow("already exists in this league")
  })

  const operations = [
    { name: "read", permission: "tournament:read", repo: mocks.find, run: () => getTournament(TOURNAMENT_ID) },
    { name: "list", permission: "tournament:read", repo: mocks.list, run: () => getTournaments({ page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" }) },
  ]

  it.each(operations)("$name authorizes the exact tenant passed to the repository", async ({ permission, repo, run }) => {
    repo.mockImplementation(async () => {
      expect(getTenantContext()?.tenantId).toBe(ACTIVE_TENANT)
      return { id: TOURNAMENT_ID }
    })
    await run()
    expect(mocks.authorize).toHaveBeenCalledWith(permission, ACTIVE_TENANT)
    expect(mocks.resolveTenant).toHaveBeenCalledOnce()
    expect(repo).toHaveBeenCalledOnce()
  })

  it.each(operations)("$name never reaches the repository after a permission rejection", async ({ repo, run }) => {
    mocks.authorize.mockRejectedValue(new Error("Forbidden"))
    await expect(run()).rejects.toThrow("Forbidden")
    expect(repo).not.toHaveBeenCalled()
  })

  const configuration = { version: 1 as const, matchType: "custom" as const, overs: 12, location: "Lahore",
    seedOrder: [3, 1, 4, 2], branding: { primaryColor: "#123abc", logo: "https://cdn.example.com/logo.png" } }

  it("persists the whole wizard envelope and decimal monetary values", async () => {
    await createTournament({ ...input, maxTeams: 4, registrationFee: 19.99, prizeAmount: 25000.50, configuration })
    const values = mocks.txValues.mock.calls[0][0]
    expect(values).toMatchObject({ entryFee: "19.99", prizePool: { version: 1, total: "25000.50" }, rules: { wizard: configuration } })
    for (const key of ["registrationFee", "prizeAmount", "configuration"]) expect(values).not.toHaveProperty(key)
  })

  it.each([
    { maxTeams: 3, configuration }, { maxTeams: 4, configuration: { ...configuration, overs: 3.5 } },
    { registrationFee: 1.001 }, { startDate: "2026-02-29" },
    { startDate: "2026-12-01", endDate: "2026-11-01" }, { rules: { arbitrary: true } }, { tenantId: "foreign" },
  ])("rejects invalid or untrusted create settings before persistence %s", async (change) => {
    await expect(createTournament({ ...input, ...change })).rejects.toThrow()
    expect(mocks.txInsert).not.toHaveBeenCalled()
  })

  const lockedRow = (extra: Record<string, unknown>) => ({ id: TOURNAMENT_ID, tenantId: ACTIVE_TENANT, slug: "premium-league", ...extra })

  it("updates under the owner lock with an audit and revalidates", async () => {
    mocks.txTournament.mockResolvedValue(lockedRow({ status: "draft" }))
    await expect(updateTournament(TOURNAMENT_ID, { name: "Renamed" })).resolves.toMatchObject({ success: true })
    expect(mocks.authorize).toHaveBeenCalledWith("tournament:update", ACTIVE_TENANT)
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks).toHaveLength(4)
    expect(locks[3].sql).toContain('FROM "tournaments"')
    expect(locks[3].sql).toContain("FOR UPDATE")
    expect(mocks.txValues.mock.calls[0][0]).toMatchObject({ method: "TOURNAMENT_UPDATE", actorId: USER_ID, actorRole: "league_owner" })
    expect(mocks.revalidate).toHaveBeenCalled()
  })

  it("does not open a transaction for a denied update", async () => {
    mocks.authorize.mockRejectedValue(new Error("Forbidden"))
    await expect(updateTournament(TOURNAMENT_ID, { name: "Renamed" })).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("rejects a foreign or missing tournament before writing", async () => {
    mocks.txTournament.mockResolvedValue(null)
    await expect(updateTournament(TOURNAMENT_ID, { name: "Renamed" })).rejects.toThrow("Tournament not found")
    expect(mocks.txSet).not.toHaveBeenCalled()
  })

  it("denies an update when the membership changed under the lock", async () => {
    mocks.txMember.mockResolvedValue({ userId: USER_ID, tenantId: ACTIVE_TENANT, role: "team_manager", status: "active" })
    mocks.txTournament.mockResolvedValue(lockedRow({}))
    await expect(updateTournament(TOURNAMENT_ID, { name: "Renamed" })).rejects.toThrow("access changed")
    expect(mocks.txSet).not.toHaveBeenCalled()
  })

  it("rejects a renamed slug that collides with another tournament", async () => {
    mocks.txTournament.mockResolvedValueOnce(lockedRow({ slug: "old-slug" }))
      .mockResolvedValueOnce({ id: "other", tenantId: ACTIVE_TENANT, slug: "renamed" })
    await expect(updateTournament(TOURNAMENT_ID, { slug: "renamed" })).rejects.toThrow("already exists in this league")
    expect(mocks.txSet).not.toHaveBeenCalled()
  })

  it("ordinary edits leave saved rules and legacy prize distributions untouched", async () => {
    mocks.txTournament.mockResolvedValue(lockedRow({ rules: { wizard: configuration, legacyRule: true }, prizePool: { winner: 1000 } }))
    await updateTournament(TOURNAMENT_ID, { name: "Renamed" })
    const values = mocks.txSet.mock.calls[0][0]
    expect(values).not.toHaveProperty("rules")
    expect(values).not.toHaveProperty("prizePool")
    expect(values).not.toHaveProperty("entryFee")
    expect(values).toMatchObject({ name: "Renamed" })
  })

  it("resizes saved bracket slots under the row lock without losing sibling rules or branding", async () => {
    mocks.txTournament.mockResolvedValue(lockedRow({ rules: { wizard: configuration, penalties: { slowOver: 5 } } }))
    await updateTournament(TOURNAMENT_ID, { maxTeams: 2 })
    expect(mocks.txSet.mock.calls[0][0]).toMatchObject({ maxTeams: 2,
      rules: { wizard: { ...configuration, seedOrder: [1, 2] }, penalties: { slowOver: 5 } } })
  })

  it("does not replace legacy/unknown rules when capacity changes", async () => {
    mocks.txTournament.mockResolvedValue(lockedRow({ rules: { formatVersion: 999 }, maxTeams: 4 }))
    await updateTournament(TOURNAMENT_ID, { maxTeams: 8 })
    expect(mocks.txSet.mock.calls[0][0]).not.toHaveProperty("rules")
  })

  it("validates a partial date edit against the locked existing counterpart", async () => {
    mocks.txTournament.mockResolvedValue(lockedRow({ startDate: "2026-11-01", endDate: "2026-11-03" }))
    await expect(updateTournament(TOURNAMENT_ID, { startDate: "2026-11-04" })).rejects.toThrow("End date")
    expect(mocks.txSet).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it("rejects clearing capacity while a saved bracket setup exists", async () => {
    mocks.txTournament.mockResolvedValue(lockedRow({ rules: { wizard: configuration } }))
    await expect(updateTournament(TOURNAMENT_ID, { maxTeams: null })).rejects.toThrow("maximum team count")
    expect(mocks.txSet).not.toHaveBeenCalled()
  })

  it("undefined date keys cannot bypass validation of a partial edit", async () => {
    mocks.txTournament.mockResolvedValue(lockedRow({ startDate: "2026-11-01", endDate: "2026-11-03" }))
    await expect(updateTournament(TOURNAMENT_ID, { startDate: undefined, endDate: "2026-10-31" })).rejects.toThrow("End date")
    expect(mocks.txSet).not.toHaveBeenCalled()
  })

  it("does not permit arbitrary rules replacement through ordinary edits", async () => {
    await expect(updateTournament(TOURNAMENT_ID, { configuration } as never)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("copy picker returns lightweight identities without logos or private configuration", async () => {
    mocks.list.mockImplementation(async () => {
      expect(getTenantContext()?.tenantId).toBe(ACTIVE_TENANT)
      return { data: [{ id: TOURNAMENT_ID, ...input, maxTeams: 4, rules: { wizard: configuration }, createdBy: USER_ID }] }
    })
    expect(await getTournamentCopyOptions()).toEqual([{ id: TOURNAMENT_ID, ...input, maxTeams: 4 }])
    expect(mocks.authorize).toHaveBeenCalledWith("tournament:read", ACTIVE_TENANT)
  })

  it("copy picker fails closed for a denied tenant", async () => {
    mocks.authorize.mockRejectedValue(new Error("Forbidden"))
    await expect(getTournamentCopyOptions()).rejects.toThrow("Forbidden")
    expect(mocks.list).not.toHaveBeenCalled()
  })
})

describe("Tournament archival replaces destructive delete", () => {
  const actor = { id: USER_ID, clerkId: CLERK_ID, isActive: true }
  const member = { userId: USER_ID, tenantId: ACTIVE_TENANT, role: "league_owner", status: "active" }

  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ userId: CLERK_ID })
    mocks.resolveTenant.mockResolvedValue(ACTIVE_TENANT)
    mocks.authorize.mockResolvedValue(undefined)
    mocks.execute.mockResolvedValue([])
    mocks.txUser.mockResolvedValue(actor)
    mocks.txLeague.mockResolvedValue({ id: ACTIVE_TENANT, isActive: true })
    mocks.txMember.mockResolvedValue(member)
    mocks.txTournament.mockResolvedValue({ id: TOURNAMENT_ID, tenantId: ACTIVE_TENANT, status: "draft" })
    mocks.txUpdate.mockReturnValue({ set: mocks.txSet })
    mocks.txSet.mockReturnValue({ where: mocks.txWhere })
    mocks.txWhere.mockReturnValue({ returning: mocks.txReturning })
    mocks.txReturning.mockResolvedValue([{ id: TOURNAMENT_ID, status: "cancelled" }])
    mocks.txInsert.mockReturnValue({ values: mocks.txValues })
    mocks.txValues.mockResolvedValue(undefined)
    mocks.transaction.mockImplementation(async (fn: any) => fn({
      execute: mocks.execute, update: mocks.txUpdate, insert: mocks.txInsert,
      query: { users: { findFirst: mocks.txUser }, tenants: { findFirst: mocks.txLeague },
        userTenantRoles: { findFirst: mocks.txMember }, tournaments: { findFirst: mocks.txTournament } },
    }))
  })

  it("cancels under the owner lock, audits, and never hard-deletes", async () => {
    await expect(deleteTournament(TOURNAMENT_ID)).resolves.toEqual({ success: true })
    expect(mocks.authorize).toHaveBeenCalledWith("tournament:delete", ACTIVE_TENANT)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.txSet).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled", registrationOpen: false }))
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks.slice(0, 3).map(query => query.params)).toEqual([[USER_ID], [ACTIVE_TENANT], [USER_ID, ACTIVE_TENANT]])
    expect(locks[0].sql).toContain("FOR UPDATE")
    expect(locks[3].sql).toContain('FROM "tournaments"')
    expect(locks[3].sql).toContain("FOR UPDATE")
    expect(locks.every(query => !query.sql.includes('FROM "matches"'))).toBe(true)
    expect(mocks.txValues.mock.calls[0][0]).toMatchObject({ tenantId: ACTIVE_TENANT, actorId: USER_ID,
      actorRole: "league_owner", method: "TOURNAMENT_ARCHIVE" })
    expect(mocks.revalidate).toHaveBeenCalled()
    expect(mocks.revalidate.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.txValues.mock.invocationCallOrder[0])
  })

  it("rejects anonymous callers before resolving a tenant", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(deleteTournament(TOURNAMENT_ID)).rejects.toThrow("Unauthorized")
    expect(mocks.resolveTenant).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("fails closed when there is no active tenant", async () => {
    mocks.resolveTenant.mockResolvedValue(null)
    await expect(deleteTournament(TOURNAMENT_ID)).rejects.toThrow("Tenant not found")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("denies a non-owner membership under the lock", async () => {
    mocks.txMember.mockResolvedValue({ ...member, role: "team_manager" })
    await expect(deleteTournament(TOURNAMENT_ID)).rejects.toThrow("access changed")
    expect(mocks.txUpdate).not.toHaveBeenCalled()
    expect(mocks.txInsert).not.toHaveBeenCalled()
  })

  it("rechecks the locked account and league", async () => {
    mocks.txUser.mockReset().mockResolvedValueOnce(actor).mockResolvedValueOnce(null)
    await expect(deleteTournament(TOURNAMENT_ID)).rejects.toThrow("access changed")
    mocks.txUser.mockResolvedValue(actor)
    mocks.txLeague.mockResolvedValue({ id: ACTIVE_TENANT, isActive: false })
    await expect(deleteTournament(TOURNAMENT_ID)).rejects.toThrow("access changed")
  })

  it("refuses a live tournament and an already-archived tournament", async () => {
    mocks.txTournament.mockResolvedValue({ id: TOURNAMENT_ID, tenantId: ACTIVE_TENANT, status: "live" })
    await expect(deleteTournament(TOURNAMENT_ID)).rejects.toThrow("live matches")
    mocks.txTournament.mockResolvedValue({ id: TOURNAMENT_ID, tenantId: ACTIVE_TENANT, status: "cancelled" })
    await expect(deleteTournament(TOURNAMENT_ID)).rejects.toThrow("already archived")
    expect(mocks.txUpdate).not.toHaveBeenCalled()
  })

  it("rejects a foreign or missing tournament before any write", async () => {
    mocks.txTournament.mockResolvedValue(null)
    await expect(deleteTournament(TOURNAMENT_ID)).rejects.toThrow("Tournament not found")
    mocks.txTournament.mockResolvedValue({ id: TOURNAMENT_ID, tenantId: "foreign", status: "draft" })
    await expect(deleteTournament(TOURNAMENT_ID)).rejects.toThrow("Tournament not found")
    expect(mocks.txUpdate).not.toHaveBeenCalled()
  })

  it("propagates an audit failure without revalidating", async () => {
    mocks.txValues.mockRejectedValue(new Error("Audit unavailable"))
    await expect(deleteTournament(TOURNAMENT_ID)).rejects.toThrow("Audit unavailable")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it("rejects a permission denial before opening a transaction", async () => {
    mocks.authorize.mockRejectedValue(new Error("Forbidden"))
    await expect(deleteTournament(TOURNAMENT_ID)).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it("validates the id shape before any transaction", async () => {
    await expect(deleteTournament("not-a-uuid")).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("Tournament registration opens/closes under the owner lock", () => {
  const actor = { id: USER_ID, clerkId: CLERK_ID, isActive: true }
  const member = { userId: USER_ID, tenantId: ACTIVE_TENANT, role: "league_owner", status: "active" }

  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ userId: CLERK_ID })
    mocks.resolveTenant.mockResolvedValue(ACTIVE_TENANT)
    mocks.authorize.mockResolvedValue(undefined)
    mocks.execute.mockResolvedValue([])
    mocks.txUser.mockResolvedValue(actor)
    mocks.txLeague.mockResolvedValue({ id: ACTIVE_TENANT, isActive: true })
    mocks.txMember.mockResolvedValue(member)
    mocks.txTournament.mockResolvedValue({ id: TOURNAMENT_ID, tenantId: ACTIVE_TENANT, status: "draft", registrationOpen: false })
    mocks.txUpdate.mockReturnValue({ set: mocks.txSet })
    mocks.txSet.mockReturnValue({ where: mocks.txWhere })
    mocks.txWhere.mockReturnValue({ returning: mocks.txReturning })
    mocks.txReturning.mockResolvedValue([{ id: TOURNAMENT_ID, status: "registration", registrationOpen: true }])
    mocks.txInsert.mockReturnValue({ values: mocks.txValues })
    mocks.txValues.mockResolvedValue(undefined)
    mocks.transaction.mockImplementation(async (fn: any) => fn({
      execute: mocks.execute, update: mocks.txUpdate, insert: mocks.txInsert,
      query: { users: { findFirst: mocks.txUser }, tenants: { findFirst: mocks.txLeague },
        userTenantRoles: { findFirst: mocks.txMember }, tournaments: { findFirst: mocks.txTournament } },
    }))
  })

  it("opens registration under the owner lock, audits, and revalidates", async () => {
    await expect(openRegistration(TOURNAMENT_ID)).resolves.toMatchObject({ success: true })
    expect(mocks.authorize).toHaveBeenCalledWith("tournament:manage_registrations", ACTIVE_TENANT)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.txSet).toHaveBeenCalledWith(expect.objectContaining({ registrationOpen: true, status: "registration" }))
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks.slice(0, 3).map(query => query.params)).toEqual([[USER_ID], [ACTIVE_TENANT], [USER_ID, ACTIVE_TENANT]])
    expect(locks[0].sql).toContain("FOR UPDATE")
    expect(locks[3].sql).toContain('FROM "tournaments"')
    expect(locks[3].sql).toContain("FOR UPDATE")
    expect(mocks.txValues.mock.calls[0][0]).toMatchObject({ tenantId: ACTIVE_TENANT, actorId: USER_ID,
      actorRole: "league_owner", method: "TOURNAMENT_REGISTRATION_OPEN",
      payload: { changedFields: ["registrationOpen", "status"] } })
    expect(mocks.revalidate).toHaveBeenCalled()
    expect(mocks.revalidate.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.txValues.mock.invocationCallOrder[0])
  })

  it("closes registration under the owner lock without touching status", async () => {
    mocks.txReturning.mockResolvedValue([{ id: TOURNAMENT_ID, status: "registration", registrationOpen: false }])
    await expect(closeRegistration(TOURNAMENT_ID)).resolves.toMatchObject({ success: true })
    const setArg = mocks.txSet.mock.calls[0][0]
    expect(setArg).toMatchObject({ registrationOpen: false })
    expect(setArg).not.toHaveProperty("status")
    expect(mocks.txValues.mock.calls[0][0]).toMatchObject({ method: "TOURNAMENT_REGISTRATION_CLOSE",
      payload: { changedFields: ["registrationOpen"] } })
  })

  it.each([["open", openRegistration], ["close", closeRegistration]] as const)("refuses an archived tournament on %s", async (_label, action) => {
    mocks.txTournament.mockResolvedValue({ id: TOURNAMENT_ID, tenantId: ACTIVE_TENANT, status: "cancelled" })
    await expect(action(TOURNAMENT_ID)).rejects.toThrow("archived")
    expect(mocks.txUpdate).not.toHaveBeenCalled()
    expect(mocks.txInsert).not.toHaveBeenCalled()
  })

  it.each([["live"], ["completed"]])("refuses to open registration on a %s tournament", async (status) => {
    mocks.txTournament.mockResolvedValue({ id: TOURNAMENT_ID, tenantId: ACTIVE_TENANT, status })
    await expect(openRegistration(TOURNAMENT_ID)).rejects.toThrow("draft or registration")
    expect(mocks.txUpdate).not.toHaveBeenCalled()
  })

  it("denies a non-owner membership under the lock", async () => {
    mocks.txMember.mockResolvedValue({ ...member, role: "team_manager" })
    await expect(openRegistration(TOURNAMENT_ID)).rejects.toThrow("access changed")
    expect(mocks.txUpdate).not.toHaveBeenCalled()
  })

  it("rejects a foreign or missing tournament before any write", async () => {
    mocks.txTournament.mockResolvedValue(null)
    await expect(openRegistration(TOURNAMENT_ID)).rejects.toThrow("Tournament not found")
    mocks.txTournament.mockResolvedValue({ id: TOURNAMENT_ID, tenantId: "foreign", status: "draft" })
    await expect(closeRegistration(TOURNAMENT_ID)).rejects.toThrow("Tournament not found")
    expect(mocks.txUpdate).not.toHaveBeenCalled()
  })

  it("propagates an audit failure without revalidating", async () => {
    mocks.txValues.mockRejectedValue(new Error("Audit unavailable"))
    await expect(openRegistration(TOURNAMENT_ID)).rejects.toThrow("Audit unavailable")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it("rejects a permission denial before opening a transaction", async () => {
    mocks.authorize.mockRejectedValue(new Error("Forbidden"))
    await expect(openRegistration(TOURNAMENT_ID)).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("validates the id shape before any transaction", async () => {
    await expect(openRegistration("not-a-uuid")).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("Fixture generation action delegation", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ userId: CLERK_ID })
    mocks.resolveTenant.mockResolvedValue(ACTIVE_TENANT)
    mocks.authorize.mockResolvedValue(undefined)
    mocks.generate.mockResolvedValue({ tournament: { id: TOURNAMENT_ID }, fixtures: [], rounds: [] })
  })

  it("requires match creation permission and delegates to the generation writer", async () => {
    const result = await generateFixtures(TOURNAMENT_ID)

    expect(mocks.authorize).toHaveBeenCalledWith("match:create", ACTIVE_TENANT)
    expect(mocks.generate).toHaveBeenCalledWith(CLERK_ID, ACTIVE_TENANT, TOURNAMENT_ID)
    expect(mocks.transaction).not.toHaveBeenCalled() // delegation, not a second transaction
    expect(result).toMatchObject({ success: true, tournament: { id: TOURNAMENT_ID } })
    expect(mocks.revalidate).toHaveBeenCalledWith(`/dashboard/tournaments/${TOURNAMENT_ID}`)
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/matches")
  })

  it("validates the tournament id shape before any lookup", async () => {
    await expect(generateFixtures("not-a-uuid")).rejects.toThrow()
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it("delegates advance to the knockout advancement writer with the same permission", async () => {
    mocks.advance.mockResolvedValue({ tournament: { id: TOURNAMENT_ID }, stage: "Semi-finals", created: [] })

    const result = await advanceTournament(TOURNAMENT_ID)

    expect(mocks.authorize).toHaveBeenCalledWith("match:create", ACTIVE_TENANT)
    expect(mocks.advance).toHaveBeenCalledWith(CLERK_ID, ACTIVE_TENANT, TOURNAMENT_ID)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: true, stage: "Semi-finals" })
    expect(mocks.revalidate).toHaveBeenCalledWith(`/dashboard/tournaments/${TOURNAMENT_ID}`)
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/matches")
  })
})

describe("Competition lock action delegation (COMP-07)", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ userId: CLERK_ID })
    mocks.resolveTenant.mockResolvedValue(ACTIVE_TENANT)
    mocks.authorize.mockResolvedValue(undefined)
    mocks.lockWriter.mockResolvedValue({ tournamentId: TOURNAMENT_ID, locked: true, lockedAt: "2026-10-17T00:00:00.000Z" })
  })

  it("requires settings-level authority and delegates to the lock writer", async () => {
    const result = await setCompetitionLock(TOURNAMENT_ID, true)

    expect(mocks.authorize).toHaveBeenCalledWith("settings:manage", ACTIVE_TENANT)
    expect(mocks.lockWriter).toHaveBeenCalledWith(TOURNAMENT_ID, true)
    expect(mocks.transaction).not.toHaveBeenCalled() // delegation, not a second transaction
    expect(result).toMatchObject({ success: true, tournamentId: TOURNAMENT_ID, locked: true })
    expect(mocks.revalidate).toHaveBeenCalledWith(`/dashboard/tournaments/${TOURNAMENT_ID}`)
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/matches")
  })

  it("validates the id shape and boolean before any lookup", async () => {
    await expect(setCompetitionLock("not-a-uuid", true)).rejects.toThrow()
    await expect(setCompetitionLock(TOURNAMENT_ID, "yes" as unknown as boolean)).rejects.toThrow()
    expect(mocks.lockWriter).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
