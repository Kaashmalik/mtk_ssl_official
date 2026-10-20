import { randomUUID } from "crypto"
import {
  auditLogs,
  db,
  teams,
  tournamentApplications,
  tournamentApplicationReplies,
  tournaments,
  userTenantRoles,
  users,
} from "@mtk/database"
import { and, asc, count, eq } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { auth } from "@clerk/nextjs/server"
import {
  describeApplicationStatus,
  isLiveStatus,
  memberMove,
  ownerMove,
  resolveOwnerDecision,
  type OwnerDecision,
} from "@mtk/database/lib/tournament-application-policy"
import {
  describeReplyRefusal,
  normalizeReplyBody,
  REPLIES_PER_APPLICATION_LIMIT,
  replyAuthorSide,
  replyThreadTarget,
  type ReplyAuthorSide,
} from "@mtk/database/lib/application-reply-policy"
import { membershipGrantsAccess } from "@mtk/database"

/**
 * REG-03 (Batch 147): the tournament-application journey. A reviewed
 * state machine: the TEAM's manager submits, the league OWNER decides
 * (approve / request_information / waitlist / decline - fixed vocabulary),
 * and the member may WITHDRAW any live application. One LIVE application
 * per team per tournament is a database guarantee; terminal states are
 * terminal (a declined application is never re-decided), identical
 * replays are pure reads, and every owner decision carries provenance
 * (decider + time, CHECK-enforced by the database needs it; a withdrawal
 * resolves with a time and NO decider - the member resolved it).
 */

const accountOf = async (clerkId: string) => {
  const [account] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!account || account.isActive !== true) throw new Error("Forbidden: your account is unavailable")
  return account
}

const activeMembershipIn = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  tenantId: string,
) => {
  const [member] = await tx
    .select({ role: userTenantRoles.role, status: userTenantRoles.status, expiresAt: userTenantRoles.expiresAt })
    .from(userTenantRoles)
    .where(and(eq(userTenantRoles.userId, userId), eq(userTenantRoles.tenantId, tenantId)))
    .limit(1)
  if (!member || !membershipGrantsAccess(member)) throw new Error("Forbidden: you are not an active member of this league")
  return member
}

/** The submission surface: the tournament must still be able to gain teams. */
function tournamentAcceptsApplications(tournament: {
  status: string
  registrationOpen?: boolean
  registrationStart?: Date | string | null
  registrationEnd?: Date | string | null
}): { ok: true } | { ok: false; reason: string } {
  if (tournament.status === "completed" || tournament.status === "cancelled") {
    return { ok: false, reason: "This tournament has ended - applications are closed" }
  }
  // The flag and the window are the same gate the direct-registration path
  // enforces (registration-management.ts): applications never outlive them.
  if (tournament.registrationOpen !== true) {
    return { ok: false, reason: "Registration is closed for this tournament" }
  }
  const now = new Date()
  const start = toTime(tournament.registrationStart)
  if (start !== null && start > now.getTime()) return { ok: false, reason: "Registration has not opened yet" }
  const end = toTime(tournament.registrationEnd)
  if (end !== null && end < now.getTime()) return { ok: false, reason: "The registration deadline has passed" }
  return { ok: true }
}

const toTime = (value: Date | string | null | undefined): number | null => {
  if (!value) return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/** A tx.execute row from the FOR UPDATE reread (postgres-js rows arrays). */
function isStatusRow(row: unknown): row is { status: string } {
  return typeof (row as { status?: unknown } | undefined)?.status === "string"
}

export async function readTeamLiveApplication(tournamentId: string, teamId: string) {
  z.string().uuid().parse(tournamentId)
  z.string().uuid().parse(teamId)
  const [row] = await db
    .select({ id: tournamentApplications.id, status: tournamentApplications.status, updatedAt: tournamentApplications.updatedAt })
    .from(tournamentApplications)
    .where(and(
      eq(tournamentApplications.tournamentId, tournamentId),
      eq(tournamentApplications.teamId, teamId),
      sql`${tournamentApplications.status} IN ('submitted', 'needs_information', 'waitlisted')`,
    ))
    .limit(1)
  return row ? { ...row, description: describeApplicationStatus(row.status as never) } : null
}

export async function submitTournamentApplication(
  tournamentId: string,
  teamId: string,
): Promise<{ submitted: true; applicationId: string; status: string; changed: boolean }> {
  z.string().uuid().parse(tournamentId)
  z.string().uuid().parse(teamId)
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  return db.transaction(async (tx) => {
    const [tournament] = await tx
      .select({
        id: tournaments.id,
        tenantId: tournaments.tenantId,
        status: tournaments.status,
        registrationOpen: tournaments.registrationOpen,
        registrationStart: tournaments.registrationStart,
        registrationEnd: tournaments.registrationEnd,
      })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1)
    if (!tournament) throw new Error("Tournament not found")
    const gate = tournamentAcceptsApplications(tournament)
    if (!gate.ok) throw new Error(gate.reason)

    // Manager authority is the TEAM's own row: the actor is the active
    // team's current manager, plus an ACTIVE league membership - both in
    // the application's OWN league.
    const [team] = await tx
      .select({ id: teams.id, tenantId: teams.tenantId, managerId: teams.managerId, isActive: teams.isActive })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
    if (!team || !team.isActive) throw new Error("Team not found")
    // Both resources in one league: a team pointer from another tenant never
    // pairs with this tournament (both-resource tenant check).
    if (team.tenantId !== tournament.tenantId) throw new Error("This team belongs to a different league")
    if (team.managerId !== account.id) throw new Error("Forbidden: only the team's manager can apply")
    await activeMembershipIn(tx, account.id, tournament.tenantId)

    await tx.execute(sql`SELECT ${tournamentApplications.id} FROM ${tournamentApplications}
      WHERE ${tournamentApplications.tournamentId} = ${tournament.id}
        AND ${tournamentApplications.teamId} = ${team.id}
      FOR UPDATE`)
    const [current] = await tx
      .select({ id: tournamentApplications.id, status: tournamentApplications.status })
      .from(tournamentApplications)
      .where(and(
        eq(tournamentApplications.tournamentId, tournament.id),
        eq(tournamentApplications.teamId, team.id),
        sql`${tournamentApplications.status} IN ('submitted', 'needs_information', 'waitlisted')`,
      ))
      .limit(1)
    if (current) {
      if (current.status === "submitted") {
        // Identical replay: a pure read - no second audit row.
        return { submitted: true, applicationId: current.id, status: current.status, changed: false }
      }
      if (current.status === "needs_information") {
        throw new Error("The owner requested more information. Withdraw, then resubmit with the missing details.")
      }
      throw new Error("Your team is waitlisted for this tournament - the owner decides from this list")
    }
    const [approved] = await tx
      .select({ id: tournamentApplications.id })
      .from(tournamentApplications)
      .where(and(
        eq(tournamentApplications.tournamentId, tournament.id),
        eq(tournamentApplications.teamId, team.id),
        eq(tournamentApplications.status, "approved"),
      ))
      .limit(1)
    if (approved) throw new Error("Your team is already approved for this tournament - register your squad")

    const [inserted] = await tx
      .insert(tournamentApplications)
      .values({ tenantId: tournament.tenantId, tournamentId: tournament.id, teamId: team.id, submittedBy: account.id })
      .returning({ id: tournamentApplications.id })
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: tournament.tenantId,
      actorId: account.id,
      actorRole: null,
      method: "TOURNAMENT_APPLICATION_SUBMITTED",
      path: "/dashboard/tournaments",
      statusCode: "200",
      payload: { resourceId: tournament.id, applicationId: inserted.id, teamId: team.id },
    })
    return { submitted: true, applicationId: inserted.id, status: "submitted", changed: true }
  }, { isolationLevel: "read committed" })
}

export async function withdrawTournamentApplication(
  applicationId: string,
): Promise<{ withdrawn: true; changed: boolean }> {
  z.string().uuid().parse(applicationId)
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  return db.transaction(async (tx) => {
    const [application] = await tx
      .select({
        id: tournamentApplications.id,
        tenantId: tournamentApplications.tenantId,
        teamId: tournamentApplications.teamId,
        status: tournamentApplications.status,
      })
      .from(tournamentApplications)
      .where(eq(tournamentApplications.id, applicationId))
      .limit(1)
    if (!application) throw new Error("Application not found")

    const [team] = await tx
      .select({ managerId: teams.managerId })
      .from(teams)
      .where(eq(teams.id, application.teamId))
      .limit(1)
    if (!team || team.managerId !== account.id) {
      throw new Error("Forbidden: only the team's manager can withdraw this application")
    }

    // read committed: the row read above was NOT locked, so a concurrent
    // decision could have committed between the snapshot and this lock. What
    // the FOR UPDATE hands back is the committed truth - transitions consume
    // this reread, never the snapshot, so terminal history cannot be
    // overwritten (CHECK-backed by tournament_applications_resolution_check).
    const [locked] = await tx.execute(sql`SELECT ${tournamentApplications.status} FROM ${tournamentApplications}
      WHERE ${tournamentApplications.id} = ${application.id} FOR UPDATE`)
    const liveStatus = isStatusRow(locked) ? locked.status : application.status
    if (!isLiveStatus(liveStatus)) {
      // Terminal: a withdrawal replay is a pure read.
      return { withdrawn: true, changed: false }
    }
    const target = memberMove(liveStatus, "withdraw")
    if (!target) throw new Error("Only a live application can be withdrawn")
    // The member resolved it: a leave time, NO decider (CHECK shape).
    await tx
      .update(tournamentApplications)
      .set({ status: target, decidedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tournamentApplications.id, application.id), eq(tournamentApplications.status, liveStatus)))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: application.tenantId,
      actorId: account.id,
      actorRole: null,
      method: "TOURNAMENT_APPLICATION_WITHDRAWN",
      path: "/dashboard/tournaments",
      statusCode: "200",
      payload: { resourceId: application.id, teamId: application.teamId, from: liveStatus },
    })
    return { withdrawn: true, changed: true }
  }, { isolationLevel: "read committed" })
}

export async function decideTournamentApplication(
  applicationId: string,
  decision: string,
): Promise<{ decided: true; status: string; changed: boolean }> {
  const target = resolveOwnerDecision(decision)
  if (!target) throw new Error("Decision must be approve, request_information, waitlist or decline")
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)
  z.string().uuid().parse(applicationId)

  return db.transaction(async (tx) => {
    const [application] = await tx
      .select({ id: tournamentApplications.id, tenantId: tournamentApplications.tenantId, status: tournamentApplications.status })
      .from(tournamentApplications)
      .where(eq(tournamentApplications.id, applicationId))
      .limit(1)
    if (!application) throw new Error("Application not found")
    // Decisions are the league OWNER's authority (REG-03 review authority).
    const [member] = await tx
      .select({ role: userTenantRoles.role, status: userTenantRoles.status, expiresAt: userTenantRoles.expiresAt })
      .from(userTenantRoles)
      .where(and(eq(userTenantRoles.userId, account.id), eq(userTenantRoles.tenantId, application.tenantId)))
      .limit(1)
    // Effective membership (SCORE-09): a suspended or expired owner role no
    // longer carries review authority - same rule as activeMembershipIn.
    if (!member || !membershipGrantsAccess(member) || member.role !== "league_owner") {
      throw new Error("Forbidden: only the league owner can decide applications")
    }

    // read committed: same locked reread as the withdrawal path - the
    // snapshot above may be stale; a concurrent withdrawal/decision that
    // committed before this lock wins and the replay is a pure read.
    const [locked] = await tx.execute(sql`SELECT ${tournamentApplications.status} FROM ${tournamentApplications}
      WHERE ${tournamentApplications.id} = ${application.id} FOR UPDATE`)
    const liveStatus = isStatusRow(locked) ? locked.status : application.status
    if (!isLiveStatus(liveStatus)) {
      // Terminal: a decision replay is a pure read (history is not re-decided).
      return { decided: true, status: liveStatus, changed: false }
    }
    const next = ownerMove(liveStatus, decision as OwnerDecision)
    if (!next) throw new Error("Only a live application can be decided")
    await tx
      .update(tournamentApplications)
      .set({ status: next, decidedAt: new Date(), decidedBy: account.id, updatedAt: new Date() })
      .where(and(eq(tournamentApplications.id, application.id), eq(tournamentApplications.status, liveStatus)))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: application.tenantId,
      actorId: account.id,
      actorRole: "league_owner",
      method: `TOURNAMENT_APPLICATION_${decision.toUpperCase()}`,
      path: "/dashboard/tournaments",
      statusCode: "200",
      payload: { resourceId: application.id, decision, from: liveStatus },
    })
    return { decided: true, status: next, changed: true }
  }, { isolationLevel: "read committed" })
}

/** Owner read: bounded live-first application list with team names. */
export async function readTournamentApplications(tournamentId: string) {
  z.string().uuid().parse(tournamentId)
  return db
    .select({
      id: tournamentApplications.id,
      teamId: tournamentApplications.teamId,
      teamName: teams.name,
      status: tournamentApplications.status,
      createdAt: tournamentApplications.createdAt,
    })
    .from(tournamentApplications)
    .innerJoin(teams, eq(teams.id, tournamentApplications.teamId))
    .where(eq(tournamentApplications.tournamentId, tournamentId))
    .orderBy(asc(tournamentApplications.createdAt))
    .limit(100)
}

/**
 * REG-03 (Batch 164): the threaded reply journey - the needs_information
 * conversation gap B147 documented. The thread is a RECORD: the member side
 * is the team's CURRENT manager, the owner side is a league_owner; both are
 * verified server-side inside the transaction (author_side is never
 * client-asserted). Replies attach only to a LIVE application - resolving
 * an application locks its history. A reply NEVER mutates the state
 * machine; decisions remain the owner's audited moves.
 */
export async function replyToTournamentApplication(
  applicationId: string,
  rawBody: string,
): Promise<{ replied: true; side: ReplyAuthorSide; changed: boolean }> {
  z.string().uuid().parse(applicationId)
  const normalized = normalizeReplyBody(rawBody)
  if ("refusal" in normalized) throw new Error(describeReplyRefusal(normalized.refusal))
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  return db.transaction(async (tx) => {
    const [application] = await tx
      .select({
        id: tournamentApplications.id,
        tenantId: tournamentApplications.tenantId,
        teamId: tournamentApplications.teamId,
        status: tournamentApplications.status,
      })
      .from(tournamentApplications)
      .where(eq(tournamentApplications.id, applicationId))
      .limit(1)
    if (!application) throw new Error("Application not found")

    const [team] = await tx
      .select({ managerId: teams.managerId })
      .from(teams)
      .where(eq(teams.id, application.teamId))
      .limit(1)
    if (!team) throw new Error("Application team not found")
    const [membership] = await tx
      .select({ role: userTenantRoles.role, status: userTenantRoles.status, expiresAt: userTenantRoles.expiresAt })
      .from(userTenantRoles)
      .where(and(eq(userTenantRoles.userId, account.id), eq(userTenantRoles.tenantId, application.tenantId)))
      .limit(1)

    const side = replyAuthorSide(
      { userId: account.id },
      { teamManagerId: team.managerId ?? "", tenantId: application.tenantId },
      membership,
    )
    if (!side) throw new Error(describeReplyRefusal("forbidden"))

    // Serialize against a concurrent owner decision: the status that gates
    // the reply is read under the same lock the decision writer takes.
    await tx.execute(sql`SELECT ${tournamentApplications.id} FROM ${tournamentApplications}
      WHERE ${tournamentApplications.id} = ${application.id} FOR UPDATE`)
    if (replyThreadTarget(application.status) === "terminal") {
      throw new Error(describeReplyRefusal("terminal"))
    }

    // Anti-flood: a bounded conversation keeps the record readable.
    const [{ total }] = await tx
      .select({ total: count() })
      .from(tournamentApplicationReplies)
      .where(eq(tournamentApplicationReplies.applicationId, application.id))
    if (Number(total) >= REPLIES_PER_APPLICATION_LIMIT) {
      throw new Error(describeReplyRefusal("flood"))
    }

    await tx.insert(tournamentApplicationReplies).values({
      tenantId: application.tenantId,
      applicationId: application.id,
      authorId: account.id,
      authorSide: side,
      body: normalized.body,
    })

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: application.tenantId,
      actorId: account.id,
      actorRole: side === "owner" ? "league_owner" : null,
      method: "TOURNAMENT_APPLICATION_REPLIED",
      path: "/dashboard/tournaments",
      statusCode: "200",
      payload: { resourceId: application.id, side, status: application.status },
    })
    return { replied: true, side, changed: true }
  }, { isolationLevel: "read committed" })
}

export type ApplicationReplyRow = {
  id: string
  authorSide: string
  body: string
  createdAt: Date
}

/** Participant-only thread read: the CURRENT manager or the league owner. */
export async function readApplicationReplies(
  applicationId: string,
): Promise<ApplicationReplyRow[]> {
  z.string().uuid().parse(applicationId)
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  const [application] = await db
    .select({
      id: tournamentApplications.id,
      tenantId: tournamentApplications.tenantId,
      teamId: tournamentApplications.teamId,
      status: tournamentApplications.status,
    })
    .from(tournamentApplications)
    .where(eq(tournamentApplications.id, applicationId))
    .limit(1)
  if (!application) throw new Error("Application not found")
  const [team] = await db
    .select({ managerId: teams.managerId })
    .from(teams)
    .where(eq(teams.id, application.teamId))
    .limit(1)
  const [membership] = await db
    .select({ role: userTenantRoles.role, status: userTenantRoles.status, expiresAt: userTenantRoles.expiresAt })
    .from(userTenantRoles)
    .where(and(eq(userTenantRoles.userId, account.id), eq(userTenantRoles.tenantId, application.tenantId)))
    .limit(1)
  const side = replyAuthorSide(
    { userId: account.id },
    { teamManagerId: team?.managerId ?? "", tenantId: application.tenantId },
    membership,
  )
  if (!side) throw new Error(describeReplyRefusal("forbidden"))

  return db
    .select({
      id: tournamentApplicationReplies.id,
      authorSide: tournamentApplicationReplies.authorSide,
      body: tournamentApplicationReplies.body,
      createdAt: tournamentApplicationReplies.createdAt,
    })
    .from(tournamentApplicationReplies)
    .where(eq(tournamentApplicationReplies.applicationId, application.id))
    .orderBy(asc(tournamentApplicationReplies.createdAt))
    .limit(REPLIES_PER_APPLICATION_LIMIT)
}
