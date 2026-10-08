"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db, withTenantContext } from "@mtk/database"
import { leagueRegistrations, teams, tournaments, users, players, payments } from "@mtk/database"
import { eq, and, desc, inArray } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"


const registerTeamSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tournamentId: z.string().uuid(),
  teamId: z.string().uuid(),
  squadPlayerIds: z.array(z.string().uuid()).min(1, "Select at least 1 player").max(30)
    .refine((ids) => new Set(ids).size === ids.length, "A player can only be selected once"),
  notes: z.string().max(500).optional().nullable(),
})

export type RegisterTeamInput = z.infer<typeof registerTeamSchema>

async function requireTenant() {
  const tenant = await getMyTenant()
  if (!tenant) throw new Error("Tenant not found")
  return tenant
}

export const registerTeam = withAuth("registration:create", async (input: RegisterTeamInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const [actor] = await db.select({ id: users.id }).from(users)
    .where(eq(users.clerkId, userId)).limit(1)
  if (!actor) throw new Error("Your account is still provisioning. Please try again.")
  const validated = registerTeamSchema.parse({
    ...input,
    tenantId: input.tenantId ?? tenant.id,
  })
  const tenantId = validated.tenantId ?? tenant.id
  if (tenantId !== tenant.id) throw new Error("Invalid tenant")

  const reg = await withTenantContext({ userId, tenantId }, async () => {
    const [team] = await db.select().from(teams)
      .where(and(eq(teams.id, validated.teamId), eq(teams.tenantId, tenant.id)))
      .limit(1)
    if (!team) throw new Error("Team not found")
    if (tenant.ownerId !== actor.id && team.managerId !== actor.id && team.captainId !== actor.id) {
      throw new Error("Only the league owner or this team's manager/captain can register it")
    }

    const [tournament] = await db.select().from(tournaments)
      .where(and(eq(tournaments.id, validated.tournamentId), eq(tournaments.tenantId, tenant.id)))
      .limit(1)
    if (!tournament) throw new Error("Tournament not found")
    if (!tournament.registrationOpen) {
      throw new Error("Registration is closed for this tournament")
    }
    if (tournament.registrationStart && tournament.registrationStart > new Date()) {
      throw new Error("Registration has not opened yet")
    }
    if (tournament.registrationEnd && tournament.registrationEnd < new Date()) {
      throw new Error("The registration deadline has passed")
    }

    const selectedPlayers = await db.select({ id: players.id }).from(players)
      .where(and(
        eq(players.teamId, team.id),
        inArray(players.id, validated.squadPlayerIds),
      ))
    if (selectedPlayers.length !== validated.squadPlayerIds.length) {
      throw new Error("Every selected squad member must belong to this team")
    }
    if (team.maxSquadSize && validated.squadPlayerIds.length > team.maxSquadSize) {
      throw new Error(`This team may register no more than ${team.maxSquadSize} players`)
    }

    const existing = await db.select().from(leagueRegistrations)
      .where(and(
        eq(leagueRegistrations.teamId, validated.teamId),
        eq(leagueRegistrations.tournamentId, validated.tournamentId),
        eq(leagueRegistrations.tenantId, tenant.id),
      ))
      .limit(1)
    if (existing.length > 0) throw new Error("Team is already registered for this tournament")

    const [created] = await db.insert(leagueRegistrations).values({
      ...validated,
      tenantId,
      registrationFee: tournament.entryFee ?? "0",
      registeredBy: actor.id,
      status: "pending",
      paymentStatus: Number(tournament.entryFee ?? 0) > 0 ? "unpaid" : "waived",
    }).returning()

    return created
  })

  revalidatePath(`/dashboard/tournaments/${validated.tournamentId}`)
  revalidatePath("/dashboard/registrations")
  return { success: true, registration: reg }
})

export const approveRegistration = withAuth("registration:manage", async (registrationId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const [actor] = await db.select({ id: users.id }).from(users)
    .where(eq(users.clerkId, userId)).limit(1)
  if (!actor) throw new Error("Your account is still provisioning. Please try again.")

  const reg = await withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [existing] = await db.select().from(leagueRegistrations).where(and(
      eq(leagueRegistrations.id, registrationId),
      eq(leagueRegistrations.tenantId, tenant.id),
    )).limit(1)
    if (!existing) throw new Error("Registration not found")
    if (existing.status !== "pending") throw new Error("This registration has already been reviewed")
    if (existing.paymentStatus !== "paid" && existing.paymentStatus !== "waived") {
      throw new Error("Confirm the registration fee payment before approving this team")
    }

    const [updated] = await db.update(leagueRegistrations).set({
      status: "approved",
      approvedBy: actor.id,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(leagueRegistrations.id, registrationId),
      eq(leagueRegistrations.tenantId, tenant.id),
      eq(leagueRegistrations.status, "pending"),
    )).returning()
    if (!updated) throw new Error("This registration has already been reviewed")

    // Link team to tournament so standings/teams tabs stay consistent.
    await db.update(teams).set({
      tournamentId: updated.tournamentId,
      updatedAt: new Date(),
    }).where(and(
      eq(teams.id, updated.teamId),
      eq(teams.tenantId, tenant.id),
    ))

    return updated
  })

  revalidatePath(`/dashboard/tournaments/${reg.tournamentId}`)
  revalidatePath("/dashboard/registrations")
  return { success: true, registration: reg }
})

/** League owners confirm off-platform team entry fees after checking receipt/reference. */
export const confirmRegistrationPayment = withAuth("registration:manage", async (
  registrationId: string,
  input: { method: "jazzcash" | "easypaisa" | "bank_transfer"; transactionReference: string },
) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const [actor] = await db.select({ id: users.id }).from(users)
    .where(eq(users.clerkId, userId)).limit(1)
  if (!actor || tenant.ownerId !== actor.id) throw new Error("Only the league owner can confirm a fee payment")

  const transactionReference = z.string().trim().min(3).max(100).parse(input.transactionReference)
  const method = z.enum(["jazzcash", "easypaisa", "bank_transfer"]).parse(input.method)
  const result = await withTenantContext({ userId, tenantId: tenant.id }, () => db.transaction(async (tx) => {
    const [registration] = await tx.select().from(leagueRegistrations).where(and(
      eq(leagueRegistrations.id, registrationId),
      eq(leagueRegistrations.tenantId, tenant.id),
    )).for("update").limit(1)
    if (!registration) throw new Error("Registration not found")
    if (registration.status !== "pending") throw new Error("Only pending registrations can have fees confirmed")
    if (registration.paymentStatus !== "unpaid") throw new Error("This registration fee is already resolved")
    const amount = Number(registration.registrationFee ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("This registration does not have a payable fee")

    const now = new Date()
    const [payment] = await tx.insert(payments).values({
      tenantId: tenant.id,
      userId: actor.id,
      amount: String(amount),
      currency: "PKR",
      paymentMethod: method,
      status: "completed",
      transactionId: transactionReference,
      paidAt: now,
      completedAt: now,
      paymentType: "tournament_registration",
      referenceId: registration.id,
      referenceType: "league_registration",
      description: `Team entry fee for tournament ${registration.tournamentId}`,
      metadata: { verifiedByLeagueOwner: true },
    }).returning({ id: payments.id })

    const [updated] = await tx.update(leagueRegistrations).set({
      paymentStatus: "paid",
      paymentTransactionId: transactionReference,
      updatedAt: now,
    }).where(and(
      eq(leagueRegistrations.id, registration.id),
      eq(leagueRegistrations.tenantId, tenant.id),
      eq(leagueRegistrations.paymentStatus, "unpaid"),
    )).returning({ id: leagueRegistrations.id })
    if (!updated) throw new Error("Registration fee status changed; reload and try again")
    return { paymentId: payment.id }
  }))

  revalidatePath("/dashboard/registrations")
  return { success: true, ...result }
})

export const rejectRegistration = withAuth("registration:manage", async (registrationId: string, reason?: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  if (!reason?.trim()) throw new Error("Provide a reason for rejecting the registration")

  const reg = await withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [updated] = await db.update(leagueRegistrations).set({
      status: "rejected",
      rejectionReason: reason.trim(),
      updatedAt: new Date(),
    }).where(and(
      eq(leagueRegistrations.id, registrationId),
      eq(leagueRegistrations.tenantId, tenant.id),
    )).returning()
    if (!updated) throw new Error("Registration not found")
    return updated
  })

  revalidatePath(`/dashboard/tournaments/${reg.tournamentId}`)
  revalidatePath("/dashboard/registrations")
  return { success: true, registration: reg }
})

export const getRegistrations = withAuth("registration:manage", async (tournamentId?: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()

  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const conditions = [eq(leagueRegistrations.tenantId, tenant.id)]
    if (tournamentId) {
      conditions.push(eq(leagueRegistrations.tournamentId, tournamentId))
    }
    return db.select().from(leagueRegistrations)
      .where(and(...conditions))
      .orderBy(desc(leagueRegistrations.createdAt))
  })
})

export const getMyRegistrations = withAuth("registration:create", async (tenantId: string) => {
  const { userId } = await auth()
  if (!userId) return []
  const tenant = await requireTenant()
  if (tenantId !== tenant.id) throw new Error("Invalid tenant")
  const [actor] = await db.select({ id: users.id }).from(users)
    .where(eq(users.clerkId, userId)).limit(1)
  if (!actor) return []

  return withTenantContext({ userId, tenantId: tenant.id }, () =>
    db.select().from(leagueRegistrations)
      .where(and(
        eq(leagueRegistrations.tenantId, tenant.id),
        eq(leagueRegistrations.registeredBy, actor.id),
      ))
      .orderBy(desc(leagueRegistrations.createdAt)),
  )
})
