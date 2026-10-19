import { NextResponse } from "next/server"
import { db, teams, matchInnings, players, battingScorecards, bowlingScorecards } from "@mtk/database"
import { eq, and, asc, inArray } from "drizzle-orm"
import { deriveMatchRecap, type MatchRecap } from "@mtk/database/lib/match-recap"
import { applyMinorNameGate } from "@mtk/database/lib/minor-consent-policy"
import { getPublicTenantContext } from "@/lib/public-tenant"
import { readPublishedMatch } from "@/lib/public-visibility"
import { generateMatchSummaryAi, matchSummaryAiReady } from "@/lib/match-summary-ai"

export const dynamic = "force-dynamic"

/**
 * FAN-04 (B163): GET /api/matches/[matchId]/ai-summary
 *
 * The gated, labeled AI match summary. Mirrors the PDF export's fail-closed
 * discipline: no resolvable public tenant, unpublished/foreign match, or
 * missing teams -> 404 before any other read; explicit columns only (this
 * route is unauthenticated); identities pass the same minor-name gate.
 *
 * Feature gating: when MATCH_SUMMARY_AI_READY is not enabled, the route 404s
 * - an unbuilt feature must not pretend to exist even as an empty response.
 * When enabled, the model receives ONLY deriveMatchRecap's fold of the
 * official rows and NEVER names a winner beyond the echoed result; a
 * provider failure serves the deterministic recap line, honestly labeled
 * "derived". Nothing here ever mutates official records.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  if (!matchSummaryAiReady()) return new NextResponse("Not Found", { status: 404 })

  const { matchId } = await params
  if (!matchId) return new NextResponse("Not Found", { status: 404 })

  const ctx = await getPublicTenantContext()
  if (!ctx?.tenantId) return new NextResponse("Not Found", { status: 404 })
  const tenantId = ctx.tenantId

  const match = await readPublishedMatch(tenantId, matchId)
  if (!match) return new NextResponse("Not Found", { status: 404 })

  const [teamA, teamB] = await Promise.all([
    db.select({ id: teams.id, name: teams.name })
      .from(teams).where(and(eq(teams.id, match.teamAId), eq(teams.tenantId, tenantId))).limit(1),
    db.select({ id: teams.id, name: teams.name })
      .from(teams).where(and(eq(teams.id, match.teamBId), eq(teams.tenantId, tenantId))).limit(1),
  ])
  if (!teamA[0] || !teamB[0]) return new NextResponse("Not Found", { status: 404 })

  // Explicit columns only (PUB-06): this route is unauthenticated.
  const innings = await db.select({
    id: matchInnings.id,
    teamId: matchInnings.teamId,
    totalRuns: matchInnings.totalRuns,
    totalBalls: matchInnings.totalBalls,
    totalWickets: matchInnings.totalWickets,
  }).from(matchInnings)
    .where(and(eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId)))
    .orderBy(asc(matchInnings.inningsNumber))
  if (innings.length === 0) {
    return NextResponse.json({ summary: null, source: "derived" }, {
      status: 200,
      headers: { "Cache-Control": "public, max-age=600" },
    })
  }

  const [battingAll, bowlingAll] = await Promise.all([
    db.select({
      inningsId: battingScorecards.inningsId,
      playerId: battingScorecards.playerId,
      runs: battingScorecards.runs,
      ballsFaced: battingScorecards.ballsFaced,
    }).from(battingScorecards)
      .where(and(eq(battingScorecards.matchId, matchId), eq(battingScorecards.tenantId, tenantId))),
    db.select({
      inningsId: bowlingScorecards.inningsId,
      playerId: bowlingScorecards.playerId,
      runsConceded: bowlingScorecards.runsConceded,
      wickets: bowlingScorecards.wickets,
      ballsBowled: bowlingScorecards.ballsBowled,
    }).from(bowlingScorecards)
      .where(and(eq(bowlingScorecards.matchId, matchId), eq(bowlingScorecards.tenantId, tenantId))),
  ])

  const playerIds = Array.from(new Set([
    ...battingAll.map((b) => b.playerId),
    ...bowlingAll.map((b) => b.playerId),
  ]))
  const playerRows = playerIds.length
    ? await db.select({ id: players.id, name: players.name, dateOfBirth: players.dateOfBirth, guardianConsentAt: players.guardianConsentAt })
        .from(players).where(and(inArray(players.id, playerIds), eq(players.tenantId, tenantId)))
    : []
  // The summary is public content: identities pass the same minor-name gate
  // as the public scorecard (B133), no exceptions for AI phrasing.
  const nameById = applyMinorNameGate(playerRows)
  const teamNameById = new Map([
    [teamA[0].id, teamA[0].name],
    [teamB[0].id, teamB[0].name],
  ])
  // MatchRecapInputInnings.overs is the official scorecard notation
  // (4.2 = four overs, two balls) - a float would fabricate precisely the
  // kind of "fact" FAN-04 forbids.
  const oversNotation = (balls: number | null): number =>
    Number(`${Math.floor((balls ?? 0) / 6)}.${(balls ?? 0) % 6}`) || 0

  const recap: MatchRecap | null = deriveMatchRecap({
    resultText: match.result ?? "",
    manOfMatchName: match.manOfMatchId ? (nameById.get(match.manOfMatchId) ?? null) : null,
    innings: innings.map((inn) => ({
      teamName: teamNameById.get(inn.teamId) ?? "Batting Team",
      totalRuns: inn.totalRuns ?? 0,
      totalWickets: inn.totalWickets ?? 0,
      totalBalls: inn.totalBalls ?? 0,
      batting: battingAll.filter((b) => b.inningsId === inn.id)
        .map((b) => ({ name: nameById.get(b.playerId) ?? "", runs: b.runs ?? 0, balls: b.ballsFaced ?? 0 })),
      bowling: bowlingAll.filter((b) => b.inningsId === inn.id)
        .map((b) => ({ name: nameById.get(b.playerId) ?? "", wickets: b.wickets ?? 0, runs: b.runsConceded ?? 0, overs: oversNotation(b.ballsBowled) })),
    })),
  })

  if (!recap) {
    return NextResponse.json({ summary: null, source: "derived" }, {
      status: 200,
      headers: { "Cache-Control": "public, max-age=600" },
    })
  }

  const attempted = await generateMatchSummaryAi(recap)
  const payload = attempted.text
    ? { summary: attempted.text, source: "ai" }
    : { summary: recap.summary, source: "derived" }

  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "public, max-age=600" },
  })
}
