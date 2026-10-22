"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import {
  broadcastAttachCommandSchema,
  broadcastPrepareCommandSchema,
  type BroadcastAttachCommand,
} from "@mtk/contracts"
import { withAuth } from "./action-guard"
import { resolveActiveTenantId } from "@/lib/rbac-server"
import {
  attachBroadcastSession,
  prepareBroadcastSession,
  readBroadcastIngest,
  refreshBroadcastSession,
  requestBroadcastEnd,
  requestBroadcastStart,
  setDefaultBroadcastDestination as setDefaultBroadcastDestinationInLeague,
  type BroadcastCommandResult,
  type BroadcastIngestDetails,
} from "@/lib/broadcast-sessions"

function requireTenant(tenantId: string | null): string {
  if (!tenantId) throw new Error("Tenant not found")
  return tenantId
}

async function currentUser(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  return userId
}

function revalidateBroadcast(matchId?: string) {
  revalidatePath("/dashboard", "layout")
  if (matchId) {
    revalidatePath(`/dashboard/matches/${matchId}`)
    revalidatePath(`/matches/${matchId}`)
    revalidatePath(`/matches/${matchId}/live`)
  }
}

export const prepareBroadcast = withAuth("match:update", async (
  matchId: string,
  destinationId: string,
): Promise<BroadcastCommandResult> => {
  const userId = await currentUser()
  z.string().uuid().parse(matchId)
  const command = broadcastPrepareCommandSchema.parse({ destinationId })
  const tenantId = requireTenant(await resolveActiveTenantId())
  const result = await prepareBroadcastSession(userId, tenantId, matchId, command.destinationId)
  revalidateBroadcast(matchId)
  return result
})

export const attachBroadcast = withAuth("match:update", async (
  matchId: string,
  input: BroadcastAttachCommand,
): Promise<BroadcastCommandResult> => {
  const userId = await currentUser()
  z.string().uuid().parse(matchId)
  const command = broadcastAttachCommandSchema.parse(input)
  const tenantId = requireTenant(await resolveActiveTenantId())
  const result = await attachBroadcastSession(userId, tenantId, matchId, command)
  revalidateBroadcast(matchId)
  return result
})

export const startBroadcast = withAuth("match:update", async (
  matchId: string,
  sessionId: string,
): Promise<BroadcastCommandResult> => {
  const userId = await currentUser()
  z.string().uuid().parse(matchId)
  z.string().uuid().parse(sessionId)
  const tenantId = requireTenant(await resolveActiveTenantId())
  const result = await requestBroadcastStart(userId, tenantId, sessionId)
  revalidateBroadcast(matchId)
  return result
})

export const endBroadcast = withAuth("match:update", async (
  matchId: string,
  sessionId: string,
): Promise<BroadcastCommandResult> => {
  const userId = await currentUser()
  z.string().uuid().parse(matchId)
  z.string().uuid().parse(sessionId)
  const tenantId = requireTenant(await resolveActiveTenantId())
  const result = await requestBroadcastEnd(userId, tenantId, sessionId)
  revalidateBroadcast(matchId)
  return result
})

export const refreshBroadcast = withAuth("match:update", async (
  matchId: string,
  sessionId: string,
): Promise<BroadcastCommandResult> => {
  const userId = await currentUser()
  z.string().uuid().parse(matchId)
  z.string().uuid().parse(sessionId)
  const tenantId = requireTenant(await resolveActiveTenantId())
  const result = await refreshBroadcastSession(userId, tenantId, sessionId)
  revalidateBroadcast(matchId)
  return result
})

export const getBroadcastIngest = withAuth("match:update", async (
  sessionId: string,
): Promise<BroadcastIngestDetails> => {
  const userId = await currentUser()
  z.string().uuid().parse(sessionId)
  const tenantId = requireTenant(await resolveActiveTenantId())
  return readBroadcastIngest(userId, tenantId, sessionId)
})

export const setDefaultBroadcastDestination = withAuth("settings:manage", async (
  destinationId: string,
): Promise<{ destinationId: string }> => {
  const userId = await currentUser()
  z.string().uuid().parse(destinationId)
  const tenantId = requireTenant(await resolveActiveTenantId())
  const result = await setDefaultBroadcastDestinationInLeague(userId, tenantId, destinationId)
  revalidatePath("/dashboard/settings", "layout")
  revalidatePath("/dashboard/settings/broadcast")
  return result
})
