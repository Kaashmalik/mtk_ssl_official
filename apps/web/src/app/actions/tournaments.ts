"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { tournamentRepo } from "@mtk/database"
import { withTenantContext, resolveDefaultTenantId, type Tournament } from "@mtk/database"
import { z } from "zod"
import { withAuth } from "./action-guard"

const createTournamentSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z.string().min(2).max(100).optional(),
  description: z.string().max(5000).optional().nullable(),
  format: z.enum(["knockout", "league", "hybrid", "round_robin"]),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  registrationDeadline: z.string().optional().nullable(),
  registrationOpen: z.boolean().default(false),
  maxTeams: z.number().int().min(2).max(128).optional().nullable(),
  status: z.enum(["draft", "registration", "live", "completed", "cancelled"]).default("draft"),
})

const updateTournamentSchema = createTournamentSchema.partial()

const tournamentFiltersSchema = z.object({
  status: z.enum(["draft", "registration", "live", "completed", "cancelled"]).optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["name", "createdAt", "startDate"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})

export type CreateTournamentInput = z.input<typeof createTournamentSchema>
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>
export type TournamentFilters = z.infer<typeof tournamentFiltersSchema>

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

/**
 * Create a new tournament.
 *
 * The tenant context is resolved from Clerk auth, then passed into
 * `withTenantContext` so the repository layer auto-scopes the insert.
 */
export const createTournament = withAuth("tournament:create", async (input: CreateTournamentInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const tenantId = await resolveDefaultTenantId(userId)
  if (!tenantId) throw new Error("Tenant not found. Create a league first.")

  const validated = createTournamentSchema.parse(input)
  const slug = validated.slug || generateSlug(validated.name)

  // ── Tenant-scoped via withTenantContext ──
  // The repo's insert() will auto-set tenantId from context.
  // Even if `values` contained a tenantId field, it would be overridden.
  const [tournament] = await withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.insert<Tournament>({
      ...validated,
      slug,
      createdBy: userId,
    })
  )

  revalidatePath("/dashboard/tournaments")
  revalidatePath("/dashboard")
  return { success: true, tournament }
})

/**
 * Update a tournament.
 * The repo's updateById() scopes by both id AND tenantId from context.
 */
export const updateTournament = withAuth("tournament:update", async (id: string, input: UpdateTournamentInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const tenantId = await resolveDefaultTenantId(userId)
  if (!tenantId) throw new Error("Tenant not found")

  const validated = updateTournamentSchema.parse(input)
  const cleanData = Object.fromEntries(Object.entries(validated).filter(([, v]) => v !== undefined)) as Record<string, unknown>
  if (cleanData.name && !cleanData.slug) cleanData.slug = generateSlug(cleanData.name as string)

  const tournament = await withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.updateById(id, { ...cleanData, updatedAt: new Date() })
  )

  if (!tournament) throw new Error("Tournament not found")
  revalidatePath("/dashboard/tournaments")
  revalidatePath(`/dashboard/tournaments/${id}`)
  return { success: true, tournament }
})

/**
 * Delete a tournament.
 */
export const deleteTournament = withAuth("tournament:delete", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const tenantId = await resolveDefaultTenantId(userId)
  if (!tenantId) throw new Error("Tenant not found")

  const deleted = await withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.deleteById(id)
  )

  if (!deleted) throw new Error("Tournament not found")
  revalidatePath("/dashboard/tournaments")
  revalidatePath("/dashboard")
  return { success: true }
})

/**
 * Get a single tournament.
 */
export const getTournament = withAuth("tournament:read", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const tenantId = await resolveDefaultTenantId(userId)
  if (!tenantId) throw new Error("Tenant not found")

  return withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.findById<Tournament>(id)
  )
})

/**
 * List tournaments with pagination and filters.
 * The repo's findFiltered() auto-scopes to the current tenant.
 */
export const getTournaments = withAuth("tournament:read", async (filters: TournamentFilters) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const tenantId = await resolveDefaultTenantId(userId)
  if (!tenantId) throw new Error("Tenant not found")

  const validated = tournamentFiltersSchema.parse(filters)

  return withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.findFiltered(validated)
  )
})

/**
 * Open tournament registration.
 */
export const openRegistration = withAuth("tournament:manage_registrations", async (tournamentId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const tenantId = await resolveDefaultTenantId(userId)
  if (!tenantId) throw new Error("Tenant not found")

  const tournament = await withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.updateById(tournamentId, {
      registrationOpen: true,
      status: "registration",
      updatedAt: new Date(),
    })
  )

  if (!tournament) throw new Error("Tournament not found")
  revalidatePath(`/dashboard/tournaments/${tournamentId}`)
  return { success: true, tournament }
})

/**
 * Close tournament registration.
 */
export const closeRegistration = withAuth("tournament:manage_registrations", async (tournamentId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const tenantId = await resolveDefaultTenantId(userId)
  if (!tenantId) throw new Error("Tenant not found")

  const tournament = await withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.updateById(tournamentId, {
      registrationOpen: false,
      updatedAt: new Date(),
    })
  )

  if (!tournament) throw new Error("Tournament not found")
  revalidatePath(`/dashboard/tournaments/${tournamentId}`)
  return { success: true, tournament }
})
