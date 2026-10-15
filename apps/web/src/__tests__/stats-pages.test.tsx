import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import StatisticsPage from "@/app/dashboard/stats/page"
import ComparePlayersPage from "@/app/dashboard/stats/compare/page"
import ScoringConsolePage from "@/app/dashboard/scoring/page"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), context: vi.fn(), batting: vi.fn(), bowling: vi.fn(),
  roster: vi.fn(), comparison: vi.fn(), console: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/league-reads", () => ({
  requireLeagueReadContext: mocks.context, readBattingLeaderboard: mocks.batting,
  readBowlingLeaderboard: mocks.bowling, readComparisonRoster: mocks.roster,
  readPlayerComparison: mocks.comparison, readScoringConsoleMatches: mocks.console,
}))
vi.mock("@/components/stats/player-comparison-radar", () => ({ PlayerComparisonRadar: () => null }))
vi.mock("@/components/stats/comparison-picker", () => ({ ComparisonPicker: () => null }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const context = { tenantId: TENANT, actorId: "actor", clerkId: "clerk", role: "league_owner" }
const leader = [{ playerId: "p1", playerName: "Player", teamName: "Team", total: "80" }]
const matchRow = {
  id: "m1", status: "live", scheduledDate: null, matchFormat: "t20", totalOvers: 20,
  teamAId: "t1", teamBId: "t2", teamAName: "Alpha", teamBName: "Beta",
}

function elements(node: any): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement(node)) return []
  return [node as React.ReactElement<any>, ...elements((node.props as any).children)]
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join(" ")
  if (React.isValidElement(node)) return text((node.props as any).children)
  return typeof node === "string" || typeof node === "number" ? String(node) : ""
}
function links(node: any) { return elements(node).map(element => element.props.href).filter(Boolean) }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.context.mockResolvedValue(context)
  mocks.batting.mockResolvedValue(leader)
  mocks.bowling.mockResolvedValue(leader)
  mocks.roster.mockResolvedValue([{ id: "p1", name: "A" }, { id: "p2", name: "B" }])
  mocks.comparison.mockResolvedValue(null)
  mocks.console.mockResolvedValue({ truncated: false, matches: [matchRow] })
})

describe("Stats dashboard pages require exact-league authority", () => {
  it("resolves stats:read before reading leaderboards and passes the resolved league", async () => {
    const tree = await StatisticsPage()
    expect(mocks.context).toHaveBeenCalledWith("stats:read")
    expect(mocks.batting).toHaveBeenCalledWith(TENANT, "runs")
    expect(mocks.batting).toHaveBeenCalledWith(TENANT, "sixes")
    expect(mocks.batting).toHaveBeenCalledWith(TENANT, "fours")
    expect(mocks.bowling).toHaveBeenCalledWith(TENANT)
    expect(text(tree)).toContain("League Statistics")
    expect(text(tree)).toContain("Most Runs")
    expect(links(tree)).toContain("/dashboard/stats/compare")
  })
  it.each(["Forbidden", "Tenant not found", "Database unavailable"])("propagates %s without a setup redirect or fake empty board", async (message) => {
    mocks.context.mockRejectedValue(new Error(message))
    await expect(StatisticsPage()).rejects.toThrow(message)
    expect(mocks.batting).not.toHaveBeenCalled()
    expect(mocks.bowling).not.toHaveBeenCalled()
  })
  it("propagates a leaderboard failure instead of rendering an empty state", async () => {
    mocks.batting.mockRejectedValue(new Error("Database unavailable"))
    await expect(StatisticsPage()).rejects.toThrow("Database unavailable")
  })
  it("redirects anonymous visits before resolving context", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(StatisticsPage()).rejects.toThrow("redirect:/")
    expect(mocks.context).not.toHaveBeenCalled()
  })
})

describe("Compare players page requires exact-league authority", () => {
  const params = { searchParams: Promise.resolve({}) }
  it("resolves stats:read and scopes roster/comparison to the league", async () => {
    const tree = await ComparePlayersPage(params)
    expect(mocks.context).toHaveBeenCalledWith("stats:read")
    expect(mocks.roster).toHaveBeenCalledWith(TENANT)
    expect(text(tree)).toContain("players in your league")
  })
  it("reads a requested player only through the league-scoped reader", async () => {
    await ComparePlayersPage({ searchParams: Promise.resolve({ a: "p1", b: "p2" }) })
    expect(mocks.comparison).toHaveBeenCalledWith(TENANT, "p1")
    expect(mocks.comparison).toHaveBeenCalledWith(TENANT, "p2")
  })
  it("propagates context and reader failures without a fallback", async () => {
    mocks.context.mockRejectedValue(new Error("Forbidden"))
    await expect(ComparePlayersPage(params)).rejects.toThrow("Forbidden")
    expect(mocks.roster).not.toHaveBeenCalled()
    mocks.context.mockResolvedValue(context)
    mocks.roster.mockRejectedValue(new Error("Database unavailable"))
    await expect(ComparePlayersPage(params)).rejects.toThrow("Database unavailable")
  })
  it("redirects anonymous visits before resolving context", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(ComparePlayersPage(params)).rejects.toThrow("redirect:/sign-in")
    expect(mocks.context).not.toHaveBeenCalled()
  })
})

describe("Scoring console page requires exact-league authority", () => {
  it("resolves match:read and reads league-scoped matches", async () => {
    const tree = await ScoringConsolePage()
    expect(mocks.context).toHaveBeenCalledWith("match:read")
    expect(mocks.console).toHaveBeenCalledWith(TENANT)
    expect(text(tree)).toContain("Scoring Console")
    expect(text(tree)).toContain("Alpha")
    expect(text(tree)).toContain("Beta")
  })
  it("explains a truncated console rather than silently dropping matches", async () => {
    mocks.console.mockResolvedValue({ truncated: true, matches: [matchRow] })
    expect(text(await ScoringConsolePage())).toContain("Showing the first")
  })
  it("propagates context and query failures without a setup redirect", async () => {
    mocks.context.mockRejectedValue(new Error("Forbidden"))
    await expect(ScoringConsolePage()).rejects.toThrow("Forbidden")
    expect(mocks.console).not.toHaveBeenCalled()
    mocks.context.mockResolvedValue(context)
    mocks.console.mockRejectedValue(new Error("Database unavailable"))
    await expect(ScoringConsolePage()).rejects.toThrow("Database unavailable")
  })
  it("redirects anonymous visits before resolving context", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(ScoringConsolePage()).rejects.toThrow("redirect:/")
    expect(mocks.context).not.toHaveBeenCalled()
  })
})
