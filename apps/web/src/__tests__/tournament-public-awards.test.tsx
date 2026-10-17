import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import PublicTournamentPage from "@/app/tournaments/[id]/page"

const mocks = vi.hoisted(() => ({
  tenant: vi.fn(), publishedTournament: vi.fn(), awards: vi.fn(), prizes: vi.fn(),
  championCalls: [] as unknown[][],
}))
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound") } }))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/public-tenant", () => ({ requirePublicTenantId: mocks.tenant }))
vi.mock("@/lib/public-visibility", () => ({
  readPublishedTournament: mocks.publishedTournament,
  readPublishedTournamentAwards: mocks.awards,
  readPublishedTournamentPrizes: mocks.prizes,
  // FAN-03: the champion banner read - champion-less in these scenarios.
  readPublishedTournamentChampion: (...args: unknown[]) => {
    mocks.championCalls.push(args)
    return Promise.resolve(null)
  },
}))
vi.mock("@/components/tournaments/knockout-bracket", () => ({ KnockoutBracket: () => null }))
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

beforeEach(() => {
  vi.resetAllMocks()
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.publishedTournament.mockResolvedValue(tournament)
  mocks.awards.mockResolvedValue(awards)
  mocks.prizes.mockResolvedValue([])
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
  })
})
