import { NextRequest, NextResponse } from "next/server"
import { db, matches, teams, matchInnings, players, battingScorecards, bowlingScorecards, venues } from "@mtk/database"
import { eq, and, asc, inArray } from "drizzle-orm"
import { getPublicTenantContext } from "@/lib/public-tenant"

/**
 * GET /api/scorecards/[matchId]/pdf
 *
 * Returns a print-optimised HTML page for the match scorecard.
 * Opening in a new tab + browser print → Save as PDF gives a professional PDF
 * without adding puppeteer or @react-pdf/renderer dependencies.
 *
 * Tenant-scoped: resolves tenant from the request host (same mechanism as the
 * public scorecard page). A cross-tenant matchId returns 404, not the scorecard.
 * No auth required — this is the same data as the public scorecard page.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params

  // Tenant scope — fail closed if no tenant can be resolved
  const ctx = await getPublicTenantContext()
  if (!ctx) {
    return new NextResponse("Not Found", { status: 404 })
  }
  const { tenantId } = ctx

  // Load match (tenant-scoped)
  const [match] = await db.select().from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1)
  if (!match) return new NextResponse("Not Found", { status: 404 })

  // Load supporting data
  const [teamA, teamB] = await Promise.all([
    db.select({ id: teams.id, name: teams.name, shortName: teams.shortName })
      .from(teams).where(and(eq(teams.id, match.teamAId), eq(teams.tenantId, tenantId))).limit(1),
    db.select({ id: teams.id, name: teams.name, shortName: teams.shortName })
      .from(teams).where(and(eq(teams.id, match.teamBId), eq(teams.tenantId, tenantId))).limit(1),
  ])
  if (!teamA[0] || !teamB[0]) return new NextResponse("Not Found", { status: 404 })

  let venueName = "TBD"
  if (match.venueId) {
    const [v] = await db.select({ name: venues.name, city: venues.city })
      .from(venues).where(and(eq(venues.id, match.venueId), eq(venues.tenantId, tenantId))).limit(1)
    if (v) venueName = `${v.name}, ${v.city}`
  }

  const innings = await db.select().from(matchInnings)
    .where(and(eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId)))
    .orderBy(asc(matchInnings.inningsNumber))

  const [battingAll, bowlingAll] = await Promise.all([
    db.select().from(battingScorecards)
      .where(and(eq(battingScorecards.matchId, matchId), eq(battingScorecards.tenantId, tenantId)))
      .orderBy(asc(battingScorecards.battingPosition)),
    db.select().from(bowlingScorecards)
      .where(and(eq(bowlingScorecards.matchId, matchId), eq(bowlingScorecards.tenantId, tenantId)))
      .orderBy(asc(bowlingScorecards.bowlingPosition)),
  ])

  // Resolve player names
  const playerIds = Array.from(new Set([
    ...battingAll.map(b => b.playerId),
    ...battingAll.map(b => b.bowlerId).filter((x): x is string => !!x),
    ...battingAll.map(b => b.fielderId).filter((x): x is string => !!x),
    ...bowlingAll.map(b => b.playerId),
  ]))
  const playerRows = playerIds.length
    ? await db.select({ id: players.id, name: players.name })
        .from(players).where(and(inArray(players.id, playerIds), eq(players.tenantId, tenantId)))
    : []
  const nameById = new Map(playerRows.map(p => [p.id, p.name]))

  // Team name lookup
  const teamNameById = new Map([
    [teamA[0].id, teamA[0].name],
    [teamB[0].id, teamB[0].name],
  ])

  function dismissal(b: typeof battingAll[0]): string {
    if (b.dismissalType === "not_out") return "not out"
    if (b.dismissalType === "bowled") return `b ${nameById.get(b.bowlerId ?? "") ?? ""}`
    if (b.dismissalType === "caught") {
      const fielder = nameById.get(b.fielderId ?? "") ?? ""
      const bowler = nameById.get(b.bowlerId ?? "") ?? ""
      return fielder ? `c ${fielder} b ${bowler}` : `c & b ${bowler}`
    }
    if (b.dismissalType === "caught_and_bowled") return `c & b ${nameById.get(b.bowlerId ?? "") ?? ""}`
    if (b.dismissalType === "lbw") return `lbw b ${nameById.get(b.bowlerId ?? "") ?? ""}`
    if (b.dismissalType === "run_out") return `run out (${nameById.get(b.fielderId ?? "") ?? ""})`
    if (b.dismissalType === "stumped") return `st ${nameById.get(b.fielderId ?? "") ?? ""} b ${nameById.get(b.bowlerId ?? "") ?? ""}`
    return b.dismissalText ?? b.dismissalType ?? "out"
  }

  function sr(runs: number, balls: number): string {
    return balls > 0 ? ((runs / balls) * 100).toFixed(1) : "0.0"
  }
  function eco(runs: number, balls: number): string {
    return balls > 0 ? ((runs / balls) * 6).toFixed(2) : "0.00"
  }
  function oversDisplay(balls: number): string {
    return `${Math.floor(balls / 6)}.${balls % 6}`
  }

  // Build innings HTML sections
  let inningsHtml = ""
  for (const inn of innings) {
    const battingTeamName = teamNameById.get(inn.teamId) ?? "Batting Team"
    const bowling = bowlingAll.filter(b => b.inningsId === inn.id)
    const batting = battingAll.filter(b => b.inningsId === inn.id)
    const extras = (inn.extras as number | null) ?? 0
    const totalRuns = (inn.totalRuns as number | null) ?? 0
    const totalWickets = (inn.totalWickets as number | null) ?? 0
    const totalBalls = (inn.totalBalls as number | null) ?? 0

    const battingRows = batting.map(b => `
      <tr>
        <td>${nameById.get(b.playerId) ?? b.playerId}</td>
        <td class="dimmed">${dismissal(b)}</td>
        <td class="num">${b.runs}</td>
        <td class="num">${b.ballsFaced}</td>
        <td class="num">${b.fours}</td>
        <td class="num">${b.sixes}</td>
        <td class="num">${sr(b.runs, b.ballsFaced)}</td>
      </tr>`).join("")

    const bowlingRows = bowling.map(b => `
      <tr>
        <td>${nameById.get(b.playerId) ?? b.playerId}</td>
        <td class="num">${oversDisplay(b.ballsBowled)}</td>
        <td class="num">${b.maidens}</td>
        <td class="num">${b.runsConceded}</td>
        <td class="num">${b.wickets}</td>
        <td class="num">${b.wides}</td>
        <td class="num">${b.noBalls}</td>
        <td class="num">${eco(b.runsConceded, b.ballsBowled)}</td>
      </tr>`).join("")

    inningsHtml += `
      <section class="innings">
        <h2>${battingTeamName} Innings &mdash; ${totalRuns}/${totalWickets} (${oversDisplay(totalBalls)} ov)</h2>
        <table>
          <thead>
            <tr>
              <th>Batsman</th><th>Dismissal</th>
              <th class="num">R</th><th class="num">B</th>
              <th class="num">4s</th><th class="num">6s</th>
              <th class="num">SR</th>
            </tr>
          </thead>
          <tbody>${battingRows || '<tr><td colspan="7" class="dimmed">No batting data recorded</td></tr>'}</tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="2">Extras</td>
              <td class="num" colspan="5">${extras}</td>
            </tr>
            <tr class="total-row">
              <td colspan="2"><strong>Total</strong></td>
              <td class="num" colspan="5"><strong>${totalRuns}/${totalWickets} (${oversDisplay(totalBalls)} ov)</strong></td>
            </tr>
          </tfoot>
        </table>
        <h3>Bowling</h3>
        <table>
          <thead>
            <tr>
              <th>Bowler</th>
              <th class="num">O</th><th class="num">M</th>
              <th class="num">R</th><th class="num">W</th>
              <th class="num">Wd</th><th class="num">Nb</th>
              <th class="num">Econ</th>
            </tr>
          </thead>
          <tbody>${bowlingRows || '<tr><td colspan="8" class="dimmed">No bowling data recorded</td></tr>'}</tbody>
        </table>
      </section>`
  }

  const matchDate = match.scheduledDate
    ? new Date(match.scheduledDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "Date TBD"

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Scorecard &mdash; ${teamA[0].name} vs ${teamB[0].name}</title>
  <style>
    /* --- Base --- */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
      color: #1a1a2e;
      background: #fff;
      padding: 24px 32px;
      max-width: 960px;
      margin: 0 auto;
    }

    /* --- Header --- */
    .match-header {
      border-bottom: 3px solid #1a1a2e;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .match-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .match-meta {
      font-size: 12px;
      color: #555;
      margin-top: 4px;
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .result-banner {
      margin-top: 10px;
      background: #1a1a2e;
      color: #fff;
      padding: 6px 12px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 13px;
      display: inline-block;
    }

    /* --- Innings section --- */
    .innings {
      margin-bottom: 32px;
      page-break-inside: avoid;
    }
    .innings h2 {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 8px;
      padding: 6px 10px;
      background: #f0f0f5;
      border-left: 4px solid #1a1a2e;
    }
    .innings h3 {
      font-size: 13px;
      font-weight: 600;
      margin: 14px 0 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #555;
    }

    /* --- Tables --- */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th {
      background: #1a1a2e;
      color: #fff;
      padding: 5px 8px;
      text-align: left;
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.3px;
    }
    td {
      padding: 5px 8px;
      border-bottom: 1px solid #eee;
    }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #fafafa; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .dimmed { color: #777; }
    .total-row td {
      background: #f0f0f5 !important;
      font-weight: 600;
    }

    /* --- Footer --- */
    .pdf-footer {
      margin-top: 32px;
      border-top: 1px solid #ddd;
      padding-top: 8px;
      font-size: 11px;
      color: #999;
      display: flex;
      justify-content: space-between;
    }

    /* --- Print --- */
    @media print {
      body { padding: 0; font-size: 11px; }
      .no-print { display: none !important; }
      .innings { page-break-inside: avoid; }
      .match-header { border-bottom-width: 2px; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="background:#fef3c7;border:1px solid #d97706;padding:10px 16px;border-radius:6px;margin-bottom:20px;font-size:13px;">
    📄 <strong>Print this page</strong> (Ctrl+P / ⌘P) and select <em>"Save as PDF"</em> to export.
    <button onclick="window.print()" style="margin-left:12px;padding:4px 12px;background:#1a1a2e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
      Print / Save PDF
    </button>
  </div>

  <div class="match-header">
    <div class="match-title">${teamA[0].name} vs ${teamB[0].name}</div>
    <div class="match-meta">
      <span>📅 ${matchDate}</span>
      <span>📍 ${venueName}</span>
      <span>🏏 ${match.matchFormat?.toUpperCase() ?? "T20"} &mdash; ${match.totalOvers} overs</span>
      ${match.tossWinnerId ? `<span>🪙 Toss: ${teamNameById.get(match.tossWinnerId) ?? ""} elected to ${match.tossDecision ?? ""}</span>` : ""}
    </div>
    ${match.result ? `<div class="result-banner">🏆 ${match.result}</div>` : ""}
  </div>

  ${inningsHtml || "<p>No innings data available yet.</p>"}

  <div class="pdf-footer">
    <span>Shakir Super League &mdash; Official Scorecard</span>
    <span>Generated ${new Date().toLocaleString("en-GB")}</span>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Allow browsers to cache for 60 s so repeated opens don't re-query
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  })
}
