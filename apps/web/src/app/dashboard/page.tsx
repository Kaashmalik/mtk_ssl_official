import React, { Suspense } from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { unstable_noStore as noStore } from "next/cache"
import { getDashboardContext } from "@/lib/dashboard-context"
import { getOwnershipTransfer } from "@/app/actions/ownership"
import { hasPermission } from "@/lib/rbac"
import { DashboardHeader, DashboardQuickActions, DashboardUnavailable, DashboardLoading, DashboardPanel } from "@/components/dashboard/dashboard-view"
import { DashboardOverview, DashboardAssignments, DashboardMatches, DashboardTasks } from "@/components/dashboard/dashboard-sections"
import { OwnershipTransferRequest } from "@/components/dashboard/ownership-transfer-request"

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
  // Only the named recipient ever sees this; anyone else gets null. A transient
  // lookup failure must not take down the dashboard.
  const transfer = await getOwnershipTransfer(context.tenantId).catch(() => null)
  return <div className="space-y-6">
    <DashboardHeader context={context} />
    <Link href="/dashboard/account" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
      Your account — public career visibility
    </Link>
    {transfer?.viewer === "recipient" && <OwnershipTransferRequest tenantId={context.tenantId} transferId={transfer.id}
      expectedVersion={transfer.version} expiresAt={transfer.expiresAt}
      ownerLabel={transfer.fromDisplayName || transfer.fromEmail} />}
    <Suspense fallback={<DashboardLoading title="League overview" />}><DashboardOverview context={context} /></Suspense>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <Suspense fallback={<DashboardLoading title="Your assignments" />}>
          <DashboardAssignments context={context} />
        </Suspense>
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
