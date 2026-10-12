import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { DashboardHeader, DashboardQuickActions, DashboardMetrics, DashboardSetup,
  DashboardMatchList, DashboardAttention, DashboardUnavailable, DashboardLoading } from "@/components/dashboard/dashboard-view"
import type { DashboardContext } from "@/lib/dashboard-context"
import type { DashboardMatch } from "@/lib/dashboard-model"

vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
const context: DashboardContext = { tenantId: "tenant", actorId: "actor", tenantName: "The League", role: "league_owner" }
const stats = { teams: 2, players: 14, tournaments: 1, matches: 6 }
const match: DashboardMatch = { id: "match", teamA: "A", teamB: "B", scoreA: "1/0 (0.1)", scoreB: "Yet to bat",
  status: "live", scorerId: "actor", scheduledDate: null, updatedAt: new Date(), result: null }
const render = (element: React.ReactElement) => renderToStaticMarkup(element)

describe("Dashboard server-rendered UI", () => {
  it("identifies the tenant and current role, escaping untrusted tenant names", () => {
    const html = render(<DashboardHeader context={{ ...context, tenantName: "<script>unsafe</script>" }} />)
    expect(html).toContain("League Owner")
    expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;")
    expect(html).not.toContain("<script>")
    expect(html).toContain('href="/dashboard/tournaments/new"')
  })
  it.each(["scorer", "coach", "team_manager", "player", "fan"] as const)("does not show creation CTAs to %s", (role) => {
    const html = render(<><DashboardHeader context={{ ...context, role }} /><DashboardQuickActions context={{ ...context, role }} /></>)
    expect(html).not.toContain('href="/dashboard/tournaments/new"')
    expect(html).not.toContain("/players/new")
    expect(html).not.toContain("/matches/new")
    expect(html).toContain("Browse matches")
  })
  it("renders honest metrics without invented growth percentages", () => {
    const html = render(<DashboardMetrics stats={stats} />)
    expect(html).toContain("Active players")
    expect(html).toContain(">14<")
    expect(html).not.toContain("new this month")
    expect(html).not.toContain("%")
    expect(html).toContain("grid-cols-2")
  })
  it("shows setup status and links only incomplete steps", () => {
    const html = render(<DashboardSetup stats={{ teams: 1, players: 0, tournaments: 1, matches: 0 }} />)
    expect(html).toContain("1 of 4 first steps complete")
    expect(html).not.toContain('href="/dashboard/tournaments/new"')
    expect(html).toContain('href="/dashboard/teams/new"')
    expect(html).toContain("not match readiness")
  })
  it("does not represent fully completed first steps as full operational readiness", () => {
    const html = render(<DashboardSetup stats={stats} />)
    expect(html).toContain("first steps are complete")
    expect(html).not.toContain("href=")
    expect(html).toContain("playing-XI approval")
  })
  it("provides a clear empty assignment state without a creation shortcut", () => {
    const html = render(<DashboardMatchList title="Your scoring assignments" matches={[]} context={{ ...context, role: "scorer" }} empty="Ask the organizer to assign a match." />)
    expect(html).toContain("Ask the organizer")
    expect(html).not.toContain("Open scoring")
  })
  it("opens only assigned scorer matches in scoring and labels page-load freshness", () => {
    const html = render(<DashboardMatchList title="Match day" matches={[match, { ...match, id: "other", scorerId: null }]} context={{ ...context, role: "scorer" }} empty="Empty" />)
    expect(html).toContain('href="/matches/match/scoring"')
    expect(html).toContain('href="/matches/other"')
    expect(html).toContain("View match")
    expect(html).toContain("Scores as of this page load")
    expect(html).toContain("Time to be confirmed")
  })
  it("renders match results as escaped text", () => {
    const html = render(<DashboardMatchList title="Results" matches={[{ ...match, status: "completed", result: "<img onerror=evil>",
      updatedAt: new Date("2026-10-12T09:30:00Z") }]} context={context} empty="Empty" />)
    expect(html).toContain("&lt;img onerror=evil&gt;")
    expect(html).toContain('href="/matches/match"')
    expect(html).toContain("Updated 12 Oct 2026, 09:30 UTC")
    expect(html).not.toContain("Scheduled:")
  })
  it("renders task counts including confirmed zeros rather than hiding them", () => {
    const html = render(<DashboardAttention attention={{ unassigned: 0, pending: 0 }} />)
    expect(html).toContain("No scorer-assignment or registration tasks")
    expect(html).toContain('href="/dashboard/registrations"')
    expect(html).toContain(">0<")
  })
  it("shows a retryable outage, not fake zeros or an empty league", () => {
    const html = render(<DashboardUnavailable title="League overview" />)
    expect(html).toContain('role="status"')
    expect(html).toContain("temporarily unavailable")
    expect(html).toContain("Refresh dashboard")
    expect(html).not.toContain("No completed matches")
  })
  it("provides accessible loading text and reduced-motion-aware skeletons", () => {
    const html = render(<DashboardLoading title="League overview" />)
    expect(html).toContain('aria-label="Loading league overview"')
    expect(html).toContain("motion-safe:animate-pulse")
  })
  it("keeps touch target sizing and visible keyboard focus on action links", () => {
    const html = render(<DashboardQuickActions context={context} />)
    expect(html).toContain("min-h-11")
    expect(html).toContain("focus-visible:ring-2")
  })
})
