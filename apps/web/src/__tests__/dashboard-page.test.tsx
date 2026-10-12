import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DashboardPage from "@/app/dashboard/page"
import { DashboardOverview, DashboardMatches, DashboardTasks } from "@/components/dashboard/dashboard-sections"
import { DashboardSetup } from "@/components/dashboard/dashboard-view"
import type { DashboardContext } from "@/lib/dashboard-context"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), stats: vi.fn(), matches: vi.fn(), attention: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock("@/lib/dashboard-context", () => ({ getDashboardContext: mocks.context }))
vi.mock("@/lib/dashboard-data", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/dashboard-data")>(),
  getDashboardStats: mocks.stats, getDashboardMatches: mocks.matches, getDashboardAttention: mocks.attention,
}))
const context: DashboardContext = { tenantId: "tenant", tenantName: "League", actorId: "actor", role: "league_owner" }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk-session" })
  mocks.context.mockResolvedValue({ status: "ready", context })
  mocks.stats.mockResolvedValue({ teams: 0, players: 0, tournaments: 0, matches: 0 })
  mocks.matches.mockResolvedValue([])
  mocks.attention.mockResolvedValue({ unassigned: 0, pending: 0 })
})
function elements(node: any): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement(node)) return []
  return [node as React.ReactElement<any>, ...elements((node.props as any).children)]
}
const render = (element: React.ReactElement) => renderToStaticMarkup(element)

describe("Dashboard route gating and section integration", () => {
  it("redirects anonymous sessions before tenant or business reads", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(DashboardPage()).rejects.toThrow("redirect:/")
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.stats).not.toHaveBeenCalled()
  })
  it("redirects a genuinely missing tenant to setup", async () => {
    mocks.context.mockResolvedValue({ status: "no-tenant" })
    await expect(DashboardPage()).rejects.toThrow("redirect:/dashboard/league/setup")
  })
  it.each(["denied", "unavailable"])("does not request business widgets for %s access", async (status) => {
    mocks.context.mockResolvedValue({ status })
    const html = render(await DashboardPage())
    expect(html).toContain(status === "denied" ? "Workspace access required" : "Workspace unavailable")
    expect(mocks.stats).not.toHaveBeenCalled()
    expect(mocks.matches).not.toHaveBeenCalled()
    expect(mocks.attention).not.toHaveBeenCalled()
    expect(html).not.toContain("Create tournament")
  })
  it("passes only the server-authorized context to all streamed sections", async () => {
    const tree = elements(await DashboardPage())
    const sections = tree.filter((e) => [DashboardOverview, DashboardMatches, DashboardTasks].includes(e.type as any))
    expect(sections).toHaveLength(5)
    expect(sections.every((e) => e.props.context === context)).toBe(true)
    expect(mocks.context).toHaveBeenCalledWith("clerk-session")
    expect(tree.filter((e) => e.type === React.Suspense)).toHaveLength(5)
  })
  it.each(["scorer", "fan", "coach", "player", "team_manager"] as const)("does not mount organizer tasks for %s", async (role) => {
    mocks.context.mockResolvedValue({ status: "ready", context: { ...context, role } })
    const tree = elements(await DashboardPage())
    expect(tree.some((e) => e.type === DashboardTasks)).toBe(false)
    expect(tree.filter((e) => e.type === DashboardMatches && e.props.group === "assigned")).toHaveLength(role === "scorer" ? 1 : 0)
  })
  it.each(["scorer", "fan", "team_manager", "coach", "player"] as const)("does not show setup creation links to %s", async (role) => {
    const tree = elements(await DashboardOverview({ context: { ...context, role } }))
    expect(tree.some((e) => e.type === DashboardSetup)).toBe(false)
  })
  it("shows setup and legitimate zero metrics to organizers", async () => {
    const html = render(await DashboardOverview({ context }))
    expect(html).toContain("0 of 4 first steps complete")
    expect(html).toContain("Active teams")
  })
  it("shows an unavailable overview, not setup or fake zero counts, when aggregates fail", async () => {
    mocks.stats.mockRejectedValue(new Error("query failed"))
    const html = render(await DashboardOverview({ context }))
    expect(html).toContain("temporarily unavailable")
    expect(html).not.toContain("0 of 4")
    expect(html).not.toContain("Active teams")
  })
  it.each(["live", "assigned", "upcoming", "recent"] as const)("distinguishes a successful empty %s list from a failed query", async (group) => {
    const emptyHtml = render(await DashboardMatches({ context, group }))
    expect(emptyHtml).not.toContain("temporarily unavailable")
    mocks.matches.mockRejectedValue(new Error("query failed"))
    const unavailableHtml = render(await DashboardMatches({ context, group }))
    expect(unavailableHtml).toContain("temporarily unavailable")
    expect(unavailableHtml).not.toContain("No completed matches yet")
  })
  it("does not show a no-tasks claim after an attention query failure", async () => {
    mocks.attention.mockRejectedValue(new Error("query failed"))
    const html = render((await DashboardTasks({ context }))!)
    expect(html).toContain("temporarily unavailable")
    expect(html).not.toContain("No scorer-assignment")
  })
})
