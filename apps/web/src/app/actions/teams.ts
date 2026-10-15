"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { withAuth } from "./action-guard"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import { archiveRosterResource } from "@/lib/archive-roster-resource"
import { teamInput, teamPatch } from "@/lib/roster-input"
import { createRosterTeam, updateRosterTeam, mutateRosterPlayer } from "@/lib/roster-management"
import { requireRosterReadContext, readRosterTeam, readRosterSquad, readRosterTeams, rosterTeamFilters } from "@/lib/roster-reads"

// ─── Validation Schemas ───────────────────────────────────────

const createTeamSchema = teamInput
const updateTeamSchema = teamPatch

export type CreateTeamInput = z.infer<typeof createTeamSchema>
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>
export type TeamFilters = z.input<typeof rosterTeamFilters>

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
  z.string().uuid().parse(id)
  const { tenantId } = await requireRosterReadContext("team:read")
  return readRosterTeam(tenantId, id)
})

export const getTeamWithRoster = withAuth("team:read", async (id: string) => {
  z.string().uuid().parse(id)
  const { tenantId } = await requireRosterReadContext("team:read")
  await requirePermissionServer("player:read", tenantId)
  const team = await readRosterTeam(tenantId, id)
  if (!team) return null
  return { ...team, players: await readRosterSquad(tenantId, id) }
})

export const getTeams = withAuth("team:read", async (filters: TeamFilters) => {
  const data = rosterTeamFilters.parse(filters)
  const { tenantId } = await requireRosterReadContext("team:read")
  return readRosterTeams(tenantId, data)
})

export const addPlayerToTeam = withAuth("team:manage_roster", async (teamId: string, playerId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(teamId)
  z.string().uuid().parse(playerId)
  const tenantId = await mutationTenant("team:manage_roster")
  const player = await mutateRosterPlayer(userId, tenantId, { kind: "ROSTER_ADD", id: playerId, teamId })
  revalidatePath("/dashboard", "layout")
  // Managers can manage a roster, not read private/global player profile data.
  return { success: true, player: { id: player.id, name: player.name, teamId: player.teamId } }
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


