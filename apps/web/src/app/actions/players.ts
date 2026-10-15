"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { playerRepo, withTenantContext, players, type Player } from "@mtk/database"
import { eq, and, ilike, desc, asc } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import { archiveRosterResource } from "@/lib/archive-roster-resource"
import { playerInput, playerPatch } from "@/lib/roster-input"
import { createRosterPlayer, mutateRosterPlayer } from "@/lib/roster-management"


// ─── Validation Schemas ───────────────────────────────────────

const createPlayerSchema = playerInput
const updatePlayerSchema = playerPatch

const playerFiltersSchema = z.object({
  tenantId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  role: z.enum(["batsman", "bowler", "all_rounder", "wicket_keeper", "wicket_keeper_batsman"]).optional(),
  status: z.enum(["active", "injured", "retired", "suspended", "inactive"]).optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["name", "createdAt", "jerseyNumber"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
})

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>
export type PlayerFilters = z.infer<typeof playerFiltersSchema>

async function requireTenant() {
  const tenant = await getMyTenant()
  if (!tenant) throw new Error("Tenant not found")
  return tenant
}

async function mutationTenant(permission: "player:create" | "player:update") {
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  return tenantId
}

// ─── Actions ──────────────────────────────────────────────────

export const createPlayer = withAuth("player:create", async (input: CreatePlayerInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const data = createPlayerSchema.parse(input)
  const tenantId = await mutationTenant("player:create")
  const player = await createRosterPlayer(userId, tenantId, data)
  revalidatePath("/dashboard", "layout")
  return { success: true, player }
})

export const updatePlayer = withAuth("player:update", async (id: string, input: UpdatePlayerInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(id)
  const data = updatePlayerSchema.parse(input)
  const tenantId = await mutationTenant("player:update")
  const player = await mutateRosterPlayer(userId, tenantId, { kind: "PLAYER_UPDATE", id, data })
  revalidatePath("/dashboard", "layout")
  return { success: true, player }
})

export const deletePlayer = withAuth("player:delete", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(id)
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("player:delete", tenantId)
  const result = await archiveRosterResource(userId, tenantId, "player", id)
  revalidatePath("/dashboard", "layout")
  return result
})

export const getPlayer = withAuth("player:read", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const tenantId = tenant.id
  
  return withTenantContext({ userId, tenantId }, () =>
    playerRepo.findById<Player>(id)
  )
})

export const getPlayers = withAuth("player:read", async (filters: PlayerFilters) => {
  const tenant = await requireTenant()
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenantId = tenant.id

  const validated = playerFiltersSchema.parse({ ...filters, tenantId: tenant.id })
  const { teamId, role, status, search, page, pageSize, sortBy, sortOrder } = validated
  const offset = (page - 1) * pageSize

  // Build where conditions (tenant isolation is handled by repository)
  const conditions = []
  if (teamId) conditions.push(eq(players.teamId, teamId))
  if (role) conditions.push(eq(players.role, role))
  if (status) conditions.push(eq(players.status, status))
  if (search) conditions.push(ilike(players.name, `%${search}%`))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Sort
  const orderFn = sortOrder === "desc" ? desc : asc
  const orderColumn = sortBy === "name" ? players.name
    : sortBy === "jerseyNumber" ? players.jerseyNumber
    : players.createdAt

  return withTenantContext({ userId, tenantId }, async () => {
    const [data, total] = await Promise.all([
      playerRepo.findMany<Player>({
        where: whereClause,
        orderBy: orderFn(orderColumn),
        limit: pageSize,
        offset,
      }),
      playerRepo.count({ where: whereClause }),
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

