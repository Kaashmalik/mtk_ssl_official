import { auth } from "@clerk/nextjs/server"
import { hasRecentSecondFactor } from "@mtk/database/lib/privileged-session-policy"

/** No feature flag or development bypass for privileged write protection. */
export async function requirePrivilegedSession(expectedAccountId?: string): Promise<void> {
  const { userId, sessionClaims } = await auth()
  if (!userId || (expectedAccountId && userId !== expectedAccountId)) throw new Error("Unauthorized")
  if (!hasRecentSecondFactor(sessionClaims)) {
    throw new Error("Recent multi-factor verification required. Open Account security, enable a second factor if needed, then sign in again with both factors before retrying. No change was saved.")
  }
}
