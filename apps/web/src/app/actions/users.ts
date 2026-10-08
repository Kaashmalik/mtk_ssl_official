"use server"

import { revalidatePath } from "next/cache"
import { db, users } from "@mtk/database"
import { eq, and, sql } from "drizzle-orm"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"
import { UserRole } from "@/lib/rbac"

async function requireTenant() {
  const tenant = await getMyTenant()
  if (!tenant) throw new Error("Tenant not found")
  return tenant
}

export const getUsers = withAuth("user:read", async () => {
  const tenant = await requireTenant()
  return db.select().from(users)
    .where(sql`${users.tenantIds} @> ARRAY[${tenant.id}::uuid]`)
    .orderBy(users.createdAt)
})

export const updateUserRole = withAuth("user:manage", async (userId: string, newRole: UserRole) => {
  const tenant = await requireTenant()
  
  // Make sure target user belongs to this tenant
  const [targetUser] = await db.select().from(users)
    .where(and(eq(users.id, userId), sql`${users.tenantIds} @> ARRAY[${tenant.id}::uuid]`))
    .limit(1)
  
  if (!targetUser) throw new Error("User not found in this tenant")
  if (targetUser.role === "super_admin") throw new Error("Cannot modify a super admin")

  const [updatedUser] = await db.update(users)
    .set({ role: newRole, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()

  revalidatePath("/dashboard/users")
  return { success: true, user: updatedUser }
})

export const toggleUserStatus = withAuth("user:manage", async (userId: string, isActive: boolean) => {
  const tenant = await requireTenant()

  const [targetUser] = await db.select().from(users)
    .where(and(eq(users.id, userId), sql`${users.tenantIds} @> ARRAY[${tenant.id}::uuid]`))
    .limit(1)

  if (!targetUser) throw new Error("User not found in this tenant")
  if (targetUser.role === "super_admin") throw new Error("Cannot modify a super admin")

  const [updatedUser] = await db.update(users)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()

  revalidatePath("/dashboard/users")
  return { success: true, user: updatedUser }
})
