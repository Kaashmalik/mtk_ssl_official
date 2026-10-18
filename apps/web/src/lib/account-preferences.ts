import { randomUUID } from "node:crypto"
import { auth } from "@clerk/nextjs/server"
import { auditLogs, db, users } from "@mtk/database"
import { eq, sql } from "drizzle-orm"
import { isUsableDisplayTimeZone } from "./time-policy"

/**
 * UX-03: per-user display timezone preference. Personal-account surface,
 * deliberately OUTSIDE the league RBAC matrix (mirrors PUB-03 consent): the
 * timezone belongs to the person, not to any league role - the only gates
 * are the Clerk session and the account's own activity.
 *
 * Honesty rule: null (unset) is the default; every formatter falls back to
 * an explicit UTC label, never the server's zone. Unknown zone strings are
 * rejected at the write boundary (fail-closed, before any db work).
 */

export type DisplayTimeZoneState = { timeZone: string | null }

const PROJECTION = { timeZone: users.timeZone }

/** Reads the caller's current preference; null = unset (UTC-labelled). */
export async function readMyDisplayTimeZone(): Promise<DisplayTimeZoneState> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const [account] = await db
    .select(PROJECTION)
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!account) throw new Error("Account unavailable")
  return { timeZone: account.timeZone ?? null }
}

/**
 * Sets (or clears, with null) the display timezone. Locked-transactional:
 * the account row is row-locked against an actor-context change, and the
 * before/after is audited. Returns the resulting state.
 */
export async function setMyDisplayTimeZone(input: { timeZone: string | null }): Promise<DisplayTimeZoneState> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const { timeZone } = input
  if (timeZone !== null && !isUsableDisplayTimeZone(timeZone)) {
    throw new Error("Unknown time zone")
  }

  const [account] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!account || account.isActive !== true) throw new Error("Account unavailable")

  return db.transaction(async (tx) => {
    // Member-like writers lock the account row: an actor-context change
    // (deactivation) serializes against this preference write.
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${account.id} FOR UPDATE`)
    const [current] = await tx
      .select(PROJECTION)
      .from(users)
      .where(eq(users.id, account.id))
      .limit(1)
    if (!current) throw new Error("Account unavailable")
    const [updated] = await tx
      .update(users)
      .set({ timeZone, updatedAt: new Date() })
      .where(eq(users.id, account.id))
      .returning({ timeZone: users.timeZone })
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: null,
      actorId: account.id,
      actorRole: null,
      method: "DISPLAY_TIMEZONE",
      path: "/dashboard/account",
      statusCode: "200",
      payload: {
        timeZone,
        before: { timeZone: current.timeZone ?? null },
        after: { timeZone: updated.timeZone ?? null },
      },
    })
    return { timeZone: updated.timeZone ?? null }
  })
}
