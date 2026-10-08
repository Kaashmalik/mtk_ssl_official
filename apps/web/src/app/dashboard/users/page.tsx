import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { getUsers } from "@/app/actions/users"
import { UserListTable } from "@/components/users/user-list-table"
import { InviteManager } from "@/components/users/invite-manager"
import { hasPermission } from "@/lib/rbac"
import { db, users } from "@mtk/database"
import { eq } from "drizzle-orm"
import { unstable_noStore as noStore } from "next/cache"

export default async function UserManagementPage() {
  noStore()

  const { userId: clerkId } = await auth()
  if (!clerkId) redirect("/")

  const [currentUser] = await db.select({ id: users.id }).from(users).where(eq(users.clerkId, clerkId)).limit(1)
  const currentUserId = currentUser?.id ?? null

  const initialUsers = await getUsers()
  const [me] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  const canInvite = hasPermission(me?.role ?? "fan", "user:invite")

  return (
    <div className="space-y-6">
      {/* Header */}
      <MotionWrapper variant="fadeInLeft">
        <h1 className="text-3xl font-bold tracking-tight">Users Management</h1>
        <p className="text-muted-foreground mt-1">
          Manage roles and active status of all users within your league.
        </p>
      </MotionWrapper>

      {/* Invite Section — only for roles that may invite (league owner / super admin) */}
      {canInvite && (
        <MotionWrapper variant="fadeInUp" delay={0.05}>
          <InviteManager />
        </MotionWrapper>
      )}

      {/* Table Section */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <UserListTable initialUsers={initialUsers} currentUserId={currentUserId} />
      </MotionWrapper>
    </div>
  )
}
