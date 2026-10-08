import { currentUser } from "@clerk/nextjs/server"
import { db, users } from "@mtk/database"
import { eq } from "drizzle-orm"

export async function isSuperAdmin(): Promise<boolean> {
  const user = await currentUser()
  if (!user) return false

  const email = user.emailAddresses?.[0]?.emailAddress
  
  try {
    const [dbUser] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.clerkId, user.id))
      .limit(1)

    if (dbUser?.role === "super_admin") {
      return true
    }
  } catch (error) {
    console.error("isSuperAdmin DB check error:", error)
  }

  if (email && process.env.NODE_ENV !== "production") {
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL
    if (superAdminEmail && email.toLowerCase() === superAdminEmail.toLowerCase()) {
      console.warn(`[super-admin] [DEV ONLY] Fallback admin check hit for email ${email}`)
      return true
    }
  }

  return false
}
