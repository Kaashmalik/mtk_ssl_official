"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { withAuth } from "./action-guard"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import { archiveRosterResource } from "@/lib/archive-roster-resource"
import { playerInput, playerPatch } from "@/lib/roster-input"
import { createRosterPlayer, mutateRosterPlayer } from "@/lib/roster-management"
import { requireRosterReadContext, readRosterPlayer, readRosterPlayers, rosterPlayerFilters } from "@/lib/roster-reads"


// ─── Validation Schemas ───────────────────────────────────────

const createPlayerSchema = playerInput
const updatePlayerSchema = playerPatch

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>
export type PlayerFilters = z.input<typeof rosterPlayerFilters>

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
  z.string().uuid().parse(id)
  const { tenantId } = await requireRosterReadContext("player:read")
  return readRosterPlayer(tenantId, id)
})

export const getPlayers = withAuth("player:read", async (filters: PlayerFilters) => {
  const data = rosterPlayerFilters.parse(filters)
  const { tenantId } = await requireRosterReadContext("player:read")
  return readRosterPlayers(tenantId, data)
})

