import React from "react"
import type { DashboardContext } from "@/lib/dashboard-context"
import { getDashboardStats, getDashboardMatches, getDashboardAttention, loadDashboardSection,
  type DashboardMatchGroup } from "@/lib/dashboard-data"
import { hasPermission } from "@/lib/rbac"
import { DashboardMetrics, DashboardSetup, DashboardMatchList, DashboardAttention, DashboardUnavailable } from "./dashboard-view"

export async function DashboardOverview({ context }: { context: DashboardContext }) {
  const result = await loadDashboardSection(() => getDashboardStats(context))
  if (result.status === "unavailable") return <DashboardUnavailable title="League overview" />
  return <div className="space-y-6">
    <DashboardMetrics stats={result.data} />
    {hasPermission(context.role, "tournament:create") && <DashboardSetup stats={result.data} />}
  </div>
}

const groups = {
  live: { title: "Match day", empty: "No matches are at the toss, live, or innings break right now." },
  upcoming: { title: "Upcoming fixtures", empty: "No scheduled fixtures yet. They will appear here once created." },
  recent: { title: "Recent results", empty: "No completed matches yet. Results will appear after a match is finalized." },
  assigned: { title: "Your assignments", empty: "No open matches are assigned to you yet. Ask your league organizer to assign you as a scorer or umpire." },
}
export async function DashboardMatches({ context, group }: { context: DashboardContext; group: DashboardMatchGroup }) {
  const result = await loadDashboardSection(() => getDashboardMatches(context, group))
  if (result.status === "unavailable") return <DashboardUnavailable title={groups[group].title} />
  return <DashboardMatchList {...groups[group]} matches={result.data} context={context} />
}

/**
 * UX-03 officiating journey: every member sees their scoring AND umpiring
 * assignments (scorer, backup scorer, COMP-06 member umpire slots - an umpire
 * can hold any member role). Renders nothing when the genuinely-empty list
 * comes back, so members without assignments never see an empty shell.
 */
export async function DashboardAssignments({ context }: { context: DashboardContext }) {
  const result = await loadDashboardSection(() => getDashboardMatches(context, "assigned"))
  if (result.status === "unavailable") return <DashboardUnavailable title={groups.assigned.title} />
  // Scorers keep an explicit empty state (their journey hinges on being
  // assigned); other members see nothing rather than an empty shell.
  if (result.data.length === 0) {
    return context.role === "scorer"
      ? <DashboardMatchList {...groups.assigned} matches={result.data} context={context} />
      : null
  }
  return <DashboardMatchList {...groups.assigned} matches={result.data} context={context} />
}

export async function DashboardTasks({ context }: { context: DashboardContext }) {
  const result = await loadDashboardSection(() => getDashboardAttention(context))
  if (result.status === "unavailable") return <DashboardUnavailable title="Needs attention" />
  return result.data ? <DashboardAttention attention={result.data} /> : null
}
