import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { leagueRegistrations, auditLogs, payments, players, teams } from "@mtk/database"
import {
  registerTeam, approveRegistration, rejectRegistration, withdrawRegistration,
  confirmRegistrationPayment, getRegistrations, getMyRegistrations, updateRegistrationSquad,
} from "@/app/actions/registrations"
import { readTeamRegistrations, readRegistrationSquadOptions, readRegistrationDetail } from "@/lib/registration-reads"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), permission: vi.fn(), tenant: vi.fn(), fallback: vi.fn(), transaction: vi.fn(), execute: vi.fn(),
  user: vi.fn(), league: vi.fn(), member: vi.fn(), team: vi.fn(), tournament: vi.fn(), registration: vi.fn(),
  select: vi.fn(), insert: vi.fn(), values: vi.fn(), returningInsert: vi.fn(),
  update: vi.fn(), set: vi.fn(), whereUpdate: vi.fn(), returning: vi.fn(), revalidate: vi.fn(),
  queries: [] as any[], state: {} as any,
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: mocks.permission, resolveActiveTenantId: mocks.tenant }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.fallback }))
vi.mock("@mtk/database", async (original) => ({ ...await original<typeof import("@mtk/database")>(),
  db: { transaction: mocks.transaction, select: mocks.select,
    query: { users: { findFirst: mocks.user }, userTenantRoles: { findFirst: mocks.member }, tenants: { findFirst: mocks.league } } } }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const ACTOR = "00000000-0000-4000-8000-000000000002"
const TEAM = "00000000-0000-4000-8000-000000000003"
const PLAYER = "00000000-0000-4000-8000-000000000004"
const PLAYER2 = "00000000-0000-4000-8000-000000000005"
const OTHER = "00000000-0000-4000-8000-000000000006"
const TOURNAMENT = "00000000-0000-4000-8000-000000000007"
const REG = "00000000-0000-4000-8000-000000000008"
const PAY = "00000000-0000-4000-8000-000000000009"
const actor = { id: ACTOR, clerkId: "clerk", isActive: true }
const member = { userId: ACTOR, tenantId: TENANT, role: "league_owner", status: "active" }
const team = { id: TEAM, tenantId: TENANT, isActive: true, managerId: ACTOR, captainId: null, maxSquadSize: 15 }
const tournament = { id: TOURNAMENT, tenantId: TENANT, status: "registration", registrationOpen: true,
  registrationStart: null, registrationEnd: null, entryFee: "500", maxTeams: 8 }
const registration = { id: REG, tenantId: TENANT, tournamentId: TOURNAMENT, teamId: TEAM, status: "pending",
  paymentStatus: "paid", registrationFee: "500", rejectionReason: null, squadPlayerIds: [PLAYER], notes: null }

const dialect = new PgDialect()
const operations = ["REGISTRATION_CREATE", "REGISTRATION_APPROVE", "REGISTRATION_REJECT", "REGISTRATION_WITHDRAW", "REGISTRATION_PAYMENT", "REGISTRATION_SQUAD"] as const
type Operation = typeof operations[number]
const permissionFor: Record<Operation, string> = {
  REGISTRATION_CREATE: "registration:create", REGISTRATION_APPROVE: "registration:manage",
  REGISTRATION_REJECT: "registration:manage", REGISTRATION_WITHDRAW: "registration:create",
  REGISTRATION_PAYMENT: "registration:manage", REGISTRATION_SQUAD: "registration:create",
}
function run(operation: Operation) {
  switch (operation) {
    case "REGISTRATION_CREATE": return registerTeam({ tournamentId: TOURNAMENT, teamId: TEAM, squadPlayerIds: [PLAYER] })
    case "REGISTRATION_APPROVE": return approveRegistration(REG)
    case "REGISTRATION_REJECT": return rejectRegistration(REG, "Not eligible this season")
    case "REGISTRATION_WITHDRAW": return withdrawRegistration(REG)
    case "REGISTRATION_PAYMENT": return confirmRegistrationPayment(REG, { method: "bank_transfer", transactionReference: "REF-1" })
    case "REGISTRATION_SQUAD": return updateRegistrationSquad(REG, { squadPlayerIds: [PLAYER, PLAYER2] })
  }
}

function selectChain(fields: any) {
  const record: any = { fields, params: [], joins: [] }
  mocks.queries.push(record)
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    innerJoin: (table: any, on: any) => { record.joins.push({ table, ...dialect.sqlToQuery(on) }); return chain },
    leftJoin: (table: any, on: any) => { record.joins.push({ table, ...dialect.sqlToQuery(on) }); return chain },
    where: (where: any) => { const q = dialect.sqlToQuery(where); record.sql = q.sql; record.params = q.params; return chain },
    orderBy: () => chain, limit: (limit: number) => { record.limit = limit; return chain },
    offset: (offset: number) => { record.offset = offset; return chain },
    then: (resolve: any, reject: any) => {
      const rows = "total" in (fields ?? {}) ? [{ total: mocks.state.total }]
        : record.table === players ? mocks.state.squad
          : record.table === leagueRegistrations ? mocks.state.registrationRows
            : record.table === teams ? [mocks.state.team]
              : mocks.state.listRows
      return Promise.resolve(rows.map((row: any) => Object.fromEntries(Object.keys(fields ?? {}).map(key => [key, row[key]])))).then(resolve, reject)
    },
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.state = { registration: { ...registration }, team: { ...team }, tournament: { ...tournament },
    squad: [{ id: PLAYER }], registrationRows: [], total: "0", listRows: [] }
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.permission.mockResolvedValue(undefined)
  mocks.fallback.mockImplementation(() => { throw new Error("Never use fallback league") })
  mocks.execute.mockResolvedValue([])
  // user findFirst: first call by clerkId, second (locked) call by id; both resolve actor unless overridden.
  mocks.user.mockResolvedValue(actor)
  mocks.league.mockImplementation(async () => ({ id: TENANT, isActive: true }))
  mocks.member.mockImplementation(async () => "member" in mocks.state ? mocks.state.member : member)
  mocks.team.mockImplementation(async () => mocks.state.team)
  mocks.tournament.mockImplementation(async () => mocks.state.tournament)
  mocks.registration.mockImplementation(async () => mocks.state.registration)
  mocks.select.mockImplementation(selectChain)
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockImplementation((row: any) => ({ returning: mocks.returningInsert, row }))
  mocks.returningInsert.mockImplementation(async () => {
    const table = mocks.insert.mock.calls.at(-1)![0]
    const row = mocks.values.mock.calls.at(-1)![0]
    if (table === leagueRegistrations) return [{ ...mocks.state.registration, ...row }]
    if (table === payments) return [{ id: PAY }]
    return [{}]
  })
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: mocks.whereUpdate })
  mocks.whereUpdate.mockReturnValue({ returning: mocks.returning })
  mocks.returning.mockImplementation(async () => {
    const table = mocks.update.mock.calls.at(-1)![0]
    const set = mocks.set.mock.calls.at(-1)![0]
    return [{ ...(table === teams ? mocks.state.team : mocks.state.registration), ...set }]
  })
  mocks.transaction.mockImplementation(async (fn: any) => fn({
    execute: mocks.execute, select: mocks.select, insert: mocks.insert, update: mocks.update,
    query: { users: { findFirst: mocks.user }, tenants: { findFirst: mocks.league }, userTenantRoles: { findFirst: mocks.member },
      teams: { findFirst: mocks.team }, tournaments: { findFirst: mocks.tournament }, leagueRegistrations: { findFirst: mocks.registration } },
  }))
})
function noWrites() {
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.insert).not.toHaveBeenCalled()
  expect(mocks.revalidate).not.toHaveBeenCalled()
}

describe.each(operations)("Current %s review authority", (operation) => {
  beforeEach(() => {
    if (operation === "REGISTRATION_PAYMENT") mocks.state.registration.paymentStatus = "unpaid"
    // The squad edit re-validates every submitted id against the team's ACTIVE roster.
    if (operation === "REGISTRATION_SQUAD") mocks.state.squad = [{ id: PLAYER }, { id: PLAYER2 }]
  })
  it("writes/audits in one transaction using the exact active league and current account", async () => {
    await expect(run(operation)).resolves.toMatchObject({ success: true })
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    expect(mocks.fallback).not.toHaveBeenCalled()
    expect(mocks.permission).toHaveBeenCalledWith(permissionFor[operation], TENANT)
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks.slice(0, 3).map(query => query.params)).toEqual([[ACTOR], [TENANT], [ACTOR, TENANT]])
    expect(locks[0].sql).toContain("FOR UPDATE")
    expect(locks[1].sql).toContain("FOR SHARE")
    expect(locks[2].sql).toContain("FOR SHARE")
    expect(locks.every(query => !query.sql.includes('FROM "matches"'))).toBe(true)
    expect(mocks.insert.mock.calls.at(-1)![0]).toBe(auditLogs)
    expect(mocks.values.mock.calls.at(-1)![0]).toMatchObject({ tenantId: TENANT, actorId: ACTOR, actorRole: "league_owner", method: operation })
    expect(mocks.revalidate.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.values.mock.invocationCallOrder.at(-1)!)
  })
  it("locks the tournament before the registration row", async () => {
    await run(operation)
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    const tournamentLock = locks.findIndex(query => query.sql.includes('FROM "tournaments"'))
    const registrationLock = locks.findIndex(query => query.sql.includes('FROM "league_registrations"'))
    if (tournamentLock !== -1 && registrationLock !== -1) expect(tournamentLock).toBeLessThan(registrationLock)
  })
  it.each([null, { id: OTHER }, { isActive: false }, { clerkId: "remapped" }, { clerkId: null }])("rechecks the locked actor %s", async change => {
    mocks.user.mockReset().mockResolvedValueOnce(actor).mockResolvedValueOnce(change === null ? null : { ...actor, ...change })
    await expect(run(operation)).rejects.toThrow("access changed")
    noWrites()
  })
  it.each([null, { userId: OTHER }, { tenantId: OTHER }, { status: "suspended" }, { status: "pending" },
    ...["super_admin", "coach", "scorer", "player", "fan"].map(role => ({ role }))])("rejects invalid exact membership %s", async change => {
    mocks.state.member = change === null ? null : { ...member, ...change }
    await expect(run(operation)).rejects.toThrow("access changed")
    noWrites()
  })
  it.each([null, { id: OTHER, isActive: true }, { id: TENANT, isActive: false }])("rejects an unavailable league %s", async league => {
    mocks.league.mockResolvedValue(league)
    await expect(run(operation)).rejects.toThrow("access changed")
    noWrites()
  })
  it("rejects a missing provisioned account", async () => {
    mocks.user.mockResolvedValue(undefined)
    await expect(run(operation)).rejects.toThrow("account not found")
    noWrites()
  })
  it("rejects anonymous sessions before any transaction", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(run(operation)).rejects.toThrow("Unauthorized")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("propagates active-tenant resolution failure without falling back", async () => {
    mocks.tenant.mockRejectedValue(new Error("Resolution unavailable"))
    await expect(run(operation)).rejects.toThrow("Resolution unavailable")
    expect(mocks.fallback).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("rejects a missing active tenant", async () => {
    mocks.tenant.mockResolvedValue(null)
    await expect(run(operation)).rejects.toThrow("Tenant not found")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("checks explicit tenant permission before opening a transaction", async () => {
    mocks.permission.mockImplementation(async (_permission: string, tenantId?: string) => { if (tenantId) throw new Error("Forbidden") })
    await expect(run(operation)).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("propagates audit failure without cache success", async () => {
    mocks.values.mockImplementation((row: any) => row.method ? Promise.reject(new Error("Audit unavailable")) : { returning: mocks.returningInsert })
    await expect(run(operation)).rejects.toThrow("Audit unavailable")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})

describe("Registration create eligibility and delegation", () => {
  it("waives the fee when the tournament has no entry fee and never trusts a supplied tenant", async () => {
    mocks.state.tournament.entryFee = "0"
    await registerTeam({ tenantId: TENANT, tournamentId: TOURNAMENT, teamId: TEAM, squadPlayerIds: [PLAYER] })
    expect(mocks.values.mock.calls[0][0]).toMatchObject({ status: "pending", paymentStatus: "waived", registrationFee: "0" })
    await expect(registerTeam({ tenantId: OTHER, tournamentId: TOURNAMENT, teamId: TEAM, squadPlayerIds: [PLAYER] }))
      .rejects.toThrow("Invalid tenant")
  })
  it("lets an assigned team manager register, and blocks an unassigned one", async () => {
    mocks.state.member = { ...member, role: "team_manager" }
    mocks.state.team = { ...team, managerId: OTHER }
    await expect(registerTeam({ tournamentId: TOURNAMENT, teamId: TEAM, squadPlayerIds: [PLAYER] }))
      .rejects.toThrow("Only the league owner")
    noWrites()
    mocks.state.team = { ...team, managerId: ACTOR }
    await expect(registerTeam({ tournamentId: TOURNAMENT, teamId: TEAM, squadPlayerIds: [PLAYER] })).resolves.toMatchObject({ success: true })
  })
  it.each([
    ["a foreign/inactive team", () => { mocks.state.team = { ...team, isActive: false } }, "Team is unavailable"],
    ["a foreign tournament", () => { mocks.state.tournament = { ...tournament, id: OTHER } }, "Tournament is unavailable"],
    ["a closed tournament", () => { mocks.state.tournament.registrationOpen = false }, "Registration is closed"],
    ["a not-yet-open window", () => { mocks.state.tournament.registrationStart = new Date(Date.now() + 86_400_000) }, "has not opened yet"],
    ["a passed deadline", () => { mocks.state.tournament.registrationEnd = new Date(Date.now() - 86_400_000) }, "deadline has passed"],
    ["a duplicate entry", () => { mocks.state.registrationRows = [{ id: REG }] }, "already registered"],
    ["a foreign/inactive squad", () => { mocks.state.squad = [] }, "active player on this team"],
  ])("rejects %s", async (_label, arrange, message) => {
    arrange()
    await expect(registerTeam({ tournamentId: TOURNAMENT, teamId: TEAM, squadPlayerIds: [PLAYER] })).rejects.toThrow(message)
    noWrites()
  })
  it("enforces the team squad limit against the selected squad", async () => {
    mocks.state.team = { ...team, maxSquadSize: 1 }
    mocks.state.squad = [{ id: PLAYER }, { id: PLAYER2 }]
    await expect(registerTeam({ tournamentId: TOURNAMENT, teamId: TEAM, squadPlayerIds: [PLAYER, PLAYER2] }))
      .rejects.toThrow("no more than 1 players")
    noWrites()
  })
  it("rejects duplicate squad members before SQL", async () => {
    await expect(registerTeam({ tournamentId: TOURNAMENT, teamId: TEAM, squadPlayerIds: [PLAYER, PLAYER] })).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("Withdraw / re-register interplay (ENH-05-03 slice 5)", () => {
  beforeEach(() => { mocks.state.squad = [{ id: PLAYER }] })
  it("lets a team re-register after its OWN withdrawal; the withdrawn row stays as history", async () => {
    mocks.state.registrationRows = [{ id: REG, status: "withdrawn" }]
    await expect(registerTeam({ tournamentId: TOURNAMENT, teamId: TEAM, squadPlayerIds: [PLAYER] }))
      .resolves.toMatchObject({ success: true })
    expect(mocks.state.registrationRows).toEqual([{ id: REG, status: "withdrawn" }]) // nothing deleted
  })
  it("refuses a re-application after a REJECTION with the honest verdict", async () => {
    mocks.state.registrationRows = [{ id: REG, status: "rejected" }]
    await expect(registerTeam({ tournamentId: TOURNAMENT, teamId: TEAM, squadPlayerIds: [PLAYER] }))
      .rejects.toThrow("was rejected")
    noWrites()
  })
  it.each(["pending", "approved", "waitlisted", "undefined-status legacy row"])("keeps refusing a live entry (%s)", async (status) => {
    mocks.state.registrationRows = [{ id: REG, status: status === "undefined-status legacy row" ? undefined : status }]
    await expect(registerTeam({ tournamentId: TOURNAMENT, teamId: TEAM, squadPlayerIds: [PLAYER] }))
      .rejects.toThrow("already registered")
    noWrites()
  })
})

describe("Registration squad edit journey (ENH-05-03, Batch 105)", () => {
  beforeEach(() => { mocks.state.squad = [{ id: PLAYER }, { id: PLAYER2 }] })
  it("an assigned team manager edits the pending squad with an audited transition", async () => {
    mocks.state.member = { ...member, role: "team_manager" }
    mocks.state.registration.squadPlayerIds = [PLAYER]
    await expect(updateRegistrationSquad(REG, { squadPlayerIds: [PLAYER, PLAYER2] })).resolves.toMatchObject({
      success: true, registration: { id: REG },
    })
    expect(mocks.permission).toHaveBeenCalledWith("registration:create", TENANT)
    // Documented order holds with the team locked before the registration row.
    const locks = mocks.execute.mock.calls.map(([q]) => dialect.sqlToQuery(q).sql)
    const teamLock = locks.findIndex(sql => sql.includes('FROM "teams"'))
    const registrationLock = locks.findIndex(sql => sql.includes('FROM "league_registrations"'))
    expect(teamLock).toBeGreaterThan(-1)
    expect(teamLock).toBeLessThan(registrationLock)
    expect(mocks.set.mock.calls.at(-1)![0]).toMatchObject({ squadPlayerIds: [PLAYER, PLAYER2] })
    const auditRow = mocks.values.mock.calls.at(-1)![0]
    expect(auditRow).toMatchObject({ tenantId: TENANT, actorId: ACTOR, actorRole: "team_manager", method: "REGISTRATION_SQUAD" })
    // The audit records the SIZES of the transition, not a replicated squad list.
    expect(auditRow.payload.before.squadPlayerIds).toBeUndefined()
    expect(auditRow.payload.before).toMatchObject({ squadSize: 1 })
    expect(auditRow.payload.after).toMatchObject({ squadSize: 2 })
    expect(auditRow.payload.changedFields).toEqual(["squadPlayerIds"])
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/registrations")
  })
  it("an identical squad is an honest replay with no write and no audit", async () => {
    mocks.state.registration.squadPlayerIds = [PLAYER, PLAYER2]
    await expect(updateRegistrationSquad(REG, { squadPlayerIds: [PLAYER, PLAYER2] })).resolves.toMatchObject({ success: true, changed: false })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each(["approved", "rejected", "withdrawn"])("refuses to edit the squad after the entry is %s", async status => {
    mocks.state.registration.status = status
    await expect(updateRegistrationSquad(REG, { squadPlayerIds: [PLAYER, PLAYER2] })).rejects.toThrow("no longer be edited")
    noWrites()
  })
  it("refuses an unassigned team manager — authority comes from the team pointers, never the role alone", async () => {
    mocks.state.member = { ...member, role: "team_manager" }
    mocks.state.team = { ...team, managerId: OTHER }
    await expect(updateRegistrationSquad(REG, { squadPlayerIds: [PLAYER, PLAYER2] }))
      .rejects.toThrow("Only the league owner or this team's manager/captain")
    noWrites()
  })
  it("refuses a foreign or inactive player as a squad member", async () => {
    mocks.state.squad = [{ id: PLAYER }]
    await expect(updateRegistrationSquad(REG, { squadPlayerIds: [PLAYER, PLAYER2] })).rejects.toThrow("active player on this team")
    noWrites()
    mocks.state.squad = []
    await expect(updateRegistrationSquad(REG, { squadPlayerIds: [PLAYER] })).rejects.toThrow("active player on this team")
    noWrites()
  })
  it("enforces the team squad limit on the edited squad", async () => {
    mocks.state.team = { ...team, maxSquadSize: 1 }
    await expect(updateRegistrationSquad(REG, { squadPlayerIds: [PLAYER, PLAYER2] })).rejects.toThrow("no more than 1 players")
    noWrites()
  })
  it("rejects duplicate squad members before SQL", async () => {
    await expect(updateRegistrationSquad(REG, { squadPlayerIds: [PLAYER, PLAYER] })).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("rejects a malformed registration id before SQL", async () => {
    await expect(updateRegistrationSquad("bad", { squadPlayerIds: [PLAYER] })).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("propagates a missing registration instead of inventing one", async () => {
    mocks.registration.mockResolvedValue(null)
    await expect(updateRegistrationSquad(REG, { squadPlayerIds: [PLAYER, PLAYER2] })).rejects.toThrow("Registration not found")
    noWrites()
  })
})

describe("Registration review transitions", () => {
  it("blocks managers from approving, rejecting or confirming payment", async () => {
    mocks.state.member = { ...member, role: "team_manager" }
    await expect(approveRegistration(REG)).rejects.toThrow("access changed")
    await expect(rejectRegistration(REG, "no")).rejects.toThrow("access changed")
    await expect(confirmRegistrationPayment(REG, { method: "bank_transfer", transactionReference: "REF" })).rejects.toThrow("access changed")
    noWrites()
  })
  it("refuses to approve an entry whose fee is unresolved", async () => {
    mocks.state.registration.paymentStatus = "unpaid"
    await expect(approveRegistration(REG)).rejects.toThrow("Confirm the registration fee payment")
    noWrites()
  })
  it("refuses to approve beyond a tournament's maximum teams under the tournament lock", async () => {
    mocks.state.total = "8"
    await expect(approveRegistration(REG)).rejects.toThrow("maximum number of teams")
    noWrites()
    const tournamentLock = mocks.execute.mock.calls.findIndex(([q]) => dialect.sqlToQuery(q).sql.includes('FROM "tournaments"'))
    expect(mocks.select.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[tournamentLock])
  })
  it("rejects an already-reviewed entry instead of overwriting history", async () => {
    mocks.state.registration.status = "approved"
    await expect(approveRegistration(REG)).rejects.toThrow("already been reviewed")
    await expect(rejectRegistration(REG, "late")).rejects.toThrow("already been reviewed")
    noWrites()
  })
  it("links the team to the tournament on approval", async () => {
    await approveRegistration(REG)
    const teamUpdate = mocks.set.mock.calls.find((_, index) => mocks.update.mock.calls[index][0] === teams)
    expect(teamUpdate?.[0]).toMatchObject({ tournamentId: TOURNAMENT })
    // PUB-06 cache invalidation: an approved entry joins the public team list.
    expect(mocks.revalidate).toHaveBeenCalledWith(`/tournaments/${TOURNAMENT}`)
  })
  it("requires a rejection reason and only updates pending rows", async () => {
    await expect(rejectRegistration(REG, "   ")).rejects.toThrow("Provide a reason")
    expect(mocks.transaction).not.toHaveBeenCalled()
    await rejectRegistration(REG, "ineligible")
    const where = dialect.sqlToQuery(mocks.whereUpdate.mock.calls[0][0])
    expect(where.sql).toContain('"status"')
  })
  it("refuses the payment confirmation when the fee is already resolved or not payable", async () => {
    mocks.state.registration.paymentStatus = "paid"
    await expect(confirmRegistrationPayment(REG, { method: "jazzcash", transactionReference: "REF" })).rejects.toThrow("already resolved")
    mocks.state.registration.paymentStatus = "unpaid"
    mocks.state.registration.registrationFee = "0"
    await expect(confirmRegistrationPayment(REG, { method: "jazzcash", transactionReference: "REF" })).rejects.toThrow("does not have a payable fee")
    noWrites()
  })
  it("records the off-platform payment and marks the entry paid", async () => {
    mocks.state.registration.paymentStatus = "unpaid"
    await expect(confirmRegistrationPayment(REG, { method: "bank_transfer", transactionReference: "REF-9" })).resolves.toMatchObject({ success: true, paymentId: PAY })
    const paymentInsert = mocks.insert.mock.calls.find(([table]) => table === payments)
    expect(paymentInsert).toBeDefined()
    const row = mocks.values.mock.calls.find(([value]) => value.referenceId === REG)?.[0]
    expect(row).toMatchObject({ amount: "500", status: "completed", transactionId: "REF-9" })
  })
  it("allows an assigned manager to withdraw, but not after the entry is rejected", async () => {
    mocks.state.member = { ...member, role: "team_manager" }
    await expect(withdrawRegistration(REG)).resolves.toMatchObject({ success: true, registration: { status: "withdrawn" } })
    // PUB-06 withdrawal path: the removed entry must leave the public page.
    expect(mocks.revalidate).toHaveBeenCalledWith(`/tournaments/${TOURNAMENT}`)
    mocks.state.registration.status = "rejected"
    await expect(withdrawRegistration(REG)).rejects.toThrow("can no longer be withdrawn")
  })
})

describe("Registration reads are exact-league scoped and projection-bounded", () => {
  beforeEach(() => { mocks.state.listRows = [{ ...registration, teamName: "Tigers", tournamentName: "Cup" }] })
  it.each([
    ["getRegistrations", () => getRegistrations(), "registration:manage"],
    ["getMyRegistrations", () => getMyRegistrations(TENANT), "registration:create"],
  ] as const)("%s authorizes %s with the active league and never the fallback", async (_name, call, permission) => {
    await call()
    expect(mocks.permission).toHaveBeenCalledWith(permission, TENANT)
    expect(mocks.fallback).not.toHaveBeenCalled()
    expect(mocks.queries.every(query => query.params.includes(TENANT))).toBe(true)
    expect(mocks.queries.every(query => query.table !== players)).toBe(true)
  })
  it("never projects the payment reference or actor/approver UUIDs into review rows", async () => {
    await getRegistrations()
    for (const query of mocks.queries) {
      for (const key of ["paymentTransactionId", "registeredBy", "approvedBy"]) expect(query.fields).not.toHaveProperty(key)
    }
  })
  it("joins the team and tournament to the same active league", async () => {
    await getRegistrations()
    const data = mocks.queries.find(query => query.joins.length)
    expect(data.joins.map((join: any) => join.table)).toEqual([teams, expect.anything()])
    expect(data.joins.every((join: any) => join.params.includes(TENANT))).toBe(true)
  })
  it("rejects a foreign tournament filter and cross-league own-read before SQL", async () => {
    await expect(getRegistrations(OTHER)).resolves.toBeDefined()
    await expect(getMyRegistrations(OTHER)).rejects.toThrow("Invalid tenant")
  })
  it("propagates a read failure instead of returning a false empty state", async () => {
    mocks.select.mockImplementation(() => { throw new Error("DB down") })
    await expect(getRegistrations()).rejects.toThrow("DB down")
  })
})

describe("Team-scoped registration reads (ENH-05-03 slice 2)", () => {
  beforeEach(() => {
    mocks.state.registrationRows = [{ ...registration, teamName: "Tigers", tournamentName: "Cup" }]
  })
  it("reads one team's submissions joined inside the exact active league, bounded", async () => {
    const result = await readTeamRegistrations(TENANT, TEAM, {})
    expect(result.data).toHaveLength(1)
    expect(result.pagination).toMatchObject({ page: 1, pageSize: 50 })
    for (const join of mocks.queries.find(query => query.joins.length)!.joins) {
      expect(join.params).toContain(TENANT)
    }
    const where = mocks.queries.find(query => query.sql)
    expect(where!.params).toEqual(expect.arrayContaining([TENANT, TEAM]))
    // The bounded page is a hard refusal, not a silent clamp.
    await expect(readTeamRegistrations(TENANT, TEAM, { pageSize: 500 })).rejects.toThrow()
  })
  it("never projects payment references or actor/approver UUIDs into team rows", async () => {
    await readTeamRegistrations(TENANT, TEAM, {})
    for (const query of mocks.queries) {
      for (const key of ["paymentTransactionId", "registeredBy", "approvedBy"]) {
        expect(query.fields).not.toHaveProperty(key)
      }
    }
  })
  it("refuses a malformed team id before SQL and keeps status filters exact", async () => {
    await expect(readTeamRegistrations(TENANT, "bad", {})).rejects.toThrow()
    expect(mocks.queries).toHaveLength(0)
    await expect(readTeamRegistrations(TENANT, TEAM, { status: "future" as never })).rejects.toThrow()
    await readTeamRegistrations(TENANT, TEAM, { status: "pending" })
    expect(mocks.queries.filter(query => query.sql)).toHaveLength(2)
  })
  it("propagates a read failure instead of a false empty state", async () => {
    mocks.select.mockImplementation(() => { throw new Error("DB down") })
    await expect(readTeamRegistrations(TENANT, TEAM, {})).rejects.toThrow("DB down")
  })
})

describe("Registration squad options read (ENH-05-03 slice 4)", () => {
  it("reads only the team's ACTIVE players as bare id/name options", async () => {
    mocks.state.squad = [
      { id: PLAYER, name: "Active One" },
      { id: PLAYER2, name: "Active Two" },
    ]
    const options = await readRegistrationSquadOptions(TENANT, TEAM)
    expect(options).toEqual([{ id: PLAYER, name: "Active One" }, { id: PLAYER2, name: "Active Two" }])
    const query = mocks.queries.find(entry => entry.sql)!
    expect(query.fields).toEqual({ id: expect.anything(), name: expect.anything() })
    expect(query.params).toEqual(expect.arrayContaining([TENANT, TEAM]))
    expect(query.limit).toBe(100)
  })
  it("refuses a malformed team id before SQL", async () => {
    await expect(readRegistrationSquadOptions(TENANT, "bad")).rejects.toThrow()
    expect(mocks.queries).toHaveLength(0)
  })
  it("propagates a read failure instead of a false empty picker", async () => {
    mocks.state.squad = []
    mocks.select.mockImplementation(() => { throw new Error("DB down") })
    await expect(readRegistrationSquadOptions(TENANT, TEAM)).rejects.toThrow("DB down")
  })
})

describe("Registration detail read (ENH-05-03 slice 6)", () => {
  beforeEach(() => {
    mocks.state.registrationRows = [{ ...registration, teamName: "Tigers", tournamentName: "Cup" }]
    mocks.state.squad = [{ id: PLAYER, name: "P" }]
  })
  it("projects the bounded review columns plus squad names, with a bounded explicit-id roster join", async () => {
    const detail = await readRegistrationDetail(TENANT, REG)
    expect(detail).toMatchObject({ id: REG, teamName: "Tigers", tournamentName: "Cup", teamId: TEAM })
    expect(detail!.squad).toEqual([{ id: PLAYER, name: "P" }])
    for (const key of ["paymentTransactionId", "registeredBy", "approvedBy"]) {
      expect(detail).not.toHaveProperty(key)
    }
  })
  it("returns null for a foreign id instead of a fabricated row", async () => {
    mocks.state.registrationRows = []
    expect(await readRegistrationDetail(TENANT, REG)).toBeNull()
  })
  it("refuses a malformed id before SQL and propagates read failures", async () => {
    await expect(readRegistrationDetail(TENANT, "bad")).rejects.toThrow()
    expect(mocks.queries.filter(query => query.sql)).toHaveLength(0)
    mocks.select.mockImplementation(() => { throw new Error("DB down") })
    await expect(readRegistrationDetail(TENANT, REG)).rejects.toThrow("DB down")
  })
})
