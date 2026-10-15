import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import TournamentDetailPage from "@/app/dashboard/tournaments/[id]/page"

const mocks = vi.hoisted(() => ({
  context: vi.fn(), getTournament: vi.fn(), remove: vi.fn(),
  following: vi.fn(), followerCount: vi.fn(), select: vi.fn(),
}))
const components = vi.hoisted(() => ({
  DeleteButton: vi.fn(() => null), FollowButton: vi.fn(() => null),
  RegistrationToggle: vi.fn(() => null), TournamentSettingsSummary: vi.fn(() => null),
}))

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound") } }))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/league-reads", () => ({ requireActiveLeagueContext: mocks.context }))
vi.mock("@/app/actions/tournaments", () => ({ getTournament: mocks.getTournament, deleteTournament: mocks.remove }))
vi.mock("@/app/actions/follows", () => ({ isFollowing: mocks.following, getFollowerCount: mocks.followerCount }))
vi.mock("@/components/shared/delete-button", () => ({ DeleteButton: components.DeleteButton }))
vi.mock("@/components/shared/follow-button", () => ({ FollowButton: components.FollowButton }))
vi.mock("@/components/tournaments/registration-toggle", () => ({ RegistrationToggle: components.RegistrationToggle }))
vi.mock("@/components/tournaments/tournament-settings-summary", () => ({ TournamentSettingsSummary: components.TournamentSettingsSummary }))
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
  })
  it("shows a team manager the registration CTA but no administration controls", async () => {
    mocks.context.mockResolvedValue(roleContext("team_manager"))
    const tree = await TournamentDetailPage({ params })
    expect(links(tree)).toContain(`/dashboard/registrations/new?tournamentId=${TOURNAMENT}`)
    expect(links(tree)).not.toContain(`/dashboard/tournaments/${TOURNAMENT}/edit`)
    expect(elements(tree).some(element => element.type === components.RegistrationToggle)).toBe(false)
    expect(elements(tree).some(element => element.type === components.DeleteButton)).toBe(false)
  })
  it.each(["scorer", "coach", "player", "fan"])("hides every mutation control from a %s", async (role) => {
    mocks.context.mockResolvedValue(roleContext(role))
    const tree = await TournamentDetailPage({ params })
    expect(links(tree)).not.toContain(`/dashboard/tournaments/${TOURNAMENT}/edit`)
    expect(links(tree)).not.toContain(`/dashboard/registrations/new?tournamentId=${TOURNAMENT}`)
    expect(elements(tree).some(element => element.type === components.RegistrationToggle)).toBe(false)
    expect(elements(tree).some(element => element.type === components.DeleteButton)).toBe(false)
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
