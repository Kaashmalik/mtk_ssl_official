import React, { Suspense } from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { getDashboardContext } from "@/lib/dashboard-context"
import { hasPermission } from "@/lib/rbac"
import { DashboardHeader, DashboardQuickActions, DashboardUnavailable, DashboardLoading, DashboardPanel } from "@/components/dashboard/dashboard-view"
import { DashboardOverview, DashboardMatches, DashboardTasks } from "@/components/dashboard/dashboard-sections"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  noStore()
  const { userId } = await auth()
  if (!userId) redirect("/")
  const access = await getDashboardContext(userId)
  if (access.status === "no-tenant") redirect("/dashboard/league/setup")
  if (access.status === "unavailable") return <DashboardUnavailable title="Workspace unavailable" />
  if (access.status !== "ready") return <DashboardPanel title="Workspace access required">
    <p className="text-sm text-muted-foreground">This workspace is unavailable for your account. Use a league you belong to or ask its organizer for access.</p>
  </DashboardPanel>
  const { context } = access
  const organizer = hasPermission(context.role, "match:update") && hasPermission(context.role, "registration:manage")
  return <div className="space-y-6">
    <DashboardHeader context={context} />
    <Suspense fallback={<DashboardLoading title="League overview" />}><DashboardOverview context={context} /></Suspense>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        {context.role === "scorer" && <Suspense fallback={<DashboardLoading title="Your scoring assignments" />}>
          <DashboardMatches context={context} group="assigned" />
        </Suspense>}
        <Suspense fallback={<DashboardLoading title="Match day" />}><DashboardMatches context={context} group="live" /></Suspense>
        <Suspense fallback={<DashboardLoading title="Recent results" />}><DashboardMatches context={context} group="recent" /></Suspense>
      </div>
      <div className="min-w-0 space-y-6">
        <DashboardQuickActions context={context} />
        {organizer && <Suspense fallback={<DashboardLoading title="Needs attention" />}><DashboardTasks context={context} /></Suspense>}
        <Suspense fallback={<DashboardLoading title="Upcoming fixtures" />}><DashboardMatches context={context} group="upcoming" /></Suspense>
      </div>
    </div>
  </div>
}
