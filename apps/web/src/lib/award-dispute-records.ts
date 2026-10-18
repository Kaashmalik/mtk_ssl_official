import { randomUUID } from "crypto"
import {
  db, tournamentAwardDisputes, tournamentAwards, tournaments,
  leagueRegistrations, players, users, auditLogs, userTenantRoles,
  membershipGrantsAccess,
} from "@mtk/database"
import {
  AWARD_DISPUTE_REASONS, AWARD_DISPUTE_REASON_LABELS,
  canResolveDispute, disputeStatusLabels,
  type AwardDisputeReason,
} from "@mtk/database/lib/award-dispute-policy"
import { isUniqueViolation } from "./db-errors"
import { requireFanContext } from "./fan-follows"
import { requireActiveLeagueContext } from "./league-reads"
import { requirePermissionServer } from "./rbac-server"
import { auth } from "@clerk/nextjs/server"
import { and, desc, eq, isNull } from "drizzle-orm"
import { z } from "zod"

/**
 * PUB-04 award disputes. A registered member's formal challenge to an official
 * award, and the owner's recorded resolution.
 *
 * AUTHORITIES ARE SEPARATED, end to end:
 *  - RAISE is member authority, derived server-side and self-contained:
 *    `requireFanContext` re-derives the active account, the exact active
 *    league and effective membership from auth() (never a client argument),
 *    and the writer then proves the actor is REGISTERED IN THAT TOURNAMENT
 *    (an approved registration carrying one of their player rows, or one they
 *    registered) — the same eligibility read the award writer enforces. There
 *    is deliberately no "dispute" permission string to grant or leak.
 *  - RESOLVE is owner authority only: `requireActiveLeagueContext
 *    ("tournament:update")`, row-locked inside the transaction.
 *  - A dispute NEVER mutates the award: even UPHELD does not supersede the
 *    declaration. The owner corrects the award through the Batch 88 supersede
 *    path as a separate, separately-audited decision. Disputes are RECORDS.
 *
 * The reason set is fixed (nothing offensive is storable; no free text in
 * this first slice — a longer dispute brief is recorded future work). One OPEN
 * dispute per member per award is a DB partial unique; a replay raises
 * nothing new, and a decided dispute does not block a fresh challenge.
 * Notification fan-out is intentionally out of this slice: the owner's queue
 * is the review surface, not in-app alerts (recorded boundary).
 */

export const raiseAwardDisputeInputSchema = z.object({
  tournamentId: z.string().uuid(),
  awardId: z.string().uuid(),
  reason: z.enum(AWARD_DISPUTE_REASONS),
}).strict()

export type RaiseAwardDisputeInput = z.infer<typeof raiseAwardDisputeInputSchema>

export type RaiseAwardDisputeResult = {
  /** False when an open dispute by this member already exists (replay safety). */
  raised: boolean
  disputeId: string
}

export async function raiseAwardDispute(input: unknown): Promise<RaiseAwardDisputeResult> {
  const parsed = raiseAwardDisputeInputSchema.parse(input)
  // Member context: active account + effective membership, re-derived from auth().
  const context = await requireFanContext("tournament:read")

  // (1) The award must be an ACTIVE official award of a tournament in the SAME
  // league. Disputing superseded history is meaningless — the row is gone.
  const [award] = await db
    .select({ id: tournamentAwards.id, tournamentId: tournamentAwards.tournamentId })
    .from(tournamentAwards)
    .innerJoin(tournaments, and(
      eq(tournaments.id, tournamentAwards.tournamentId),
      eq(tournaments.tenantId, context.tenantId),
    ))
    .where(and(
      eq(tournamentAwards.id, parsed.awardId),
      eq(tournamentAwards.tenantId, context.tenantId),
      eq(tournamentAwards.tournamentId, parsed.tournamentId),
      isNull(tournamentAwards.supersededAt),
    ))
    .limit(1)
  if (!award) throw new Error("Forbidden: award not found in this league, or already superseded")

  // (2) Self-contained registration proof in THAT tournament: an approved
  // registration carrying one of the actor's player rows, or one they
  // registered themselves. Unverifiable membership never creates a record.
  const approvedTeams = await db
    .select({ teamId: leagueRegistrations.teamId })
    .from(leagueRegistrations)
    .where(and(
      eq(leagueRegistrations.tournamentId, parsed.tournamentId),
      eq(leagueRegistrations.tenantId, context.tenantId),
      eq(leagueRegistrations.status, "approved"),
    ))
  const registeredTeamIds = new Set(approvedTeams.map((row) => row.teamId))
  const memberPlayers = await db
    .select({ teamId: players.teamId })
    .from(players)
    .where(and(eq(players.userId, context.actorId), eq(players.tenantId, context.tenantId)))
  const registeredPlayer = memberPlayers.some((p) => p.teamId != null && registeredTeamIds.has(p.teamId))
  if (!registeredPlayer) {
    const ownRegistrations = await db
      .select({ id: leagueRegistrations.id })
      .from(leagueRegistrations)
      .where(and(
        eq(leagueRegistrations.tournamentId, parsed.tournamentId),
        eq(leagueRegistrations.tenantId, context.tenantId),
        eq(leagueRegistrations.status, "approved"),
        eq(leagueRegistrations.registeredBy, context.actorId),
      ))
      .limit(1)
    if (ownRegistrations.length === 0) {
      throw new Error("Forbidden: only members registered in this tournament can dispute its awards")
    }
  }

  // (3) Replay check before the insert; the DB partial unique is the real
  // guarantee, this just avoids a noisy rollback on honest re-runs.
  const [existing] = await db
    .select({ id: tournamentAwardDisputes.id })
    .from(tournamentAwardDisputes)
    .where(and(
      eq(tournamentAwardDisputes.awardId, parsed.awardId),
      eq(tournamentAwardDisputes.raisedBy, context.actorId),
      eq(tournamentAwardDisputes.status, "open"),
    ))
    .limit(1)
  if (existing) return { raised: false, disputeId: existing.id }

  try {
    const [inserted] = await db
      .insert(tournamentAwardDisputes)
      .values({
        tenantId: context.tenantId,
        tournamentId: parsed.tournamentId,
        awardId: parsed.awardId,
        raisedBy: context.actorId,
        reason: parsed.reason,
      })
      .returning({ id: tournamentAwardDisputes.id })
    if (!inserted) throw new Error("The dispute could not be recorded. Please retry.")

    await db.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.role,
      method: "AWARD_DISPUTE_RAISED",
      path: "/actions/awards",
      statusCode: "200",
      payload: {
        disputeId: inserted.id,
        tournamentId: parsed.tournamentId,
        awardId: parsed.awardId,
        reason: parsed.reason,
      },
    })
    return { raised: true, disputeId: inserted.id }
  } catch (err) {
    // Lost the race against a concurrent raise: the open dispute exists, so
    // this call IS the replay — resolve it idempotently, never a second row.
    if (isUniqueViolation(err)) {
      const [row] = await db
        .select({ id: tournamentAwardDisputes.id })
        .from(tournamentAwardDisputes)
        .where(and(
          eq(tournamentAwardDisputes.awardId, parsed.awardId),
          eq(tournamentAwardDisputes.raisedBy, context.actorId),
          eq(tournamentAwardDisputes.status, "open"),
        ))
        .limit(1)
      if (row) return { raised: false, disputeId: row.id }
    }
    throw err
  }
}

export const resolveAwardDisputeInputSchema = z.object({
  disputeId: z.string().uuid(),
  decision: z.enum(["upheld", "dismissed"]),
}).strict()

export type ResolveAwardDisputeInput = z.infer<typeof resolveAwardDisputeInputSchema>

export type ResolveAwardDisputeResult = {
  /** False when the dispute was already decided (terminal either way; replay). */
  decided: boolean
  disputeId: string
  decision: "upheld" | "dismissed"
}

export async function resolveAwardDispute(input: unknown): Promise<ResolveAwardDisputeResult> {
  const parsed = resolveAwardDisputeInputSchema.parse(input)
  // Owner authority only — the same permission that declares awards.
  const context = await requireActiveLeagueContext("tournament:update")

  const result = await db.transaction(async (tx) => {
    // (1) Row-locked, tenant-pinned: serialize the decision.
    const [dispute] = await tx
      .select({ id: tournamentAwardDisputes.id, status: tournamentAwardDisputes.status })
      .from(tournamentAwardDisputes)
      .where(and(
        eq(tournamentAwardDisputes.id, parsed.disputeId),
        eq(tournamentAwardDisputes.tenantId, context.tenantId),
      ))
      .for("update")
      .limit(1)
    if (!dispute) throw new Error("Forbidden: dispute not found in this league")

    // (2) Terminal either way: an already-decided row resolves nothing new —
    // the DB CHECK pinning resolution provenance backs this up.
    if (!canResolveDispute(dispute)) {
      return { decided: false, disputeId: dispute.id, decision: parsed.decision }
    }

    await tx.update(tournamentAwardDisputes)
      .set({ status: parsed.decision, resolvedAt: new Date(), resolvedBy: context.actorId })
      .where(eq(tournamentAwardDisputes.id, dispute.id))

    // (3) THE BOUNDARY: the dispute record is resolved; the AWARD ROW ITSELF IS
    // NEVER TOUCHED HERE. Even an upheld dispute does not supersede the
    // declaration — the owner separately corrects the award via the Batch 88
    // supersede path, which carries its own AWARD_CORRECTED audit.
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.role,
      method: "AWARD_DISPUTE_RESOLVED",
      path: "/actions/awards",
      statusCode: "200",
      payload: {
        disputeId: dispute.id,
        decision: parsed.decision,
        awardMutated: false,
      },
    })

    return { decided: true, disputeId: dispute.id, decision: parsed.decision }
  }, { isolationLevel: "read committed" })

  return result
}

/** Bounded owner queue size (house bound; overflow is disclosed, not hidden). */
export const AWARD_DISPUTE_QUEUE_BOUND = 200

export type OpenAwardDisputeRow = {
  disputeId: string
  awardId: string
  tournamentId: string
  category: string
  reason: AwardDisputeReason
  reasonLabel: string
  raisedAt: Date
  raisedByName: string | null
}

/**
 * The owner's review queue: every OPEN dispute in the league, newest first,
 * bounded with house-style disclosure upstream. Owner callers resolve the
 * `canEdit` gate; the writer re-checks authority.
 */
export async function readOpenAwardDisputes(tenantId: string): Promise<OpenAwardDisputeRow[]> {
  const rows = await db
    .select({
      disputeId: tournamentAwardDisputes.id,
      awardId: tournamentAwardDisputes.awardId,
      tournamentId: tournamentAwardDisputes.tournamentId,
      category: tournamentAwards.category,
      reason: tournamentAwardDisputes.reason,
      raisedAt: tournamentAwardDisputes.raisedAt,
      raisedByName: users.displayName,
    })
    .from(tournamentAwardDisputes)
    .innerJoin(tournamentAwards, eq(tournamentAwards.id, tournamentAwardDisputes.awardId))
    .leftJoin(users, eq(users.id, tournamentAwardDisputes.raisedBy))
    .where(and(
      eq(tournamentAwardDisputes.tenantId, tenantId),
      eq(tournamentAwardDisputes.status, "open"),
    ))
    .orderBy(desc(tournamentAwardDisputes.raisedAt))
    .limit(AWARD_DISPUTE_QUEUE_BOUND)
  return rows.map((row) => ({ ...row, reasonLabel: AWARD_DISPUTE_REASON_LABELS[row.reason] }))
}

/** Bounded member history (house bound). */
export const MY_DISPUTES_BOUND = 50

export type MyAwardDisputeRow = {
  disputeId: string
  awardId: string
  category: string
  reasonLabel: string
  status: "open" | "upheld" | "dismissed"
  statusLabel: string
  raisedAt: Date
}

/** The member's own dispute history in the league, newest first (bounded). */
export async function readMyAwardDisputes(tenantId: string, actorId: string): Promise<MyAwardDisputeRow[]> {
  const rows = await db
    .select({
      disputeId: tournamentAwardDisputes.id,
      awardId: tournamentAwardDisputes.awardId,
      category: tournamentAwards.category,
      reason: tournamentAwardDisputes.reason,
      status: tournamentAwardDisputes.status,
      raisedAt: tournamentAwardDisputes.raisedAt,
    })
    .from(tournamentAwardDisputes)
    .innerJoin(tournamentAwards, eq(tournamentAwards.id, tournamentAwardDisputes.awardId))
    .where(and(
      eq(tournamentAwardDisputes.tenantId, tenantId),
      eq(tournamentAwardDisputes.raisedBy, actorId),
    ))
    .orderBy(desc(tournamentAwardDisputes.raisedAt))
    .limit(MY_DISPUTES_BOUND)
  return rows.map((row) => ({
    disputeId: row.disputeId,
    awardId: row.awardId,
    category: row.category,
    reasonLabel: AWARD_DISPUTE_REASON_LABELS[row.reason],
    status: row.status,
    statusLabel: disputeStatusLabels(row.status),
    raisedAt: row.raisedAt,
  }))
}

export type AwardDisputeAffordance = {
  /** Award ids the actor already has an OPEN dispute on (affordance is then dimmed). */
  myOpenDisputeAwardIds: string[]
}

/**
 * Read-only affordance data for the PUBLIC tournament page: null for anonymous
 * visitors and for signed-in members who are not registered in that tournament
 * — the dispute affordance simply is not offered to anyone else. This re-derives
 * identity from auth() exactly like `requireFanContext` (no client arguments)
 * and re-uses the raise authority's registration proof, so the offer and the
 * write can never disagree about who may dispute. Read-only: anon-safe pages
 * unaffected; a signed-in non-member changes nothing.
 */
export async function readAwardDisputeAffordance(
  tenantId: string,
  tournamentId: string,
): Promise<AwardDisputeAffordance | null> {
  const { userId: clerkId } = await auth()
  if (!clerkId) return null
  const tenantIdResolved = tenantId
  await requirePermissionServer("tournament:read", tenantIdResolved)
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) return null
  const membership = await db.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantIdResolved)) })
  if (!membership || !membershipGrantsAccess(membership) || membership.role === "super_admin") return null

  // The raise authority's registration proof, in read-only form.
  const approvedTeams = await db
    .select({ teamId: leagueRegistrations.teamId })
    .from(leagueRegistrations)
    .where(and(
      eq(leagueRegistrations.tournamentId, tournamentId),
      eq(leagueRegistrations.tenantId, tenantIdResolved),
      eq(leagueRegistrations.status, "approved"),
    ))
  const registeredTeamIds = new Set(approvedTeams.map((row) => row.teamId))
  const memberPlayers = await db
    .select({ teamId: players.teamId })
    .from(players)
    .where(and(eq(players.userId, actor.id), eq(players.tenantId, tenantIdResolved)))
  const memberPlayersEligible = memberPlayers.some((p) => p.teamId != null && registeredTeamIds.has(p.teamId))
  if (!memberPlayersEligible) {
    const ownRegistrations = await db
      .select({ id: leagueRegistrations.id })
      .from(leagueRegistrations)
      .where(and(
        eq(leagueRegistrations.tournamentId, tournamentId),
        eq(leagueRegistrations.tenantId, tenantIdResolved),
        eq(leagueRegistrations.status, "approved"),
        eq(leagueRegistrations.registeredBy, actor.id),
      ))
      .limit(1)
    if (ownRegistrations.length === 0) return null
  }

  const open = await db
    .select({ awardId: tournamentAwardDisputes.awardId })
    .from(tournamentAwardDisputes)
    .where(and(
      eq(tournamentAwardDisputes.tenantId, tenantIdResolved),
      eq(tournamentAwardDisputes.raisedBy, actor.id),
      eq(tournamentAwardDisputes.status, "open"),
    ))
  return { myOpenDisputeAwardIds: open.map((row) => row.awardId) }
}

/**
 * Guest-safe wrapper for the public page: anonymous visitors, signed-in
 * non-members and any read problem all collapse to "no affordance" — the
 * public page renders unchanged rather than failing, exactly like the
 * fail-closed fan-vote reads it sits next to.
 */
export async function readAwardDisputeAffordanceSafe(
  tenantId: string,
  tournamentId: string,
): Promise<AwardDisputeAffordance | null> {
  try {
    return await readAwardDisputeAffordance(tenantId, tournamentId)
  } catch {
    return null
  }
}
