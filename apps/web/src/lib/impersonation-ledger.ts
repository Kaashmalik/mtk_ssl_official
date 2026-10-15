import { db, impersonationSessions, users } from "@mtk/database"
import { and, eq, inArray } from "drizzle-orm"

/**
 * Impersonation ledger operations. The single-use guarantee lives here: a
 * session is claimed in ONE statement whose WHERE clause carries the
 * `status = "issued"` predicate, so a concurrent redemption cannot double-use
 * a token (the previous read-then-write flow allowed that race). Revocation
 * likewise only transitions live sessions.
 */

export type ImpersonationLedgerSession = typeof impersonationSessions.$inferSelect

/**
 * Atomically claim an issued session for consumption. Returns the ledger row
 * when this call won the claim, or null when the token was already used,
 * revoked, or is being claimed concurrently.
 */
export async function claimIssuedImpersonationSession(jti: string): Promise<ImpersonationLedgerSession | null> {
  const [claimed] = await db.update(impersonationSessions)
    .set({ status: "active", consumedAt: new Date() })
    .where(and(eq(impersonationSessions.jti, jti), eq(impersonationSessions.status, "issued")))
    .returning()
  return claimed ?? null
}

/** The impersonation target's display identity, if the account still exists. */
export async function findImpersonationTarget(userId: string) {
  const [user] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return user ?? null
}

/**
 * Revoke a live session (`issued` or `active`). False when the session is
 * already resolved; the ledger never re-stamps an existing revocation time.
 */
export async function revokeImpersonationSession(jti: string): Promise<boolean> {
  const [revoked] = await db.update(impersonationSessions)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(
      eq(impersonationSessions.jti, jti),
      inArray(impersonationSessions.status, ["issued", "active"]),
    ))
    .returning({ id: impersonationSessions.id })
  return revoked !== undefined
}
