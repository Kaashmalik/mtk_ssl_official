import { db, teams, matches } from "@mtk/database"
import { and, eq, inArray, or } from "drizzle-orm"
import { z } from "zod"

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
  managedTeams: { id: string; name: string }[]
  scoringMatches: MemberScoringMatch[]
  /** False for every member when either league-wide read was truncated. */
  isComplete: boolean
}

/** Keyed by the member's account id (`users.id`), matching the roster read. */
export type MemberAssignmentMap = Record<string, MemberAssignments>

/** Maximum listed resources per kind; queries fetch one extra detection row. */
export const memberAssignmentLimit = 200

export async function readMemberAssignments(
  tenantId: string,
  userIds: string[],
): Promise<MemberAssignmentMap> {
  z.string().uuid().parse(tenantId)
  const ids = [...new Set(z.array(z.string().uuid()).max(100).parse(userIds))]
  const map: MemberAssignmentMap = {}
  for (const id of ids) map[id] = { managedTeams: [], scoringMatches: [], isComplete: true }
  // Avoid unnecessary reads when the league has no loaded members.
  if (ids.length === 0) return map

  const [teamRows, matchRows] = await Promise.all([
    db.select({ id: teams.id, managerId: teams.managerId, name: teams.name }).from(teams)
      .where(and(eq(teams.tenantId, tenantId), inArray(teams.managerId, ids)))
      .orderBy(teams.id)
      .limit(memberAssignmentLimit + 1),
    db.select({
      id: matches.id, matchNumber: matches.matchNumber, status: matches.status,
      scheduledDate: matches.scheduledDate, scorerId: matches.scorerId, backupScorerId: matches.backupScorerId,
    }).from(matches)
      .where(and(eq(matches.tenantId, tenantId),
        or(inArray(matches.scorerId, ids), inArray(matches.backupScorerId, ids))))
      .orderBy(matches.id)
      .limit(memberAssignmentLimit + 1),
  ])

  // The sentinel tells us there are omitted rows, not which members own them.
  // Conservatively mark every member incomplete; never infer "None" from a cap.
  const isComplete = teamRows.length <= memberAssignmentLimit && matchRows.length <= memberAssignmentLimit
  for (const member of Object.values(map)) member.isComplete = isComplete
  for (const team of teamRows.slice(0, memberAssignmentLimit)) {
    if (team.managerId && map[team.managerId]) map[team.managerId].managedTeams.push({ id: team.id, name: team.name })
  }
  for (const match of matchRows.slice(0, memberAssignmentLimit)) {
    const base = { id: match.id, matchNumber: match.matchNumber, status: match.status, scheduledDate: match.scheduledDate }
    if (match.scorerId && map[match.scorerId]) map[match.scorerId].scoringMatches.push({ ...base, role: "scorer" })
    if (match.backupScorerId && match.backupScorerId !== match.scorerId && map[match.backupScorerId]) {
      map[match.backupScorerId].scoringMatches.push({ ...base, role: "backup" })
    }
  }
  return map
}
