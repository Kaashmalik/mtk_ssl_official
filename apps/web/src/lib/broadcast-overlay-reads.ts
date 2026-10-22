import {
  db, matches, matchBalls, matchInnings, players, teams, tenantBranding, tenants, tournaments,
} from "@mtk/database"
import { and, asc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import {
  buildBroadcastOverlaySnapshot,
  type BroadcastOverlaySnapshot,
} from "@mtk/contracts"
import { foldScoringParticipants } from "@mtk/database/lib/scoring-participants"
import { isMatchPublished, isTournamentPublished } from "@/lib/public-visibility"

/**
 * ENH-09-01: read-only OBS snapshot.
 *
 * Publication is rechecked on every poll: an unpublished match, a draft
 * tournament or an inactive league returns null immediately. The query returns
 * only public allowlisted fields - no contact data, credentials, stream keys or
 * provider metadata. Balls are bounded so a long archive cannot turn the
 * overlay poll into an unbounded scan.
 *
 * Batch 100 (ENH-09-02): when SCORING_PARTICIPANTS_READY is on in this
 * environment (migration 20261022120000 applied), the SAME shared fold the
 * scoring service uses inside its recording transaction runs here over the
 * current innings' official delivery log, and the canonical
 * striker/non-striker/bowler projection rides the snapshot under
 * `current.participants`. The OBS page still derives nothing itself. With
 * the flag off the extra attribution column is never referenced (it may not
 * exist yet) and the snapshot is byte-for-byte the aggregate-only shape.
 */

const MAX_OVERLAY_BALLS = 1_000

/** Batch 100: the attribution columns and the confirmed-participant fold
 *  exist only where migration 20261022120000 has been applied AND the
 *  operator turned the gate on. Default off = legacy behaviour. */
function participantsReady(): boolean {
  return process.env.SCORING_PARTICIPANTS_READY === "true"
}

export async function readBroadcastOverlaySnapshot(input: {
  tenantId: string
  matchId: string
}): Promise<BroadcastOverlaySnapshot | null> {
  const tenantId = z.string().uuid().parse(input.tenantId)
  const matchId = z.string().uuid().parse(input.matchId)

  const [match] = await db
    .select({
      id: matches.id,
      tenantId: matches.tenantId,
      status: matches.status,
      scoringRevision: matches.scoringRevision,
      updatedAt: matches.updatedAt,
      totalOvers: matches.totalOvers,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      tournamentId: matches.tournamentId,
      tenantActive: tenants.isActive,
      tenantName: tenants.name,
    })
    .from(matches)
    .innerJoin(tenants, eq(tenants.id, matches.tenantId))
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1)
  if (!match || match.tenantActive !== true || !isMatchPublished(match.status)) return null

  if (match.tournamentId) {
    const [parent] = await db
      .select({ status: tournaments.status })
      .from(tournaments)
      .where(and(eq(tournaments.id, match.tournamentId), eq(tournaments.tenantId, tenantId)))
      .limit(1)
    if (!parent || !isTournamentPublished(parent.status)) return null
  }

  const [innings, teamRows, branding] = await Promise.all([
    db
      .select({
        inningsNumber: matchInnings.inningsNumber,
        id: matchInnings.id,
        teamId: matchInnings.teamId,
        totalRuns: matchInnings.totalRuns,
        totalWickets: matchInnings.totalWickets,
        totalBalls: matchInnings.totalBalls,
      })
      .from(matchInnings)
      .where(and(eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId)))
      .orderBy(asc(matchInnings.inningsNumber)),
    db
      .select({ id: teams.id, name: teams.name, logoUrl: teams.logoUrl })
      .from(teams)
      .where(and(
        inArray(teams.id, [match.teamAId, match.teamBId]),
        eq(teams.tenantId, tenantId),
      )),
    db
      .select({
        logoUrl: tenantBranding.logoUrl,
        primaryColor: tenantBranding.primaryColor,
        secondaryColor: tenantBranding.secondaryColor,
        appName: tenantBranding.appName,
      })
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, tenantId))
      .limit(1),
  ])

  const currentInnings = innings.at(-1)
  const ready = participantsReady()
  const ballRows = currentInnings
    ? await db
      .select({
        id: matchBalls.id,
        inningsNumber: matchInnings.inningsNumber,
        ballSequence: matchBalls.ballSequence,
        overNumber: matchBalls.overNumber,
        ballNumber: matchBalls.ballNumber,
        runs: matchBalls.runs,
        isWicket: matchBalls.isWicket,
        isWide: matchBalls.isWide,
        isNoBall: matchBalls.isNoBall,
        isBye: matchBalls.isBye,
        isLegBye: matchBalls.isLegBye,
        isFour: matchBalls.isFour,
        isSix: matchBalls.isSix,
        batsmanId: matchBalls.batsmanId,
        bowlerId: matchBalls.bowlerId,
        wicketType: matchBalls.wicketType,
        ...(ready ? { wicketPlayerOutId: matchBalls.wicketPlayerOutId } : {}),
      })
      .from(matchBalls)
      .innerJoin(matchInnings, eq(matchInnings.id, matchBalls.inningsId))
      .where(and(
        eq(matchBalls.matchId, matchId),
        eq(matchBalls.tenantId, tenantId),
        eq(matchBalls.inningsId, currentInnings.id),
      ))
      .orderBy(asc(matchBalls.ballSequence))
      .limit(MAX_OVERLAY_BALLS)
    : []

  const participantIds = [...new Set(
    ballRows.flatMap(ball => [ball.batsmanId, ball.bowlerId]).filter((id): id is string => !!id),
  )]
  const playerRows = participantIds.length > 0
    ? await db
      .select({ id: players.id, name: players.name })
      .from(players)
      .where(and(
        inArray(players.id, participantIds),
        eq(players.tenantId, tenantId),
      ))
    : []

  const brand = branding[0]
  // Batch 100: the shared canonical fold over the same official rows. The
  // cast keeps the flagged-off select shape (no attribution column) valid;
  // `ready` guarantees the column was selected whenever the fold runs.
  const participants = ready
    ? foldScoringParticipants(ballRows.map(ball => ({
      ballSequence: ball.ballSequence,
      overNumber: ball.overNumber,
      ballNumber: ball.ballNumber,
      batsmanId: ball.batsmanId,
      bowlerId: ball.bowlerId,
      runs: ball.runs,
      isWide: ball.isWide,
      isNoBall: ball.isNoBall,
      isBye: ball.isBye,
      isLegBye: ball.isLegBye,
      isWicket: ball.isWicket,
      wicketType: ball.wicketType,
      wicketPlayerOutId: (ball as { wicketPlayerOutId?: string | null }).wicketPlayerOutId ?? null,
    })))
    : null
  return buildBroadcastOverlaySnapshot({
    match: {
      id: match.id,
      tenantId: match.tenantId,
      status: match.status,
      scoringRevision: match.scoringRevision,
      updatedAt: match.updatedAt.toISOString(),
      totalOvers: match.totalOvers ?? 20,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
    },
    teams: teamRows,
    innings,
    balls: ballRows,
    players: playerRows,
    branding: {
      name: brand?.appName?.trim() || match.tenantName,
      logoUrl: brand?.logoUrl ?? null,
      primaryColor: brand?.primaryColor ?? null,
      secondaryColor: brand?.secondaryColor ?? null,
    },
    participants,
  })
}
