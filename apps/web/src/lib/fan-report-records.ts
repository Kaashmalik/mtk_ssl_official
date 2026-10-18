import { randomUUID } from "crypto"
import { db, fanReactionReports, users, matches, tournaments, teams, auditLogs } from "@mtk/database"
import { and, eq, desc, asc, count, gte } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"
import {
  isReactionReportReason,
  reactionTargetDecision,
  reactionReportDecision,
  fanReportRateDecision,
  FAN_REPORT_WINDOW_MS,
} from "@mtk/database/lib/fan-reaction-policy"
import { requireFanContext } from "./fan-follows"
import { readActiveFanBlockExists } from "./fan-block-records"
import { requireActiveLeagueContext } from "./league-reads"

/**
 * FAN-01 reports slice (locked writer).
 *
 * The public reaction bar shows aggregate counts only, so a fan cannot
 * reference one specific reaction row: a report is per MATCH FEED. Gates run
 * in a fixed order - identity first (`requireFanContext`), then the shared
 * publication policy for the target match, then the flood floor - and only
 * then the insert, whose partial unique index makes a re-report while an
 * open one exists an idempotent no-op (never a duplicate, never an error).
 *
 * The organizer decision is append-provenance: only an OPEN report can be
 * decided, decided states are terminal, and reviewer identity + time are
 * stamped inside the same transaction as the audit row (the DB review
 * provenance CHECK mirrors this). Reports are moderation signals only: no
 * scoring, standings or award path reads them.
 */

const reportInputSchema = z.object({
  matchId: z.string().uuid(),
  reason: z.string().refine(isReactionReportReason, "Unknown reason"),
})

const decideInputSchema = z.object({
  reportId: z.string().uuid(),
  decision: z.enum(["dismissed", "actioned"]),
})

export type FanReportResult =
  | { action: "open"; reportId: string }
  | { action: "already_open" }
  | { action: "refused"; reason: "target_unpublished" | "report_rate_limited" | "blocked" }

/**
 * Read the published/played-state of the target match in the same league.
 * Tenant is pinned on both joins - a foreign match id reads as unpublished.
 * (Same gate shape as the reaction writer; duplicated here instead of
 * exported so both writers stay independently locked.)
 */
async function readReactionTarget(tenantId: string, matchId: string) {
  const [row] = await db
    .select({ status: matches.status, tournamentStatus: tournaments.status })
    .from(matches)
    .innerJoin(tournaments, and(eq(tournaments.id, matches.tournamentId), eq(tournaments.tenantId, tenantId)))
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1)
  return row ?? null
}

/**
 * A signed-in fan reports a match's reaction feed. Replay-safe: an existing
 * OPEN report from the same fan degrades to `already_open`; after a decision
 * a fresh report is allowed again.
 */
export async function reportMatchReactionFeed(input: unknown): Promise<FanReportResult> {
  const parsed = reportInputSchema.parse(input)
  const context = await requireFanContext("fan:follow")

  // (0) Anti-abuse gate: a league-scoped active block refuses this fan's
  // report fail-closed, before any target or rate logic runs.
  if (await readActiveFanBlockExists(context.tenantId, context.actorId)) {
    return { action: "refused", reason: "blocked" }
  }

  // (1) Target gate: published tournament, published, never-cancelled match.
  const target = await readReactionTarget(context.tenantId, parsed.matchId)
  const decision = target
    ? reactionTargetDecision({ matchStatus: target.status, tournamentStatus: target.tournamentStatus })
    : { allowed: false as const, reason: "target_unpublished" as const }
  if (!decision.allowed) return { action: "refused", reason: decision.reason }

  // (2) Flood floor on reports (same spirit as the reaction guard).
  const [recentRow] = await db
    .select({ total: count() })
    .from(fanReactionReports)
    .where(and(
      eq(fanReactionReports.reportedBy, context.actorId),
      gte(fanReactionReports.createdAt, new Date(Date.now() - FAN_REPORT_WINDOW_MS)),
    ))
  const rate = fanReportRateDecision(Number(recentRow?.total ?? 0))
  if (!rate.allowed) return { action: "refused", reason: rate.reason }

  // (3) Insert. The partial unique index (match_id, reported_by) WHERE open
  // absorbs a concurrent or repeated open report - empty returning reads as
  // already_open, honestly.
  const inserted = await db
    .insert(fanReactionReports)
    .values({
      tenantId: context.tenantId,
      matchId: parsed.matchId,
      reportedBy: context.actorId,
      reason: parsed.reason,
    })
    .onConflictDoNothing()
    .returning({ id: fanReactionReports.id })

  if (inserted.length === 0) return { action: "already_open" }
  const reportId = inserted[0].id

  await db.insert(auditLogs).values({
    requestId: randomUUID(),
    tenantId: context.tenantId,
    actorId: context.actorId,
    actorRole: context.role,
    method: "REACTION_REPORT",
    path: `/matches/${parsed.matchId}`,
    statusCode: "200",
    // Report provenance: which feed, which reason, which fan (id only).
    payload: { matchId: parsed.matchId, reportId, reason: parsed.reason },
  })

  return { action: "open", reportId }
}

export type OpenReactionReport = {
  id: string
  reason: string
  reporterName: string | null
  createdAt: string
}

/** The league owner's open-report queue for one of their matches. */
export async function readOpenReactionReports(matchIdInput: unknown): Promise<OpenReactionReport[]> {
  const { matchId } = z.object({ matchId: z.string().uuid() }).strict().parse(
    typeof matchIdInput === "string" ? { matchId: matchIdInput } : matchIdInput,
  )
  const { tenantId } = await requireActiveLeagueContext("match:update")
  const rows = await db
    .select({
      id: fanReactionReports.id,
      reason: fanReactionReports.reason,
      reporterName: users.displayName,
      createdAt: fanReactionReports.createdAt,
    })
    .from(fanReactionReports)
    .innerJoin(users, and(eq(users.id, fanReactionReports.reportedBy), eq(users.isActive, true)))
    .where(and(
      eq(fanReactionReports.tenantId, tenantId),
      eq(fanReactionReports.matchId, matchId),
      eq(fanReactionReports.status, "open"),
    ))
    .orderBy(desc(fanReactionReports.createdAt))
    .limit(50)
  return rows.map(row => ({
    id: row.id,
    reason: row.reason,
    reporterName: row.reporterName ?? null,
    createdAt: row.createdAt.toISOString(),
  }))
}

export type DecideReportResult =
  | { decided: true }
  | { decided: false; reason: "not_found" | "already_decided" | "invalid_decision" }

/**
 * Decide one open report (dismissed = reviewed, nothing to act on; actioned =
 * reviewed and handled - the handling itself stays in the audited
 * removeModeratedReaction flow). Locked read pins tenant + match context so
 * a foreign report id reads as not_found; a replay after a decision reports
 * that honestly instead of re-deciding.
 */
export async function decideReactionReport(input: unknown): Promise<DecideReportResult> {
  const parsed = decideInputSchema.parse(input)
  const { tenantId, actorId, role } = await requireActiveLeagueContext("match:update")

  return db.transaction(async tx => {
    const [report] = await tx
      .select({ id: fanReactionReports.id, status: fanReactionReports.status, matchId: fanReactionReports.matchId })
      .from(fanReactionReports)
      .where(and(
        eq(fanReactionReports.id, parsed.reportId),
        eq(fanReactionReports.tenantId, tenantId),
      ))
      .for("update")
      .limit(1)
    if (!report) return { decided: false, reason: "not_found" as const }

    const outcome = reactionReportDecision({
      // A status outside the known set cannot exist (DB CHECK); it would
      // simply read as undecided-unknown and refuse below.
      currentStatus: report.status as "open" | "dismissed" | "actioned",
      decision: parsed.decision,
    })
    if (!outcome.allowed) return { decided: false, reason: outcome.reason }

    await tx
      .update(fanReactionReports)
      .set({ status: parsed.decision, reviewedBy: actorId, reviewedAt: new Date() })
      .where(eq(fanReactionReports.id, report.id))

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId,
      actorId,
      actorRole: role,
      method: "REACTION_REPORT_DECIDE",
      path: `/dashboard/matches/${report.matchId}`,
      statusCode: "200",
      // Decision provenance: what was decided, of what, under which match.
      payload: { reportId: report.id, matchId: report.matchId, decision: parsed.decision },
    })
    return { decided: true } as const
  })
}

export type LeagueOpenReport = {
  id: string
  matchId: string
  matchLabel: string
  reason: string
  reporterName: string | null
  createdAt: string
}

/**
 * The league-wide open-report queue: every match's open reports in one
 * bounded, oldest-first list (fairness - the longest-waiting report is the
 * queue head). Tenant is pinned in the WHERE clause; the match label joins
 * both registered team names through the match row, and a report whose
 * teams cannot resolve still surfaces with an honest id-only label.
 * Reports are the same engagement-bound signals as before: deciding a
 * record here goes through the identical locked decide path.
 */
export async function readLeagueOpenReports(): Promise<LeagueOpenReport[]> {
  const { tenantId } = await requireActiveLeagueContext("match:update")
  const teamA = alias(teams, "report_team_a")
  const teamB = alias(teams, "report_team_b")
  const rows = await db
    .select({
      id: fanReactionReports.id,
      matchId: fanReactionReports.matchId,
      teamAName: teamA.name,
      teamBName: teamB.name,
      reason: fanReactionReports.reason,
      reporterName: users.displayName,
      createdAt: fanReactionReports.createdAt,
    })
    .from(fanReactionReports)
    .innerJoin(matches, and(eq(matches.id, fanReactionReports.matchId), eq(matches.tenantId, tenantId)))
    .innerJoin(users, and(eq(users.id, fanReactionReports.reportedBy), eq(users.isActive, true)))
    .leftJoin(teamA, and(eq(teamA.id, matches.teamAId), eq(teamA.tenantId, tenantId)))
    .leftJoin(teamB, and(eq(teamB.id, matches.teamBId), eq(teamB.tenantId, tenantId)))
    .where(and(eq(fanReactionReports.tenantId, tenantId), eq(fanReactionReports.status, "open")))
    .orderBy(asc(fanReactionReports.createdAt))
    .limit(50)
  return rows.map(row => {
    const pair = [row.teamAName, row.teamBName].filter(Boolean).join(" vs ")
    return {
      id: row.id,
      matchId: row.matchId,
      matchLabel: pair || `Match ${row.matchId.slice(0, 8)}`,
      reason: row.reason,
      reporterName: row.reporterName ?? null,
      createdAt: row.createdAt.toISOString(),
    }
  })
}
