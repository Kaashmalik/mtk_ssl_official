"use server"

import { auth } from "@clerk/nextjs/server"
import { db } from "@mtk/database"
import { battingScorecards, bowlingScorecards, fieldingScorecards, matches, matchInnings } from "@mtk/database"
import { eq, asc, and, exists, sql } from "drizzle-orm"
import { z } from "zod"
import { withAuth } from "./action-guard"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"


// Legacy input shape retained for source compatibility only. There is no
// supported manual-import/correction command; the old writer is disabled below.

const battingEntrySchema = z.object({
  playerId: z.string().uuid(),
  teamId: z.string().uuid(),
  battingPosition: z.number().int().min(1).max(11),
  runs: z.number().int().min(0).default(0),
  ballsFaced: z.number().int().min(0).default(0),
  fours: z.number().int().min(0).default(0),
  sixes: z.number().int().min(0).default(0),
  dismissalType: z.enum([
    "bowled", "caught", "caught_behind", "caught_and_bowled", "lbw",
    "run_out", "stumped", "hit_wicket", "retired", "retired_hurt",
    "obstructing_field", "timed_out", "handled_ball", "not_out",
  ]).default("not_out"),
  bowlerId: z.string().uuid().optional().nullable(),
  fielderId: z.string().uuid().optional().nullable(),
  dismissalText: z.string().optional().nullable(),
  dotBalls: z.number().int().min(0).default(0),
})

const bowlingEntrySchema = z.object({
  playerId: z.string().uuid(),
  teamId: z.string().uuid(),
  bowlingPosition: z.number().int().min(1),
  ballsBowled: z.number().int().min(0).default(0),
  maidens: z.number().int().min(0).default(0),
  runsConceded: z.number().int().min(0).default(0),
  wickets: z.number().int().min(0).default(0),
  wides: z.number().int().min(0).default(0),
  noBalls: z.number().int().min(0).default(0),
  dotBalls: z.number().int().min(0).default(0),
})

const saveScorecardSchema = z.object({
  tenantId: z.string().uuid().optional(),
  matchId: z.string().uuid(),
  inningsId: z.string().uuid(),
  batting: z.array(battingEntrySchema),
  bowling: z.array(bowlingEntrySchema),
})

export type SaveScorecardInput = z.infer<typeof saveScorecardSchema>

async function requireScorecardTenant(permission: "scorecard:read" | "scorecard:create") {
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  return tenantId
}

async function requireScorecardMatch(matchId: string, tenantId: string) {
  const match = await db.query.matches.findFirst({ columns: { id: true, tenantId: true },
    where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)) })
  if (!match || match.id !== matchId || match.tenantId !== tenantId) throw new Error("Match not found")
}

function scopedInnings(column: typeof battingScorecards.inningsId | typeof bowlingScorecards.inningsId,
  matchId: string, tenantId: string) {
  // Defend against legacy rows whose child matchId/tenantId disagree with the
  // referenced innings. A match UUID alone is not proof of the full hierarchy.
  return exists(sql`(SELECT 1 FROM ${matchInnings} WHERE ${and(eq(matchInnings.id, column),
    eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId))})`)
}

// ─── Actions ──────────────────────────────────────────────────

/** @deprecated Record deliveries through scoring-service. A historical import
 * needs an explicit audited/idempotent canonical workflow, not direct inserts.
 * Keep this exported denial stub so old clients cannot revive a second writer.
 */
export const saveScorecard = withAuth("scorecard:create", async (_input: SaveScorecardInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  await requireScorecardTenant("scorecard:create")
  throw new Error("Manual scorecard writes are disabled. Record deliveries through the scoring service; historical corrections require a canonical audited workflow.")
})

export const getFullScorecard = withAuth("scorecard:read", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  const tenantId = await requireScorecardTenant("scorecard:read")
  await requireScorecardMatch(matchId, tenantId)
  const [batting, bowling, fielding] = await Promise.all([
    db.select().from(battingScorecards)
      .where(and(eq(battingScorecards.matchId, matchId), eq(battingScorecards.tenantId, tenantId),
        scopedInnings(battingScorecards.inningsId, matchId, tenantId)))
      .orderBy(asc(battingScorecards.battingPosition)),
    db.select().from(bowlingScorecards)
      .where(and(eq(bowlingScorecards.matchId, matchId), eq(bowlingScorecards.tenantId, tenantId),
        scopedInnings(bowlingScorecards.inningsId, matchId, tenantId)))
      .orderBy(asc(bowlingScorecards.bowlingPosition)),
    db.select().from(fieldingScorecards)
      .where(and(eq(fieldingScorecards.matchId, matchId), eq(fieldingScorecards.tenantId, tenantId))),
  ])
  return { batting, bowling, fielding }
})

export const getInningsScorecard = withAuth("scorecard:read", async (inningsId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(inningsId)
  const tenantId = await requireScorecardTenant("scorecard:read")
  const innings = await db.query.matchInnings.findFirst({ columns: { id: true, tenantId: true, matchId: true },
    where: and(eq(matchInnings.id, inningsId), eq(matchInnings.tenantId, tenantId)) })
  if (!innings || innings.id !== inningsId || innings.tenantId !== tenantId) throw new Error("Innings not found")
  await requireScorecardMatch(innings.matchId, tenantId)
  const [batting, bowling] = await Promise.all([
    db.select().from(battingScorecards)
      .where(and(eq(battingScorecards.inningsId, inningsId), eq(battingScorecards.matchId, innings.matchId),
        eq(battingScorecards.tenantId, tenantId)))
      .orderBy(asc(battingScorecards.battingPosition)),
    db.select().from(bowlingScorecards)
      .where(and(eq(bowlingScorecards.inningsId, inningsId), eq(bowlingScorecards.matchId, innings.matchId),
        eq(bowlingScorecards.tenantId, tenantId)))
      .orderBy(asc(bowlingScorecards.bowlingPosition)),
  ])
  return { batting, bowling }
})
