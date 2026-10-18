import { randomUUID } from "crypto"
import {
  auditLogs,
  db,
  matches,
  scorecardCorrectionRequests,
  userTenantRoles,
  users,
} from "@mtk/database"
import { and, asc, eq } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { auth } from "@clerk/nextjs/server"
import {
  correctionRequestDecision,
  isCorrectionReason,
  isCorrectionStatus,
  type CorrectionStatus,
} from "@mtk/database/lib/scorecard-correction-policy"
import { membershipGrantsAccess } from "@mtk/database"

/**
 * REG-05 (Batch 141): the correction-request journey. Requests are
 * RECORDS, never mutations: a member raises one, an owner resolves it,
 * and nothing here edits a scorecard directly. One OPEN request per
 * member per match is a database guarantee; an identical replay is a
 * pure read; a DIFFERENT reason while one is open refuses (a raised
 * formal record is not silently rewritten). Resolution is owner-only,
 * under a lock, with provenance CHECK-enforced by the database.
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

const activeMembershipIn = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  tenantId: string,
) => {
  const [member] = await tx
    .select({ role: userTenantRoles.role, status: userTenantRoles.status, expiresAt: userTenantRoles.expiresAt })
    .from(userTenantRoles)
    .where(and(eq(userTenantRoles.userId, userId), eq(userTenantRoles.tenantId, tenantId)))
    .limit(1)
  if (!member || !membershipGrantsAccess(member)) throw new Error("Forbidden: you are not an active member of this league")
  return member
}

export async function submitScorecardCorrection(
  matchId: string,
  reason: string,
): Promise<{ raised: true; requestId: string; changed: boolean }> {
  if (!isCorrectionReason(reason)) throw new Error("Correction reason must be one of the listed kinds")
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)
  z.string().uuid().parse(matchId)

  return db.transaction(async (tx) => {
    // Primary-key fetch; the league authority is the row's OWN tenant_id
    // and every write is gated by an ACTIVE membership in exactly that
    // league below - a non-member can read no further and never write.
    const [match] = await tx
      .select({ id: matches.id, tenantId: matches.tenantId, status: matches.status })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
    if (!match) throw new Error("Match not found")
    const decision = correctionRequestDecision(match)
    if (!decision.ok) throw new Error(decision.reason)
    await activeMembershipIn(tx, account.id, match.tenantId)

    await tx.execute(sql`SELECT ${scorecardCorrectionRequests.id} FROM ${scorecardCorrectionRequests}
      WHERE ${scorecardCorrectionRequests.matchId} = ${match.id}
        AND ${scorecardCorrectionRequests.requestedBy} = ${account.id}
      FOR UPDATE`)
    const [current] = await tx
      .select({ id: scorecardCorrectionRequests.id, reason: scorecardCorrectionRequests.reason, status: scorecardCorrectionRequests.status })
      .from(scorecardCorrectionRequests)
      .where(and(
        eq(scorecardCorrectionRequests.matchId, match.id),
        eq(scorecardCorrectionRequests.requestedBy, account.id),
        eq(scorecardCorrectionRequests.status, "open"),
      ))
      .limit(1)

    if (current) {
      // One open request per member per match (database-enforced too).
      if (current.reason === reason) {
        // Identical replay: a pure read - no second audit row.
        return { raised: true, requestId: current.id, changed: false }
      }
      throw new Error("You already have an open correction request for this match - resolve or withdraw it first")
    }

    const [raised] = await tx
      .insert(scorecardCorrectionRequests)
      .values({ tenantId: match.tenantId, matchId: match.id, requestedBy: account.id, reason })
      .returning({ id: scorecardCorrectionRequests.id })
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: match.tenantId,
      actorId: account.id,
      actorRole: null,
      method: "SCORECARD_CORRECTION_RAISED",
      path: "/dashboard/matches",
      statusCode: "200",
      payload: { resourceId: match.id, correctionId: raised.id, reason },
    })
    return { raised: true, requestId: raised.id, changed: true }
  }, { isolationLevel: "read committed" })
}

export async function resolveScorecardCorrection(
  requestId: string,
  decision: string,
): Promise<{ resolved: true; status: Exclude<CorrectionStatus, "open"> }> {
  if (decision !== "approved" && decision !== "dismissed") {
    throw new Error("Resolution must be approved or dismissed")
  }
  if (!isCorrectionStatus(decision)) throw new Error("Resolution must be approved or dismissed")
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)
  z.string().uuid().parse(requestId)

  return db.transaction(async (tx) => {
    const [request] = await tx
      .select({ id: scorecardCorrectionRequests.id, tenantId: scorecardCorrectionRequests.tenantId, status: scorecardCorrectionRequests.status })
      .from(scorecardCorrectionRequests)
      .where(eq(scorecardCorrectionRequests.id, requestId))
      .limit(1)
    if (!request) throw new Error("Correction request not found")
    // Resolution is the league OWNER's authority (review and correction
    // stay apart - the request never edits the scorecard itself).
    const [member] = await tx
      .select({ role: userTenantRoles.role, status: userTenantRoles.status, expiresAt: userTenantRoles.expiresAt })
      .from(userTenantRoles)
      .where(and(eq(userTenantRoles.userId, account.id), eq(userTenantRoles.tenantId, request.tenantId)))
      .limit(1)
    if (!member || member.status !== "active" || member.role !== "league_owner") {
      throw new Error("Forbidden: only the league owner can resolve correction requests")
    }

    await tx.execute(sql`SELECT ${scorecardCorrectionRequests.id} FROM ${scorecardCorrectionRequests}
      WHERE ${scorecardCorrectionRequests.id} = ${request.id} FOR UPDATE`)
    if (request.status !== "open") {
      // Terminal state: a resolution replay is a pure read.
      return { resolved: true, status: decision }
    }
    await tx
      .update(scorecardCorrectionRequests)
      .set({ status: decision, resolvedAt: new Date(), resolvedBy: account.id })
      .where(eq(scorecardCorrectionRequests.id, request.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: request.tenantId,
      actorId: account.id,
      actorRole: "league_owner",
      method: "SCORECARD_CORRECTION_RESOLVED",
      path: "/dashboard/matches",
      statusCode: "200",
      payload: { resourceId: request.id, decision },
    })
    return { resolved: true, status: decision }
  }, { isolationLevel: "read committed" })
}

/** Owner read: bounded requests for a match with requester display names. */
export async function readMatchCorrectionRequests(matchId: string, tenantId: string) {
  return db
    .select({
      id: scorecardCorrectionRequests.id,
      requestedBy: scorecardCorrectionRequests.requestedBy,
      displayName: users.displayName,
      reason: scorecardCorrectionRequests.reason,
      status: scorecardCorrectionRequests.status,
      raisedAt: scorecardCorrectionRequests.raisedAt,
    })
    .from(scorecardCorrectionRequests)
    .innerJoin(users, eq(users.id, scorecardCorrectionRequests.requestedBy))
    .where(and(eq(scorecardCorrectionRequests.matchId, matchId), eq(scorecardCorrectionRequests.tenantId, tenantId)))
    .orderBy(asc(scorecardCorrectionRequests.raisedAt))
    .limit(50)
}
