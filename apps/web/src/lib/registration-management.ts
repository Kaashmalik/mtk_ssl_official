import { randomUUID } from "crypto"
import { teamManagementGrant } from "@mtk/database/lib/resource-grants"
import {
  db, users, tenants, userTenantRoles, teams, tournaments, players,
  leagueRegistrations, payments, auditLogs, membershipGrantsAccess,
  type LeagueRegistration, type Team, type Tournament,
} from "@mtk/database"
import { and, eq, inArray, count, sql } from "drizzle-orm"
import { z } from "zod"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Operation = "REGISTRATION_CREATE" | "REGISTRATION_APPROVE" | "REGISTRATION_REJECT"
  | "REGISTRATION_PAYMENT" | "REGISTRATION_WITHDRAW"

// Review writers lock account -> league -> membership -> tournament -> team ->
// registration. READ COMMITTED reads after waits must recheck current authority
// and references. Tournament locks always precede registration locks so approval
// cannot deadlock with a concurrent registration. Never take match locks here.
async function actorContext(tx: Tx, clerkId: string, tenantId: string, operation: Operation) {
  const initial = await tx.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!initial) throw new Error("Forbidden: registration account not found")
  await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${initial.id} FOR UPDATE`)
  await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
  await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
    WHERE ${and(eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId))} FOR SHARE`)
  const actor = await tx.query.users.findFirst({ where: eq(users.id, initial.id) })
  const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  const member = await tx.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId)) })
  const mayDelegate = operation === "REGISTRATION_CREATE" || operation === "REGISTRATION_WITHDRAW"
  if (!actor || actor.id !== initial.id || actor.clerkId !== clerkId || actor.isActive !== true
    || !league || league.id !== tenantId || league.isActive !== true
    || !member || member.userId !== actor.id || member.tenantId !== tenantId || !membershipGrantsAccess(member)
    || !(member.role === "league_owner" || (mayDelegate && member.role === "team_manager"))) {
    throw new Error("Forbidden: your registration access changed")
  }
  return { actor, league, member }
}
type Context = Awaited<ReturnType<typeof actorContext>>

async function lockTournament(tx: Tx, tenantId: string, id: string, mode: "share" | "update"): Promise<Tournament> {
  await tx.execute(mode === "update"
    ? sql`SELECT ${tournaments.id} FROM ${tournaments} WHERE ${and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId))} FOR UPDATE`
    : sql`SELECT ${tournaments.id} FROM ${tournaments} WHERE ${and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId))} FOR SHARE`)
  const row = await tx.query.tournaments.findFirst({ where: and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId)) })
  if (!row || row.id !== id || row.tenantId !== tenantId) throw new Error("Tournament is unavailable in this league")
  return row
}
async function lockTeam(tx: Tx, tenantId: string, id: string, mode: "share" | "update"): Promise<Team> {
  await tx.execute(mode === "update"
    ? sql`SELECT ${teams.id} FROM ${teams} WHERE ${and(eq(teams.id, id), eq(teams.tenantId, tenantId))} FOR UPDATE`
    : sql`SELECT ${teams.id} FROM ${teams} WHERE ${and(eq(teams.id, id), eq(teams.tenantId, tenantId))} FOR SHARE`)
  const row = await tx.query.teams.findFirst({ where: and(eq(teams.id, id), eq(teams.tenantId, tenantId)) })
  if (!row || row.id !== id || row.tenantId !== tenantId) throw new Error("Team is unavailable in this league")
  return row
}
async function lockRegistration(tx: Tx, tenantId: string, id: string): Promise<LeagueRegistration> {
  await tx.execute(sql`SELECT ${leagueRegistrations.id} FROM ${leagueRegistrations}
    WHERE ${and(eq(leagueRegistrations.id, id), eq(leagueRegistrations.tenantId, tenantId))} FOR UPDATE`)
  const row = await tx.query.leagueRegistrations.findFirst({ where: and(
    eq(leagueRegistrations.id, id), eq(leagueRegistrations.tenantId, tenantId)) })
  if (!row || row.id !== id || row.tenantId !== tenantId) throw new Error("Registration not found")
  return row
}
async function findRegistration(tx: Tx, tenantId: string, id: string) {
  const row = await tx.query.leagueRegistrations.findFirst({ where: and(
    eq(leagueRegistrations.id, id), eq(leagueRegistrations.tenantId, tenantId)) })
  if (!row || row.id !== id || row.tenantId !== tenantId) throw new Error("Registration not found")
  return row
}
function delegateAuthority(context: Context, team: Team) {
  if (context.member.role === "league_owner") return
  // ISO-05 resource grant: the manager/captain pointers on the team row itself.
  if (teamManagementGrant(team, context.actor.id) === null) {
    throw new Error("Only the league owner or this team's manager/captain can manage it")
  }
}
function registrationSnapshot(reg: LeagueRegistration) {
  return { tournamentId: reg.tournamentId, teamId: reg.teamId, status: reg.status, paymentStatus: reg.paymentStatus }
}
async function audit(tx: Tx, context: Context, tenantId: string, method: Operation, resourceId: string,
  before: unknown, after: unknown, changedFields: string[]) {
  // Do not replicate squad lists, notes, fee references or account UUIDs into audit payloads.
  await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: context.actor.id, actorRole: context.member.role,
    method, path: `/dashboard/registrations/${resourceId}`, statusCode: "200",
    payload: { resourceId, before, after, changedFields } })
}

export const registerTeamSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tournamentId: z.string().uuid(),
  teamId: z.string().uuid(),
  squadPlayerIds: z.array(z.string().uuid()).min(1, "Select at least 1 player").max(30)
    .refine((ids) => new Set(ids).size === ids.length, "A player can only be selected once"),
  notes: z.string().trim().max(500).optional().nullable(),
}).strict()

export const confirmPaymentSchema = z.object({
  method: z.enum(["jazzcash", "easypaisa", "bank_transfer"]),
  transactionReference: z.string().trim().min(3).max(100),
}).strict()

export async function createLeagueRegistration(clerkId: string, tenantId: string, input: z.input<typeof registerTeamSchema>) {
  const parsed = registerTeamSchema.parse(input)
  if (parsed.tenantId && parsed.tenantId !== tenantId) throw new Error("Invalid tenant")
  return db.transaction(async (tx) => {
    const context = await actorContext(tx, clerkId, tenantId, "REGISTRATION_CREATE")
    const tournament = await lockTournament(tx, tenantId, parsed.tournamentId, "share")
    const team = await lockTeam(tx, tenantId, parsed.teamId, "share")
    if (team.isActive !== true) throw new Error("Team is unavailable in this league")
    delegateAuthority(context, team)

    if (!tournament.registrationOpen || !["draft", "registration", "live"].includes(tournament.status)) {
      throw new Error("Registration is closed for this tournament")
    }
    const now = new Date()
    if (tournament.registrationStart && tournament.registrationStart > now) throw new Error("Registration has not opened yet")
    if (tournament.registrationEnd && tournament.registrationEnd < now) throw new Error("The registration deadline has passed")

    const [existing] = await tx.select({ id: leagueRegistrations.id }).from(leagueRegistrations)
      .where(and(eq(leagueRegistrations.tenantId, tenantId), eq(leagueRegistrations.teamId, team.id),
        eq(leagueRegistrations.tournamentId, tournament.id))).limit(1)
    if (existing) throw new Error("Team is already registered for this tournament")

    const squad = await tx.select({ id: players.id }).from(players)
      .where(and(eq(players.tenantId, tenantId), eq(players.teamId, team.id), eq(players.isActive, true),
        inArray(players.id, parsed.squadPlayerIds)))
    if (squad.length !== parsed.squadPlayerIds.length) {
      throw new Error("Every selected squad member must be an active player on this team")
    }
    if (team.maxSquadSize && parsed.squadPlayerIds.length > team.maxSquadSize) {
      throw new Error(`This team may register no more than ${team.maxSquadSize} players`)
    }

    const fee = tournament.entryFee ?? "0"
    const [created] = await tx.insert(leagueRegistrations).values({
      tenantId, tournamentId: tournament.id, teamId: team.id, status: "pending",
      registeredBy: context.actor.id, registrationFee: fee,
      paymentStatus: Number(fee) > 0 ? "unpaid" : "waived",
      squadPlayerIds: parsed.squadPlayerIds, notes: parsed.notes ?? null,
    }).returning()
    if (!created) throw new Error("Registration could not be created. Please try again.")
    await audit(tx, context, tenantId, "REGISTRATION_CREATE", created.id, null, registrationSnapshot(created),
      ["tournamentId", "teamId", "squadPlayerIds", "notes", "paymentStatus"])
    return created
  }, { isolationLevel: "read committed" })
}

export async function approveLeagueRegistration(clerkId: string, tenantId: string, id: string) {
  z.string().uuid().parse(id)
  return db.transaction(async (tx) => {
    const context = await actorContext(tx, clerkId, tenantId, "REGISTRATION_APPROVE")
    const initial = await findRegistration(tx, tenantId, id)
    const tournament = await lockTournament(tx, tenantId, initial.tournamentId, "update")
    const team = await lockTeam(tx, tenantId, initial.teamId, "share")
    const registration = await lockRegistration(tx, tenantId, id)
    if (registration.status !== "pending") throw new Error("This registration has already been reviewed")
    if (registration.paymentStatus !== "paid" && registration.paymentStatus !== "waived") {
      throw new Error("Confirm the registration fee payment before approving this team")
    }
    if (tournament.maxTeams !== null) {
      const [row] = await tx.select({ total: count() }).from(leagueRegistrations)
        .where(and(eq(leagueRegistrations.tenantId, tenantId), eq(leagueRegistrations.tournamentId, tournament.id),
          eq(leagueRegistrations.status, "approved")))
      if (Number(row.total) >= tournament.maxTeams) throw new Error("This tournament is already at its maximum number of teams")
    }
    const now = new Date()
    const [updated] = await tx.update(leagueRegistrations)
      .set({ status: "approved", approvedBy: context.actor.id, approvedAt: now, updatedAt: now })
      .where(and(eq(leagueRegistrations.id, id), eq(leagueRegistrations.tenantId, tenantId),
        eq(leagueRegistrations.status, "pending"))).returning()
    if (!updated) throw new Error("This registration has already been reviewed")
    await tx.update(teams).set({ tournamentId: tournament.id, updatedAt: now })
      .where(and(eq(teams.id, team.id), eq(teams.tenantId, tenantId)))
    await audit(tx, context, tenantId, "REGISTRATION_APPROVE", id, registrationSnapshot(registration),
      registrationSnapshot(updated), ["status", "approvedBy", "approvedAt"])
    return updated
  }, { isolationLevel: "read committed" })
}

export async function rejectLeagueRegistration(clerkId: string, tenantId: string, id: string, reason: string) {
  z.string().uuid().parse(id)
  const cleanReason = z.string().trim().min(1, "Provide a reason for rejecting the registration").max(500).parse(reason)
  return db.transaction(async (tx) => {
    const context = await actorContext(tx, clerkId, tenantId, "REGISTRATION_REJECT")
    const initial = await findRegistration(tx, tenantId, id)
    await lockTournament(tx, tenantId, initial.tournamentId, "share")
    const registration = await lockRegistration(tx, tenantId, id)
    if (registration.status !== "pending") throw new Error("This registration has already been reviewed")
    const now = new Date()
    const [updated] = await tx.update(leagueRegistrations)
      .set({ status: "rejected", rejectionReason: cleanReason, updatedAt: now })
      .where(and(eq(leagueRegistrations.id, id), eq(leagueRegistrations.tenantId, tenantId),
        eq(leagueRegistrations.status, "pending"))).returning()
    if (!updated) throw new Error("This registration has already been reviewed")
    await audit(tx, context, tenantId, "REGISTRATION_REJECT", id, registrationSnapshot(registration),
      registrationSnapshot(updated), ["status", "rejectionReason"])
    return updated
  }, { isolationLevel: "read committed" })
}

export async function withdrawLeagueRegistration(clerkId: string, tenantId: string, id: string) {
  z.string().uuid().parse(id)
  return db.transaction(async (tx) => {
    const context = await actorContext(tx, clerkId, tenantId, "REGISTRATION_WITHDRAW")
    const initial = await findRegistration(tx, tenantId, id)
    await lockTournament(tx, tenantId, initial.tournamentId, "share")
    const team = await lockTeam(tx, tenantId, initial.teamId, "share")
    delegateAuthority(context, team)
    const registration = await lockRegistration(tx, tenantId, id)
    if (registration.status !== "pending" && registration.status !== "approved") {
      throw new Error("This registration can no longer be withdrawn")
    }
    const now = new Date()
    const [updated] = await tx.update(leagueRegistrations)
      .set({ status: "withdrawn", updatedAt: now })
      .where(and(eq(leagueRegistrations.id, id), eq(leagueRegistrations.tenantId, tenantId),
        eq(leagueRegistrations.status, registration.status))).returning()
    if (!updated) throw new Error("Registration changed. Reload before saving.")
    // Withdrawal keeps the squad, fee and any team/tournament linkage; refunds,
    // slot release and archival remain separate workflows.
    await audit(tx, context, tenantId, "REGISTRATION_WITHDRAW", id, registrationSnapshot(registration),
      registrationSnapshot(updated), ["status"])
    return updated
  }, { isolationLevel: "read committed" })
}

export async function confirmLeagueRegistrationPayment(clerkId: string, tenantId: string, id: string,
  input: z.input<typeof confirmPaymentSchema>) {
  z.string().uuid().parse(id)
  const parsed = confirmPaymentSchema.parse(input)
  return db.transaction(async (tx) => {
    const context = await actorContext(tx, clerkId, tenantId, "REGISTRATION_PAYMENT")
    const initial = await findRegistration(tx, tenantId, id)
    await lockTournament(tx, tenantId, initial.tournamentId, "share")
    const registration = await lockRegistration(tx, tenantId, id)
    if (registration.status !== "pending") throw new Error("Only pending registrations can have fees confirmed")
    if (registration.paymentStatus !== "unpaid") throw new Error("This registration fee is already resolved")
    const amount = Number(registration.registrationFee ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("This registration does not have a payable fee")

    const now = new Date()
    const [payment] = await tx.insert(payments).values({
      tenantId, userId: context.actor.id, amount: String(amount), currency: "PKR",
      paymentMethod: parsed.method, status: "completed", transactionId: parsed.transactionReference,
      paidAt: now, completedAt: now, paymentType: "tournament_registration",
      referenceId: registration.id, referenceType: "league_registration",
      description: `Team entry fee for tournament ${registration.tournamentId}`,
      metadata: { verifiedByLeagueOwner: true },
    }).returning({ id: payments.id })
    const [updated] = await tx.update(leagueRegistrations)
      .set({ paymentStatus: "paid", paymentTransactionId: parsed.transactionReference, updatedAt: now })
      .where(and(eq(leagueRegistrations.id, id), eq(leagueRegistrations.tenantId, tenantId),
        eq(leagueRegistrations.paymentStatus, "unpaid"))).returning({ id: leagueRegistrations.id })
    if (!updated) throw new Error("Registration fee status changed; reload and try again")
    await audit(tx, context, tenantId, "REGISTRATION_PAYMENT", id, { paymentStatus: "unpaid" },
      { paymentStatus: "paid" }, ["paymentStatus"])
    return { paymentId: payment.id }
  }, { isolationLevel: "read committed" })
}
