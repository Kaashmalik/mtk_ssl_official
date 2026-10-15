import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), superAdmin: vi.fn(), select: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/super-admin", () => ({ isSuperAdmin: mocks.superAdmin }))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select },
}))

import { GET } from "@/app/api/admin/leagues/route"
import { adminLeagueListLimit, listAllLeaguesForAdmin } from "@/lib/admin-reads"

const rows = [
  { id: "t-1", name: "League A", slug: "league-a", plan: "free", customDomain: null, isActive: true, createdAt: new Date("2026-01-02T00:00:00Z") },
  { id: "t-2", name: "League B", slug: "league-b", plan: "pro", customDomain: "b.example.test", isActive: false, createdAt: new Date("2026-01-01T00:00:00Z") },
]

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk-admin" })
  mocks.superAdmin.mockResolvedValue(true)
  mocks.select.mockReturnValue({
    from: () => ({ orderBy: () => ({ limit: (limit: number) => (limit === adminLeagueListLimit ? Promise.resolve(rows) : Promise.resolve([])) }) }),
  })
})

describe("admin leagues route gates", () => {
  it("answers 401 before any role check when unauthenticated", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    const response = await GET()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
    expect(mocks.superAdmin).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("answers 403 for a non-super-admin account before any read", async () => {
    mocks.superAdmin.mockResolvedValue(false)
    const response = await GET()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "Forbidden" })
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("serves the projected, newest-first league list to a super admin", async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.leagues).toHaveLength(2)
    // Exactly the projected fields — never raw internal columns.
    for (const league of body.leagues) {
      expect(Object.keys(league).sort()).toEqual(
        ["createdAt", "customDomain", "id", "isActive", "name", "plan", "slug"].sort(),
      )
    }
    expect(body.leagues[0].id).toBe("t-1")
    expect(mocks.superAdmin).toHaveBeenCalledTimes(1)
  })

  it("fails closed with 500 when the read errors", async () => {
    mocks.select.mockReturnValue({
      from: () => ({ orderBy: () => ({ limit: () => Promise.reject(new Error("Database unavailable")) }) }),
    })
    const response = await GET()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Failed to fetch leagues" })
  })
})

describe("admin league list read bound", () => {
  it("caps the platform listing at the documented bound and keeps newest-first order", async () => {
    const leagues = await listAllLeaguesForAdmin()
    expect(adminLeagueListLimit).toBe(500)
    expect(mocks.select).toHaveBeenCalledTimes(1)
    expect(leagues[0].createdAt.getTime()).toBeGreaterThan(leagues[1].createdAt.getTime())
  })
})
