"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { withAuth } from "./action-guard"
import { withScoringFence } from "@/lib/scoring-fence-action"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import { mutateMatchLifecycle } from "@/lib/match-lifecycle"
import { requireMatchScoringAccess, requireScoringActorId } from "@/lib/scoring-access"
import { proxyCompleteMatch } from "@/lib/scoring-service-client"
import { manageMatch, matchMetadataSchema, streamCommandSchema } from "@/lib/match-management"
import { assignScorerInMatch, approveScorerAssignmentInMatch, approveUmpireAssignmentInMatch, assignUmpireInMatch, setPlayingXis, approvePlayingXis, substituteInPlayingXi, findTenantMatch, listTenantMatches, listTenantScorers, listTenantUmpires,
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

/**
 * Reschedules an unstarted fixture (COMP-07) behind team-rest and venue-use
 * conflict checks — a distinct locked command so generic metadata edits can
 * never bypass the scheduling rules.
 */
export const rescheduleMatch = withAuth("match:update", async (id: string, input: {
  scheduledDate: string
  minRestHours?: number
}) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(id)
  const data = z.object({
    scheduledDate: z.string().min(1).max(40),
    minRestHours: z.number().min(0).max(168).optional(),
  }).strict().parse(input)
  const tenantId = await requireMatchTenant("match:update")
  const match = await manageMatch(userId, tenantId, { kind: "reschedule", id, data })
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

export const endMatch = withAuth("match:score", withScoringFence(async (matchId: string, winnerId: string | null, result: string, manOfMatchId?: string | null, handoverEpoch?: number, expectedRevision?: number) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const command = z.object({ matchId: z.string().uuid(), winnerId: z.string().uuid().nullable(),
    result: z.string().trim().min(1).max(2000), manOfMatchId: z.string().uuid().nullish(),
    handoverEpoch: z.number().int().min(0).optional(), expectedRevision: z.number().int().min(0).max(2147483647).optional() })
    .parse({ matchId, winnerId, result, manOfMatchId, handoverEpoch, expectedRevision })
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requireMatchScoringAccess(userId, tenantId, matchId)
  const actorId = await requireScoringActorId(userId)
  // Never write completed results locally: canonical authorization, replay,
  // cache invalidation and broadcasts belong to the scoring service.
  await proxyCompleteMatch(matchId, { winnerId: command.winnerId ?? undefined,
    result: command.result, manOfMatchId: command.manOfMatchId ?? undefined,
    handoverEpoch: command.handoverEpoch, expectedRevision: command.expectedRevision }, tenantId, actorId)
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/matches/${matchId}/scoring`)
  revalidatePath(`/matches/${matchId}/live`)
  return { success: true, matchId, status: "completed" as const }
}))

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

/**
 * Official approval (COMP-06/IAM-06): the assigned primary or backup scorer
 * consents to their assignment. Gated on `match:score` (not match:update)
 * and, inside the locked writer, on the actor actually occupying a slot - so
 * an owner can never approve on the assigned member's behalf. Any later
 * assignment change clears the consent and re-arms the requirement.
 */
export const approveScorerAssignment = withAuth("match:score", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  const result = await approveScorerAssignmentInMatch({ userId, tenantId, matchId })
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/dashboard/matches/${matchId}`)
  revalidatePath(`/matches/${matchId}/scoring`)
  return { success: true as const, ...result }
})

/**
 * Umpire consent (COMP-06, mirroring scorer approval): the assigned member
 * umpire consents to their assignment. Gated `match:read` because umpires may
 * hold any member role; the locked writer's slot check is the real authority
 * and an active effective membership is re-verified there.
 */
export const approveUmpireAssignment = withAuth("match:read", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  const result = await approveUmpireAssignmentInMatch({ userId, tenantId, matchId })
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/dashboard/matches/${matchId}`)
  return { success: true as const, ...result }
})

const declaredXiEntrySchema = z.object({
  playerId: z.string().uuid(),
  battingOrder: z.number().int().min(1).max(11),
}).strict()

/**
 * Declared playing XIs (COMP-06 slice): an owner or the assigned scorer
 * stores both sides' squads for a competition match. Shape validation is
 * repeated by the locked writer through the shared XI policy; the writer is
 * the real authority and an active effective membership is re-verified there.
 */
export const declarePlayingXis = withAuth("match:update", async (
  matchId: string,
  teamAXi: { playerId: string; battingOrder: number }[],
  teamBXi: { playerId: string; battingOrder: number }[],
) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  const aXi = z.array(declaredXiEntrySchema).parse(teamAXi)
  const bXi = z.array(declaredXiEntrySchema).parse(teamBXi)
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("match:update", tenantId)
  const result = await setPlayingXis({ userId, tenantId, matchId, teamAXi: aXi, teamBXi: bXi })
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/dashboard/matches/${matchId}`)
  return { success: true as const, ...result }
})

/**
 * Official approval of the declared playing XIs (COMP-06 slice): a league
 * owner or an ASSIGNED member umpire approves. Gated `match:read` because
 * member umpires may hold any role; the locked writer's authority check is
 * the real gate. A later re-declaration clears the approval and re-arms it.
 */
export const approveXis = withAuth("match:read", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  const result = await approvePlayingXis({ userId, tenantId, matchId })
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/dashboard/matches/${matchId}`)
  return { success: true as const, ...result }
})

/**
 * Audited XI substitution (SCORE-10, mirroring XI approval): a league owner or
 * an ASSIGNED member umpire replaces one declared player with a squad-eligible
 * roster player of the same side. Gated `match:read` because member umpires
 * may hold any role; the locked writer's authority and eligibility checks are
 * the real gate and the substitution is audited (XI_SUBSTITUTE).
 */
export const substituteInXi = withAuth("match:read", async (
  matchId: string,
  teamId: string,
  outgoingPlayerId: string,
  incomingPlayerId: string,
) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  z.string().uuid().parse(teamId)
  z.string().uuid().parse(outgoingPlayerId)
  z.string().uuid().parse(incomingPlayerId)
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  const result = await substituteInPlayingXi({ userId, tenantId, matchId, teamId, outgoingPlayerId, incomingPlayerId })
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/dashboard/matches/${matchId}`)
  return { success: true as const, ...result }
})

export const getScorersForTenant = withAuth("match:update", async () => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("match:update", tenantId)
  return listTenantScorers(tenantId)
})

export const getUmpiresForTenant = withAuth("match:update", async () => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("match:update", tenantId)
  return listTenantUmpires(tenantId)
})

/**
 * Member-bound umpire assignment (COMP-06): any EFFECTIVE member of the league
 * may fill an umpire slot (any role; expiry-aware). `null` clears the slot and
 * one person cannot hold both. Free-text umpire columns remain for external
 * officials and are untouched by this writer.
 */
export const assignUmpire = withAuth("match:update", async (matchId: string, slot: "primary" | "secondary", umpireId: string | null) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  const targetSlot = z.enum(["primary", "secondary"]).parse(slot)
  z.string().uuid().nullable().parse(umpireId)
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("match:update", tenantId)
  const match = await assignUmpireInMatch({ userId, tenantId, matchId, slot: targetSlot, umpireId })
  revalidatePath("/dashboard", "layout")
  revalidatePath(`/dashboard/matches/${matchId}`)
  return { success: true as const, match }
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
