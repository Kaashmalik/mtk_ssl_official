"use server"

import { auth } from "@clerk/nextjs/server"
import { randomUUID } from "crypto"
import { revalidatePath } from "next/cache"
import { db, withTenantContext } from "@mtk/database"
import { matches, teams, tournaments, users, tenants, userTenantRoles, auditLogs } from "@mtk/database"
import { eq, and, desc, asc, count, or, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"
import { checkPlanFeature, type PlanKey } from "@mtk/database"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import { scorerMembership } from "@/lib/scorer-membership"
import { mutateMatchLifecycle } from "@/lib/match-lifecycle"
import { requireMatchScoringAccess, requireScoringActorId } from "@/lib/scoring-access"
import { proxyCompleteMatch } from "@/lib/scoring-service-client"



const createMatchSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tournamentId: z.string().uuid().optional().nullable(),
  teamAId: z.string().uuid(),
  teamBId: z.string().uuid(),
  venueId: z.string().uuid().optional().nullable(),
  matchFormat: z.enum(["t20", "odi", "test", "t10", "custom"]).default("t20"),
  matchType: z.enum(["group", "knockout", "final", "semi_final", "quarter_final", "friendly", "practice"]).default("group"),
  totalOvers: z.number().int().min(1).max(450).default(20),
  scheduledDate: z.string().optional().nullable(),
  matchNumber: z.number().int().optional().nullable(),
  umpire1: z.string().max(200).optional().nullable(),
  umpire2: z.string().max(200).optional().nullable(),
})

const matchFiltersSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tournamentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  status: z.enum(["scheduled", "toss", "live", "innings_break", "completed", "abandoned", "cancelled", "no_result"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["scheduledDate", "createdAt", "matchNumber"]).default("scheduledDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})

export type CreateMatchInput = z.infer<typeof createMatchSchema>
export type MatchFilters = z.infer<typeof matchFiltersSchema>

async function requireTenant() {
  const tenant = await getMyTenant()
  if (!tenant) throw new Error("Tenant not found")
  return tenant
}

export const createMatch = withAuth("match:create", async (input: CreateMatchInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const validated = createMatchSchema.parse({
    ...input,
    tenantId: input.tenantId ?? tenant.id,
  })
  const tenantId = validated.tenantId ?? tenant.id
  if (tenantId !== tenant.id) throw new Error("Invalid tenant")
  if (validated.teamAId === validated.teamBId) throw new Error("A team cannot play against itself")

  return withTenantContext({ userId, tenantId }, async () => {
    const [teamA] = await db.select().from(teams)
      .where(and(eq(teams.id, validated.teamAId), eq(teams.tenantId, tenant.id)))
      .limit(1)
    const [teamB] = await db.select().from(teams)
      .where(and(eq(teams.id, validated.teamBId), eq(teams.tenantId, tenant.id)))
      .limit(1)
    if (!teamA || !teamB) throw new Error("One or both teams not found")

    if (validated.tournamentId) {
      const [tournament] = await db.select().from(tournaments)
        .where(and(eq(tournaments.id, validated.tournamentId), eq(tournaments.tenantId, tenant.id)))
        .limit(1)
      if (!tournament) throw new Error("Tournament not found")
    }

    const [match] = await db.insert(matches).values({
      ...validated,
      tenantId,
      scheduledDate: validated.scheduledDate ? new Date(validated.scheduledDate) : null,
      status: "scheduled",
      createdBy: userId,
    }).returning()

    revalidatePath("/dashboard/matches")
    revalidatePath("/dashboard")
    return { success: true, match }
  })
})

export const updateMatch = withAuth("match:update", async (id: string, input: Partial<CreateMatchInput>) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  // TypeScript types do not constrain server-action payloads. Do not let generic
  // metadata edits bypass the locked scorer-assignment command (or change IDs).
  const validated = createMatchSchema.omit({ tenantId: true }).partial().strict().parse(input)
  const cleanData = Object.fromEntries(
    Object.entries(validated).filter(([, v]) => v !== undefined)
  ) as Omit<Partial<CreateMatchInput>, "scheduledDate"> & {
    scheduledDate?: Date | null;
  };

  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    if (cleanData.teamAId || cleanData.teamBId) {
      const teamIds = [cleanData.teamAId, cleanData.teamBId].filter(Boolean) as string[]
      if (new Set(teamIds).size !== teamIds.length) throw new Error("A team cannot play against itself")
      const teamsFound = await db.select().from(teams)
        .where(and(eq(teams.tenantId, tenant.id), or(...teamIds.map((tid) => eq(teams.id, tid)))!))
      if (teamsFound.length !== teamIds.length) throw new Error("One or more teams not found")
    }

    if (cleanData.tournamentId) {
      const [tournament] = await db.select().from(tournaments)
        .where(and(eq(tournaments.id, cleanData.tournamentId as string), eq(tournaments.tenantId, tenant.id)))
        .limit(1)
      if (!tournament) throw new Error("Tournament not found")
    }
    if ("scheduledDate" in cleanData) {
      const scheduledDate = cleanData.scheduledDate as string | null | undefined
      cleanData.scheduledDate = scheduledDate ? new Date(scheduledDate) : null
    }
    const [match] = await db.update(matches).set({ ...cleanData, updatedAt: new Date() })
      .where(and(eq(matches.id, id), eq(matches.tenantId, tenant.id)))
      .returning()
    if (!match) throw new Error("Match not found")
    revalidatePath("/dashboard/matches")
    revalidatePath(`/dashboard/matches/${id}`)
    return { success: true, match }
  })
})

export const deleteMatch = withAuth("match:delete", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    await db.delete(matches).where(and(eq(matches.id, id), eq(matches.tenantId, tenant.id)))
    revalidatePath("/dashboard/matches")
    revalidatePath("/dashboard")
    return { success: true }
  })
})

export const getMatch = withAuth("match:read", async (id: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [match] = await db.select().from(matches)
      .where(and(eq(matches.id, id), eq(matches.tenantId, tenant.id)))
      .limit(1)
    return match ?? null
  })
})

export const getMatches = withAuth("match:read", async (filters: MatchFilters) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const validated = matchFiltersSchema.parse({ ...filters, tenantId: tenant.id })
    const { tournamentId, teamId, status, page, pageSize, sortBy, sortOrder } = validated
    const offset = (page - 1) * pageSize
    const conditions = [eq(matches.tenantId, tenant.id)]
    if (tournamentId) conditions.push(eq(matches.tournamentId, tournamentId))
    if (teamId) conditions.push(or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId))!)
    if (status) conditions.push(eq(matches.status, status))
    const whereClause = and(...conditions)
    const orderFn = sortOrder === "desc" ? desc : asc
    const orderColumn = sortBy === "scheduledDate" ? matches.scheduledDate : sortBy === "matchNumber" ? matches.matchNumber : matches.createdAt
    const [data, [{ total }]] = await Promise.all([
      db.select().from(matches).where(whereClause).orderBy(orderFn(orderColumn)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(matches).where(whereClause),
    ])
    return { data, pagination: { page, pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / pageSize) } }
  })
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

const startStreamSchema = z.object({
  matchId: z.string().uuid(),
  source: z.enum(["facebook", "youtube", "rtmp", "webrtc"]),
  url: z.string().url(),
})

export const startStream = withAuth("match:update", async (matchId: string, source: "facebook" | "youtube" | "rtmp" | "webrtc", url: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
// Structured PlanLimitError so the UI can offer an upgrade prompt.
  checkPlanFeature({
    plan: tenant.plan as PlanKey,
    feature: "liveStreaming",
    label: "Live streaming",
  })
  const validated = startStreamSchema.parse({ matchId, source, url })
  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [match] = await db.update(matches)
      .set({ liveStreamUrl: validated.url, streamSource: validated.source, streamStatus: "live", updatedAt: new Date() })
      .where(and(eq(matches.id, validated.matchId), eq(matches.tenantId, tenant.id)))
      .returning()
    if (!match) throw new Error("Match not found")
    revalidatePath(`/dashboard/matches/${matchId}`)
    revalidatePath(`/matches/${matchId}/live`)
    return { success: true, match }
  })
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
  const match = await withTenantContext({ userId, tenantId }, () => db.transaction(async tx => {
    // Match -> ordered users -> league -> ordered memberships. This matches the
    // canonical writer. Member removal never locks matches: its plain reads run
    // AFTER these same user locks, so assignment/removal cannot orphan a slot.
    const key = and(eq(matches.id, matchId), eq(matches.tenantId, tenantId))
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${key} FOR UPDATE`)
    const existing = await tx.query.matches.findFirst({ where: key })
    if (!existing || existing.id !== matchId || existing.tenantId !== tenantId) throw new Error("Match not found")
    const initialActor = await tx.query.users.findFirst({ where: eq(users.clerkId, userId) })
    if (!initialActor) throw new Error("Forbidden: assignment account not found")
    const ids = [...new Set([initialActor.id, ...(scorerId ? [scorerId] : [])])].sort()
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${inArray(users.id, ids)} ORDER BY ${users.id} FOR UPDATE`)
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
    await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
      WHERE ${and(eq(userTenantRoles.tenantId, tenantId), inArray(userTenantRoles.userId, ids))}
      ORDER BY ${userTenantRoles.id} FOR UPDATE`)
    const actor = await tx.query.users.findFirst({ where: eq(users.id, initialActor.id) })
    const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
    const actorMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, initialActor.id), eq(userTenantRoles.tenantId, tenantId),
    ) })
    if (!actor || actor.id !== initialActor.id || actor.clerkId !== userId || actor.isActive !== true
      || !league || league.id !== tenantId || league.isActive !== true
      || !actorMember || actorMember.userId !== actor.id || actorMember.tenantId !== tenantId
      || actorMember.status !== "active" || actorMember.role !== "league_owner") {
      throw new Error("Forbidden: your scorer-assignment access changed")
    }
    if (scorerId) {
      const account = await tx.query.users.findFirst({ where: eq(users.id, scorerId) })
      const member = await tx.query.userTenantRoles.findFirst({ where: and(
        eq(userTenantRoles.userId, scorerId), eq(userTenantRoles.tenantId, tenantId),
      ) })
      if (!account || account.id !== scorerId || account.isActive !== true
        || !member || member.userId !== scorerId || member.tenantId !== tenantId
        || member.status !== "active" || member.role !== "scorer") {
        throw new Error("Selected user is not an active scorer in this tenant")
      }
    }
    // A single person cannot occupy both the primary and backup slot.
    const otherSlot = targetSlot === "primary" ? existing.backupScorerId : existing.scorerId
    if (scorerId && otherSlot === scorerId) throw new Error("Primary and backup scorer must be different people")
    if ((targetSlot === "primary" ? existing.scorerId : existing.backupScorerId) === scorerId) return existing
    const patch = targetSlot === "primary"
      ? { scorerId, updatedAt: new Date() }
      : { backupScorerId: scorerId, updatedAt: new Date() }
    const [updated] = await tx.update(matches)
      .set(patch)
      .where(key)
      .returning()
    if (!updated) throw new Error("Match changed. Reload before assigning.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: actor.id, actorRole: actorMember.role,
      method: "MATCH_SCORER_ASSIGN", path: `/dashboard/matches/${matchId}`, statusCode: "200",
      payload: { matchId, slot: targetSlot,
        before: { scorerId: existing.scorerId, backupScorerId: existing.backupScorerId },
        after: { scorerId: updated.scorerId, backupScorerId: updated.backupScorerId } },
    })
    return updated
  }, { isolationLevel: "read committed" }))
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
  return db.select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(scorerMembership(tenantId))
})

export const endStream = withAuth("match:update", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [match] = await db.update(matches)
      .set({ streamStatus: "ended", updatedAt: new Date() })
      .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenant.id)))
      .returning()
    if (!match) throw new Error("Match not found")
    revalidatePath(`/dashboard/matches/${matchId}`)
    revalidatePath(`/matches/${matchId}/live`)
    return { success: true, match }
  })
})
