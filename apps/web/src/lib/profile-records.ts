import { randomUUID } from "crypto"
import { auditLogs, db, users } from "@mtk/database"
import { eq } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { auth } from "@clerk/nextjs/server"
import { normalizeDisplayName, type DisplayNameDecision } from "@mtk/database/lib/profile-policy"

/**
 * REG-05 (Batch 142): the self-profile display-name journey. The display
 * name is a PERSONAL surface (PUB-03 discipline: outside the league RBAC
 * matrix) - the only gates are the Clerk session and the account's own
 * activity. Same writer shape as the timezone preference: the account row
 * locks against actor-context changes, an identical value is a pure read,
 * and before/after is audited at user level.
 */

export async function readMyDisplayName(): Promise<string | null> {
  const { userId: clerkId } = await auth()
  if (!clerkId) return null
  const [account] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  // A deactivated account shows no name here - the self-READ never refuses.
  if (!account || account.isActive !== true) return null
  const [row] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, account.id))
    .limit(1)
  return row?.displayName ?? null
}

export interface DisplayNameState {
  userId: string
  displayName: string | null
}

export async function setMyDisplayName(input: { displayName: string }): Promise<DisplayNameState & { changed: boolean }> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const decision: DisplayNameDecision = normalizeDisplayName(input.displayName)
  if (!decision.ok) throw new Error(decision.reason)

  const [account] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!account || account.isActive !== true) throw new Error("Account unavailable")

  return db.transaction(async (tx) => {
    // Member-like writers lock the account row: an actor-context change
    // (deactivation) serializes against this profile write.
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${account.id} FOR UPDATE`)
    const [current] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, account.id))
      .limit(1)
    if (!current) throw new Error("Account unavailable")
    if (current.displayName === decision.value) {
      // Identical replay: a pure read - no fake update, no second audit row.
      return { userId: account.id, displayName: decision.value, changed: false }
    }
    const [updated] = await tx
      .update(users)
      .set({ displayName: decision.value, updatedAt: new Date() })
      .where(eq(users.id, account.id))
      .returning({ displayName: users.displayName })
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: null,
      actorId: account.id,
      actorRole: null,
      method: "DISPLAY_NAME",
      path: "/dashboard/account",
      statusCode: "200",
      payload: {
        before: { displayName: current.displayName ?? null },
        after: { displayName: updated.displayName ?? null },
      },
    })
    return { userId: account.id, displayName: updated.displayName ?? null, changed: true }
  }, { isolationLevel: "read committed" })
}
