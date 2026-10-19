import React from "react"
import Link from "next/link"
import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { z } from "zod"
import { getDashboardContext } from "@/lib/dashboard-context"
import { getMemberDetails } from "@/app/actions/users"
import { readMemberAssignments } from "@/lib/member-assignments"
import { membershipExpiryDisplay } from "@/lib/membership-display"
import { UserListTable } from "@/components/users/user-list-table"
import { MemberExpiryForm } from "@/components/users/member-expiry-form"

export default async function MemberDetailsPage({ params }: { params: Promise<{ membershipId: string }> }) {
  noStore()
  const { userId } = await auth()
  if (!userId) redirect("/")
  const access = await getDashboardContext(userId)
  if (access.status === "unavailable") throw new Error("League member access is unavailable. Please try again.")
  if (access.status !== "ready" || access.context.role !== "league_owner") redirect("/dashboard")
  const { membershipId } = await params
  if (!z.string().uuid().safeParse(membershipId).success) notFound()
  const { tenantId, tenantName, actorId } = access.context
  const member = await getMemberDetails({ tenantId, membershipId })
  if (!member) notFound()
  const assignments = await readMemberAssignments(tenantId, [member.id])
  const expiry = membershipExpiryDisplay(member.expiresAt ?? null)
  const provenance = member.delegatedByUserId
    ? `The expiry bound was granted or last extended by ${member.delegatedByName ?? "an owner whose account no longer resolves"}.`
    : member.expiresAt
      ? "This bound predates expiry provenance tracking, so no granting owner is recorded."
      : null
  return <div className="space-y-6">
    <Link href="/dashboard/settings/members" className="inline-flex min-h-11 items-center underline">Back to members</Link>
    <div><h1 className="text-3xl font-bold">Member access in {tenantName}</h1>
      <p className="text-muted-foreground">Review this league membership and its listed operational assignments. Other leagues and the global account are not changed here.</p>
    </div>
    <p className="rounded-md border px-4 py-3 text-sm" title={expiry.detail}>
      <span className="font-medium">Expiry bound: {expiry.short}.</span>{" "}
      {provenance && <span className="text-muted-foreground">{provenance}</span>}
      {" "}Expiry is independent of suspension: an expired membership is not reactivated by clearing the status.
    </p>
    {!member.protectedAccess && member.id !== actorId && !["league_owner", "super_admin"].includes(member.role) && (
      <MemberExpiryForm key={`${membershipId}/${member.version}`} tenantId={tenantId} membershipId={membershipId}
        version={member.version} expiresAt={member.expiresAt ? new Date(member.expiresAt).toISOString() : null} />
    )}
    <UserListTable key={`${tenantId}/${membershipId}`} initialUsers={[member]} assignments={assignments} directoryMode currentUserId={actorId} tenantId={tenantId} tenantName={tenantName} />
    <p className="text-sm text-muted-foreground">Listed assignments do not grant additional roles or prove identity verification.</p>
  </div>
}
