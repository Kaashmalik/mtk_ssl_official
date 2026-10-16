import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { getMemberDirectory } from "@/app/actions/users"
import { getOwnershipTransfer } from "@/app/actions/ownership"
import { UserListTable } from "@/components/users/user-list-table"
import { InviteManager } from "@/components/users/invite-manager"
import { OwnershipTransferPanel } from "@/components/settings/ownership-transfer-panel"
import { getDashboardContext } from "@/lib/dashboard-context"
import { readMemberAssignments } from "@/lib/member-assignments"
import { unstable_noStore as noStore } from "next/cache"
import { memberDirectoryFilters, parseMemberDirectorySearch, type MemberDirectorySearch } from "@/lib/member-directory-filters"
import { MemberDirectoryControls, MemberDirectoryNavigation } from "@/components/users/member-directory-controls"

export default async function UserManagementPage({ searchParams }: { searchParams?: Promise<MemberDirectorySearch> }) {
  noStore()

  const { userId: clerkId } = await auth()
  if (!clerkId) redirect("/")

  const access = await getDashboardContext(clerkId)
  if (access.status === "unavailable") throw new Error("League member access is unavailable. Please try again.")
  if (access.status !== "ready" || access.context.role !== "league_owner") redirect("/dashboard")
  const { actorId: currentUserId, tenantId, tenantName } = access.context
  const parsed = parseMemberDirectorySearch(await searchParams ?? {})
  if (!parsed.success) return <div className="space-y-6">
    <h1 className="text-3xl font-bold">Members &amp; access — {tenantName}</h1>
    <MemberDirectoryControls filters={memberDirectoryFilters.parse({})} invalid />
  </div>
  const directory = await getMemberDirectory({ tenantId, ...parsed.data })
  const initialUsers = directory.members
  const assignments = await readMemberAssignments(tenantId, initialUsers.map((member) => member.id))
  const transfer = await getOwnershipTransfer(tenantId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <MotionWrapper variant="fadeInLeft">
        <h1 className="text-3xl font-bold tracking-tight">Members &amp; access</h1>
        <p className="text-muted-foreground mt-1">
          Manage membership in {tenantName} only. Changes never alter another league or the global account.
        </p>
      </MotionWrapper>

      <MemberDirectoryControls key={JSON.stringify(parsed.data)} filters={parsed.data} />

      {/* Invitations are shown only to the authorized league owner. */}
      <MotionWrapper variant="fadeInUp" delay={0.05}>
        <InviteManager key={`${tenantId}/${currentUserId}`} tenantId={tenantId} />
      </MotionWrapper>

      {/* Two-party ownership handover; the offer stays inert until the recipient accepts. */}
      <MotionWrapper variant="fadeInUp" delay={0.08}>
        <p className="text-sm text-muted-foreground mb-2">Ownership recipient choices use the current member results. Search for a member or open another results page to select them.</p>
        <OwnershipTransferPanel key={`${tenantId}/ownership`} tenantId={tenantId} currentUserId={currentUserId}
          members={initialUsers} initialTransfer={transfer} />
      </MotionWrapper>

      {/* Table Section */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <UserListTable key={`${tenantId}/${JSON.stringify(parsed.data)}`} initialUsers={initialUsers} assignments={assignments} directoryMode currentUserId={currentUserId} tenantId={tenantId} tenantName={tenantName} />
      </MotionWrapper>
      <MemberDirectoryNavigation filters={parsed.data} nextCursor={directory.nextCursor} />
    </div>
  )
}
