"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { playerRepo, teamRepo, withTenantContext } from "@mtk/database"
import { players, type Player, type Team } from "@mtk/database"
import { eq, and, ilike, desc, asc } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"
import { checkPlanLimit, type PlanKey } from "@mtk/database"


// ─── Validation Schemas ───────────────────────────────────────

const createPlayerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  tenantId: z.string().uuid("Invalid tenant ID").optional(),
  teamId: z.string().uuid("Invalid team ID").optional().nullable(),
  role: z.enum(["batsman", "bowler", "all_rounder", "wicket_keeper", "wicket_keeper_batsman"]).optional().nullable(),
  battingStyle: z.enum(["right", "left"]).optional().nullable(),
  bowlingStyle: z.enum(["right_arm_fast", "right_arm_medium", "right_arm_spin", "left_arm_fast", "left_arm_medium", "left_arm_spin"]).optional().nullable(),
  jerseyNumber: z.number().int().min(0).max(999).optional().nullable(),
  photoUrl: z.string().url("Invalid photo URL").optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  email: z.string().email("Invalid email").optional().nullable(),
  nationality: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  heightCm: z.number().int().min(100).max(250).optional().nullable(),
  weightKg: z.number().int().min(30).max(200).optional().nullable(),
  biography: z.string().max(2000).optional().nullable(),
  status: z.enum(["active", "injured", "retired", "suspended", "inactive"]).optional(),
})

const updatePlayerSchema = createPlayerSchema.partial().omit({ tenantId: true })

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

// ─── Actions ──────────────────────────────────────────────────

export const createPlayer = withAuth("player:create", async (input: CreatePlayerInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const validated = createPlayerSchema.parse({
    ...input,
    tenantId: input.tenantId ?? tenant.id,
  })
  const tenantId = validated.tenantId ?? tenant.id
  if (tenantId !== tenant.id) throw new Error("Invalid tenant")

  const player = await withTenantContext({ userId, tenantId }, async () => {
    if (validated.teamId) {
      const team = await teamRepo.findById<Team>(validated.teamId)
      if (!team) throw new Error("Team not found")
    }

    // Structured PlanLimitError so the UI can offer an upgrade prompt.
    // `playerRepo.count()` is RLS-scoped to this tenant.
    checkPlanLimit({
      plan: tenant.plan as PlanKey,
      feature: "maxPlayers",
      current: await playerRepo.count(),
    })

    return playerRepo.insertOne<Player>({
      ...validated,
      createdBy: userId,
    })
  })

  revalidatePath("/dashboard/players")
  revalidatePath("/dashboard")
  return { success: true, player }
})

export const updatePlayer = withAuth("player:update", async (id: string, input: UpdatePlayerInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const tenantId = tenant.id

  const validated = updatePlayerSchema.parse(input)

  // Remove undefined values to avoid overwriting with null
  const cleanData = Object.fromEntries(
    Object.entries(validated).filter(([, v]) => v !== undefined)
  )

  const player = await withTenantContext({ userId, tenantId }, async () => {
    if (cleanData.teamId) {
      const team = await teamRepo.findById<Team>(cleanData.teamId as string)
      if (!team) throw new Error("Team not found")
    }

    return playerRepo.updateById<Player>(id, {
      ...cleanData,
      updatedAt: new Date(),
    })
  })

  if (!player) throw new Error("Player not found")

  revalidatePath("/dashboard/players")
  revalidatePath(`/dashboard/players/${id}`)
  return { success: true, player }
})

export const deletePlayer = withAuth("player:delete", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const tenantId = tenant.id

  const deleted = await withTenantContext({ userId, tenantId }, () =>
    playerRepo.deleteById(id)
  )

  if (!deleted) throw new Error("Player not found")

  revalidatePath("/dashboard/players")
  revalidatePath("/dashboard")
  return { success: true }
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

