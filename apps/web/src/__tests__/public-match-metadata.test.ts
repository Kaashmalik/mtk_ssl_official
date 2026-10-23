import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  tenant: vi.fn(),
  match: vi.fn(),
  teams: vi.fn(),
}))

vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: vi.fn() }))
vi.mock("@/lib/public-tenant", () => ({ requirePublicTenantId: mocks.tenant }))
vi.mock("@/lib/public-visibility", () => ({
  readPublishedMatch: mocks.match,
  readPublishedMatchTeams: mocks.teams,
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const MATCH = "00000000-0000-4000-8000-000000000008"
const teamA = { id: "00000000-0000-4000-8000-000000000003", name: "Falcons" }
const teamB = { id: "00000000-0000-4000-8000-000000000004", name: "Tigers" }
const match = { id: MATCH, status: "completed", matchFormat: "t20", scheduledDate: "2026-10-01", result: "Falcons won by 4 wickets", teamAId: teamA.id, teamBId: teamB.id }
const NOINDEX = { index: false, follow: false }

afterEach(() => {
  vi.resetAllMocks()
})

describe("Public match metadata (Batch 114) — fail closed, never fabricate", () => {
  it("a published match yields team names, the truthful result and a canonical path", async () => {
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.match.mockResolvedValue(match)
    mocks.teams.mockResolvedValue({ teamA, teamB })
    const { resolvePublicMatchMetadata } = await import("@/lib/public-match-metadata")
    const meta = await resolvePublicMatchMetadata(MATCH) as unknown as Record<string, any>
    expect(meta.title).toBe("Falcons vs Tigers")
    expect(meta.robots).toEqual({ index: true, follow: true })
    expect(meta.alternates.canonical).toBe(`/matches/${MATCH}`)
    expect(meta.openGraph.title).toBe("Falcons vs Tigers")
    expect(String(meta.description)).toContain("Falcons won by 4 wickets")
  })

  it("an unpublished or foreign match is noindex instead of fabricating a title", async () => {
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.match.mockResolvedValue(null)
    const { resolvePublicMatchMetadata } = await import("@/lib/public-match-metadata")
    const meta = await resolvePublicMatchMetadata(MATCH) as unknown as Record<string, any>
    expect(meta.robots).toEqual(NOINDEX)
    expect(meta.title).toBeUndefined()
  })

  it("missing team resolution and read failures both fail closed to noindex", async () => {
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.match.mockResolvedValue(match)
    mocks.teams.mockResolvedValue({ teamA, teamB: null })
    const { resolvePublicMatchMetadata } = await import("@/lib/public-match-metadata")
    expect(((await resolvePublicMatchMetadata(MATCH)) as any).robots).toEqual(NOINDEX)
    mocks.match.mockRejectedValue(new Error("DB down"))
    expect(((await resolvePublicMatchMetadata(MATCH)) as any).robots).toEqual(NOINDEX)
  })
})
