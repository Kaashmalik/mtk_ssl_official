import {
  db, battingScorecards, bowlingScorecards, fieldingScorecards, matches, matchInnings,
} from "@mtk/database"
import { eq, asc, and, exists, sql } from "drizzle-orm"

/**
 * Scorecard reads. Every function is predicated on an explicit, caller-resolved
 * `tenantId` — the same active-league scoping contract as the other lib
 * readers (player-id-cards, fan-follows, venue-reads). No writes live here:
 * deliveries are recorded through scoring-service and the manual writer is a
 * disabled denial stub in the action module.
 */

/** The parent match must exist in the exact league before child rows are read. */
export async function requireScorecardMatch(matchId: string, tenantId: string): Promise<void> {
  const match = await db.query.matches.findFirst({ columns: { id: true, tenantId: true },
    where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)) })
  if (!match || match.id !== matchId || match.tenantId !== tenantId) throw new Error("Match not found")
}

/** An innings in the exact league, re-checked field-by-field against legacy rows. */
export async function findScopedInnings(inningsId: string, tenantId: string) {
  const innings = await db.query.matchInnings.findFirst({ columns: { id: true, tenantId: true, matchId: true },
    where: and(eq(matchInnings.id, inningsId), eq(matchInnings.tenantId, tenantId)) })
  if (!innings || innings.id !== inningsId || innings.tenantId !== tenantId) throw new Error("Innings not found")
  return innings
}

function scopedInnings(
  column: typeof battingScorecards.inningsId | typeof bowlingScorecards.inningsId,
  matchId: string,
  tenantId: string,
) {
  // Defend against legacy rows whose child matchId/tenantId disagree with the
  // referenced innings. A match UUID alone is not proof of the full hierarchy.
  return exists(sql`(SELECT 1 FROM ${matchInnings} WHERE ${and(eq(matchInnings.id, column),
    eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId))})`)
}

/** Batting/bowling/fielding rows for a whole match, correlated to its exact-tenant innings. */
export async function readMatchScorecards(matchId: string, tenantId: string) {
  return Promise.all([
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
  ]).then(([batting, bowling, fielding]) => ({ batting, bowling, fielding }))
}

/** Batting/bowling rows for one innings, bound to both its match and league keys. */
export async function readInningsScorecards(inningsId: string, matchId: string, tenantId: string) {
  return Promise.all([
    db.select().from(battingScorecards)
      .where(and(eq(battingScorecards.inningsId, inningsId), eq(battingScorecards.matchId, matchId),
        eq(battingScorecards.tenantId, tenantId)))
      .orderBy(asc(battingScorecards.battingPosition)),
    db.select().from(bowlingScorecards)
      .where(and(eq(bowlingScorecards.inningsId, inningsId), eq(bowlingScorecards.matchId, matchId),
        eq(bowlingScorecards.tenantId, tenantId)))
      .orderBy(asc(bowlingScorecards.bowlingPosition)),
  ]).then(([batting, bowling]) => ({ batting, bowling }))
}
