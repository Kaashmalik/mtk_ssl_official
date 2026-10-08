import { auth } from "@clerk/nextjs/server";
import { db, users } from "@mtk/database";
import { eq } from "drizzle-orm";

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL;

/**
 * Verify the current request is from a super admin.
 * Uses Clerk v6 auth() and Drizzle to retrieve user roles.
 * Returns the userId string on success, null otherwise.
 */
export async function verifySuperAdmin(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;

  try {
    const [user] = await db
      .select({ email: users.email, role: users.role })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);

    if (!user) {
      return null;
    }

    const isRoleAdmin = user.role === "super_admin";
    const isDev = process.env.NODE_ENV !== "production";
    const isEmailAdmin =
      isDev &&
      SUPER_ADMIN_EMAIL &&
      user.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

    if (!isRoleAdmin) {
      if (isEmailAdmin) {
        console.warn(`[admin-auth] [DEV ONLY] Bootstrapping super_admin permissions for user email ${user.email} matching SUPER_ADMIN_EMAIL.`);
        return userId;
      }
      return null;
    }

    return userId;
  } catch (error) {
    console.error("verifySuperAdmin error:", error);
    return null;
  }
}

/**
 * Check if a given email is a super admin
 */
export async function isSuperAdmin(email: string): Promise<boolean> {
  try {
    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user?.role === "super_admin") {
      return true;
    }
  } catch {}

  const isDev = process.env.NODE_ENV !== "production"
  if (isDev && SUPER_ADMIN_EMAIL && email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    console.warn(`[admin-auth] [DEV ONLY] isSuperAdmin fallback hit for email ${email}`);
    return true;
  }

  return false;
}
