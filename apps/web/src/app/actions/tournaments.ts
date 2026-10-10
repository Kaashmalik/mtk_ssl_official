"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db, users, tournamentRepo } from "@mtk/database"
import { withTenantContext, type Tournament } from "@mtk/database"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { requirePermissionServer, resolveActiveTenantId } from "@/lib/rbac-server"
import type { Permission } from "@/lib/rbac"

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

/** Resolve once, then authorize and query the same tenant. */
async function requireTournamentContext(permission: Permission) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found. Create a league first.")

  await requirePermissionServer(permission, tenantId)
  return { userId, tenantId }
}

/**
 * Create a new tournament.
 *
 * The tenant context is resolved from Clerk auth, then passed into
 * `withTenantContext` so the repository layer auto-scopes the insert.
 */
export async function createTournament(input: CreateTournamentInput) {
  const { userId, tenantId } = await requireTournamentContext("tournament:create")

  const validated = createTournamentSchema.parse(input)
  const slug = validated.slug || generateSlug(validated.name)

  // Clerk's string ID is not the UUID referenced by tournaments.created_by.
  const dbUser = await db.query.users.findFirst({
    where: eq(users.clerkId, userId),
    columns: { id: true },
  })
  if (!dbUser) throw new Error("Your account is still being set up. Please refresh and try again.")

  // ── Tenant-scoped via withTenantContext ──
  // The repo's insert() will auto-set tenantId from context.
  // Even if `values` contained a tenantId field, it would be overridden.
  const [tournament] = await withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.insert<Tournament>({
      ...validated,
      slug,
      createdBy: dbUser.id,
    })
  )

  if (!tournament) throw new Error("Tournament could not be created. Please try again.")

  revalidatePath("/dashboard/tournaments")
  revalidatePath("/dashboard")
  return { success: true, tournament }
}

/**
 * Update a tournament.
 * The repo's updateById() scopes by both id AND tenantId from context.
 */
export async function updateTournament(id: string, input: UpdateTournamentInput) {
  const { userId, tenantId } = await requireTournamentContext("tournament:update")

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
}

/**
 * Delete a tournament.
 */
export async function deleteTournament(id: string) {
  const { userId, tenantId } = await requireTournamentContext("tournament:delete")

  const deleted = await withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.deleteById(id)
  )

  if (!deleted) throw new Error("Tournament not found")
  revalidatePath("/dashboard/tournaments")
  revalidatePath("/dashboard")
  return { success: true }
}

/**
 * Get a single tournament.
 */
export async function getTournament(id: string) {
  const { userId, tenantId } = await requireTournamentContext("tournament:read")

  return withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.findById<Tournament>(id)
  )
}

/**
 * List tournaments with pagination and filters.
 * The repo's findFiltered() auto-scopes to the current tenant.
 */
export async function getTournaments(filters: TournamentFilters) {
  const { userId, tenantId } = await requireTournamentContext("tournament:read")

  const validated = tournamentFiltersSchema.parse(filters)

  return withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.findFiltered(validated)
  )
}

/**
 * Open tournament registration.
 */
export async function openRegistration(tournamentId: string) {
  const { userId, tenantId } = await requireTournamentContext("tournament:manage_registrations")

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
}

/**
 * Close tournament registration.
 */
export async function closeRegistration(tournamentId: string) {
  const { userId, tenantId } = await requireTournamentContext("tournament:manage_registrations")

  const tournament = await withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.updateById(tournamentId, {
      registrationOpen: false,
      updatedAt: new Date(),
    })
  )

  if (!tournament) throw new Error("Tournament not found")
  revalidatePath(`/dashboard/tournaments/${tournamentId}`)
  return { success: true, tournament }
}
