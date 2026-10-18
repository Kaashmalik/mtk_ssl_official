import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { teams, matches, matchInnings, venues, players, leagueRegistrations, matchAvailability } from "@mtk/database"
import type { SquadRegistration } from "@mtk/database/lib/registered-squad-eligibility"
import { MatchReadinessCard } from "@/components/matches/readiness-card"
import MatchesPage from "@/app/dashboard/matches/page"
import MatchDetailPage from "@/app/dashboard/matches/[id]/page"
import NewMatchPage from "@/app/dashboard/matches/new/page"
import EditMatchPage from "@/app/dashboard/matches/[id]/edit/page"
import { DeleteButton } from "@/components/shared/delete-button"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), tenant: vi.fn(), permission: vi.fn(), match: vi.fn(),
  options: vi.fn(), scorecard: vi.fn(), select: vi.fn(), predicates: [] as any[], registrations: [] as SquadRegistration[], registrationFailure: false }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) },
  notFound: () => { throw new Error("not-found") } }))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.tenant, requirePermissionServer: mocks.permission }))
vi.mock("@/app/actions/matches", () => ({ getMatch: mocks.match, deleteMatch: vi.fn(), getMatchFormOptions: mocks.options }))
vi.mock("@/app/actions/scorecards", () => ({ getFullScorecard: mocks.scorecard }))
vi.mock("@/components/shared/delete-button", () => ({ DeleteButton: () => null }))
vi.mock("@/components/matches/match-lifecycle-controls", () => ({ MatchLifecycleControls: () => null }))
vi.mock("@/components/matches/stream-start-modal", () => ({ StreamStartModal: () => null }))
vi.mock("@/components/matches/scorer-assign", () => ({ ScorerAssign: () => null }))
vi.mock("@/components/share/share-button", () => ({ ShareButton: () => null }))
vi.mock("@/components/matches/new-match-form", () => ({ NewMatchForm: () => null }))
vi.mock("@/components/matches/edit-match-form", () => ({ EditMatchForm: () => null }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select } }))
const TENANT = "00000000-0000-4000-8000-000000000001"
const MATCH = "00000000-0000-4000-8000-000000000002"
const A = "00000000-0000-4000-8000-000000000003"
const B = "00000000-0000-4000-8000-000000000004"
const PLAYER = "00000000-0000-4000-8000-000000000005"
const VENUE = "00000000-0000-4000-8000-000000000006"
const TOURNAMENT = "00000000-0000-4000-8000-000000000007"
const fixture = { id: MATCH, tenantId: TENANT, teamAId: A, teamBId: B, venueId: VENUE, manOfMatchId: PLAYER,
  status: "scheduled", scheduledDate: null, matchFormat: "t20", matchType: "friendly", totalOvers: 20 }
const dialect = new PgDialect()
const params = { params: Promise.resolve({ id: MATCH }) }
function elements(node: any): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement(node)) return []
  return [node as React.ReactElement<any>, ...elements((node.props as any).children)]
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.predicates.length = 0
  mocks.registrations = []
  mocks.registrationFailure = false
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.permission.mockResolvedValue(undefined)
  mocks.match.mockResolvedValue(fixture)
  mocks.options.mockResolvedValue({ teams: [{ id: A, name: "A" }, { id: B, name: "B" }], tournaments: [] })
  mocks.scorecard.mockResolvedValue({ batting: [{ inningsId: "innings", playerId: PLAYER, bowlerId: B,
    fielderId: A, dismissalType: "caught" }], bowling: [{ inningsId: "innings", playerId: B }] })
  mocks.select.mockImplementation(() => ({ from: (table: any) => {
    let rows: any[] = []
    let predicatesRecord: { limit?: number } | undefined
    const chain: any = {
      // REG-05 (Batch 138): the availability summary joins rows to users
      // BEFORE where(); the chain must accept the join link transparently.
      innerJoin: () => chain,
      where: (where: any) => {
        const query = dialect.sqlToQuery(where)
        predicatesRecord = { table, ...query, limit: undefined as number | undefined } as any
        mocks.predicates.push(predicatesRecord)
        if (table === matches) rows = [fixture]
        if (table === teams) rows = [{ id: query.params[0], name: query.params[0] === A ? "A" : "B" }]
        if (table === venues) rows = [{ name: "Ground", city: "City" }]
        if (table === players) rows = [{ id: PLAYER, name: "Player" }]
        if (table === matchInnings) rows = [{ id: "innings", teamId: A, inningsNumber: 1, totalBalls: 0, totalRuns: 0, totalWickets: 0 }]
        if (table === leagueRegistrations) rows = mocks.registrations
        if (table === matchAvailability) rows = []
        return chain
      },
      limit: async (limit: number) => {
        if (predicatesRecord) predicatesRecord.limit = limit
        if (table === leagueRegistrations && mocks.registrationFailure) throw new Error("Registration read unavailable")
        return rows
      },
      orderBy: () => chain,
      then: (resolve: any) => resolve(rows),
    }
    return chain
  } }))
})

describe("Match dashboard route boundaries", () => {
  it("authorizes the active league before list queries and scopes every auxiliary lookup", async () => {
    await MatchesPage()
    expect(mocks.permission).toHaveBeenCalledWith("match:read", TENANT)
    expect(mocks.select.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.permission.mock.invocationCallOrder[0])
    expect(mocks.predicates.filter(q => q.table === matches)).toHaveLength(3)
    expect(mocks.predicates.every(q => q.params.includes(TENANT))).toBe(true)
    expect(mocks.predicates.filter(q => q.table === teams)).toHaveLength(6)
    expect(mocks.predicates.filter(q => q.table === matchInnings)).toHaveLength(3)
  })
  it("does not query business records for denied membership", async () => {
    mocks.permission.mockRejectedValue(new Error("Forbidden"))
    await expect(MatchesPage()).rejects.toThrow("Forbidden")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("does not query business records for anonymous sessions", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(MatchesPage()).rejects.toThrow("redirect:/")
    expect(mocks.tenant).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("does not fall back or read on active-league lookup failure", async () => {
    mocks.tenant.mockRejectedValue(new Error("Resolution unavailable"))
    await expect(MatchesPage()).rejects.toThrow("Resolution unavailable")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("scopes detail team/venue/award/roster/innings and dismissal-name reads to the authorized match's league", async () => {
    const tree = elements(await MatchDetailPage(params))
    expect(mocks.match).toHaveBeenCalledWith(MATCH)
    expect(mocks.scorecard).toHaveBeenCalledWith(MATCH)
    expect(mocks.predicates.length).toBeGreaterThanOrEqual(10)
    // Every read is scoped to the authorized match's league, with exactly
    // one documented exception class: the session's OWN identity
    // resolution (Clerk-id account lookup), which is global by nature and
    // reads nothing that belongs to a league (REG-05, Batch 138).
    expect(mocks.predicates.every(q =>
      q.params.includes(TENANT)
      || q.params.includes("clerk"),
    )).toBe(true)
    expect(tree.find(e => e.type === DeleteButton)!.props.operation).toBe("cancel")
  })
  it("does not request auxiliary detail data when match access is denied", async () => {
    mocks.match.mockRejectedValue(new Error("Forbidden"))
    await expect(MatchDetailPage(params)).rejects.toThrow("Forbidden")
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.scorecard).not.toHaveBeenCalled()
  })
  it("does not request auxiliary detail data for a foreign/missing match", async () => {
    mocks.match.mockResolvedValue(null)
    await expect(MatchDetailPage(params)).rejects.toThrow("not-found")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("uses active-league creation picker options rather than generic owned-league actions", async () => {
    const page = await NewMatchPage()
    expect(mocks.options).toHaveBeenCalledWith("create")
    expect(page.props.teams).toHaveLength(2)
  })
  it("uses the same active-league edit picker after authorized match detail", async () => {
    const page = await EditMatchPage(params)
    expect(mocks.options).toHaveBeenCalledWith("update")
    expect(page.props.teams).toHaveLength(2)
  })
  it("does not offer metadata editing or cancellation for a completed match", async () => {
    mocks.match.mockResolvedValue({ ...fixture, status: "completed" })
    const tree = elements(await MatchDetailPage(params))
    expect(tree.some(e => e.type === DeleteButton)).toBe(false)
    await expect(EditMatchPage(params)).rejects.toThrow(`redirect:/dashboard/matches/${MATCH}`)
    expect(mocks.options).not.toHaveBeenCalled()
  })
  it("passes known non-approved registrations to readiness instead of hiding them as legacy unknowns", async () => {
    mocks.match.mockResolvedValue({ ...fixture, tournamentId: TOURNAMENT })
    mocks.registrations = [{ tenantId: TENANT, tournamentId: TOURNAMENT, teamId: A, status: "withdrawn", squadPlayerIds: [PLAYER] }]
    const tree = elements(await MatchDetailPage(params))
    const readiness = tree.find(element => element.type === MatchReadinessCard)!.props.match
    expect(readiness.teamARegistrationApproved).toBe(false)
    expect(readiness.teamBRegistrationApproved).toBeUndefined()
    const query = mocks.predicates.find(row => row.table === leagueRegistrations)
    expect(query.params).toEqual([TENANT, TOURNAMENT, A, B])
    expect(query.limit).toBe(3)
  })
  it("does not render arbitrary readiness for duplicate registration rows", async () => {
    mocks.match.mockResolvedValue({ ...fixture, tournamentId: TOURNAMENT })
    const row = { tenantId: TENANT, tournamentId: TOURNAMENT, teamId: A, status: "approved", squadPlayerIds: [PLAYER] }
    mocks.registrations = [row, row]
    await expect(MatchDetailPage(params)).rejects.toThrow("require review")
  })
  it("propagates a readiness registration read outage", async () => {
    mocks.match.mockResolvedValue({ ...fixture, tournamentId: TOURNAMENT })
    mocks.registrationFailure = true
    await expect(MatchDetailPage(params)).rejects.toThrow("Registration read unavailable")
  })
})
