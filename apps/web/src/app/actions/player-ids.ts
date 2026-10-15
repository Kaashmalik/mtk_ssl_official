"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import {
  listIssuedPlayerIdCards, issuePlayerIdCard, revokePlayerIdCard, setPlayerIdCardExpiry,
} from "@/lib/player-id-cards"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import { withAuth } from "./action-guard"

async function requirePlayerTenant(permission: "player:read" | "player:update") {
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  return tenantId
}

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}, "Invalid date")

/** Issues (or returns) the league ID card number for a player. */
export const issuePlayerId = withAuth("player:update", async (playerId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(playerId)
  const tenant = await requirePlayerTenant("player:update")

  const { card } = await issuePlayerIdCard({ tenantId: tenant, playerId })
  revalidatePath(`/dashboard/players/${playerId}`)
  return { success: true, playerId: card }
})

export const revokePlayerId = withAuth("player:update", async (playerId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(playerId)
  const tenant = await requirePlayerTenant("player:update")

  const revoked = await revokePlayerIdCard(playerId, tenant)
  if (!revoked) throw new Error("Player ID not found")
  revalidatePath(`/dashboard/players/${playerId}`)
  return { success: true }
})

/** All issued ID cards for the tenant, with player + team names resolved. */
export const getIssuedPlayerIds = withAuth("player:read", async () => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requirePlayerTenant("player:read")

  return listIssuedPlayerIdCards(tenant)
})

const setPlayerIdExpirySchema = z.object({
  playerId: z.string().uuid(),
  expiryDate: dateOnly.nullable(),
})

export const setPlayerIdExpiry = withAuth("player:update", async (input: z.infer<typeof setPlayerIdExpirySchema>) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requirePlayerTenant("player:update")
  const parsed = setPlayerIdExpirySchema.parse(input)

  const updated = await setPlayerIdCardExpiry(
    parsed.playerId,
    tenant,
    parsed.expiryDate ? new Date(`${parsed.expiryDate}T00:00:00Z`) : null,
  )
  if (!updated) throw new Error("Player ID not found")
  revalidatePath(`/dashboard/players/${parsed.playerId}`)
  return { success: true }
})
