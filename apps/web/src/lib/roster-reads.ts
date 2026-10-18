import { auth } from "@clerk/nextjs/server"
import { db, teams, players, users, userTenantRoles, tenants, matches, membershipGrantsAccess } from "@mtk/database"
import { and, eq, asc, desc, ilike, isNull, count, sql } from "drizzle-orm"
import { z } from "zod"
import { resolveActiveTenantId, requirePermissionServer } from "./rbac-server"
import { hasPermission, type Permission, type UserRole } from "./rbac"

export type RosterReadContext = { tenantId: string; actorId: string; clerkId: string; role: UserRole }

/** Request-local authorization, not a lock or a read-versus-revocation guarantee. */
export async function requireRosterReadContext(permission: Permission): Promise<RosterReadContext> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) throw new Error("Forbidden: roster account unavailable")
  const membership = await db.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId)) })
  const league = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!membership || membership.userId !== actor.id || membership.tenantId !== tenantId
    || !membershipGrantsAccess(membership) || membership.role === "super_admin" || !hasPermission(membership.role, permission)
    || !league || league.id !== tenantId || league.isActive !== true) throw new Error("Forbidden: roster access unavailable")
  return { tenantId, actorId: actor.id, clerkId, role: membership.role }
}

export function canManageRosterTeam(context: RosterReadContext, team: { isActive: boolean; managerId: string | null; captainId: string | null }) {
  return team.isActive && (context.role === "league_owner" || (context.role === "team_manager"
    && (team.managerId === context.actorId || team.captainId === context.actorId)))
}

// Explicit projections: ordinary reads never fetch contact/DOB/physical/free-text
// profile data, global identity links or creator metadata for client serialization.
const rosterPlayerColumns = {
  id: players.id, tenantId: players.tenantId, teamId: players.teamId, name: players.name,
  role: players.role, battingStyle: players.battingStyle, bowlingStyle: players.bowlingStyle,
  jerseyNumber: players.jerseyNumber, photoUrl: players.photoUrl, nationality: players.nationality,
  city: players.city, status: players.status, isActive: players.isActive,
}
const editablePlayerColumns = { ...rosterPlayerColumns, email: players.email, phone: players.phone,
  dateOfBirth: players.dateOfBirth, heightCm: players.heightCm, weightKg: players.weightKg, biography: players.biography,
  guardianName: players.guardianName, guardianConsentAt: players.guardianConsentAt, guardianConsentRecordedBy: players.guardianConsentRecordedBy }
export type EditableRosterPlayer = Pick<typeof players.$inferSelect, keyof typeof editablePlayerColumns>

const teamColumns = {
  id: teams.id, tenantId: teams.tenantId, tournamentId: teams.tournamentId, name: teams.name, shortName: teams.shortName,
  slug: teams.slug, description: teams.description, city: teams.city, logoUrl: teams.logoUrl, bannerUrl: teams.bannerUrl,
  primaryColor: teams.primaryColor, secondaryColor: teams.secondaryColor, captainId: teams.captainId,
  managerId: teams.managerId, maxSquadSize: teams.maxSquadSize, homeGround: teams.homeGround,
  foundedYear: teams.foundedYear, jerseyColor: teams.jerseyColor, isActive: teams.isActive,
  createdAt: teams.createdAt, updatedAt: teams.updatedAt,
}
export type RosterTeam = Pick<typeof teams.$inferSelect, keyof typeof teamColumns>

export const rosterTeamFilters = z.object({ tenantId: z.string().uuid().optional(), tournamentId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(), isActive: z.boolean().optional(),
  page: z.number().int().min(1).max(1000000).default(1), pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["name", "createdAt", "city"]).default("name"), sortOrder: z.enum(["asc", "desc"]).default("asc"),
}).strict()
export const rosterPlayerFilters = z.object({ tenantId: z.string().uuid().optional(), teamId: z.string().uuid().optional(),
  role: z.enum(["batsman", "bowler", "all_rounder", "wicket_keeper", "wicket_keeper_batsman"]).optional(),
  status: z.enum(["active", "injured", "retired", "suspended", "inactive"]).optional(),
  isActive: z.boolean().optional(), unassigned: z.boolean().optional(), search: z.string().trim().max(100).optional(),
  page: z.number().int().min(1).max(1000000).default(1), pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["name", "createdAt", "jerseyNumber"]).default("name"), sortOrder: z.enum(["asc", "desc"]).default("asc"),
}).strict().refine(value => !(value.teamId && value.unassigned), "Choose a team or unassigned, not both")
function verifyScope(tenantId: string, supplied?: string) { if (supplied && supplied !== tenantId) throw new Error("Invalid tenant") }
function contains(value: string) { return `%${value.replace(/[\\%_]/g, "\\$&")}%` }
function pagination(page: number, pageSize: number, total: number) { return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } }

export async function readRosterTeam(tenantId: string, id: string) {
  z.string().uuid().parse(id)
  const [row] = await db.select(teamColumns).from(teams).where(and(eq(teams.id, id), eq(teams.tenantId, tenantId))).limit(1)
  return row ?? null
}
export async function readRosterPlayer(tenantId: string, id: string) {
  z.string().uuid().parse(id)
  const [row] = await db.select({ ...rosterPlayerColumns, teamId: teams.id, teamName: teams.name, teamIsActive: teams.isActive }).from(players)
    .leftJoin(teams, and(eq(teams.id, players.teamId), eq(teams.tenantId, tenantId)))
    .where(and(eq(players.id, id), eq(players.tenantId, tenantId))).limit(1)
  return row ?? null
}
export async function readEditableRosterPlayer(context: RosterReadContext, id: string) {
  z.string().uuid().parse(id)
  if (context.role !== "league_owner") throw new Error("Forbidden: only league owners may read player edit data")
  const [row] = await db.select(editablePlayerColumns).from(players)
    .where(and(eq(players.id, id), eq(players.tenantId, context.tenantId))).limit(1)
  return row ?? null
}
export async function readRosterSquad(tenantId: string, teamId: string) {
  return db.select(rosterPlayerColumns).from(players)
    .where(and(eq(players.tenantId, tenantId), eq(players.teamId, teamId))).orderBy(asc(players.name), asc(players.id))
}
export async function readRosterTeamOptions(tenantId: string) {
  const rows = await db.select({ id: teams.id, name: teams.name }).from(teams)
    .where(and(eq(teams.tenantId, tenantId), eq(teams.isActive, true))).orderBy(asc(teams.name), asc(teams.id)).limit(101)
  return { teams: rows.slice(0, 100), truncated: rows.length > 100 }
}
export function rosterPageNumber(value: unknown) { return z.coerce.number().int().min(1).max(1000000).parse(value ?? 1) }
export async function readRosterTeams(tenantId: string, input: z.input<typeof rosterTeamFilters>) {
  const { tenantId: supplied, tournamentId, search, isActive, page, pageSize, sortBy, sortOrder } = rosterTeamFilters.parse(input)
  verifyScope(tenantId, supplied)
  const where = and(eq(teams.tenantId, tenantId), tournamentId ? eq(teams.tournamentId, tournamentId) : undefined,
    search ? ilike(teams.name, contains(search)) : undefined, isActive === undefined ? undefined : eq(teams.isActive, isActive))
  const order = sortOrder === "desc" ? desc : asc
  // Bounded page; database-side scoped aggregates, not one network query per row.
  const [data, [total]] = await Promise.all([
    db.select({ ...teamColumns,
      playerCount: sql<number>`(select count(*) from ${players} where ${players.tenantId} = ${tenantId} and ${players.teamId} = ${teams.id})`.mapWith(Number),
      wins: sql<number>`(select count(*) from ${matches} where ${matches.tenantId} = ${tenantId} and ${matches.status} = 'completed'
        and (${matches.teamAId} = ${teams.id} or ${matches.teamBId} = ${teams.id}) and ${matches.winnerId} = ${teams.id})`.mapWith(Number),
      losses: sql<number>`(select count(*) from ${matches} where ${matches.tenantId} = ${tenantId} and ${matches.status} = 'completed'
        and ((${matches.teamAId} = ${teams.id} and ${matches.winnerId} = ${matches.teamBId})
          or (${matches.teamBId} = ${teams.id} and ${matches.winnerId} = ${matches.teamAId})))`.mapWith(Number),
      played: sql<number>`(select count(*) from ${matches} where ${matches.tenantId} = ${tenantId} and ${matches.status} = 'completed'
        and (${matches.teamAId} = ${teams.id} or ${matches.teamBId} = ${teams.id}))`.mapWith(Number),
    }).from(teams).where(where).orderBy(order(sortBy === "name" ? teams.name : sortBy === "city" ? teams.city : teams.createdAt), asc(teams.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(teams).where(where),
  ])
  return { data, pagination: pagination(page, pageSize, Number(total.total)) }
}
export async function readRosterPlayers(tenantId: string, input: z.input<typeof rosterPlayerFilters>) {
  const { tenantId: supplied, teamId, role, status, search, isActive, unassigned, page, pageSize, sortBy, sortOrder } = rosterPlayerFilters.parse(input)
  verifyScope(tenantId, supplied)
  const join = and(eq(teams.id, players.teamId), eq(teams.tenantId, tenantId))
  const where = and(eq(players.tenantId, tenantId), teamId ? eq(teams.id, teamId) : undefined,
    unassigned ? isNull(players.teamId) : undefined, role ? eq(players.role, role) : undefined,
    status ? eq(players.status, status) : undefined, search ? ilike(players.name, contains(search)) : undefined,
    isActive === undefined ? undefined : eq(players.isActive, isActive))
  const order = sortOrder === "desc" ? desc : asc
  const [data, [total]] = await Promise.all([
    db.select({ ...rosterPlayerColumns, teamId: teams.id, teamName: teams.name }).from(players).leftJoin(teams, join).where(where)
      .orderBy(order(sortBy === "name" ? players.name : sortBy === "jerseyNumber" ? players.jerseyNumber : players.createdAt), asc(players.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(players).leftJoin(teams, join).where(where),
  ])
  return { data, pagination: pagination(page, pageSize, Number(total.total)) }
}
