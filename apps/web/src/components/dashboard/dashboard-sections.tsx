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
  assigned: { title: "Your scoring assignments", empty: "No open matches are assigned to you. Ask your league organizer to assign a scorer." },
}
export async function DashboardMatches({ context, group }: { context: DashboardContext; group: DashboardMatchGroup }) {
  const result = await loadDashboardSection(() => getDashboardMatches(context, group))
  if (result.status === "unavailable") return <DashboardUnavailable title={groups[group].title} />
  return <DashboardMatchList {...groups[group]} matches={result.data} context={context} />
}

export async function DashboardTasks({ context }: { context: DashboardContext }) {
  const result = await loadDashboardSection(() => getDashboardAttention(context))
  if (result.status === "unavailable") return <DashboardUnavailable title="Needs attention" />
  return result.data ? <DashboardAttention attention={result.data} /> : null
}
