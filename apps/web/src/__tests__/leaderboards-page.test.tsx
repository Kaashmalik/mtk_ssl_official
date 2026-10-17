import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import LeaderboardsPage from "@/app/leaderboards/page"

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), batting: vi.fn(), bowling: vi.fn(), fielding: vi.fn() }))
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }))
vi.mock("@/lib/public-tenant", () => ({ requirePublicTenantId: mocks.tenant }))
vi.mock("@/lib/public-visibility", () => ({
  readPublicBattingLeaderboard: mocks.batting,
  readPublicBowlingLeaderboard: mocks.bowling,
  readPublicFieldingLeaderboard: mocks.fielding,
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

function collectElements(node: unknown, type: string): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement(node)) return []
  const props = node.props as { children?: React.ReactNode }
  return [
    ...(node.type === type ? [node as React.ReactElement<Record<string, unknown>>] : []),
    ...React.Children.toArray(props.children).flatMap(child => collectElements(child, type)),
  ]
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.batting.mockResolvedValue([{ playerId: "p1", playerName: "Adeel", total: 320 }])
  mocks.bowling.mockResolvedValue([{ playerId: "p2", playerName: "Bilal", total: 18 }])
  mocks.fielding.mockResolvedValue([{ playerId: "p3", playerName: "Usman", total: 7 }])
})

describe("Public leaderboards are scoped to the request-host league", () => {
  it("reads all three leaderboards for the resolved public tenant, never globally", async () => {
    const tree = await LeaderboardsPage({})
    expect(mocks.tenant).toHaveBeenCalledTimes(1)
    expect(mocks.batting).toHaveBeenCalledWith(TENANT, { minimumInnings: 0, minimumBalls: 0, minimumMatches: 0 })
    expect(mocks.bowling).toHaveBeenCalledWith(TENANT, { minimumInnings: 0, minimumBalls: 0, minimumMatches: 0 })
    expect(mocks.fielding).toHaveBeenCalledWith(TENANT, { minimumInnings: 0, minimumBalls: 0, minimumMatches: 0 })
    const text = collectText(tree)
    expect(text).toContain("Adeel")
    expect(text).toContain("Bilal")
    expect(text).toContain("Usman")
  })

  it("propagates a no-tenant resolution instead of rendering a global list", async () => {
    mocks.tenant.mockRejectedValue(new Error("No tenant resolved"))
    await expect(LeaderboardsPage({})).rejects.toThrow("No tenant resolved")
    expect(mocks.batting).not.toHaveBeenCalled()
  })

  it("renders an honest empty state when the league has no published stats", async () => {
    mocks.batting.mockResolvedValue([])
    mocks.bowling.mockResolvedValue([])
    mocks.fielding.mockResolvedValue([])
    const text = collectText(await LeaderboardsPage({}))
    expect(text.filter((t) => t === "No published stats meet these minimums.")).toHaveLength(3)
  })

  it("passes user-selected minimums to all three same-league readers", async () => {
    await LeaderboardsPage({ searchParams: Promise.resolve({ minimumInnings: "3", minimumBalls: "60", minimumMatches: "4" }) })
    expect(mocks.batting).toHaveBeenCalledWith(TENANT, { minimumInnings: 3, minimumBalls: 60, minimumMatches: 4 })
    expect(mocks.bowling).toHaveBeenCalledWith(TENANT, { minimumInnings: 3, minimumBalls: 60, minimumMatches: 4 })
    expect(mocks.fielding).toHaveBeenCalledWith(TENANT, { minimumInnings: 3, minimumBalls: 60, minimumMatches: 4 })
  })

  it("passes a format-qualified filter through and labels it as format-specific, never as official records", async () => {
    const tree = await LeaderboardsPage({ searchParams: Promise.resolve({ format: "t20", minimumInnings: "3", minimumBalls: "60", minimumMatches: "2" }) })
    expect(mocks.batting).toHaveBeenCalledWith(TENANT, { minimumInnings: 3, minimumBalls: 60, minimumMatches: 2, format: "t20" })
    expect(mocks.bowling).toHaveBeenCalledWith(TENANT, { minimumInnings: 3, minimumBalls: 60, minimumMatches: 2, format: "t20" })
    expect(mocks.fielding).toHaveBeenCalledWith(TENANT, { minimumInnings: 3, minimumBalls: 60, minimumMatches: 2, format: "t20" })
    const text = collectText(tree).join(" ")
    expect(text).toContain("T20-format")
    expect(text).toContain("Top Run Scorers")
    expect(text).toContain("Top Fielders")
    expect(text).toContain("Dismissals")
    expect(text).toContain("— T20")
    expect(text).toContain("not official records or league awards")
    expect(text).toContain("only shown with the person's own consent")
  })

  it("keeps the combined labels when the format filter is left unselected", async () => {
    const tree = await LeaderboardsPage({ searchParams: Promise.resolve({ format: "", minimumInnings: "3", minimumBalls: "60" }) })
    expect(mocks.batting).toHaveBeenCalledWith(TENANT, { minimumInnings: 3, minimumBalls: 60, minimumMatches: 0 })
    expect(collectText(tree).join(" ")).toContain("Formats are combined")
  })

  it("does not query or fake an empty ranking for an invalid or repeated format", async () => {
    const text = collectText(await LeaderboardsPage({ searchParams: Promise.resolve({ format: ["t20", "odi"] }) })).join(" ")
    expect(text).toContain("a valid match format")
    expect(mocks.batting).not.toHaveBeenCalled()
    expect(mocks.bowling).not.toHaveBeenCalled()
    expect(mocks.fielding).not.toHaveBeenCalled()
  })

  it.each(["-1", "1.5", "10001", ["1", "2"]])("does not query or fake an empty ranking for invalid input %s", async value => {
    const text = collectText(await LeaderboardsPage({ searchParams: Promise.resolve({ minimumInnings: value }) }))
    expect(text.join(" ")).toContain("Enter whole-number minimums")
    expect(text).not.toContain("No published stats meet these minimums.")
    expect(mocks.batting).not.toHaveBeenCalled()
    expect(mocks.bowling).not.toHaveBeenCalled()
    expect(mocks.fielding).not.toHaveBeenCalled()
  })

  it.each(["-1", "10001", ["2", "3"]])("rejects an invalid matches qualification %s for the fielding board", async value => {
    const text = collectText(await LeaderboardsPage({ searchParams: Promise.resolve({ minimumMatches: value }) }))
    expect(text.join(" ")).toContain("Enter whole-number minimums")
    expect(mocks.fielding).not.toHaveBeenCalled()
  })

  it("labels the aggregates without claiming verified, format-specific or official records", async () => {
    const text = collectText(await LeaderboardsPage({})).join(" ")
    expect(text).toContain("Formats are combined")
    expect(text).toContain("not official records or league awards")
    expect(text).toContain("only shown with the person's own consent")
    expect(text).toContain("Zero means no minimum")
    // Fielding's qualification basis is matches, and innings/balls never apply to it.
    expect(text).toContain("matches for fielding")
    expect(text).toContain("minimum balls and innings do not apply to it")
  })

  it.each(["batting", "bowling", "fielding"] as const)("propagates a %s failure instead of an empty ranking", async kind => {
    mocks[kind].mockRejectedValue(new Error("Database unavailable"))
    await expect(LeaderboardsPage({})).rejects.toThrow("Database unavailable")
  })

  it("uses a labelled GET form and accessible table headers", async () => {
    const tree = await LeaderboardsPage({ searchParams: Promise.resolve({ minimumInnings: "2", minimumBalls: "12", minimumMatches: "1" }) })
    expect(collectElements(tree, "form")[0].props.method).toBe("get")
    expect(collectElements(tree, "input").map(node => node.props)).toMatchObject([
      { id: "minimum-innings", name: "minimumInnings", min: 0, max: 10_000, defaultValue: 2 },
      { id: "minimum-balls", name: "minimumBalls", min: 0, max: 10_000, defaultValue: 12 },
      { id: "minimum-matches", name: "minimumMatches", min: 0, max: 10_000, defaultValue: 1 },
    ])
    expect(collectElements(tree, "label").map(node => node.props.htmlFor)).toEqual(["format", "minimum-innings", "minimum-balls", "minimum-matches"])
    expect(collectElements(tree, "th")).toHaveLength(9)
    expect(collectElements(tree, "th").every(node => node.props.scope === "col")).toBe(true)
  })
})
