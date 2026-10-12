import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { getUsers } from "@/app/actions/users"
import { UserListTable } from "@/components/users/user-list-table"
import { InviteManager } from "@/components/users/invite-manager"
import { getDashboardContext } from "@/lib/dashboard-context"
import { unstable_noStore as noStore } from "next/cache"

export default async function UserManagementPage() {
  noStore()

  const { userId: clerkId } = await auth()
  if (!clerkId) redirect("/")

  const access = await getDashboardContext(clerkId)
  if (access.status !== "ready" || access.context.role !== "league_owner") redirect("/dashboard")
  const { actorId: currentUserId, tenantId, tenantName } = access.context
  const initialUsers = await getUsers(tenantId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <MotionWrapper variant="fadeInLeft">
        <h1 className="text-3xl font-bold tracking-tight">Members &amp; access</h1>
        <p className="text-muted-foreground mt-1">
          Manage membership in {tenantName} only. Changes never alter another league or the global account.
        </p>
      </MotionWrapper>

      {/* Invitations are shown only to the authorized league owner. */}
      <MotionWrapper variant="fadeInUp" delay={0.05}>
        <InviteManager key={tenantId} />
      </MotionWrapper>

      {/* Table Section */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <UserListTable key={tenantId} initialUsers={initialUsers} currentUserId={currentUserId} tenantId={tenantId} tenantName={tenantName} />
      </MotionWrapper>
    </div>
  )
}
