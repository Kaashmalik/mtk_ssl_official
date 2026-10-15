import { randomUUID } from "crypto"
import {
  db, withTenantContext, matches, teams, tournaments, tenants, users, userTenantRoles, auditLogs,
} from "@mtk/database"
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm"
import { scorerMembership } from "@/lib/scorer-membership"

/**
 * Match record reads and the scorer-assignment writer. Every function is
 * predicated on an explicit, caller-resolved `tenantId` — the same
 * active-league scoping contract as the other lib readers/writers. Lifecycle
 * commands (create/update/cancel/stream) live in `lib/match-management.ts`
 * via its own action-facing surface; no second writer is provided here.
 */

type Match = typeof matches.$inferSelect

/** Match-row statuses, mirroring the matches lifecycle enum. */
export type MatchStatus =
  | "scheduled" | "toss" | "live" | "innings_break"
  | "completed" | "abandoned" | "cancelled" | "no_result"

export interface MatchListFilters {
  tournamentId?: string
  teamId?: string
  status?: MatchStatus
  page: number
  pageSize: number
  sortBy: "scheduledDate" | "createdAt" | "matchNumber"
  sortOrder: "asc" | "desc"
}

/** One match of the exact league, or null. */
export async function findTenantMatch(userId: string, tenantId: string, matchId: string): Promise<Match | null> {
  return withTenantContext({ userId, tenantId }, async () => {
    const [match] = await db.select().from(matches)
      .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
      .limit(1)
    return match ?? null
  })
}

/** Active teams and open competitions of the exact league for a match form. */
export async function readMatchFormOptions(tenantId: string) {
  const [teamRows, tournamentRows] = await Promise.all([
    db.select({ id: teams.id, name: teams.name }).from(teams)
      .where(and(eq(teams.tenantId, tenantId), eq(teams.isActive, true))).orderBy(asc(teams.name)).limit(100),
    db.select({ id: tournaments.id, name: tournaments.name }).from(tournaments)
      .where(and(eq(tournaments.tenantId, tenantId), inArray(tournaments.status, ["draft", "registration", "live"])))
      .orderBy(asc(tournaments.name)).limit(100),
  ])
  return { teams: teamRows, tournaments: tournamentRows }
}

/** One page of the league's matches plus the total count for pagination. */
export async function listTenantMatches(userId: string, tenantId: string, validated: MatchListFilters) {
  return withTenantContext({ userId, tenantId }, async () => {
    const { tournamentId, teamId, status, page, pageSize, sortBy, sortOrder } = validated
    const offset = (page - 1) * pageSize
    const conditions = [eq(matches.tenantId, tenantId)]
    if (tournamentId) conditions.push(eq(matches.tournamentId, tournamentId))
    if (teamId) conditions.push(or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId))!)
    if (status) conditions.push(eq(matches.status, status))
    const whereClause = and(...conditions)
    const orderFn = sortOrder === "desc" ? desc : asc
    const orderColumn = sortBy === "scheduledDate" ? matches.scheduledDate : sortBy === "matchNumber" ? matches.matchNumber : matches.createdAt
    const [data, [{ total }]] = await Promise.all([
      db.select().from(matches).where(whereClause).orderBy(orderFn(orderColumn)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(matches).where(whereClause),
    ])
    return { data, pagination: { page, pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / pageSize) } }
  })
}

/** Active scorer accounts of the exact league for assignment pickers. */
export async function listTenantScorers(tenantId: string) {
  return db.select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(scorerMembership(tenantId))
}

/**
 * Assign or clear a match's primary/backup scorer under the canonical lock
 * ordering: match -> ordered users -> league (FOR SHARE) -> ordered
 * memberships. Member removal never locks matches — its plain reads run after
 * these same user locks — so assignment/removal cannot orphan a slot. The
 * actor's owner authority is re-verified under lock, the target must be an
 * active scorer member of this league, one person cannot occupy both slots,
 * and the before/after change is audited.
 */
export async function assignScorerInMatch(input: {
  userId: string
  tenantId: string
  matchId: string
  slot: "primary" | "backup"
  scorerId: string | null
}): Promise<Match> {
  const { userId, tenantId, matchId, slot: targetSlot, scorerId } = input
  return withTenantContext({ userId, tenantId }, () => db.transaction(async tx => {
    // Match -> ordered users -> league -> ordered memberships. This matches the
    // canonical writer. Member removal never locks matches: its plain reads run
    // AFTER these same user locks, so assignment/removal cannot orphan a slot.
    const key = and(eq(matches.id, matchId), eq(matches.tenantId, tenantId))
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${key} FOR UPDATE`)
    const existing = await tx.query.matches.findFirst({ where: key })
    if (!existing || existing.id !== matchId || existing.tenantId !== tenantId) throw new Error("Match not found")
    const initialActor = await tx.query.users.findFirst({ where: eq(users.clerkId, userId) })
    if (!initialActor) throw new Error("Forbidden: assignment account not found")
    const ids = [...new Set([initialActor.id, ...(scorerId ? [scorerId] : [])])].sort()
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${inArray(users.id, ids)} ORDER BY ${users.id} FOR UPDATE`)
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
    await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
      WHERE ${and(eq(userTenantRoles.tenantId, tenantId), inArray(userTenantRoles.userId, ids))}
      ORDER BY ${userTenantRoles.id} FOR UPDATE`)
    const actor = await tx.query.users.findFirst({ where: eq(users.id, initialActor.id) })
    const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
    const actorMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, initialActor.id), eq(userTenantRoles.tenantId, tenantId),
    ) })
    if (!actor || actor.id !== initialActor.id || actor.clerkId !== userId || actor.isActive !== true
      || !league || league.id !== tenantId || league.isActive !== true
      || !actorMember || actorMember.userId !== actor.id || actorMember.tenantId !== tenantId
      || actorMember.status !== "active" || actorMember.role !== "league_owner") {
      throw new Error("Forbidden: your scorer-assignment access changed")
    }
    if (scorerId) {
      const account = await tx.query.users.findFirst({ where: eq(users.id, scorerId) })
      const member = await tx.query.userTenantRoles.findFirst({ where: and(
        eq(userTenantRoles.userId, scorerId), eq(userTenantRoles.tenantId, tenantId),
      ) })
      if (!account || account.id !== scorerId || account.isActive !== true
        || !member || member.userId !== scorerId || member.tenantId !== tenantId
        || member.status !== "active" || member.role !== "scorer") {
        throw new Error("Selected user is not an active scorer in this tenant")
      }
    }
    // A single person cannot occupy both the primary and backup slot.
    const otherSlot = targetSlot === "primary" ? existing.backupScorerId : existing.scorerId
    if (scorerId && otherSlot === scorerId) throw new Error("Primary and backup scorer must be different people")
    if ((targetSlot === "primary" ? existing.scorerId : existing.backupScorerId) === scorerId) return existing
    const patch = targetSlot === "primary"
      ? { scorerId, updatedAt: new Date() }
      : { backupScorerId: scorerId, updatedAt: new Date() }
    const [updated] = await tx.update(matches)
      .set(patch)
      .where(key)
      .returning()
    if (!updated) throw new Error("Match changed. Reload before assigning.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: actor.id, actorRole: actorMember.role,
      method: "MATCH_SCORER_ASSIGN", path: `/dashboard/matches/${matchId}`, statusCode: "200",
      payload: { matchId, slot: targetSlot,
        before: { scorerId: existing.scorerId, backupScorerId: existing.backupScorerId },
        after: { scorerId: updated.scorerId, backupScorerId: updated.backupScorerId } },
    })
    return updated
  }, { isolationLevel: "read committed" }))
}
