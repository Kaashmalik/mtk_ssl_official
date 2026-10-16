import { db, teams, matches } from "@mtk/database"
import { and, eq, inArray, or } from "drizzle-orm"

/**
 * League-scoped member assignment records. Both reads are predicated on an
 * explicit, caller-resolved `tenantId` — the same active-league scoping contract
 * as the other lib readers (member-management, venue-reads, player-id-cards).
 *
 * These are the same operational assignments `removeLeagueMember` refuses to
 * orphan (a managed team, a primary/backup scoring slot). Surfacing them lets an
 * owner see *why* a removal is blocked and what to unassign first.
 */

export interface MemberScoringMatch {
  id: string
  matchNumber: number | null
  status: string
  scheduledDate: Date | null
  role: "scorer" | "backup"
}

export interface MemberAssignments {
  managedTeamNames: string[]
  scoringMatches: MemberScoringMatch[]
}

/** Keyed by the member's account id (`users.id`), matching the roster read. */
export type MemberAssignmentMap = Record<string, MemberAssignments>

/** Hard bound on each assignment read (matches are heavier than teams). */
export const memberAssignmentLimit = 200

export async function readMemberAssignments(
  tenantId: string,
  userIds: string[],
): Promise<MemberAssignmentMap> {
  const ids = [...new Set(userIds.filter((id) => Boolean(id)))]
  const map: MemberAssignmentMap = {}
  for (const id of ids) map[id] = { managedTeamNames: [], scoringMatches: [] }
  // `inArray([])` is invalid SQL; nothing to read when the league has no members.
  if (ids.length === 0) return map

  const [teamRows, matchRows] = await Promise.all([
    db.select({ managerId: teams.managerId, name: teams.name }).from(teams)
      .where(and(eq(teams.tenantId, tenantId), inArray(teams.managerId, ids)))
      .limit(memberAssignmentLimit),
    db.select({
      id: matches.id, matchNumber: matches.matchNumber, status: matches.status,
      scheduledDate: matches.scheduledDate, scorerId: matches.scorerId, backupScorerId: matches.backupScorerId,
    }).from(matches)
      .where(and(eq(matches.tenantId, tenantId),
        or(inArray(matches.scorerId, ids), inArray(matches.backupScorerId, ids))))
      .limit(memberAssignmentLimit),
  ])

  for (const team of teamRows) {
    if (team.managerId && map[team.managerId]) map[team.managerId].managedTeamNames.push(team.name)
  }
  for (const match of matchRows) {
    const base = { id: match.id, matchNumber: match.matchNumber, status: match.status, scheduledDate: match.scheduledDate }
    if (match.scorerId && map[match.scorerId]) map[match.scorerId].scoringMatches.push({ ...base, role: "scorer" })
    if (match.backupScorerId && match.backupScorerId !== match.scorerId && map[match.backupScorerId]) {
      map[match.backupScorerId].scoringMatches.push({ ...base, role: "backup" })
    }
  }
  return map
}
