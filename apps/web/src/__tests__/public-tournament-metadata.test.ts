import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  tenant: vi.fn(),
  tournament: vi.fn(),
}))

vi.mock("@/lib/public-tenant", () => ({ requirePublicTenantId: mocks.tenant }))
vi.mock("@/lib/public-visibility", () => ({ readPublishedTournament: mocks.tournament }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const TOURNAMENT = "00000000-0000-4000-8000-000000000007"
const tournament = { id: TOURNAMENT, name: "Falcon Cup", description: "Annual invitational", format: "t20", status: "live", startDate: "2026-09-01", endDate: "2026-10-30", championTeamId: null }
const NOINDEX = { index: false, follow: false }

afterEach(() => {
  vi.resetAllMocks()
})

describe("Public tournament metadata (Batch 116) — fail closed, never fabricate", () => {
  it("a published tournament yields its name, truthful facts and a canonical path", async () => {
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.tournament.mockResolvedValue(tournament)
    const { resolvePublicTournamentMetadata } = await import("@/lib/public-tournament-metadata")
    const meta = await resolvePublicTournamentMetadata(TOURNAMENT) as unknown as Record<string, any>
    expect(meta.title).toBe("Falcon Cup")
    expect(meta.robots).toEqual({ index: true, follow: true })
    expect(meta.alternates.canonical).toBe(`/tournaments/${TOURNAMENT}`)
    expect(String(meta.description)).toContain("Falcon Cup")
    expect(String(meta.description)).toContain("Annual invitational")
  })

  it("the description is bounded — an unbounded database text column must not flow into a card verbatim", async () => {
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.tournament.mockResolvedValue({ ...tournament, description: "Long ".repeat(200) })
    const { resolvePublicTournamentMetadata } = await import("@/lib/public-tournament-metadata")
    const meta = await resolvePublicTournamentMetadata(TOURNAMENT) as unknown as Record<string, any>
    expect(String(meta.description).length).toBeLessThanOrEqual(320)
  })

  it("an unpublished or foreign tournament is noindex with no fabricated title", async () => {
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.tournament.mockResolvedValue(null)
    const { resolvePublicTournamentMetadata } = await import("@/lib/public-tournament-metadata")
    const meta = await resolvePublicTournamentMetadata(TOURNAMENT) as unknown as Record<string, any>
    expect(meta.robots).toEqual(NOINDEX)
    expect(meta.title).toBeUndefined()
  })

  it("read failures fail closed to noindex", async () => {
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.tournament.mockRejectedValue(new Error("DB down"))
    const { resolvePublicTournamentMetadata } = await import("@/lib/public-tournament-metadata")
    expect(((await resolvePublicTournamentMetadata(TOURNAMENT)) as any).robots).toEqual(NOINDEX)
  })
})
