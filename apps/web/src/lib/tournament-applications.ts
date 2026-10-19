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
function tournamentAcceptsApplications(tournament: { status: string }): { ok: true } | { ok: false; reason: string } {
  if (tournament.status === "completed" || tournament.status === "cancelled") {
    return { ok: false, reason: "This tournament has ended - applications are closed" }
  }
  return { ok: true }
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
      .select({ id: tournaments.id, tenantId: tournaments.tenantId, status: tournaments.status })
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
      .select({ id: teams.id, managerId: teams.managerId, isActive: teams.isActive })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
    if (!team || !team.isActive) throw new Error("Team not found")
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

    await tx.execute(sql`SELECT ${tournamentApplications.id} FROM ${tournamentApplications}
      WHERE ${tournamentApplications.id} = ${application.id} FOR UPDATE`)
    if (!isLiveStatus(application.status)) {
      // Terminal: a withdrawal replay is a pure read.
      return { withdrawn: true, changed: false }
    }
    const target = memberMove(application.status, "withdraw")
    if (!target) throw new Error("Only a live application can be withdrawn")
    // The member resolved it: a leave time, NO decider (CHECK shape).
    await tx
      .update(tournamentApplications)
      .set({ status: target, decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(tournamentApplications.id, application.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: application.tenantId,
      actorId: account.id,
      actorRole: null,
      method: "TOURNAMENT_APPLICATION_WITHDRAWN",
      path: "/dashboard/tournaments",
      statusCode: "200",
      payload: { resourceId: application.id, teamId: application.teamId, from: application.status },
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
    if (!member || member.status !== "active" || member.role !== "league_owner") {
      throw new Error("Forbidden: only the league owner can decide applications")
    }

    await tx.execute(sql`SELECT ${tournamentApplications.id} FROM ${tournamentApplications}
      WHERE ${tournamentApplications.id} = ${application.id} FOR UPDATE`)
    if (!isLiveStatus(application.status)) {
      // Terminal: a decision replay is a pure read (history is not re-decided).
      return { decided: true, status: application.status, changed: false }
    }
    const next = ownerMove(application.status, decision as OwnerDecision)
    if (!next) throw new Error("Only a live application can be decided")
    await tx
      .update(tournamentApplications)
      .set({ status: next, decidedAt: new Date(), decidedBy: account.id, updatedAt: new Date() })
      .where(eq(tournamentApplications.id, application.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: application.tenantId,
      actorId: account.id,
      actorRole: "league_owner",
      method: `TOURNAMENT_APPLICATION_${decision.toUpperCase()}`,
      path: "/dashboard/tournaments",
      statusCode: "200",
      payload: { resourceId: application.id, decision, from: application.status },
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
