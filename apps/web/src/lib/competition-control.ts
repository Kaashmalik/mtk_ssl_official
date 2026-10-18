import { randomUUID } from "crypto"
import { auditLogs, db, matches, userTenantRoles, users } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { auth } from "@clerk/nextjs/server"
import { canForfeit, canPostpone, canReschedule } from "@mtk/database/lib/competition-control-policy"

/**
 * COMP-07 (Batch 153): competition control. Forfeit, postpone, reschedule
 * are league-OWNER decisions, audited, under lock. A match that has
 * already produced a result (completed/no_result/abandoned/cancelled)
 * cannot be rewritten into a forfeit or postponement - that would be a
 * silent result change; the audited scoring-correction path is the only
 * route for those. Rescheduling sets scheduledDate and (for a postponed
 * match) returns it to "scheduled".
 */

const accountOf = async (clerkId: string) => {
  const [account] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!account || account.isActive !== true) throw new Error("Forbidden: your account is unavailable")
  return account
}

const ownerOf = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  account: { id: string },
  tenantId: string,
) => {
  const [member] = await tx
    .select({ role: userTenantRoles.role, status: userTenantRoles.status, expiresAt: userTenantRoles.expiresAt })
    .from(userTenantRoles)
    .where(and(eq(userTenantRoles.userId, account.id), eq(userTenantRoles.tenantId, tenantId)))
    .limit(1)
  if (!member || member.status !== "active" || member.role !== "league_owner") {
    throw new Error("Forbidden: only the league owner may control competition fixtures")
  }
}

export async function forfeitMatch(matchId: string, reason: string): Promise<{ forfeited: true; changed: boolean }> {
  z.string().uuid().parse(matchId)
  const cleanReason = reason.trim().slice(0, 500)
  if (!cleanReason) throw new Error("A forfeit reason is required")
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  return db.transaction(async (tx) => {
    const [match] = await tx
      .select({ id: matches.id, tenantId: matches.tenantId, status: matches.status })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
    if (!match) throw new Error("Match not found")
    await ownerOf(tx, account, match.tenantId)
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${matches.id} = ${match.id} FOR UPDATE`)
    if (match.status === "forfeited") return { forfeited: true, changed: false }
    if (!canForfeit(match.status)) throw new Error("Only an open match can be forfeited")

    await tx
      .update(matches)
      .set({ status: "forfeited", forfeitReason: cleanReason, updatedAt: new Date() })
      .where(eq(matches.id, match.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: match.tenantId,
      actorId: account.id,
      actorRole: "league_owner",
      method: "MATCH_FORFEITED",
      path: "/dashboard/matches",
      statusCode: "200",
      payload: { resourceId: match.id, reason: cleanReason, from: match.status },
    })
    return { forfeited: true, changed: true }
  }, { isolationLevel: "read committed" })
}

export async function postponeMatch(matchId: string, reason: string): Promise<{ postponed: true; changed: boolean }> {
  z.string().uuid().parse(matchId)
  const cleanReason = reason.trim().slice(0, 500)
  if (!cleanReason) throw new Error("A postponement reason is required")
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  return db.transaction(async (tx) => {
    const [match] = await tx
      .select({ id: matches.id, tenantId: matches.tenantId, status: matches.status })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
    if (!match) throw new Error("Match not found")
    await ownerOf(tx, account, match.tenantId)
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${matches.id} = ${match.id} FOR UPDATE`)
    if (match.status === "postponed") return { postponed: true, changed: false }
    if (!canPostpone(match.status)) throw new Error("Only an open match can be postponed")

    await tx
      .update(matches)
      .set({ status: "postponed", postponementReason: cleanReason, updatedAt: new Date() })
      .where(eq(matches.id, match.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: match.tenantId,
      actorId: account.id,
      actorRole: "league_owner",
      method: "MATCH_POSTPONED",
      path: "/dashboard/matches",
      statusCode: "200",
      payload: { resourceId: match.id, reason: cleanReason, from: match.status },
    })
    return { postponed: true, changed: true }
  }, { isolationLevel: "read committed" })
}

export async function rescheduleMatch(matchId: string, newDate: string): Promise<{ rescheduled: true; changed: boolean }> {
  z.string().uuid().parse(matchId)
  const parsed = new Date(newDate)
  if (Number.isNaN(parsed.getTime())) throw new Error("A valid date is required")
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  return db.transaction(async (tx) => {
    const [match] = await tx
      .select({ id: matches.id, tenantId: matches.tenantId, status: matches.status })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
    if (!match) throw new Error("Match not found")
    await ownerOf(tx, account, match.tenantId)
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${matches.id} = ${match.id} FOR UPDATE`)
    if (!canReschedule(match.status)) throw new Error("Only a scheduled or postponed match can be rescheduled")

    await tx
      .update(matches)
      .set({ scheduledDate: parsed, status: match.status === "postponed" ? "scheduled" : match.status, postponementReason: null, updatedAt: new Date() })
      .where(eq(matches.id, match.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: match.tenantId,
      actorId: account.id,
      actorRole: "league_owner",
      method: "MATCH_RESCHEDULED",
      path: "/dashboard/matches",
      statusCode: "200",
      payload: { resourceId: match.id, newDate: parsed.toISOString(), from: match.status },
    })
    return { rescheduled: true, changed: true }
  }, { isolationLevel: "read committed" })
}
