import { randomUUID } from "crypto"
import { auditLogs, db, leagueRegistrations, teams, tournaments, userTenantRoles, users } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { auth } from "@clerk/nextjs/server"
import {
  canApproveRegistration,
  canRejectRegistration,
  canSetPaymentStatus,
  evaluateSquadEligibility,
  sameLeague,
} from "@mtk/database/lib/registration-eligibility-policy"
import { membershipGrantsAccess } from "@mtk/database"

/**
 * REG-04 (Batch 148): registration approval, fee status and squad
 * eligibility. Approval is a TRANSITION (only pending/waitlisted may be
 * approved/rejected); payment states move only forward; squad eligibility
 * is a pure derived answer from the policy; cross-tenant bindings are
 * refused outright. Every real change is audited; terminal replays are
 * pure reads.
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

const ownerOf = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  account: { id: string },
  tenantId: string,
) => {
  const [member] = await tx
    .select({ role: userTenantRoles.role, status: userTenantRoles.status, expiresAt: userTenantRoles.expiresAt })
    .from(userTenantRoles)
    .where(and(eq(userTenantRoles.userId, account.id), eq(userTenantRoles.tenantId, tenantId)))
    .limit(1)
  if (!member || member.status !== "active" || member.role !== "league_owner") {
    throw new Error("Forbidden: only the league owner can manage registrations")
  }
}

export async function approveRegistration(registrationId: string): Promise<{ approved: true; changed: boolean }> {
  z.string().uuid().parse(registrationId)
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  return db.transaction(async (tx) => {
    const [registration] = await tx
      .select({ id: leagueRegistrations.id, tenantId: leagueRegistrations.tenantId, tournamentId: leagueRegistrations.tournamentId, teamId: leagueRegistrations.teamId, status: leagueRegistrations.status })
      .from(leagueRegistrations)
      .where(eq(leagueRegistrations.id, registrationId))
      .limit(1)
    if (!registration) throw new Error("Registration not found")
    await ownerOf(tx, account, registration.tenantId)

    await tx.execute(sql`SELECT ${leagueRegistrations.id} FROM ${leagueRegistrations} WHERE ${leagueRegistrations.id} = ${registration.id} FOR UPDATE`)
    if (registration.status === "approved") return { approved: true, changed: false } // terminal replay
    if (!canApproveRegistration(registration.status)) throw new Error("Only a pending or waitlisted registration can be approved")

    // Cross-tenant guard: the registration's tournament must be in the
    // SAME league as the registration itself. Never bind cross-tenant
    // resources, even by an owner.
    const [tournament] = await tx
      .select({ tenantId: tournaments.tenantId })
      .from(tournaments)
      .where(eq(tournaments.id, registration.tournamentId))
      .limit(1)
    if (!tournament || !sameLeague(tournament.tenantId, registration.tenantId)) {
      throw new Error("Registration and tournament are in different leagues")
    }
    const [team] = await tx
      .select({ tenantId: teams.tenantId })
      .from(teams)
      .where(eq(teams.id, registration.teamId))
      .limit(1)
    if (!team || !sameLeague(team.tenantId, registration.tenantId)) {
      throw new Error("Registration and team are in different leagues")
    }

    await tx
      .update(leagueRegistrations)
      .set({ status: "approved", approvedBy: account.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(leagueRegistrations.id, registration.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: registration.tenantId,
      actorId: account.id,
      actorRole: "league_owner",
      method: "REGISTRATION_APPROVED",
      path: "/dashboard/registrations",
      statusCode: "200",
      payload: { resourceId: registration.id, tournamentId: registration.tournamentId, teamId: registration.teamId },
    })
    return { approved: true, changed: true }
  }, { isolationLevel: "read committed" })
}

export async function rejectRegistration(registrationId: string, reason: string | null): Promise<{ rejected: true; changed: boolean }> {
  z.string().uuid().parse(registrationId)
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)
  const cleanReason = reason ? reason.trim().slice(0, 500) : null

  return db.transaction(async (tx) => {
    const [registration] = await tx
      .select({ id: leagueRegistrations.id, tenantId: leagueRegistrations.tenantId, status: leagueRegistrations.status })
      .from(leagueRegistrations)
      .where(eq(leagueRegistrations.id, registrationId))
      .limit(1)
    if (!registration) throw new Error("Registration not found")
    await ownerOf(tx, account, registration.tenantId)

    await tx.execute(sql`SELECT ${leagueRegistrations.id} FROM ${leagueRegistrations} WHERE ${leagueRegistrations.id} = ${registration.id} FOR UPDATE`)
    if (registration.status === "rejected") return { rejected: true, changed: false }
    if (!canRejectRegistration(registration.status)) throw new Error("Only a pending or waitlisted registration can be rejected")

    await tx
      .update(leagueRegistrations)
      .set({ status: "rejected", rejectionReason: cleanReason, updatedAt: new Date() })
      .where(eq(leagueRegistrations.id, registration.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: registration.tenantId,
      actorId: account.id,
      actorRole: "league_owner",
      method: "REGISTRATION_REJECTED",
      path: "/dashboard/registrations",
      statusCode: "200",
      payload: { resourceId: registration.id, reason: cleanReason },
    })
    return { rejected: true, changed: true }
  }, { isolationLevel: "read committed" })
}

export async function updateRegistrationPaymentStatus(
  registrationId: string,
  next: string,
): Promise<{ updated: true; changed: boolean }> {
  z.string().uuid().parse(registrationId)
  if (!["unpaid", "paid", "refunded", "waived"].includes(next)) throw new Error("Unknown payment status")
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  return db.transaction(async (tx) => {
    const [registration] = await tx
      .select({ id: leagueRegistrations.id, tenantId: leagueRegistrations.tenantId, paymentStatus: leagueRegistrations.paymentStatus })
      .from(leagueRegistrations)
      .where(eq(leagueRegistrations.id, registrationId))
      .limit(1)
    if (!registration) throw new Error("Registration not found")
    await ownerOf(tx, account, registration.tenantId)

    await tx.execute(sql`SELECT ${leagueRegistrations.id} FROM ${leagueRegistrations} WHERE ${leagueRegistrations.id} = ${registration.id} FOR UPDATE`)
    if (registration.paymentStatus === next) return { updated: true, changed: false }
    if (!canSetPaymentStatus(registration.paymentStatus, next)) {
      throw new Error(`Payment status cannot move from ${registration.paymentStatus} to ${next}`)
    }
    await tx
      .update(leagueRegistrations)
      .set({ paymentStatus: next as "unpaid" | "paid" | "refunded" | "waived", updatedAt: new Date() })
      .where(eq(leagueRegistrations.id, registration.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: registration.tenantId,
      actorId: account.id,
      actorRole: "league_owner",
      method: "REGISTRATION_PAYMENT_UPDATED",
      path: "/dashboard/registrations",
      statusCode: "200",
      payload: { resourceId: registration.id, from: registration.paymentStatus, to: next },
    })
    return { updated: true, changed: true }
  }, { isolationLevel: "read committed" })
}

export async function setRegistrationSquad(registrationId: string, playerIds: string[]): Promise<{ updated: true; changed: boolean }> {
  z.string().uuid().parse(registrationId)
  for (const id of playerIds) z.string().uuid().parse(id)
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  return db.transaction(async (tx) => {
    const [registration] = await tx
      .select({ id: leagueRegistrations.id, tenantId: leagueRegistrations.tenantId, status: leagueRegistrations.status, squadPlayerIds: leagueRegistrations.squadPlayerIds, teamId: leagueRegistrations.teamId })
      .from(leagueRegistrations)
      .where(eq(leagueRegistrations.id, registrationId))
      .limit(1)
    if (!registration) throw new Error("Registration not found")
    // Squad edits belong to the owning team's manager, not the league owner.
    const [team] = await tx
      .select({ managerId: teams.managerId })
      .from(teams)
      .where(eq(teams.id, registration.teamId))
      .limit(1)
    if (!team || team.managerId !== account.id) throw new Error("Forbidden: only the team's manager can set the squad")
    await activeMembershipIn(tx, account.id, registration.tenantId)

    await tx.execute(sql`SELECT ${leagueRegistrations.id} FROM ${leagueRegistrations} WHERE ${leagueRegistrations.id} = ${registration.id} FOR UPDATE`)
    const previous = registration.squadPlayerIds ?? []
    const same = previous.length === playerIds.length && previous.every((v, i) => v === playerIds[i])
    if (same) return { updated: true, changed: false }
    await tx
      .update(leagueRegistrations)
      .set({ squadPlayerIds: playerIds, updatedAt: new Date() })
      .where(eq(leagueRegistrations.id, registration.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: registration.tenantId,
      actorId: account.id,
      actorRole: null,
      method: "REGISTRATION_SQUAD_SET",
      path: "/dashboard/registrations",
      statusCode: "200",
      payload: { resourceId: registration.id, size: playerIds.length },
    })
    return { updated: true, changed: true }
  }, { isolationLevel: "read committed" })
}

export async function readRegistrationEligibility(registrationId: string, minSquadSize: number) {
  z.string().uuid().parse(registrationId)
  const [registration] = await db
    .select({ status: leagueRegistrations.status, paymentStatus: leagueRegistrations.paymentStatus, squadPlayerIds: leagueRegistrations.squadPlayerIds })
    .from(leagueRegistrations)
    .where(eq(leagueRegistrations.id, registrationId))
    .limit(1)
  if (!registration) throw new Error("Registration not found")
  return evaluateSquadEligibility({
    approvalStatus: registration.status,
    paymentStatus: registration.paymentStatus,
    squadSize: (registration.squadPlayerIds ?? []).length,
    minSquadSize,
  })
}
