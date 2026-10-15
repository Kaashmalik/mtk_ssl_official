"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { withAuth } from "./action-guard"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import { mutateMatchLifecycle } from "@/lib/match-lifecycle"
import { requireMatchScoringAccess, requireScoringActorId } from "@/lib/scoring-access"
import { proxyCompleteMatch } from "@/lib/scoring-service-client"
import { manageMatch, matchMetadataSchema, streamCommandSchema } from "@/lib/match-management"
import { assignScorerInMatch, findTenantMatch, listTenantMatches, listTenantScorers,
  readMatchFormOptions } from "@/lib/match-records"

const createMatchSchema = matchMetadataSchema.extend({ tenantId: z.string().uuid().optional() }).strict()

const matchFiltersSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tournamentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  status: z.enum(["scheduled", "toss", "live", "innings_break", "completed", "abandoned", "cancelled", "no_result"]).optional(),
  page: z.number().int().min(1).max(1000000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["scheduledDate", "createdAt", "matchNumber"]).default("scheduledDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
}).strict()

export type CreateMatchInput = z.infer<typeof createMatchSchema>
export type MatchFilters = z.infer<typeof matchFiltersSchema>

async function requireMatchTenant(permission: "match:create" | "match:update" | "match:delete" | "match:read") {
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  return tenantId
}

function revalidateMatch(matchId: string) {
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/matches/${matchId}/live`)
  revalidatePath(`/matches/${matchId}/scoring`)
}

export const createMatch = withAuth("match:create", async (input: CreateMatchInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const { tenantId: suppliedTenant, ...data } = createMatchSchema.parse(input)
  const tenantId = await requireMatchTenant("match:create")
  if (suppliedTenant && suppliedTenant !== tenantId) throw new Error("Invalid tenant")
  const match = await manageMatch(userId, tenantId, { kind: "create", data })
  revalidateMatch(match.id)
  return { success: true, match }
})

export const updateMatch = withAuth("match:update", async (id: string, input: Partial<CreateMatchInput>) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  // TypeScript types do not constrain server-action payloads. Do not let generic
  // metadata edits bypass the locked scorer-assignment command (or change IDs).
  z.string().uuid().parse(id)
  const data = matchMetadataSchema.partial().strict().parse(input)
  const tenantId = await requireMatchTenant("match:update")
  const match = await manageMatch(userId, tenantId, { kind: "update", id, data })
  revalidateMatch(id)
  return { success: true, match }
})

export const deleteMatch = withAuth("match:delete", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(id)
  const tenantId = await requireMatchTenant("match:delete")
  // Compatibility action name; intentionally preserve rows instead of cascades.
  const match = await manageMatch(userId, tenantId, { kind: "cancel", id })
  revalidateMatch(id)
  return { success: true, match }
})

export const getMatch = withAuth("match:read", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(id)
  const tenantId = await requireMatchTenant("match:read")
  return findTenantMatch(userId, tenantId, id)
})

/** Picker reads use the same active league as the eventual command, not the
 * caller's owned/default league. Writes revalidate references under locks. */
export const getMatchFormOptions = withAuth("match:read", async (intent: "create" | "update" = "create") => {
  const mode = z.enum(["create", "update"]).parse(intent)
  const tenantId = await requireMatchTenant(mode === "create" ? "match:create" : "match:update")
  return readMatchFormOptions(tenantId)
})

export const getMatches = withAuth("match:read", async (filters: MatchFilters) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const validated = matchFiltersSchema.parse(filters)
  const tenantId = await requireMatchTenant("match:read")
  if (validated.tenantId && validated.tenantId !== tenantId) throw new Error("Invalid tenant")
  return listTenantMatches(userId, tenantId, validated)
})

export const setTossResult = withAuth("match:score", async (matchId: string, tossWinnerId: string, tossDecision: "bat" | "bowl") => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.object({ matchId: z.string().uuid(), tossWinnerId: z.string().uuid(), tossDecision: z.enum(["bat", "bowl"]) })
    .parse({ matchId, tossWinnerId, tossDecision })
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("match:score", tenantId)
  const match = await mutateMatchLifecycle(userId, tenantId, matchId, "MATCH_TOSS_SET", existing => {
    if (!["scheduled", "toss"].includes(existing.status)) throw new Error("Toss cannot change after the match has started")
    if (![existing.teamAId, existing.teamBId].includes(tossWinnerId)) throw new Error("Toss winner must be a match team")
    if (existing.status === "toss" && existing.tossWinnerId === tossWinnerId && existing.tossDecision === tossDecision) return null
    return { tossWinnerId, tossDecision, status: "toss" }
  })
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/matches/${matchId}/scoring`)
  return { success: true, match }
})

export const startMatch = withAuth("match:score", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("match:score", tenantId)
  const match = await mutateMatchLifecycle(userId, tenantId, matchId, "MATCH_START", existing => {
    if (existing.status === "live") return null
    if (!["scheduled", "toss"].includes(existing.status)) throw new Error("This match cannot be started")
    return { status: "live", startDate: existing.startDate ?? new Date() }
  })
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/matches/${matchId}/scoring`)
  return { success: true, match }
})

export const endMatch = withAuth("match:score", async (matchId: string, winnerId: string | null, result: string, manOfMatchId?: string | null) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const command = z.object({ matchId: z.string().uuid(), winnerId: z.string().uuid().nullable(),
    result: z.string().trim().min(1).max(2000), manOfMatchId: z.string().uuid().nullish() })
    .parse({ matchId, winnerId, result, manOfMatchId })
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requireMatchScoringAccess(userId, tenantId, matchId)
  const actorId = await requireScoringActorId(userId)
  // Never write completed results locally: canonical authorization, replay,
  // cache invalidation and broadcasts belong to the scoring service.
  await proxyCompleteMatch(matchId, { winnerId: command.winnerId ?? undefined,
    result: command.result, manOfMatchId: command.manOfMatchId ?? undefined }, tenantId, actorId)
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/matches/${matchId}/scoring`)
  revalidatePath(`/matches/${matchId}/live`)
  return { success: true, matchId, status: "completed" as const }
})

export const startStream = withAuth("match:update", async (matchId: string, source: "facebook" | "youtube" | "rtmp" | "webrtc", url: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  const data = streamCommandSchema.parse({ source, url })
  const tenantId = await requireMatchTenant("match:update")
  const match = await manageMatch(userId, tenantId, { kind: "stream-start", id: matchId, data })
  revalidateMatch(matchId)
  return { success: true, match }
})

const scorerSlot = z.enum(["primary", "backup"])

/**
 * Assign or clear a match's primary or backup scorer. Both slots are validated
 * against the active scorer membership of the match's league, and one person
 * cannot occupy both slots. `null` clears the slot.
 */
export const assignScorer = withAuth("match:update", async (matchId: string, slot: "primary" | "backup", scorerId: string | null) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  const targetSlot = scorerSlot.parse(slot)
  z.string().uuid().nullable().parse(scorerId)
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("match:update", tenantId)
  const match = await assignScorerInMatch({ userId, tenantId, matchId, slot: targetSlot, scorerId })
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/matches/${matchId}/scoring`)
  return { success: true, match }
})

export const getScorersForTenant = withAuth("match:update", async () => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("match:update", tenantId)
  return listTenantScorers(tenantId)
})

export const endStream = withAuth("match:update", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  const tenantId = await requireMatchTenant("match:update")
  const match = await manageMatch(userId, tenantId, { kind: "stream-end", id: matchId })
  revalidateMatch(matchId)
  return { success: true, match }
})
