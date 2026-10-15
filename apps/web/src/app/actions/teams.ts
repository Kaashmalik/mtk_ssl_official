"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { teamRepo, playerRepo, withTenantContext, type Team, type Player, teams, players } from "@mtk/database"
import { eq, and, ilike, desc, asc } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import { archiveRosterResource } from "@/lib/archive-roster-resource"
import { teamInput, teamPatch } from "@/lib/roster-input"
import { createRosterTeam, updateRosterTeam, mutateRosterPlayer } from "@/lib/roster-management"

// ─── Validation Schemas ───────────────────────────────────────

const createTeamSchema = teamInput
const updateTeamSchema = teamPatch

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

async function mutationTenant(permission: "team:create" | "team:update" | "team:manage_roster") {
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  return tenantId
}

// ─── Actions ──────────────────────────────────────────────────

export const createTeam = withAuth("team:create", async (input: CreateTeamInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const data = createTeamSchema.parse(input)
  const tenantId = await mutationTenant("team:create")
  const team = await createRosterTeam(userId, tenantId, data)
  revalidatePath("/dashboard", "layout")
  return { success: true, team }
})

export const updateTeam = withAuth("team:update", async (id: string, input: UpdateTeamInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(id)
  const data = updateTeamSchema.parse(input)
  const tenantId = await mutationTenant("team:update")
  const team = await updateRosterTeam(userId, tenantId, id, data)
  revalidatePath("/dashboard", "layout")
  return { success: true, team }
})

export const deleteTeam = withAuth("team:delete", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(id)
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("team:delete", tenantId)
  // Compatibility action name. Never cascade-delete match/scorecard history.
  const result = await archiveRosterResource(userId, tenantId, "team", id)
  revalidatePath("/dashboard", "layout")
  return result
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
  z.string().uuid().parse(teamId)
  z.string().uuid().parse(playerId)
  const tenantId = await mutationTenant("team:manage_roster")
  const player = await mutateRosterPlayer(userId, tenantId, { kind: "ROSTER_ADD", id: playerId, teamId })
  revalidatePath("/dashboard", "layout")
  return { success: true, player }
})

export const removePlayerFromTeam = withAuth("team:manage_roster", async (teamId: string, playerId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(teamId)
  z.string().uuid().parse(playerId)
  const tenantId = await mutationTenant("team:manage_roster")
  await mutateRosterPlayer(userId, tenantId, { kind: "ROSTER_REMOVE", id: playerId, teamId })
  revalidatePath("/dashboard", "layout")
  return { success: true }
})


