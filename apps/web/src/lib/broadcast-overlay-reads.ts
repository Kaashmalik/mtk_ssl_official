import {
  db, matches, matchBalls, matchInnings, players, teams, tenantBranding, tenants, tournaments,
} from "@mtk/database"
import { and, asc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import {
  buildBroadcastOverlaySnapshot,
  type BroadcastOverlaySnapshot,
} from "@mtk/contracts"
import { isMatchPublished, isTournamentPublished } from "@/lib/public-visibility"

/**
 * ENH-09-01: read-only OBS snapshot.
 *
 * Publication is rechecked on every poll: an unpublished match, a draft
 * tournament or an inactive league returns null immediately. The query returns
 * only public allowlisted fields - no contact data, credentials, stream keys or
 * provider metadata. Balls are bounded so a long archive cannot turn the
 * overlay poll into an unbounded scan.
 */

const MAX_OVERLAY_BALLS = 1_000

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
  const ballRows = currentInnings
    ? await db
      .select({
        inningsNumber: matchInnings.inningsNumber,
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
  return buildBroadcastOverlaySnapshot({
    match: {
      id: match.id,
      tenantId: match.tenantId,
      status: match.status,
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
  })
}
