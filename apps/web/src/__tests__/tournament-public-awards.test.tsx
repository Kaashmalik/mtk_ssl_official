import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import PublicTournamentPage from "@/app/tournaments/[id]/page"
import { AWARD_DISPUTE_LABELS } from "@/components/tournaments/award-dispute-affordance"

const mocks = vi.hoisted(() => ({
  tenant: vi.fn(), publishedTournament: vi.fn(), awards: vi.fn(), prizes: vi.fn(),
  affordance: vi.fn(),
  championCalls: [] as unknown[][],
}))
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound") } }))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/public-tenant", () => ({ requirePublicTenantId: mocks.tenant }))
vi.mock("@/lib/public-visibility", () => ({
  readPublishedTournament: mocks.publishedTournament,
  readPublishedTournamentAwards: mocks.awards,
  readPublishedTournamentPrizes: mocks.prizes,
  // FAN-03: the champion banner + milestone reads - none in these scenarios.
  readPublishedTournamentChampion: (...args: unknown[]) => {
    mocks.championCalls.push(args)
    return Promise.resolve(null)
  },
  readPublishedTournamentMilestones: () => Promise.resolve({ centuries: [], fiveFors: [] }),
  // Batch 124: the Most Runs / Most Wickets reads — no published stats in
  // these scenarios, so the leaders card never mounts on top of the awards
  // assertions.
  readPublicBattingLeaderboard: () => Promise.resolve([]),
  readPublicBowlingLeaderboard: () => Promise.resolve([]),
}))
vi.mock("@/components/tournaments/knockout-bracket", () => ({ KnockoutBracket: () => null }))
// PUB-04 disputes: the affordance read is mocked at the module boundary so
// these page tests never touch Clerk/session state.
vi.mock("@/lib/award-dispute-records", () => ({
  readAwardDisputeAffordanceSafe: mocks.affordance,
}))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { select: () => thenableEmpty() },
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const TOURNAMENT = "00000000-0000-4000-8000-000000000002"

function thenableEmpty(): Promise<unknown[]> & Record<string, unknown> {
  const rows: unknown[] = []
  const promise = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>
  for (const method of ["where", "orderBy", "limit", "from"]) {
    ;(promise as any)[method] = () => promise
  }
  return promise
}

const tournament = {
  id: TOURNAMENT, tenantId: TENANT, name: "Summer Cup", format: "t20", status: "completed",
  startDate: null, endDate: null, registrationDeadline: null, maxTeams: 8,
  registrationOpen: false, description: null,
}
const awards = [{
  id: "00000000-0000-4000-8000-0000000000aa", category: "player_of_the_tournament",
  categoryLabel: "Player of the Tournament", playerId: "p1", playerName: "Aarav Kohli",
  teamId: null, teamName: null, citation: "456 runs at 76", declaredAt: new Date("2026-10-15T00:00:00Z"),
}]

function texts(node: any, bucket: string[] = []): string[] {
  if (Array.isArray(node)) return node.flatMap((child) => texts(child, bucket))
  if (typeof node === "string" || typeof node === "number") { bucket.push(String(node)); return bucket }
  if (!React.isValidElement(node)) return bucket
  texts((node.props as any).children, bucket)
  return bucket
}

/** Elements of a named client component (page tests tree-walk, not render). */
function findNamed(node: any, name: string, out: any[] =[]): any[] {
  if (Array.isArray(node)) return node.flatMap((child) => findNamed(child, name, out))
  if (!React.isValidElement(node)) return out
  if (typeof node.type === "function" && node.type.name === name) out.push(node)
  findNamed((node.props as any).children, name, out)
  return out
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.publishedTournament.mockResolvedValue(tournament)
  mocks.awards.mockResolvedValue(awards)
  mocks.prizes.mockResolvedValue([])
  // Default: no dispute affordance (anonymous visitors and non-members).
  mocks.affordance.mockResolvedValue(null)
})

describe("Public tournament page official awards gallery (PUB-04)", () => {
  it("renders only official, organizer-declared awards with their provenance", async () => {
    const tree = await PublicTournamentPage({ params: Promise.resolve({ id: TOURNAMENT }) })
    const copy = texts(tree).join("\n")
    expect(copy).toContain("Official Awards")
    expect(copy).toContain("Player of the Tournament")
    expect(copy).toContain("Aarav Kohli")
    expect(copy).toContain("456 runs at 76")
    expect(copy).toContain("2026-10-15")
    expect(copy).toContain("Official")
    // Fan-favorite separation is a stated guarantee of the surface.
    expect(copy).toContain("never mixed")
  })

  it("shows no awards section when the league has declared none", async () => {
    mocks.awards.mockResolvedValue([])
    const tree = await PublicTournamentPage({ params: Promise.resolve({ id: TOURNAMENT }) })
    expect(texts(tree)).not.toContain("Official Awards")
  })

  it("reads the gallery only for an already-published tournament (404 ordering)", async () => {
    mocks.publishedTournament.mockResolvedValue(null)
    await expect(PublicTournamentPage({ params: Promise.resolve({ id: TOURNAMENT }) }))
      .rejects.toThrow("notFound")
    expect(mocks.awards).not.toHaveBeenCalled()
    expect(mocks.publishedTournament).toHaveBeenCalledWith(TENANT, TOURNAMENT)
    // The affordance read is an award-gallery read: it must not run either.
    expect(mocks.affordance).not.toHaveBeenCalled()
  })

  it("offers no dispute affordance to guests and non-members (null = page unchanged)", async () => {
    const tree = await PublicTournamentPage({ params: Promise.resolve({ id: TOURNAMENT }) })
    const copy = texts(tree).join("\n")
    expect(copy).toContain("Official Awards")
    expect(copy).not.toContain("Challenge")
    expect(copy).not.toContain("formally challenge")
  })

  it("offers the challenge affordance to a registered member with no open dispute", async () => {
    mocks.affordance.mockResolvedValue({ myOpenDisputeAwardIds: [] })
    const tree = await PublicTournamentPage({ params: Promise.resolve({ id: TOURNAMENT }) })
    // Client components are tree-walked as elements (no renderer in house page
    // tests), so the affordance is asserted by element + exact props.
    const affordances = findNamed(tree, "AwardDisputeAffordance")
    expect(affordances).toHaveLength(1)
    expect(affordances[0].props).toEqual({
      tournamentId: TOURNAMENT, awardId: "00000000-0000-4000-8000-0000000000aa",
    })
    expect(findNamed(tree, "AwardDisputePendingNotice")).toHaveLength(0)
    expect(mocks.affordance).toHaveBeenCalledWith(TENANT, TOURNAMENT)
  })

  it("dims the affordance when the member already has an OPEN dispute on that award", async () => {
    mocks.affordance.mockResolvedValue({
      myOpenDisputeAwardIds: ["00000000-0000-4000-8000-0000000000aa"],
    })
    const tree = await PublicTournamentPage({ params: Promise.resolve({ id: TOURNAMENT }) })
    // The Challenge control is replaced by the pending notice.
    expect(findNamed(tree, "AwardDisputeAffordance")).toHaveLength(0)
    expect(findNamed(tree, "AwardDisputePendingNotice")).toHaveLength(1)
  })
})

describe("Award dispute affordance copy (PUB-04 truthfulness)", () => {
  it("states exactly what raising does and does not do", () => {
    expect(AWARD_DISPUTE_LABELS.action).toBe("Challenge")
    expect(AWARD_DISPUTE_LABELS.intro).toContain("formally challenge an official award")
    expect(AWARD_DISPUTE_LABELS.intro).toContain("never changes the award by itself")
    expect(AWARD_DISPUTE_LABELS.open).toContain("awaiting review")
    expect(AWARD_DISPUTE_LABELS.successReplay).toContain("already have an open dispute")
    // The affordance never promises the award will change or that disputes
    // override declarations.
    for (const value of Object.values(AWARD_DISPUTE_LABELS)) {
      expect(value.toLowerCase()).not.toContain("will be changed")
      expect(value.toLowerCase()).not.toContain("revok")
    }
  })
})
