import React, { Suspense } from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { unstable_noStore as noStore } from "next/cache"
import { getDashboardContext } from "@/lib/dashboard-context"
import { resolveNoTenantLanding } from "@/lib/onboarding-destination"
import { getMyLeagueApplication } from "@/app/actions/league-applications"
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
  if (access.status === "no-tenant") {
    // ENH-02-01: the landing follows the account's own facts — a returning
    // applicant goes to their application status; everyone else gets the
    // fan-versus-organizer hub. No branch grants membership or rights, and
    // there are no redirects into each other, so no loop is possible.
    const landing = resolveNoTenantLanding({
      applicationState: (await getMyLeagueApplication().catch(() => null))?.application?.state ?? null,
    })
    if (landing.kind === "application-status") redirect(landing.path)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Welcome to the platform</h1>
        <p className="text-sm text-muted-foreground">
          Your account is active. Pick what brought you here — none of these options changes your roles or access.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/" className="rounded-xl border p-4 hover:bg-muted/40">
            <p className="font-semibold">Follow cricket</p>
            <p className="mt-1 text-sm text-muted-foreground">Browse publicly eligible matches, standings, and leagues as a fan.</p>
          </Link>
          <Link href="/dashboard/league/setup" className="rounded-xl border p-4 hover:bg-muted/40">
            <p className="font-semibold">Create your league</p>
            <p className="mt-1 text-sm text-muted-foreground">Instant self-serve onboarding for a new league workspace.</p>
          </Link>
          <Link href="/dashboard/league/apply" className="rounded-xl border p-4 hover:bg-muted/40">
            <p className="font-semibold">Apply for reviewed onboarding</p>
            <p className="mt-1 text-sm text-muted-foreground">For larger organizations that need a manual review.</p>
          </Link>
          {landing.withPreviousApplication && (
            <Link href="/dashboard/league/apply" className="rounded-xl border p-4 hover:bg-muted/40">
              <p className="font-semibold">Read your previous application</p>
              <p className="mt-1 text-sm text-muted-foreground">The decision and reviewer note stay visible to you.</p>
            </Link>
          )}
        </div>
      </div>
    )
  }
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
