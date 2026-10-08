"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db, withTenantContext } from "@mtk/database"
import { matches, teams, tournaments, users } from "@mtk/database"
import { eq, and, desc, asc, count, or, arrayContains } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"
import { checkPlanFeature, type PlanKey } from "@mtk/database"



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
  const cleanData = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined)
  ) as Omit<Partial<CreateMatchInput>, "scheduledDate"> & {
    scheduledDate?: Date | null;
  };
  if (cleanData.tenantId) {
    delete cleanData.tenantId;
  }

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
  const tenant = await requireTenant()
  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [match] = await db.update(matches)
      .set({ tossWinnerId, tossDecision, status: "toss", updatedAt: new Date() })
      .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenant.id)))
      .returning()
    if (!match) throw new Error("Match not found")
    revalidatePath(`/dashboard/matches/${matchId}`)
    return { success: true, match }
  })
})

export const startMatch = withAuth("match:score", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [match] = await db.update(matches)
      .set({ status: "live", startDate: new Date(), updatedAt: new Date() })
      .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenant.id)))
      .returning()
    if (!match) throw new Error("Match not found")
    revalidatePath(`/dashboard/matches/${matchId}`)
    return { success: true, match }
  })
})

export const endMatch = withAuth("match:score", async (matchId: string, winnerId: string | null, result: string, manOfMatchId?: string | null) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [match] = await db.update(matches)
      .set({ status: "completed", winnerId, result, manOfMatchId: manOfMatchId ?? null, endDate: new Date(), updatedAt: new Date() })
      .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenant.id)))
      .returning()
    if (!match) throw new Error("Match not found")
    revalidatePath(`/dashboard/matches/${matchId}`)
    revalidatePath("/dashboard/matches")
    return { success: true, match }
  })
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

export const assignScorer = withAuth("match:update", async (matchId: string, scorerId: string | null) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    if (scorerId) {
      const [scorer] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, scorerId), eq(users.role, "scorer")))
        .limit(1)
      if (!scorer) throw new Error("Selected user is not a scorer")
    }
    const [match] = await db.update(matches)
      .set({ scorerId, updatedAt: new Date() })
      .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenant.id)))
      .returning()
    if (!match) throw new Error("Match not found")
    revalidatePath(`/dashboard/matches/${matchId}`)
    return { success: true, match }
  })
})

export const getScorersForTenant = withAuth("match:read", async () => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  return db.select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(and(eq(users.role, "scorer"), arrayContains(users.tenantIds, [tenant.id])))
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
