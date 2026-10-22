"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import { canScoreMatch, requireMatchScoringAccess, requireScoringActorId } from "@/lib/scoring-access"
import { withAuth } from "./action-guard"
import { withScoringFence } from "@/lib/scoring-fence-action"
import {
  proxyUndoBall,
  proxyCreateInnings,
  proxyCompleteInnings,
} from "@/lib/scoring-service-client"
import { findInningsId, findScoringMatch, findScoringTenant, readBallHistory,
  readMatchPlayersForScoring, readMatchScoringBatch } from "@/lib/scoring-reads"
import { recordBallCommandSchema, submitDelivery } from "@/lib/scoring-submission"

// ─── Schemas ──────────────────────────────────────────────────

const recordBallSchema = recordBallCommandSchema

export type RecordBallInput = z.infer<typeof recordBallSchema>

const createInningsSchema = z.object({
  matchId: z.string().uuid(),
  teamId: z.string().uuid(),
  inningsNumber: z.number().int().min(1).max(3), // 1, 2, or 3 for super over
  /** SCORE-11 writer fencing: the handover epoch the scoring session observed. */
  handoverEpoch: z.number().int().min(0).optional(),
  expectedRevision: z.number().int().min(0).max(2147483647).optional(),
})

export type CreateInningsInput = z.infer<typeof createInningsSchema>

async function requireTenant() {
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("match:read", tenantId)
  const tenant = await findScoringTenant(tenantId)
  if (!tenant) throw new Error("Tenant not found")
  return tenant
}

// ─── Record Ball ──────────────────────────────────────────────
// Auth + tenant checks here; persistence is Nest scoring-service (SoT).

export const recordBall = withAuth("match:score", withScoringFence(async (input: RecordBallInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const validated = recordBallSchema.parse(input)
  if ((validated.queueAccountId !== undefined && validated.queueAccountId !== userId) ||
      (validated.queueTenantId !== undefined && validated.queueTenantId !== tenant.id)) {
    throw new Error("Saved delivery belongs to a different scoring account or league. Switch back to review it.")
  }

  const acknowledgement = await submitDelivery(userId, tenant.id, validated)

  revalidatePath(`/matches/${validated.matchId}/scoring`)
  revalidatePath(`/dashboard/matches/${validated.matchId}`)
  revalidatePath("/dashboard/scoring")

  return acknowledgement
}))

// ─── Undo Ball ────────────────────────────────────────────────
// Auth here; undo rules enforced by scoring-service SoT.

export const undoBall = withAuth("match:score", withScoringFence(async (
  matchId: string,
  ballId: string,
  handoverEpoch?: number,
  expectedRevision?: number,
) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()

  z.string().uuid().parse(matchId)
  z.string().uuid().parse(ballId)
  await requireMatchScoringAccess(userId, tenant.id, matchId)
  const actorId = await requireScoringActorId(userId)

  const result = await proxyUndoBall(matchId, ballId, tenant.id, actorId, handoverEpoch, expectedRevision)

  revalidatePath(`/matches/${matchId}/scoring`)
  revalidatePath(`/dashboard/matches/${matchId}`)

  return { success: true, scoringRevision: result?.scoringRevision, participants: result?.participants ?? null }
}))

// ─── Create Innings ───────────────────────────────────────────
// Authorisation here; innings numbering, team validation and the duplicate
// check live in scoring-service (SoT), which also performs the insert.

export const createInnings = withAuth("match:score", withScoringFence(async (input: CreateInningsInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const validated = createInningsSchema.parse(input)

  await requireMatchScoringAccess(userId, tenant.id, validated.matchId)
  const actorId = await requireScoringActorId(userId)

  const innings = await proxyCreateInnings(validated, tenant.id, actorId)

  revalidatePath(`/matches/${validated.matchId}/scoring`)

  return { success: true, innings }
}))

// ─── Get Match State (for scoring page) ───────────────────────
// Returns match + both teams + all innings + recent balls. Single query batch.

export const getMatchForScoring = withAuth("match:read", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()

  const match = await findScoringMatch(matchId, tenant.id)
  if (!match) throw new Error("Match not found")
  const canScore = await canScoreMatch(userId, tenant.id, match)

  const { teamA, teamB, allInnings, recentBalls } = await readMatchScoringBatch(
    matchId, match.teamAId, match.teamBId, tenant.id,
  )

  return {
    tenantId: tenant.id,
    queueScope: { accountId: userId, tenantId: tenant.id, matchId: match.id },
    canScore,
    match: {
      id: match.id,
      status: match.status,
      matchFormat: match.matchFormat,
      totalOvers: match.totalOvers,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      tossWinnerId: match.tossWinnerId,
      tossDecision: match.tossDecision,
      updatedAt: match.updatedAt,
      // SCORE-11 writer fencing: echoed by every scoring write this session
      // issues; the canonical service fences stale sessions (reload prompt).
      handoverEpoch: match.scorerHandoverEpoch,
      scoringRevision: match.scoringRevision,
    },
    teamA: teamA[0] ?? { id: match.teamAId, name: "Team A" },
    teamB: teamB[0] ?? { id: match.teamBId, name: "Team B" },
    innings: allInnings,
    recentBalls: recentBalls.reverse(), // chronological order
  }
})

// ─── Get Players for Scoring ──────────────────────────────────
// Returns both teams' players for the player selector.

export const getMatchPlayersForScoring = withAuth("match:read", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()

  const result = await readMatchPlayersForScoring(matchId, tenant.id)
  if (!result) throw new Error("Match not found")

  return result
})

// ─── Complete Innings ─────────────────────────────────────────
// Authorisation here; the innings status transition, the parent match's
// `live` -> `innings_break` transition and cache invalidation all happen in
// scoring-service (SoT), in one transaction.

export const completeInnings = withAuth("match:score", withScoringFence(async (
  matchId: string,
  inningsId: string,
  handoverEpoch?: number,
  expectedRevision?: number,
) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  z.string().uuid().parse(matchId)
  z.string().uuid().parse(inningsId)
  await requireMatchScoringAccess(userId, tenant.id, matchId)
  const actorId = await requireScoringActorId(userId)

  // Early tenant boundary; the canonical transaction also checks tenant,
  // actor membership, and current assignment before completing the innings.
  const owned = await findInningsId(inningsId, matchId, tenant.id)
  if (!owned) throw new Error("Innings not found")

  const result = await proxyCompleteInnings(matchId, inningsId, tenant.id, actorId, handoverEpoch, expectedRevision)

  revalidatePath(`/matches/${matchId}/scoring`)
  revalidatePath(`/dashboard/matches/${matchId}`)

  return {
    success: true,
    innings: result.innings,
    matchStatus: result.matchStatus,
    inningsBreakApplied: result.inningsBreakApplied,
    scoringRevision: result.scoringRevision,
  }
}))

// ─── Get Ball History ─────────────────────────────────────────

export const getBallHistory = withAuth("match:read", async (matchId: string, inningsId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()

  // Tenant scope was missing here historically. `withAuth("match:read")` checks
  // that the caller holds `match:read` in *their own* tenant, which says nothing
  // about whether this particular match belongs to it — the innings gate keeps
  // the join scoped through `matchInnings.tenantId`.
  const balls = await readBallHistory(matchId, inningsId, tenant.id)
  if (!balls) throw new Error("Innings not found")
  return balls
})
