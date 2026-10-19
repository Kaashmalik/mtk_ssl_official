import { randomUUID } from "crypto"
import { db, fanPredictions, matches, users, userTenantRoles, membershipGrantsAccess, auditLogs } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { auth } from "@clerk/nextjs/server"
import {
  isPredictionPick,
  predictionWindow,
  settlePrediction,
  describePredictionWindow,
  type PredictionPick,
  type PredictionSettledVerdict,
} from "@mtk/database/lib/fan-prediction-policy"

/**
 * FAN-04 (Batch 164): the fan-prediction journey. A member of the match's
 * league keeps ONE private, no-stakes pick per match; re-picking updates
 * the same row in place while the window is open, an identical replay is a
 * pure read, and the write is audited. Correctness is NEVER stored - the
 * view derives it from the official match row, so a pick can never alter
 * or contradict a recorded score.
 */

const pickSchema = z.enum(["home", "away"])

const memberContextOf = async (clerkId: string) => {
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

export async function saveMyPrediction(
  matchId: string,
  pick: string,
): Promise<{ recorded: true; pick: PredictionPick; changed: boolean; windowSentence: string }> {
  z.string().uuid().parse(matchId)
  if (!pickSchema.safeParse(pick).success || !isPredictionPick(pick)) {
    throw new Error("Prediction must be home or away")
  }
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await memberContextOf(clerkId)

  return db.transaction(async (tx) => {
    // Match by primary key alone, exactly like the availability writer: the
    // row's OWN tenant is the authority, and the ACTIVE membership in that
    // exact league is what may read beyond existence - let alone write.
    const [match] = await tx
      .select({
        id: matches.id,
        tenantId: matches.tenantId,
        status: matches.status,
        scheduledDate: matches.scheduledDate,
        winnerId: matches.winnerId,
        teamAId: matches.teamAId,
        teamBId: matches.teamBId,
        result: matches.result,
      })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
    if (!match) throw new Error("Match not found")

    const window = predictionWindow(match, new Date())
    if (!window.open) throw new Error(describePredictionWindow(window))
    await activeMembershipIn(tx, account.id, match.tenantId)

    // One pick per member per match (unique index): lock the existing row
    // if any, then identical replay = pure read, different pick = in place.
    const [existing] = await tx
      .select({ id: fanPredictions.id, prediction: fanPredictions.prediction })
      .from(fanPredictions)
      .where(and(
        eq(fanPredictions.matchId, match.id),
        eq(fanPredictions.tenantId, match.tenantId),
        eq(fanPredictions.userId, account.id),
      ))
      .limit(1)
    if (existing?.prediction === pick) {
      return { recorded: true, pick, changed: false, windowSentence: "Already predicted - your pick stands." }
    }
    if (existing) {
      await tx
        .update(fanPredictions)
        .set({ prediction: pick, updatedAt: new Date() })
        .where(eq(fanPredictions.id, existing.id))
    } else {
      await tx.insert(fanPredictions).values({
        tenantId: match.tenantId,
        matchId: match.id,
        userId: account.id,
        prediction: pick,
      })
    }

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: match.tenantId,
      actorId: account.id,
      actorRole: null,
      method: "FAN_PREDICTION_RECORDED",
      path: "/dashboard/matches",
      statusCode: "200",
      payload: {
        resourceId: match.id,
        pick,
        mode: existing ? "updated" : "created",
        previousPick: existing?.prediction ?? null,
      },
    })
    return { recorded: true, pick, changed: true, windowSentence: "Predictions are open until the match begins." }
  }, { isolationLevel: "read committed" })
}

/** Serializable view for the client card. */
export type FanPredictionView = {
  userId: string | null
  pick: PredictionPick | null
  window: { open: boolean; reason?: string; sentence: string }
  settled: Exclude<PredictionSettledVerdict, null> | null
  resultText: string | null
  teamAName: string | null
  teamBName: string | null
}

/**
 * Card-sizing read: the viewer's pick + the DERIVED verdict from the
 * official row. Never throws for a signed-out or unknown viewer - the card
 * simply does not render for them (honest absence, not an error box).
 */
export async function readMyPredictionView(
  matchId: string,
  tenantId: string,
  viewerUserId: string | null,
  teamAName: string,
  teamBName: string,
): Promise<FanPredictionView | null> {
  z.string().uuid().parse(matchId)
  // Tenant-consistent like every other page read (ISO-07): the match row is
  // fetched under (id, tenant) - never by bare PK.
  const [match] = await db
    .select({
      id: matches.id,
      status: matches.status,
      scheduledDate: matches.scheduledDate,
      winnerId: matches.winnerId,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      result: matches.result,
    })
    .from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1)
  if (!match) return null

  let pick: PredictionPick | null = null
  if (viewerUserId) {
    const [existing] = await db
      .select({ prediction: fanPredictions.prediction })
      .from(fanPredictions)
      .where(and(
        eq(fanPredictions.matchId, matchId),
        eq(fanPredictions.tenantId, tenantId),
        eq(fanPredictions.userId, viewerUserId),
      ))
      .limit(1)
    if (existing && isPredictionPick(existing.prediction)) pick = existing.prediction
  }

  const window = predictionWindow(match, new Date())
  const settled = pick ? settlePrediction(pick, match) : null

  return {
    userId: viewerUserId,
    pick,
    window: { open: window.open, ...(window.open ? {} : { reason: window.reason }), sentence: describePredictionWindow(window) },
    settled,
    resultText: match.result,
    teamAName,
    teamBName,
  }
}
