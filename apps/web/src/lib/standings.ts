/**
 * Competition standings (points table) — rules version 1 (COMP-05).
 *
 * Pure, database-free computation shared by the owner dashboard and the
 * public tournament page. Rule v1:
 *  - A fixture is "played" when its status is `completed` or `no_result`.
 *    Abandoned/scheduled/live fixtures are not yet results and are excluded
 *    (rescheduling is COMP-07).
 *  - Winner: 2 points. No winner (tie or no result): 1 point each. Loser: 0.
 *  - Net run rate follows the cricket convention: (runs scored / balls
 *    faced) − (runs conceded / balls bowled), aggregated across the counted
 *    fixtures. Innings evidence is only aggregated when BOTH sides' innings
 *    rows exist (partial/voided innings must not skew the rate). Teams with
 *    no innings evidence have no NRR and sort last within their points.
 *  - Tie-breakers: points → NRR → wins → name (alphabetical).
 *  - Group-wise standings need a group column on matches, which does not
 *    exist yet; computation is tournament-wide.
 */

export const STANDINGS_RULE_VERSION = 2

export type StandingsTeamInput = {
  id: string
  name: string
  shortName?: string | null
}

export type StandingsMatchInput = {
  matchId: string
  teamAId: string
  teamBId: string
  status: string | null
  winnerId: string | null
  /** Group label for hybrid group stages ("A", "B", ...); null/undefined for knockout or single-group tournaments. */
  groupLabel?: string | null
  /** Innings rows for the fixture; only runs/balls matter here. */
  innings: { teamId: string; runs: number; balls: number }[]
}

export type StandingsRow = {
  ruleVersion: number
  teamId: string
  name: string
  shortName: string
  played: number
  won: number
  lost: number
  noResult: number
  points: number
  runsFor: number
  ballsFor: number
  runsAgainst: number
  ballsAgainst: number
  /** Cricket NRR: runs/balls faced minus runs/balls bowled. */
  netRunRate: number
  /** False until the team has complete innings evidence on both sides. */
  hasNetRunRate: boolean
}

function isPlayedFixture(status: string | null): boolean {
  return status === "completed" || status === "no_result"
}

export function computeStandings(input: {
  teams: StandingsTeamInput[]
  matches: StandingsMatchInput[]
  /** When set, only fixtures carrying this group label are counted (hybrid group stages). */
  group?: string | null
}): StandingsRow[] {
  const rows = new Map<string, StandingsRow>()
  for (const team of input.teams) {
    rows.set(team.id, {
      ruleVersion: STANDINGS_RULE_VERSION,
      teamId: team.id,
      name: team.name,
      shortName: team.shortName || team.name.substring(0, 3).toUpperCase(),
      played: 0, won: 0, lost: 0, noResult: 0, points: 0,
      runsFor: 0, ballsFor: 0, runsAgainst: 0, ballsAgainst: 0,
      netRunRate: 0, hasNetRunRate: false,
    })
  }

  for (const match of input.matches) {
    if (input.group != null && match.groupLabel !== input.group) continue
  if (match.teamAId === match.teamBId) continue // never a valid fixture
    const teamA = rows.get(match.teamAId)
    const teamB = rows.get(match.teamBId)
    if (!teamA || !teamB) continue // ignore cross-tenant/legacy pairings
    if (!isPlayedFixture(match.status)) continue

    teamA.played += 1
    teamB.played += 1
    if (match.winnerId === match.teamAId) {
      teamA.won += 1; teamA.points += 2
      teamB.lost += 1
    } else if (match.winnerId === match.teamBId) {
      teamB.won += 1; teamB.points += 2
      teamA.lost += 1
    } else {
      teamA.noResult += 1; teamA.points += 1
      teamB.noResult += 1; teamB.points += 1
    }

    // NRR evidence: only complete pairs of innings for counted fixtures.
    const inningsA = match.innings.find(inn => inn.teamId === match.teamAId)
    const inningsB = match.innings.find(inn => inn.teamId === match.teamBId)
    if (inningsA && inningsB) {
      const sides = [
        { batting: teamA, bowling: teamB, innings: inningsA },
        { batting: teamB, bowling: teamA, innings: inningsB },
      ]
      for (const side of sides) {
        side.batting.runsFor += side.innings.runs
        side.batting.ballsFor += side.innings.balls
        side.bowling.runsAgainst += side.innings.runs
        side.bowling.ballsAgainst += side.innings.balls
      }
    }
  }

  const standings = [...rows.values()]
  for (const row of standings) {
    row.hasNetRunRate = row.ballsFor > 0 && row.ballsAgainst > 0
    row.netRunRate = row.hasNetRunRate
      ? row.runsFor / row.ballsFor - row.runsAgainst / row.ballsAgainst
      : 0
  }

  return standings.sort((a, b) =>
    b.points - a.points
    || (Number(b.hasNetRunRate) - Number(a.hasNetRunRate))
    || b.netRunRate - a.netRunRate
    || b.won - a.won
    || a.name.localeCompare(b.name))
}

/** Broadcast convention: signed, three decimals; exactly zero stays unsigned. */
export function formatNetRunRate(value: number): string {
  if (value === 0) return "0.000"
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}`
}
