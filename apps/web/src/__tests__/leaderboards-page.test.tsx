import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import LeaderboardsPage from "@/app/leaderboards/page"

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), batting: vi.fn(), bowling: vi.fn() }))
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }))
vi.mock("@/lib/public-tenant", () => ({ requirePublicTenantId: mocks.tenant }))
vi.mock("@/lib/public-visibility", () => ({
  readPublicBattingLeaderboard: mocks.batting,
  readPublicBowlingLeaderboard: mocks.bowling,
}))

const TENANT = "00000000-0000-4000-8000-000000000001"

/** Collects rendered player names from the tables the page returns. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out }
  if (!React.isValidElement(node)) return out
  const props = node.props as { children?: React.ReactNode }
  React.Children.forEach(props.children, (child) => collectText(child, out))
  return out
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.batting.mockResolvedValue([{ playerId: "p1", playerName: "Adeel", total: 320 }])
  mocks.bowling.mockResolvedValue([{ playerId: "p2", playerName: "Bilal", total: 18 }])
})

describe("Public leaderboards are scoped to the request-host league", () => {
  it("reads both leaderboards for the resolved public tenant, never globally", async () => {
    const tree = await LeaderboardsPage()
    expect(mocks.tenant).toHaveBeenCalledTimes(1)
    expect(mocks.batting).toHaveBeenCalledWith(TENANT)
    expect(mocks.bowling).toHaveBeenCalledWith(TENANT)
    const text = collectText(tree)
    expect(text).toContain("Adeel")
    expect(text).toContain("Bilal")
  })

  it("propagates a no-tenant resolution instead of rendering a global list", async () => {
    mocks.tenant.mockRejectedValue(new Error("No tenant resolved"))
    await expect(LeaderboardsPage()).rejects.toThrow("No tenant resolved")
    expect(mocks.batting).not.toHaveBeenCalled()
  })

  it("renders an honest empty state when the league has no published stats", async () => {
    mocks.batting.mockResolvedValue([])
    mocks.bowling.mockResolvedValue([])
    const text = collectText(await LeaderboardsPage())
    expect(text.filter((t) => t === "No stats yet.")).toHaveLength(2)
  })
})
