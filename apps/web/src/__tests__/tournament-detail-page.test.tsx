import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import TournamentDetailPage from "@/app/dashboard/tournaments/[id]/page"
import { AWARD_DISPUTE_REVIEW_LABELS } from "@/components/tournaments/award-dispute-review-card"

const mocks = vi.hoisted(() => ({
  context: vi.fn(), getTournament: vi.fn(), remove: vi.fn(),
  following: vi.fn(), followerCount: vi.fn(), select: vi.fn(),
  disputes: vi.fn(),
}))
const components = vi.hoisted(() => ({
  DeleteButton: vi.fn(() => null), FollowButton: vi.fn(() => null),
  RegistrationToggle: vi.fn(() => null), TournamentSettingsSummary: vi.fn(() => null),
  AdvanceTournamentButton: vi.fn(() => null), GenerateFixturesButton: vi.fn(() => null),
}))

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound") } }))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/league-reads", () => ({ requireActiveLeagueContext: mocks.context }))
vi.mock("@/app/actions/tournaments", () => ({ getTournament: mocks.getTournament, deleteTournament: mocks.remove, generateFixtures: vi.fn() }))
vi.mock("@/app/actions/follows", () => ({ isFollowing: mocks.following, getFollowerCount: mocks.followerCount }))
vi.mock("@/components/shared/delete-button", () => ({ DeleteButton: components.DeleteButton }))
vi.mock("@/components/shared/follow-button", () => ({ FollowButton: components.FollowButton }))
vi.mock("@/components/tournaments/registration-toggle", () => ({ RegistrationToggle: components.RegistrationToggle }))
vi.mock("@/components/tournaments/advance-tournament-button", () => ({ AdvanceTournamentButton: components.AdvanceTournamentButton }))
vi.mock("@/components/tournaments/generate-fixtures-button", () => ({ GenerateFixturesButton: components.GenerateFixturesButton }))
vi.mock("@/components/tournaments/tournament-settings-summary", () => ({ TournamentSettingsSummary: components.TournamentSettingsSummary }))
// PUB-04 disputes: the owner queue read is mocked at the module boundary.
vi.mock("@/lib/award-dispute-records", () => ({ readOpenAwardDisputes: mocks.disputes }))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select },
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000ff"
const TOURNAMENT = "00000000-0000-4000-8000-000000000002"
const params = Promise.resolve({ id: TOURNAMENT })
const roleContext = (role: string) => ({ tenantId: TENANT, actorId: "actor", clerkId: "clerk", role })

const tournament = {
  id: TOURNAMENT, tenantId: TENANT, name: "Summer Cup", format: "league", status: "registration",
  startDate: null, endDate: null, registrationDeadline: null, maxTeams: 8,
  registrationOpen: true, description: null,
}

function selectChain() {
  const chain: any = {
    from: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain,
    innerJoin: () => chain, leftJoin: () => chain, groupBy: () => chain, having: () => chain,
    then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
  }
  return chain
}
function elements(node: any): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement(node)) return []
  return [node as React.ReactElement<any>, ...elements((node.props as any).children)]
}
function links(node: any) { return elements(node).map(element => element.props.href).filter(Boolean) }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue(roleContext("league_owner"))
  mocks.getTournament.mockResolvedValue(tournament)
  mocks.following.mockResolvedValue(false)
  mocks.followerCount.mockResolvedValue(0)
  mocks.select.mockImplementation(selectChain)
})

describe("Tournament detail page gates mutation controls by the viewer's exact-league role", () => {
  it("resolves tournament:read for the exact active league", async () => {
    await TournamentDetailPage({ params })
    expect(mocks.context).toHaveBeenCalledWith("tournament:read")
    expect(mocks.getTournament).toHaveBeenCalledWith(TOURNAMENT)
  })
  it("shows every control to a league owner", async () => {
    const tree = await TournamentDetailPage({ params })
    expect(links(tree)).toContain(`/dashboard/tournaments/${TOURNAMENT}/edit`)
    expect(links(tree)).toContain(`/dashboard/registrations/new?tournamentId=${TOURNAMENT}`)
    expect(elements(tree).some(element => element.type === components.RegistrationToggle)).toBe(true)
    expect(elements(tree).some(element => element.type === components.DeleteButton)).toBe(true)
    // Registration-stage tournament: fixture generation (Batch 49) is offered
    // to the match:create holder - the page wiring for the orphaned action.
    expect(elements(tree).some(element => element.type === components.GenerateFixturesButton)).toBe(true)
  })
  it("shows a team manager the registration CTA but no administration controls", async () => {
    mocks.context.mockResolvedValue(roleContext("team_manager"))
    const tree = await TournamentDetailPage({ params })
    expect(links(tree)).toContain(`/dashboard/registrations/new?tournamentId=${TOURNAMENT}`)
    expect(links(tree)).not.toContain(`/dashboard/tournaments/${TOURNAMENT}/edit`)
    expect(elements(tree).some(element => element.type === components.RegistrationToggle)).toBe(false)
    expect(elements(tree).some(element => element.type === components.DeleteButton)).toBe(false)
    expect(elements(tree).some(element => element.type === components.GenerateFixturesButton)).toBe(false)
  })
  it.each(["scorer", "coach", "player", "fan"])("hides every mutation control from a %s", async (role) => {
    mocks.context.mockResolvedValue(roleContext(role))
    const tree = await TournamentDetailPage({ params })
    expect(links(tree)).not.toContain(`/dashboard/tournaments/${TOURNAMENT}/edit`)
    expect(links(tree)).not.toContain(`/dashboard/registrations/new?tournamentId=${TOURNAMENT}`)
    expect(elements(tree).some(element => element.type === components.RegistrationToggle)).toBe(false)
    expect(elements(tree).some(element => element.type === components.DeleteButton)).toBe(false)
    expect(elements(tree).some(element => element.type === components.GenerateFixturesButton)).toBe(false)
  })
  it("propagates a denied or failed context before reading the tournament", async () => {
    mocks.context.mockRejectedValue(new Error("Forbidden"))
    await expect(TournamentDetailPage({ params })).rejects.toThrow("Forbidden")
    expect(mocks.getTournament).not.toHaveBeenCalled()
  })
  it("404s a missing tournament", async () => {
    mocks.getTournament.mockResolvedValue(null)
    await expect(TournamentDetailPage({ params })).rejects.toThrow("notFound")
  })
  it("404s a tournament resolved from a foreign league", async () => {
    mocks.getTournament.mockResolvedValue({ ...tournament, tenantId: OTHER_TENANT })
    await expect(TournamentDetailPage({ params })).rejects.toThrow("notFound")
  })
})

const DISPUTE_ROW = {
  disputeId: "00000000-0000-4000-8000-0000000000fa",
  awardId: "00000000-0000-4000-8000-0000000000fb",
  tournamentId: TOURNAMENT,
  category: "best_batsman",
  reason: "process_error" as const,
  reasonLabel: "The selection process was not followed",
  raisedAt: new Date("2026-10-18T08:00:00Z"),
  raisedByName: "Bilal",
}

describe("Award dispute review queue gates by owner authority (PUB-04)", () => {
  function reviewCard(tree: React.ReactNode): React.ReactElement | undefined {
    return elements(tree).find(
      (element) => typeof element.type === "function" && element.type.name === "AwardDisputeReviewCard")
  }

  beforeEach(() => {
    mocks.disputes.mockResolvedValue([DISPUTE_ROW])
  })

  it("hands the owner exactly the queued open disputes, bounded read upstream", async () => {
    const card = reviewCard(await TournamentDetailPage({ params })) as React.ReactElement<{ disputes: typeof DISPUTE_ROW[] }> | undefined
    expect(card).toBeDefined()
    expect(card!.props.disputes).toEqual([DISPUTE_ROW])
    expect(mocks.disputes).toHaveBeenCalledWith(TENANT)
  })

  it("shows no dispute queue to roles without tournament:update", async () => {
    mocks.context.mockResolvedValue(roleContext("team_manager"))
    const tree = await TournamentDetailPage({ params })
    expect(reviewCard(tree)).toBeUndefined()
    expect(mocks.disputes).not.toHaveBeenCalled()
  })
})

describe("Award dispute review copy (PUB-04 truthfulness)", () => {
  it("records decisions without ever promising the award will change", () => {
    expect(AWARD_DISPUTE_REVIEW_LABELS.upheld).toBe("Uphold")
    expect(AWARD_DISPUTE_REVIEW_LABELS.dismissed).toBe("Dismiss")
    expect(AWARD_DISPUTE_REVIEW_LABELS.intro).toContain("never changes the award itself")
    expect(AWARD_DISPUTE_REVIEW_LABELS.intro).toContain("correct the award separately")
    expect(AWARD_DISPUTE_REVIEW_LABELS.queueEmpty).toContain("No open award disputes")
    expect(AWARD_DISPUTE_REVIEW_LABELS.raisedByUnavailable).toContain("unavailable")
    expect(AWARD_DISPUTE_REVIEW_LABELS.successReplay).toContain("already decided")
  })
})
