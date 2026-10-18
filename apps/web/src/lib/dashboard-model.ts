import { hasPermission, type Permission, type UserRole } from "./rbac"

export type DashboardAction = { label: string; description: string; href: string; permission: Permission }
const creationActions: DashboardAction[] = [
  { label: "Create tournament", description: "Choose a format and save your competition settings", href: "/dashboard/tournaments/new", permission: "tournament:create" },
  { label: "Add team", description: "Bring a team into your league", href: "/dashboard/teams/new", permission: "team:create" },
  { label: "Add player", description: "Create a player profile for your roster", href: "/dashboard/players/new", permission: "player:create" },
  { label: "Schedule match", description: "Set up your next fixture", href: "/dashboard/matches/new", permission: "match:create" },
]

export function getDashboardActions(role: UserRole): DashboardAction[] {
  const actions = creationActions.filter((action) => hasPermission(role, action.permission))
  if (actions.length) return actions
  const browseActions: DashboardAction[] = [
    { label: "Browse matches", description: role === "scorer" ? "Open an assigned match below to score" : "Follow fixtures and match results", href: "/dashboard/matches", permission: "match:read" },
    { label: "View teams", description: "Explore your league's teams and rosters", href: "/dashboard/teams", permission: "team:read" },
  ]
  return browseActions.filter((action) => hasPermission(role, action.permission))
}

export type DashboardStats = { teams: number; players: number; tournaments: number; matches: number }
export function getSetupSteps(stats: DashboardStats) {
  return [
    { label: "Create your first tournament", href: "/dashboard/tournaments/new", done: stats.tournaments > 0 },
    { label: "Add at least two active teams", href: "/dashboard/teams/new", done: stats.teams >= 2 },
    { label: "Add an active player", href: "/dashboard/players/new", done: stats.players > 0 },
    { label: "Schedule your first match", href: "/dashboard/matches/new", done: stats.matches > 0 },
  ]
}

type MatchSummary = { id: string; tenantId: string; teamAId: string; teamBId: string; status: string;
  scorerId: string | null; backupScorerId?: string | null; umpire1Id?: string | null; umpire2Id?: string | null;
  scheduledDate: Date | null; updatedAt: Date; result: string | null }
type InningsSummary = { matchId: string; tenantId: string; teamId: string; inningsNumber: number;
  totalRuns: number; totalWickets: number; totalBalls: number }
export function toDashboardMatch(match: MatchSummary, names: Map<string, string>, innings: InningsSummary[], tenantId: string) {
  const ownInnings = innings.filter((i) => i.matchId === match.id && i.tenantId === tenantId &&
    (i.teamId === match.teamAId || i.teamId === match.teamBId))
  const latestForTeam = (teamId: string) => ownInnings.filter((i) => i.teamId === teamId)
    .sort((a, b) => b.inningsNumber - a.inningsNumber)[0]
  const score = (teamId: string) => {
    const i = latestForTeam(teamId)
    return i ? `${i.totalRuns}/${i.totalWickets} (${Math.floor(i.totalBalls / 6)}.${i.totalBalls % 6})${i.inningsNumber > 2 ? " · Super over" : ""}` : "Yet to bat"
  }
  return { id: match.id, teamA: names.get(match.teamAId) ?? "Team unavailable",
    teamB: names.get(match.teamBId) ?? "Team unavailable", scoreA: score(match.teamAId), scoreB: score(match.teamBId),
    status: match.status, scorerId: match.scorerId, backupScorerId: match.backupScorerId ?? null,
    umpire1Id: match.umpire1Id ?? null, umpire2Id: match.umpire2Id ?? null, scheduledDate: match.scheduledDate,
    updatedAt: match.updatedAt, result: match.result }
}
export type DashboardMatch = ReturnType<typeof toDashboardMatch>

/**
 * UX-03 officiating journey: what the member's assignment on this match is.
 * Mirrors the read predicate in dashboard-data (same four slots). A null
 * result means the member holds no assignment slot on the match.
 */
export function dashboardAssignmentLabel(
  match: Pick<DashboardMatch, "scorerId" | "backupScorerId" | "umpire1Id" | "umpire2Id">,
  actorId: string,
): "Scorer" | "Backup scorer" | "Officiating" | null {
  if (match.scorerId === actorId) return "Scorer"
  if (match.backupScorerId === actorId) return "Backup scorer"
  if (match.umpire1Id === actorId || match.umpire2Id === actorId) return "Officiating"
  return null
}

export function matchDashboardHref(match: Pick<DashboardMatch, "id" | "scorerId" | "status"> & { backupScorerId?: string | null }, role: UserRole, actorId: string) {
  const editable = ["scheduled", "toss", "live", "innings_break"].includes(match.status)
  const assigned = role === "league_owner" || (role === "scorer" && (match.scorerId === actorId || match.backupScorerId === actorId))
  return editable && assigned && hasPermission(role, "match:score")
    ? `/matches/${match.id}/scoring` : `/matches/${match.id}`
}

/** No user timezone is configured yet: never imply the server's timezone is theirs. */
export function formatDashboardDate(date: Date | null) {
  if (!date || !Number.isFinite(date.getTime())) return "Time to be confirmed"
  return `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`
}
