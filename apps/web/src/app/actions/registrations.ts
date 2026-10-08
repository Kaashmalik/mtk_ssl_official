"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db, withTenantContext } from "@mtk/database"
import { leagueRegistrations, teams, tournaments } from "@mtk/database"
import { eq, and, desc } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"


const registerTeamSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tournamentId: z.string().uuid(),
  teamId: z.string().uuid(),
  squadPlayerIds: z.array(z.string().uuid()).min(1, "Select at least 1 player").max(30),
  registrationFee: z.string().optional().default("0"),
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

    const [tournament] = await db.select().from(tournaments)
      .where(and(eq(tournaments.id, validated.tournamentId), eq(tournaments.tenantId, tenant.id)))
      .limit(1)
    if (!tournament) throw new Error("Tournament not found")
    if (!tournament.registrationOpen) {
      throw new Error("Registration is closed for this tournament")
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
      registeredBy: userId,
      status: "pending",
      paymentStatus: "unpaid",
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

  const reg = await withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [updated] = await db.update(leagueRegistrations).set({
      status: "approved",
      approvedBy: userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(leagueRegistrations.id, registrationId),
      eq(leagueRegistrations.tenantId, tenant.id),
    )).returning()
    if (!updated) throw new Error("Registration not found")

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

export const rejectRegistration = withAuth("registration:manage", async (registrationId: string, reason?: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()

  const reg = await withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [updated] = await db.update(leagueRegistrations).set({
      status: "rejected",
      rejectionReason: reason ?? null,
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

  return withTenantContext({ userId, tenantId: tenant.id }, () =>
    db.select().from(leagueRegistrations)
      .where(and(
        eq(leagueRegistrations.tenantId, tenant.id),
        eq(leagueRegistrations.registeredBy, userId),
      ))
      .orderBy(desc(leagueRegistrations.createdAt)),
  )
})
