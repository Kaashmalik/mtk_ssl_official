"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db, teamRepo, playerRepo, tournamentRepo, withTenantContext, withoutTenantContext, checkPlanLimit } from "@mtk/database"
import { type PlanKey, type Team, type Player, type Tournament } from "@mtk/database"
import { teams, players, users } from "@mtk/database"
import { eq, and, ilike, desc, asc } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"

// ─── Validation Schemas ───────────────────────────────────────

const createTeamSchema = z.object({
  name: z.string().min(2, "Team name must be at least 2 characters").max(100),
  tenantId: z.string().uuid("Invalid tenant ID").optional(),
  shortName: z.string().min(2).max(10).optional().nullable(),
  slug: z.string().min(2).max(50).optional(),
  description: z.string().max(2000).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  bannerUrl: z.string().url().optional().nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color").optional().nullable(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color").optional().nullable(),
  jerseyColor: z.string().max(50).optional().nullable(),
  homeGround: z.string().max(200).optional().nullable(),
  foundedYear: z.number().int().min(1800).max(2100).optional().nullable(),
  maxSquadSize: z.number().int().min(5).max(30).default(15).optional(),
  tournamentId: z.string().uuid().optional().nullable(),
})

const updateTeamSchema = createTeamSchema.partial().omit({ tenantId: true })

const teamFiltersSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tournamentId: z.string().uuid().optional(),
  search: z.string().optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["name", "createdAt", "city"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
})

export type CreateTeamInput = z.infer<typeof createTeamSchema>
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>
export type TeamFilters = z.infer<typeof teamFiltersSchema>

async function requireTenant() {
  const tenant = await getMyTenant()
  if (!tenant) throw new Error("Tenant not found")
  return tenant
}

async function requireAssignedTeamAccess(team: Team, tenantOwnerId: string, clerkUserId: string) {
  const [actor] = await withoutTenantContext(() => db.select({ id: users.id }).from(users)
    .where(eq(users.clerkId, clerkUserId)).limit(1))
  if (!actor) throw new Error("Your account is still provisioning. Please try again.")
  if (actor.id !== tenantOwnerId && team.managerId !== actor.id && team.captainId !== actor.id) {
    throw new Error("You can only manage the team assigned to you")
  }
}

// ─── Slug Generator ───────────────────────────────────────────

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

// ─── Actions ──────────────────────────────────────────────────

export const createTeam = withAuth("team:create", async (input: CreateTeamInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const tenantId = tenant.id

  const validated = createTeamSchema.parse({
    ...input,
    tenantId: input.tenantId ?? tenant.id,
  })
  const slug = validated.slug || generateSlug(validated.name)

  const team = await withTenantContext({ userId, tenantId }, async () => {
    // Plan-based team quota check. Throws a structured PlanLimitError that the
    // UI can detect (`isPlanLimitError`) to show an upgrade prompt instead of a
    // generic failure. `teamRepo.count()` is RLS-scoped to this tenant.
    checkPlanLimit({
      plan: tenant.plan as PlanKey,
      feature: "maxTeams",
      current: await teamRepo.count(),
    })

    if (validated.tournamentId) {
      const tournament = await tournamentRepo.findById<Tournament>(validated.tournamentId)
      if (!tournament) throw new Error("Tournament not found")
    }

    return teamRepo.insertOne<Team>({
      ...validated,
      slug,
      createdBy: userId,
    })
  })

  revalidatePath("/dashboard/teams")
  revalidatePath("/dashboard")
  return { success: true, team }
})

export const updateTeam = withAuth("team:update", async (id: string, input: UpdateTeamInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const tenantId = tenant.id

  const validated = updateTeamSchema.parse(input)
  const cleanData = Object.fromEntries(
    Object.entries(validated).filter(([, v]) => v !== undefined)
  )

  // Regenerate slug if name changes
  if (cleanData.name && !cleanData.slug) {
    cleanData.slug = generateSlug(cleanData.name as string)
  }

  const team = await withTenantContext({ userId, tenantId }, async () => {
    const existingTeam = await teamRepo.findById<Team>(id)
    if (!existingTeam) throw new Error("Team not found")
    await requireAssignedTeamAccess(existingTeam, tenant.ownerId, userId)

    if (cleanData.tournamentId) {
      const tournament = await tournamentRepo.findById<Tournament>(cleanData.tournamentId as string)
      if (!tournament) throw new Error("Tournament not found")
    }

    return teamRepo.updateById<Team>(id, {
      ...cleanData,
      updatedAt: new Date(),
    })
  })

  if (!team) throw new Error("Team not found")

  revalidatePath("/dashboard/teams")
  revalidatePath(`/dashboard/teams/${id}`)
  return { success: true, team }
})

export const deleteTeam = withAuth("team:delete", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const tenantId = tenant.id

  const deleted = await withTenantContext({ userId, tenantId }, () =>
    teamRepo.deleteById(id)
  )

  if (!deleted) throw new Error("Team not found")

  revalidatePath("/dashboard/teams")
  revalidatePath("/dashboard")
  return { success: true }
})

export const getTeam = withAuth("team:read", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const tenantId = tenant.id

  return withTenantContext({ userId, tenantId }, () =>
    teamRepo.findById<Team>(id)
  )
})

export const getTeamWithRoster = withAuth("team:read", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const tenantId = tenant.id

  return withTenantContext({ userId, tenantId }, async () => {
    const team = await teamRepo.findById<Team>(id)
    if (!team) return null

    const roster = await playerRepo.findMany<Player>({
      where: eq(players.teamId, id),
      orderBy: asc(players.name),
    })

    return { ...team, players: roster }
  })
})

export const getTeams = withAuth("team:read", async (filters: TeamFilters) => {
  const tenant = await requireTenant()
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenantId = tenant.id

  const validated = teamFiltersSchema.parse({ ...filters, tenantId: tenant.id })
  const { tournamentId, search, isActive, page, pageSize, sortBy, sortOrder } = validated
  const offset = (page - 1) * pageSize

  const conditions = []
  if (tournamentId) conditions.push(eq(teams.tournamentId, tournamentId))
  if (search) conditions.push(ilike(teams.name, `%${search}%`))
  if (isActive !== undefined) conditions.push(eq(teams.isActive, isActive))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined
  const orderFn = sortOrder === "desc" ? desc : asc
  const orderColumn = sortBy === "name" ? teams.name
    : sortBy === "city" ? teams.city
    : teams.createdAt

  return withTenantContext({ userId, tenantId }, async () => {
    const [data, total] = await Promise.all([
      teamRepo.findMany<Team>({
        where: whereClause,
        orderBy: orderFn(orderColumn),
        limit: pageSize,
        offset,
      }),
      teamRepo.count({ where: whereClause }),
    ])

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    }
  })
})

export const addPlayerToTeam = withAuth("team:manage_roster", async (teamId: string, playerId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const tenantId = tenant.id

  const player = await withTenantContext({ userId, tenantId }, async () => {
    const team = await teamRepo.findById<Team>(teamId)
    if (!team) throw new Error("Team not found")
    await requireAssignedTeamAccess(team, tenant.ownerId, userId)

    const rosterMember = await playerRepo.findById<Player>(playerId)
    if (!rosterMember) throw new Error("Player not found")
    if (rosterMember.teamId && rosterMember.teamId !== teamId) {
      throw new Error("Remove the player from their current team before moving them")
    }
    if (!rosterMember.teamId && team.maxSquadSize) {
      const rosterSize = await playerRepo.count({ where: eq(players.teamId, teamId) })
      if (rosterSize >= team.maxSquadSize) {
        throw new Error(`This team has reached its ${team.maxSquadSize}-player squad limit`)
      }
    }

    return playerRepo.updateById<Player>(playerId, {
      teamId,
      updatedAt: new Date(),
    })
  })

  if (!player) throw new Error("Player not found")

  revalidatePath(`/dashboard/teams/${teamId}`)
  revalidatePath(`/dashboard/players/${playerId}`)
  return { success: true, player }
})

export const removePlayerFromTeam = withAuth("team:manage_roster", async (teamId: string, playerId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const tenantId = tenant.id

  await withTenantContext({ userId, tenantId }, async () => {
    const team = await teamRepo.findById<Team>(teamId)
    if (!team) throw new Error("Team not found")
    await requireAssignedTeamAccess(team, tenant.ownerId, userId)

    const pl = await playerRepo.findById<Player>(playerId)
    if (!pl || pl.teamId !== teamId) {
      throw new Error("Player not found in this team")
    }

    return playerRepo.updateById<Player>(playerId, {
      teamId: null,
      updatedAt: new Date(),
    })
  })

  revalidatePath(`/dashboard/teams/${teamId}`)
  revalidatePath(`/dashboard/players/${playerId}`)
  return { success: true }
})


