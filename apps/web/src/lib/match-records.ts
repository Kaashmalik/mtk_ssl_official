import { randomUUID } from "crypto"
import {
  db, withTenantContext, matches, teams, tournaments, tenants, users, userTenantRoles, auditLogs,
  membershipGrantsAccess, matchPlayingXis, players, leagueRegistrations,
} from "@mtk/database"
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { scorerMembership } from "@/lib/scorer-membership"
import { matchRegistrationMap, registrationAllowsPlayer,
  type SquadRegistration } from "@mtk/database/lib/registered-squad-eligibility"
import { validateDeclaredXi, xiSubstitutionOrder, PLAYING_XI_SIZE,
  type XiDeclarationEntry } from "@mtk/database/lib/playing-xi-policy"

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
 * Umpire candidate filter (COMP-06): unlike scorers, umpiring is not tied to a
 * role — any EFFECTIVE membership of the league qualifies (active account,
 * active membership whose expiry bound, if any, still passes on the server
 * clock). The locked writer re-derives the same facts under lock.
 */
export function umpireMembership(tenantId: string) {
  return sql`(
    ${users.isActive} = true AND EXISTS (SELECT 1 FROM ${userTenantRoles}
      WHERE ${userTenantRoles.userId} = ${users.id}
        AND ${userTenantRoles.tenantId} = ${tenantId}
        AND ${userTenantRoles.status} = 'active'
        AND (${userTenantRoles.expiresAt} IS NULL OR ${userTenantRoles.expiresAt} > now()))
  )`
}

export async function listTenantUmpires(tenantId: string) {
  return db.select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(umpireMembership(tenantId))
}

/**
 * Assign or clear a member-bound umpire slot (COMP-06) under the canonical
 * lock ordering: match -> ordered users -> league (FOR SHARE) -> ordered
 * memberships. The actor's owner authority is re-verified under lock and the
 * target must be an EFFECTIVE member of this league (any role; an expired or
 * suspended membership is rejected). One member can never hold both umpire
 * slots; free-text umpire_1/2 stay reserved for external officials. The
 * before/after change is audited.
 */
export async function assignUmpireInMatch(input: {
  userId: string
  tenantId: string
  matchId: string
  slot: "primary" | "secondary"
  umpireId: string | null
}): Promise<Match> {
  const { userId, tenantId, matchId, slot: targetSlot, umpireId } = input
  return withTenantContext({ userId, tenantId }, () => db.transaction(async tx => {
    const key = and(eq(matches.id, matchId), eq(matches.tenantId, tenantId))
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${key} FOR UPDATE`)
    const existing = await tx.query.matches.findFirst({ where: key })
    if (!existing || existing.id !== matchId || existing.tenantId !== tenantId) throw new Error("Match not found")
    const initialActor = await tx.query.users.findFirst({ where: eq(users.clerkId, userId) })
    if (!initialActor) throw new Error("Forbidden: assignment account not found")
    const ids = [...new Set([initialActor.id, ...(umpireId ? [umpireId] : [])])].sort()
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
      || !membershipGrantsAccess(actorMember) || actorMember.role !== "league_owner") {
      throw new Error("Forbidden: your umpire-assignment access changed")
    }
    if (umpireId) {
      const account = await tx.query.users.findFirst({ where: eq(users.id, umpireId) })
      const member = await tx.query.userTenantRoles.findFirst({ where: and(
        eq(userTenantRoles.userId, umpireId), eq(userTenantRoles.tenantId, tenantId),
      ) })
      if (!account || account.id !== umpireId || account.isActive !== true
        || !member || member.userId !== umpireId || member.tenantId !== tenantId
        || !membershipGrantsAccess(member)) {
        throw new Error("Selected user is not an effective member of this league")
      }
    }
    // One person cannot fill both umpire slots.
    if (umpireId && (targetSlot === "primary" ? existing.umpire2Id : existing.umpire1Id) === umpireId) {
      throw new Error("The same person cannot be both umpires")
    }
    if ((targetSlot === "primary" ? existing.umpire1Id : existing.umpire2Id) === umpireId) return existing
    const nextUmpire1Id = targetSlot === "primary" ? umpireId : existing.umpire1Id
    const nextUmpire2Id = targetSlot === "secondary" ? umpireId : existing.umpire2Id
    // Umpire consent (COMP-06, mirroring scorer approval): consent binds to
    // the exact assignment. Any change to either slot revokes it and, when a
    // member slot remains occupied, the assigned member must approve again.
    const patch = targetSlot === "primary"
      ? { umpire1Id: umpireId, updatedAt: new Date() }
      : { umpire2Id: umpireId, updatedAt: new Date() }
    Object.assign(patch, {
      umpireApprovalRequired: nextUmpire1Id !== null || nextUmpire2Id !== null,
      umpireApprovedAt: null,
    })
    const [updated] = await tx.update(matches)
      .set(patch)
      .where(key)
      .returning()
    if (!updated) throw new Error("Match changed. Reload before assigning.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: actor.id, actorRole: actorMember.role,
      method: "MATCH_UMPIRE_ASSIGN", path: `/dashboard/matches/${matchId}`, statusCode: "200",
      payload: { matchId, slot: targetSlot,
        before: { umpire1Id: existing.umpire1Id, umpire2Id: existing.umpire2Id, umpireApprovedAt: existing.umpireApprovedAt },
        after: { umpire1Id: updated.umpire1Id, umpire2Id: updated.umpire2Id, umpireApprovalRequired: updated.umpireApprovalRequired, umpireApprovedAt: updated.umpireApprovedAt } },
    })
    return updated
  }, { isolationLevel: "read committed" }))
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
      || !membershipGrantsAccess(actorMember) || actorMember.role !== "league_owner") {
      throw new Error("Forbidden: your scorer-assignment access changed")
    }
    if (scorerId) {
      const account = await tx.query.users.findFirst({ where: eq(users.id, scorerId) })
      const member = await tx.query.userTenantRoles.findFirst({ where: and(
        eq(userTenantRoles.userId, scorerId), eq(userTenantRoles.tenantId, tenantId),
      ) })
      if (!account || account.id !== scorerId || account.isActive !== true
        || !member || member.userId !== scorerId || member.tenantId !== tenantId
        || !membershipGrantsAccess(member) || member.role !== "scorer") {
        throw new Error("Selected user is not an active scorer in this tenant")
      }
    }
    // A single person cannot occupy both the primary and backup slot.
    const otherSlot = targetSlot === "primary" ? existing.backupScorerId : existing.scorerId
    if (scorerId && otherSlot === scorerId) throw new Error("Primary and backup scorer must be different people")
    if ((targetSlot === "primary" ? existing.scorerId : existing.backupScorerId) === scorerId) return existing
    const nextScorerId = targetSlot === "primary" ? scorerId : existing.scorerId
    const nextBackupScorerId = targetSlot === "backup" ? scorerId : existing.backupScorerId
    // Official approval (COMP-06): consent binds to the exact assignment. Any
    // change to either slot revokes it and, when a slot remains occupied, the
    // assigned member must approve again (IAM-06 pending acceptance).
    const patch = targetSlot === "primary"
      ? { scorerId, updatedAt: new Date() }
      : { backupScorerId: scorerId, updatedAt: new Date() }
    Object.assign(patch, {
      scorerApprovalRequired: nextScorerId !== null || nextBackupScorerId !== null,
      scorerApprovedAt: null,
    })
    const [updated] = await tx.update(matches)
      .set(patch)
      .where(key)
      .returning()
    if (!updated) throw new Error("Match changed. Reload before assigning.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: actor.id, actorRole: actorMember.role,
      method: "MATCH_SCORER_ASSIGN", path: `/dashboard/matches/${matchId}`, statusCode: "200",
      payload: { matchId, slot: targetSlot,
        before: { scorerId: existing.scorerId, backupScorerId: existing.backupScorerId, scorerApprovedAt: existing.scorerApprovedAt },
        after: { scorerId: updated.scorerId, backupScorerId: updated.backupScorerId, scorerApprovalRequired: updated.scorerApprovalRequired, scorerApprovedAt: updated.scorerApprovedAt } },
    })
    return updated
  }, { isolationLevel: "read committed" }))
}

/**
 * Official approval (COMP-06/IAM-06): the ASSIGNED member (never an owner on
 * their behalf) consents to their scorer assignment. Fail-closed: effective
 * scorer membership, an occupied slot containing the actor, an outstanding
 * approval requirement and a still-pending state are all re-checked under the
 * match row lock; a concurrent assignment change wins the conditional update
 * and voids this approval.
 */
export async function approveScorerAssignmentInMatch(input: {
  userId: string
  tenantId: string
  matchId: string
}): Promise<{ matchId: string; slot: "primary" | "backup"; approvedAt: Date }> {
  const { userId, tenantId, matchId } = input
  return withTenantContext({ userId, tenantId }, () => db.transaction(async tx => {
    const key = and(eq(matches.id, matchId), eq(matches.tenantId, tenantId))
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${key} FOR UPDATE`)
    const match = await tx.query.matches.findFirst({ where: key })
    if (!match || match.id !== matchId || match.tenantId !== tenantId) throw new Error("Match not found")
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.clerkId} = ${userId} FOR UPDATE`)
    const actor = await tx.query.users.findFirst({ where: eq(users.clerkId, userId) })
    if (!actor || actor.clerkId !== userId || actor.isActive !== true) throw new Error("Forbidden: approval account unavailable")
    // SCORE-09: a membership whose bound has passed denies this league surface.
    const actorMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId),
    ) })
    if (!actorMember || actorMember.userId !== actor.id || actorMember.tenantId !== tenantId
      || !membershipGrantsAccess(actorMember)) throw new Error("Forbidden: your membership changed")
    const slot: "primary" | "backup" | null = match.scorerId === actor.id
      ? "primary"
      : match.backupScorerId === actor.id ? "backup" : null
    if (!slot) throw new Error("You are not the assigned scorer of this match")
    if (!match.scorerApprovalRequired) throw new Error("This assignment does not require approval")
    if (match.scorerApprovedAt) throw new Error("This assignment is already approved")
    const approvedAt = new Date()
    const [updated] = await tx.update(matches)
      .set({ scorerApprovedAt: approvedAt, updatedAt: approvedAt })
      .where(and(key, eq(matches.scorerApprovalRequired, true), isNull(matches.scorerApprovedAt),
        slot === "primary" ? eq(matches.scorerId, actor.id) : eq(matches.backupScorerId, actor.id)))
      .returning({ id: matches.id })
    if (!updated) throw new Error("Match changed. Reload before approving.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: actor.id,
      method: "SCORER_ASSIGNMENT_APPROVE", path: `/dashboard/matches/${matchId}`, statusCode: "200",
      payload: { matchId, slot, scorerId: slot === "primary" ? match.scorerId : match.backupScorerId, approvedAt: approvedAt.toISOString() },
    })
    return { matchId, slot, approvedAt }
  }, { isolationLevel: "read committed" }))
}

/**
 * Umpire consent (COMP-06, mirroring scorer approval): the ASSIGNED member
 * consents to their member-umpire assignment. Fail-closed: an occupied member
 * slot containing the actor, an armed requirement and a still-pending state
 * are all re-checked under the match row lock; a concurrent assignment change
 * wins the conditional update and voids this approval. Unlike scorer consent
 * this is gated `match:read` at the action tier (umpires may hold any role);
 * the slot check here is the real authority - nobody else can ever approve.
 */
export async function approveUmpireAssignmentInMatch(input: {
  userId: string
  tenantId: string
  matchId: string
}): Promise<{ matchId: string; slot: "primary" | "secondary"; approvedAt: Date }> {
  const { userId, tenantId, matchId } = input
  return withTenantContext({ userId, tenantId }, () => db.transaction(async tx => {
    const key = and(eq(matches.id, matchId), eq(matches.tenantId, tenantId))
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${key} FOR UPDATE`)
    const match = await tx.query.matches.findFirst({ where: key })
    if (!match || match.id !== matchId || match.tenantId !== tenantId) throw new Error("Match not found")
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.clerkId} = ${userId} FOR UPDATE`)
    const actor = await tx.query.users.findFirst({ where: eq(users.clerkId, userId) })
    if (!actor || actor.clerkId !== userId || actor.isActive !== true) throw new Error("Forbidden: approval account unavailable")
    // SCORE-09: a membership whose bound has passed denies this league surface.
    const actorMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId),
    ) })
    if (!actorMember || actorMember.userId !== actor.id || actorMember.tenantId !== tenantId
      || !membershipGrantsAccess(actorMember)) throw new Error("Forbidden: your membership changed")
    const slot: "primary" | "secondary" | null = match.umpire1Id === actor.id
      ? "primary"
      : match.umpire2Id === actor.id ? "secondary" : null
    if (!slot) throw new Error("You are not the assigned umpire of this match")
    if (!match.umpireApprovalRequired) throw new Error("This assignment does not require approval")
    if (match.umpireApprovedAt) throw new Error("This assignment is already approved")
    const approvedAt = new Date()
    const [updated] = await tx.update(matches)
      .set({ umpireApprovedAt: approvedAt, updatedAt: approvedAt })
      .where(and(key, eq(matches.umpireApprovalRequired, true), isNull(matches.umpireApprovedAt),
        slot === "primary" ? eq(matches.umpire1Id, actor.id) : eq(matches.umpire2Id, actor.id)))
      .returning({ id: matches.id })
    if (!updated) throw new Error("Match changed. Reload before approving.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: actor.id,
      method: "UMPIRE_ASSIGNMENT_APPROVE", path: `/dashboard/matches/${matchId}`, statusCode: "200",
      payload: { matchId, slot, umpireId: slot === "primary" ? match.umpire1Id : match.umpire2Id, approvedAt: approvedAt.toISOString() },
    })
    return { matchId, slot, approvedAt }
  }, { isolationLevel: "read committed" }))
}

/**
 * Declared playing XIs (COMP-06 slice): an owner or the assigned scorer /
 * backup stores BOTH sides' squads for a competition match. Canonical lock
 * order: match -> actor user -> league -> membership -> ordered teams ->
 * tournament registrations (the canonical boundary's mirrored read) ->
 * ordered players. The shared policy validates each side's shape (exactly 11
 * distinct players, orders 1..11) before any write; every declared player
 * must sit on his side's ACTIVE roster and registered tournament squad, and
 * friendlies never arm the gate. Storing a declaration supersedes the
 * previously active XI rows (history is kept, never mutated), arms
 * `xi_required` and clears any prior approval. Audited as XI_DECLARE.
 */
export async function setPlayingXis(input: {
  userId: string
  tenantId: string
  matchId: string
  teamAXi: XiDeclarationEntry[]
  teamBXi: XiDeclarationEntry[]
}): Promise<{ matchId: string; declaredAt: Date }> {
  const { userId, tenantId, matchId, teamAXi, teamBXi } = input
  return withTenantContext({ userId, tenantId }, () => db.transaction(async tx => {
    const key = and(eq(matches.id, matchId), eq(matches.tenantId, tenantId))
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${key} FOR UPDATE`)
    const match = await tx.query.matches.findFirst({ where: key })
    if (!match || match.id !== matchId || match.tenantId !== tenantId) throw new Error("Match not found")
    if (match.tournamentId === null) throw new Error("Playing XIs apply to competition matches only")
    if (match.status !== "scheduled") throw new Error("XIs can only be declared while the match is scheduled")
    if (!match.teamAId || !match.teamBId || match.teamAId === match.teamBId) {
      throw new Error("Match requires two distinct teams")
    }
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.clerkId} = ${userId} FOR UPDATE`)
    const actor = await tx.query.users.findFirst({ where: eq(users.clerkId, userId) })
    if (!actor || actor.clerkId !== userId || actor.isActive !== true) {
      throw new Error("Forbidden: declaration account unavailable")
    }
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
    const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
    await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
      WHERE ${and(eq(userTenantRoles.tenantId, tenantId), eq(userTenantRoles.userId, actor.id))} FOR UPDATE`)
    const actorMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId),
    ) })
    if (!league || league.id !== tenantId || league.isActive !== true
      || !actorMember || actorMember.userId !== actor.id || actorMember.tenantId !== tenantId
      || !membershipGrantsAccess(actorMember)) throw new Error("Forbidden: your membership changed")
    const assignedScorer = match.scorerId === actor.id || match.backupScorerId === actor.id
    if (actorMember.role !== "league_owner" && !assignedScorer) {
      throw new Error("Forbidden: only the owner or the assigned scorer declares the XIs")
    }
    // Shared policy: an invalid declaration fails closed before any write.
    validateDeclaredXi(teamAXi, match.teamAId)
    validateDeclaredXi(teamBXi, match.teamBId)
    // Ordered team locks before any roster reads.
    const teamIds = [match.teamAId, match.teamBId].sort()
    await tx.execute(sql`SELECT ${teams.id} FROM ${teams}
      WHERE ${and(eq(teams.tenantId, tenantId), inArray(teams.id, teamIds))} ORDER BY ${teams.id} FOR SHARE`)
    for (const id of teamIds) {
      const team = await tx.query.teams.findFirst({ where: and(eq(teams.id, id), eq(teams.tenantId, tenantId)) })
      if (!team || team.id !== id || team.tenantId !== tenantId || team.isActive !== true) {
        throw new Error("Match team is unavailable")
      }
    }
    // Mirrors the canonical boundary's registered-squad eligibility read.
    const regWhere = and(eq(leagueRegistrations.tenantId, tenantId),
      eq(leagueRegistrations.tournamentId, match.tournamentId),
      inArray(leagueRegistrations.teamId, teamIds))
    await tx.execute(sql`SELECT ${leagueRegistrations.id} FROM ${leagueRegistrations}
      WHERE ${regWhere} ORDER BY ${leagueRegistrations.id} LIMIT 3 FOR SHARE`)
    const regRows = await tx.query.leagueRegistrations.findMany({ where: regWhere,
      columns: { tenantId: true, tournamentId: true, teamId: true, status: true, squadPlayerIds: true },
      orderBy: [asc(leagueRegistrations.id)], limit: 3 })
    let registrations: Map<string, SquadRegistration>
    try {
      registrations = matchRegistrationMap(regRows, tenantId, match.tournamentId, teamIds)
    } catch {
      throw new Error("Tournament registrations require review")
    }
    const entries: ReadonlyArray<readonly [teamId: string, entry: XiDeclarationEntry]> = [
      ...teamAXi.map(entry => [match.teamAId, entry] as const),
      ...teamBXi.map(entry => [match.teamBId, entry] as const),
    ]
    for (const [teamId, entry] of entries) {
      if (!registrationAllowsPlayer(registrations.get(teamId), entry.playerId)) {
        throw new Error("A declared player is outside the approved tournament squad")
      }
    }
    const playerIds = [...new Set(entries.map(([, entry]) => entry.playerId))].sort()
    await tx.execute(sql`SELECT ${players.id} FROM ${players}
      WHERE ${and(eq(players.tenantId, tenantId), inArray(players.id, playerIds))} ORDER BY ${players.id} FOR SHARE`)
    const rosterSide = new Map<string, string>()
    for (const id of playerIds) {
      const player = await tx.query.players.findFirst({ where: and(eq(players.id, id), eq(players.tenantId, tenantId)) })
      if (!player || player.id !== id || player.tenantId !== tenantId
        || player.isActive !== true || player.status !== "active") {
        throw new Error("A declared player is not an active roster member")
      }
      const side = player.teamId
      if (side === null || ![match.teamAId, match.teamBId].includes(side)) {
        throw new Error("A declared player belongs to neither side")
      }
      rosterSide.set(id, side)
    }
    for (const [teamId, entry] of entries) {
      if (rosterSide.get(entry.playerId) !== teamId) {
        throw new Error("A declared player does not belong to that side")
      }
    }
    const declaredAt = new Date()
    // Supersede, never mutate: previous active rows stay as declaration history.
    await tx.update(matchPlayingXis)
      .set({ supersededAt: declaredAt })
      .where(and(eq(matchPlayingXis.matchId, matchId), eq(matchPlayingXis.tenantId, tenantId),
        isNull(matchPlayingXis.supersededAt)))
    await tx.insert(matchPlayingXis).values(entries.map(([teamId, entry]) => ({
      matchId, tenantId, teamId, playerId: entry.playerId, battingOrder: entry.battingOrder,
      declaredBy: actor.id, declaredAt,
    })))
    const [updated] = await tx.update(matches)
      .set({ xiRequired: true, xiApprovedAt: null, updatedAt: declaredAt })
      .where(key)
      .returning()
    if (!updated) throw new Error("Match changed. Reload before declaring.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: actor.id, actorRole: actorMember.role,
      method: "XI_DECLARE", path: `/dashboard/matches/${matchId}`, statusCode: "200",
      payload: { matchId,
        before: { xiRequired: match.xiRequired, xiApprovedAt: match.xiApprovedAt },
        after: { xiRequired: updated.xiRequired, xiApprovedAt: updated.xiApprovedAt,
          teamASquadSize: teamAXi.length, teamBSquadSize: teamBXi.length } },
    })
    return { matchId, declaredAt }
  }, { isolationLevel: "read committed" }))
}

/**
 * Official approval of declared playing XIs (COMP-06 slice, mirroring scorer /
 * umpire consent): a league owner or an ASSIGNED member umpire approves both
 * sides' squads. Fail-closed under the match row lock: the requirement must be
 * armed, approval still pending, and both sides carry exactly 11 active
 * declared players. Only a concurrent declaration re-arming the gate can void
 * this approval through the conditional update. Audited as XI_APPROVE.
 */
export async function approvePlayingXis(input: {
  userId: string
  tenantId: string
  matchId: string
}): Promise<{ matchId: string; approvedAt: Date }> {
  const { userId, tenantId, matchId } = input
  return withTenantContext({ userId, tenantId }, () => db.transaction(async tx => {
    const key = and(eq(matches.id, matchId), eq(matches.tenantId, tenantId))
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${key} FOR UPDATE`)
    const match = await tx.query.matches.findFirst({ where: key })
    if (!match || match.id !== matchId || match.tenantId !== tenantId) throw new Error("Match not found")
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.clerkId} = ${userId} FOR UPDATE`)
    const actor = await tx.query.users.findFirst({ where: eq(users.clerkId, userId) })
    if (!actor || actor.clerkId !== userId || actor.isActive !== true) {
      throw new Error("Forbidden: approval account unavailable")
    }
    // SCORE-09: a membership whose bound has passed denies this league surface.
    const actorMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId),
    ) })
    if (!actorMember || actorMember.userId !== actor.id || actorMember.tenantId !== tenantId
      || !membershipGrantsAccess(actorMember)) throw new Error("Forbidden: your membership changed")
    if (actorMember.role !== "league_owner"
      && match.umpire1Id !== actor.id && match.umpire2Id !== actor.id) {
      throw new Error("Only the owner or an assigned member umpire approves the XIs")
    }
    if (match.tournamentId === null) throw new Error("Playing XIs apply to competition matches only")
    if (!match.xiRequired) throw new Error("This match has no declared XIs to approve")
    if (match.xiApprovedAt) throw new Error("The XIs are already approved")
    const counts = await tx.select({ teamId: matchPlayingXis.teamId, declared: count() })
      .from(matchPlayingXis)
      .where(and(eq(matchPlayingXis.matchId, matchId), eq(matchPlayingXis.tenantId, tenantId),
        isNull(matchPlayingXis.supersededAt)))
      .groupBy(matchPlayingXis.teamId)
    const complete = counts.length === 2
      && match.teamAId !== match.teamBId
      && counts.every(side => Number(side.declared) === PLAYING_XI_SIZE)
    if (!complete) throw new Error("Both sides must each declare exactly 11 players before approval")
    const approvedAt = new Date()
    const [updated] = await tx.update(matches)
      .set({ xiApprovedAt: approvedAt, updatedAt: approvedAt })
      .where(and(key, eq(matches.xiRequired, true), isNull(matches.xiApprovedAt)))
      .returning({ id: matches.id })
    if (!updated) throw new Error("Match changed. Reload before approving.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: actor.id,
      method: "XI_APPROVE", path: `/dashboard/matches/${matchId}`, statusCode: "200",
      payload: { matchId, approvedAt: approvedAt.toISOString(),
        approvedAs: actorMember.role === "league_owner" ? "owner" : "umpire" },
    })
    return { matchId, approvedAt }
  }, { isolationLevel: "read committed" }))
}

/**
 * Audited XI substitution (SCORE-10, COMP-06): an official (league owner or
 * assigned member umpire) replaces one active declared XI member with a
 * registered-squad, active-roster player of the SAME side while the gate is
 * armed. The match row lock plus the shared policy re-validate the pair; the
 * outgoing row is superseded (never deleted) and the replacement inherits its
 * batting order. The official's own substitution act keeps `xi_approved_at`
 * intact — approval binds to the gate, the history rows record who changed
 * what. Audited as XI_SUBSTITUTE.
 */
export async function substituteInPlayingXi(input: {
  userId: string
  tenantId: string
  matchId: string
  teamId: string
  outgoingPlayerId: string
  incomingPlayerId: string
}): Promise<{ matchId: string; teamId: string; battingOrder: number; substitutedAt: Date }> {
  const { userId, tenantId, matchId, teamId, outgoingPlayerId, incomingPlayerId } = input
  return withTenantContext({ userId, tenantId }, () => db.transaction(async tx => {
    const key = and(eq(matches.id, matchId), eq(matches.tenantId, tenantId))
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${key} FOR UPDATE`)
    const match = await tx.query.matches.findFirst({ where: key })
    if (!match || match.id !== matchId || match.tenantId !== tenantId) throw new Error("Match not found")
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.clerkId} = ${userId} FOR UPDATE`)
    const actor = await tx.query.users.findFirst({ where: eq(users.clerkId, userId) })
    if (!actor || actor.clerkId !== userId || actor.isActive !== true) {
      throw new Error("Forbidden: substitution account unavailable")
    }
    // SCORE-09: a membership whose bound has passed denies this league surface.
    const actorMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId),
    ) })
    if (!actorMember || actorMember.userId !== actor.id || actorMember.tenantId !== tenantId
      || !membershipGrantsAccess(actorMember)) throw new Error("Forbidden: your membership changed")
    if (actorMember.role !== "league_owner"
      && match.umpire1Id !== actor.id && match.umpire2Id !== actor.id) {
      throw new Error("Only the owner or an assigned member umpire may substitute")
    }
    if (match.tournamentId === null) throw new Error("Playing XIs apply to competition matches only")
    if (!match.xiRequired) throw new Error("This match has no declared XIs to substitute into")
    if (match.teamAId !== teamId && match.teamBId !== teamId) {
      throw new Error("Substitution side does not belong to this match")
    }
    if (!["scheduled", "toss", "live", "innings_break"].includes(match.status ?? "")) {
      throw new Error("Substitutions are closed for this match status")
    }
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
    const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
    if (!league || league.id !== tenantId || league.isActive !== true) {
      throw new Error("Forbidden: league unavailable")
    }
    // Active declared rows for BOTH sides, then the shared policy decision.
    const activeRows = await tx.query.matchPlayingXis.findMany({
      where: and(eq(matchPlayingXis.matchId, matchId), eq(matchPlayingXis.tenantId, tenantId),
        isNull(matchPlayingXis.supersededAt)),
      columns: { teamId: true, playerId: true, battingOrder: true },
      orderBy: [asc(matchPlayingXis.battingOrder)],
    })
    const battingOrder = xiSubstitutionOrder({ activeRows, teamId, outgoingPlayerId, incomingPlayerId })
    // Ordered team locks before any roster reads.
    const teamIds = [match.teamAId, match.teamBId].sort()
    await tx.execute(sql`SELECT ${teams.id} FROM ${teams}
      WHERE ${and(eq(teams.tenantId, tenantId), inArray(teams.id, teamIds))} ORDER BY ${teams.id} FOR SHARE`)
    // Mirrors the canonical boundary's registered-squad eligibility read.
    const regWhere = and(eq(leagueRegistrations.tenantId, tenantId),
      eq(leagueRegistrations.tournamentId, match.tournamentId),
      inArray(leagueRegistrations.teamId, teamIds))
    await tx.execute(sql`SELECT ${leagueRegistrations.id} FROM ${leagueRegistrations}
      WHERE ${regWhere} ORDER BY ${leagueRegistrations.id} LIMIT 3 FOR SHARE`)
    const regRows = await tx.query.leagueRegistrations.findMany({ where: regWhere,
      columns: { tenantId: true, tournamentId: true, teamId: true, status: true, squadPlayerIds: true },
      orderBy: [asc(leagueRegistrations.id)], limit: 3 })
    let registrations: Map<string, SquadRegistration>
    try {
      registrations = matchRegistrationMap(regRows, tenantId, match.tournamentId, teamIds)
    } catch {
      throw new Error("Tournament registrations require review")
    }
    await tx.execute(sql`SELECT ${players.id} FROM ${players}
      WHERE ${and(eq(players.tenantId, tenantId), eq(players.id, incomingPlayerId))} FOR SHARE`)
    const incoming = await tx.query.players.findFirst({ where: and(eq(players.id, incomingPlayerId), eq(players.tenantId, tenantId)) })
    if (!incoming || incoming.id !== incomingPlayerId || incoming.tenantId !== tenantId
      || incoming.isActive !== true || incoming.status !== "active") {
      throw new Error("The incoming player is not an active roster member")
    }
    if (incoming.teamId !== teamId) throw new Error("The incoming player belongs to the other side")
    if (!registrationAllowsPlayer(registrations.get(teamId), incomingPlayerId)) {
      throw new Error("The incoming player is outside the approved tournament squad")
    }
    const substitutedAt = new Date()
    // Supersede the outgoing declaration; the replacement inherits its slot.
    await tx.update(matchPlayingXis)
      .set({ supersededAt: substitutedAt })
      .where(and(eq(matchPlayingXis.matchId, matchId), eq(matchPlayingXis.tenantId, tenantId),
        eq(matchPlayingXis.teamId, teamId), eq(matchPlayingXis.playerId, outgoingPlayerId),
        isNull(matchPlayingXis.supersededAt)))
    await tx.insert(matchPlayingXis).values({
      matchId, tenantId, teamId, playerId: incomingPlayerId, battingOrder,
      declaredBy: actor.id, declaredAt: substitutedAt,
    })
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: actor.id,
      method: "XI_SUBSTITUTE", path: `/dashboard/matches/${matchId}`, statusCode: "200",
      payload: { matchId, teamId, outgoingPlayerId, incomingPlayerId, battingOrder,
        substitutedAt: substitutedAt.toISOString(),
        substitutedAs: actorMember.role === "league_owner" ? "owner" : "umpire" },
    })
    return { matchId, teamId, battingOrder, substitutedAt }
  }, { isolationLevel: "read committed" }))
}
