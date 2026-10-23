import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  tenant: vi.fn(),
  match: vi.fn(),
  teams: vi.fn(),
}))

vi.mock("@/lib/public-tenant", () => ({ requirePublicTenantId: mocks.tenant }))
vi.mock("@/lib/public-visibility", () => ({
  readPublishedMatch: mocks.match,
  readPublishedMatchTeams: mocks.teams,
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const MATCH = "00000000-0000-4000-8000-000000000008"
const teamA = { id: "00000000-0000-4000-8000-000000000003", name: "Falcons", shortName: "FAL", primaryColor: "#1d4ed8", secondaryColor: null, logoUrl: null }
const teamB = { id: "00000000-0000-4000-8000-000000000004", name: "Tigers", shortName: "TIG", primaryColor: "#b91c1c", secondaryColor: null, logoUrl: null }

afterEach(() => {
  vi.resetAllMocks()
})

describe("Match OG image render data (Batch 119) — same gates, bounded values", () => {
  it("a published match yields team-name heading and a truthful sub-line; colors validated", async () => {
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.match.mockResolvedValue({ id: MATCH, status: "completed", matchFormat: "t20", scheduledDate: "2026-10-01", result: "Falcons won by 4 wickets", teamAId: teamA.id, teamBId: teamB.id })
    mocks.teams.mockResolvedValue({ teamA, teamB })
    const { resolveMatchOgRenderData } = await import("../lib/match-og-image")
    const data = await resolveMatchOgRenderData(MATCH)
    expect(data).not.toBeNull()
    expect(data!.heading).toBe("Falcons vs Tigers")
    expect(data!.subLine).toContain("Falcons won by 4 wickets")
    expect(data!.accentA).toBe("#1d4ed8")
    expect(data!.accentB).toBe("#b91c1c")
  })

  it("a match without a result falls back to format and date — nothing else is invented", async () => {
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.match.mockResolvedValue({ id: MATCH, status: "scheduled", matchFormat: "t20", scheduledDate: "2026-10-01", result: null, teamAId: teamA.id, teamBId: teamB.id })
    mocks.teams.mockResolvedValue({ teamA, teamB })
    const { resolveMatchOgRenderData } = await import("../lib/match-og-image")
    const data = await resolveMatchOgRenderData(MATCH)
    expect(data!.subLine).toContain("t20")
    expect(data!.subLine).toContain("2026-10-01")
  })

  it("invalid, non-hex, or absent team colors fall back to the platform palette — a raw column can never reach the canvas", async () => {
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.match.mockResolvedValue({ id: MATCH, status: "live", matchFormat: "t20", scheduledDate: "2026-10-01", result: null, teamAId: teamA.id, teamBId: teamB.id })
    mocks.teams.mockResolvedValue({ teamA: { ...teamA, primaryColor: "javascript:alert(1)" }, teamB: { ...teamB, primaryColor: null } })
    const { resolveMatchOgRenderData, PLATFORM_ACCENT_A, PLATFORM_ACCENT_B } = await import("../lib/match-og-image")
    const data = await resolveMatchOgRenderData(MATCH)
    expect(data!.accentA).toBe(PLATFORM_ACCENT_A)
    expect(data!.accentB).toBe(PLATFORM_ACCENT_B)
    expect(data!.accentA).toMatch(/^#[\da-fA-F]{6}$/)
  })

  it("an unpublished, foreign, half-resolved, or failed read yields null — no card for a hidden match", async () => {
    const { resolveMatchOgRenderData } = await import("../lib/match-og-image")
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.match.mockResolvedValue(null)
    expect(await resolveMatchOgRenderData(MATCH)).toBeNull()
    mocks.match.mockResolvedValue({ id: MATCH, status: "live", matchFormat: "t20", scheduledDate: null, result: null, teamAId: teamA.id, teamBId: teamB.id })
    mocks.teams.mockResolvedValue({ teamA, teamB: null })
    expect(await resolveMatchOgRenderData(MATCH)).toBeNull()
    mocks.match.mockRejectedValue(new Error("DB down"))
    expect(await resolveMatchOgRenderData(MATCH)).toBeNull()
  })
})
