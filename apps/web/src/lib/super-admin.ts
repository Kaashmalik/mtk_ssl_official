import { auth, clerkClient, currentUser } from "@clerk/nextjs/server"
import { hasRecentSecondFactor } from "@mtk/database/lib/privileged-session-policy"
import { db, users } from "@mtk/database"
import { eq } from "drizzle-orm"

/**
 * Second-factor gate for platform administration.
 *
 * Rigorous default: an account ENROLLED in a second factor must present a
 * fresh second-factor verification inside this very session. Accounts that
 * have never enrolled may administer on the single verified first factor -
 * the Clerk free plan offers no second factor at all, so demanding one would
 * make platform administration impossible. The moment the account enrols
 * (plan upgrade), the strict fresh-second-factor rule resumes automatically.
 * Fails closed when enrollment state cannot be determined.
 */
async function secondFactorPolicySatisfied(clerkId: string, sessionClaims: unknown): Promise<boolean> {
  if (hasRecentSecondFactor(sessionClaims)) return true
  try {
    const client = await clerkClient()
    const clerkUser = await client.users.getUser(clerkId)
    return clerkUser.twoFactorEnabled !== true
  } catch (error) {
    console.error("isSuperAdmin second-factor enrollment check error:", error)
    return false
  }
}

export async function isSuperAdmin(): Promise<boolean> {
  const user = await currentUser()
  if (!user) return false
  const session = await auth()
  if (session.userId !== user.id || !(await secondFactorPolicySatisfied(user.id, session.sessionClaims))) return false

  const email = user.emailAddresses?.[0]?.emailAddress
  
  try {
    const [dbUser] = await db
      .select({ role: users.role, isActive: users.isActive })
      .from(users)
      .where(eq(users.clerkId, user.id))
      .limit(1)

    if (dbUser) return dbUser.isActive === true && dbUser.role === "super_admin"
  } catch (error) {
    console.error("isSuperAdmin DB check error:", error)
    return false
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
