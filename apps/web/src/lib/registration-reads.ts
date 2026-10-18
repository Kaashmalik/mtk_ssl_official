import { auth } from "@clerk/nextjs/server"
import { db, users, userTenantRoles, tenants, leagueRegistrations, teams, tournaments, players, membershipGrantsAccess } from "@mtk/database"
import { teamManagementGrant } from "@mtk/database/lib/resource-grants"
import { and, eq, asc, desc, count } from "drizzle-orm"
import { z } from "zod"
import { resolveActiveTenantId, requirePermissionServer } from "./rbac-server"
import { hasPermission, type Permission, type UserRole } from "./rbac"

export type RegistrationReadContext = { tenantId: string; actorId: string; clerkId: string; role: UserRole }

/** Request-local authorization, not a lock or a read-versus-revocation guarantee. */
export async function requireRegistrationReadContext(permission: Permission): Promise<RegistrationReadContext> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) throw new Error("Forbidden: registration account unavailable")
  const membership = await db.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId)) })
  const league = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!membership || membership.userId !== actor.id || membership.tenantId !== tenantId
    || !membershipGrantsAccess(membership) || membership.role === "super_admin" || !hasPermission(membership.role, permission)
    || !league || league.id !== tenantId || league.isActive !== true) throw new Error("Forbidden: registration access unavailable")
  return { tenantId, actorId: actor.id, clerkId, role: membership.role }
}

/**
 * Access decision for the league registration review queue. Returns the review
 * context when the viewer holds `registration:manage` in the exact active league,
 * or `null` when they are simply not a league owner: no active league, no active
 * membership, a `super_admin`-only membership, or a missing permission. Tenant,
 * actor, membership and league lookups are not swallowed here, so an
 * infrastructure failure throws and the page's error boundary reports it instead
 * of showing a redirect that would look like an ordinary non-owner visit.
 */
export async function resolveRegistrationReviewAccess(): Promise<RegistrationReadContext | null> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) return null
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) return null
  const membership = await db.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId)) })
  const league = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!membership || membership.userId !== actor.id || membership.tenantId !== tenantId
    || !membershipGrantsAccess(membership) || membership.role === "super_admin"
    || !hasPermission(membership.role, "registration:manage")
    || !league || league.id !== tenantId || league.isActive !== true) return null
  return { tenantId, actorId: actor.id, clerkId, role: membership.role }
}

export function canWithdrawRegistration(context: RegistrationReadContext, team: { isActive: boolean; managerId: string | null; captainId: string | null }) {
  return team.isActive && (context.role === "league_owner" || (context.role === "team_manager"
    && teamManagementGrant(team, context.actorId) !== null))
}

// Explicit projections: ordinary review reads never fetch the off-platform payment
// transaction reference or the global registered-by/approved-by account UUIDs.
export const registrationReviewColumns = {
  id: leagueRegistrations.id, tenantId: leagueRegistrations.tenantId, tournamentId: leagueRegistrations.tournamentId,
  teamId: leagueRegistrations.teamId, status: leagueRegistrations.status, rejectionReason: leagueRegistrations.rejectionReason,
  registrationFee: leagueRegistrations.registrationFee, paymentStatus: leagueRegistrations.paymentStatus,
  squadPlayerIds: leagueRegistrations.squadPlayerIds, notes: leagueRegistrations.notes,
  approvedAt: leagueRegistrations.approvedAt, createdAt: leagueRegistrations.createdAt, updatedAt: leagueRegistrations.updatedAt,
}

export const registrationReviewFilters = z.object({
  tournamentId: z.string().uuid().optional(),
  status: z.enum(["pending", "approved", "rejected", "withdrawn", "waitlisted"]).optional(),
  page: z.number().int().min(1).max(1000000).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
}).strict()

function page(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
}

/** Active-league review list. Single joined read, bounded page, no per-row lookups. */
export async function readRegistrations(tenantId: string, input: z.input<typeof registrationReviewFilters>) {
  const { tournamentId, status, page: current, pageSize } = registrationReviewFilters.parse(input)
  const where = and(eq(leagueRegistrations.tenantId, tenantId),
    tournamentId ? eq(leagueRegistrations.tournamentId, tournamentId) : undefined,
    status ? eq(leagueRegistrations.status, status) : undefined)
  const [data, [total]] = await Promise.all([
    db.select({ ...registrationReviewColumns, teamName: teams.name, tournamentName: tournaments.name })
      .from(leagueRegistrations)
      .innerJoin(teams, and(eq(teams.id, leagueRegistrations.teamId), eq(teams.tenantId, tenantId)))
      .innerJoin(tournaments, and(eq(tournaments.id, leagueRegistrations.tournamentId), eq(tournaments.tenantId, tenantId)))
      .where(where)
      .orderBy(desc(leagueRegistrations.createdAt), desc(leagueRegistrations.id))
      .limit(pageSize).offset((current - 1) * pageSize),
    db.select({ total: count() }).from(leagueRegistrations).where(where),
  ])
  return { data, pagination: page(current, pageSize, Number(total.total)) }
}

/** The acting account's own submissions, still bounded to the exact active league. */
export async function readActorRegistrations(tenantId: string, actorId: string, input: z.input<typeof registrationReviewFilters>) {
  const { tournamentId, status, page: current, pageSize } = registrationReviewFilters.parse(input)
  const where = and(eq(leagueRegistrations.tenantId, tenantId), eq(leagueRegistrations.registeredBy, actorId),
    tournamentId ? eq(leagueRegistrations.tournamentId, tournamentId) : undefined,
    status ? eq(leagueRegistrations.status, status) : undefined)
  const [data, [total]] = await Promise.all([
    db.select({ ...registrationReviewColumns, teamName: teams.name, tournamentName: tournaments.name })
      .from(leagueRegistrations)
      .innerJoin(teams, and(eq(teams.id, leagueRegistrations.teamId), eq(teams.tenantId, tenantId)))
      .innerJoin(tournaments, and(eq(tournaments.id, leagueRegistrations.tournamentId), eq(tournaments.tenantId, tenantId)))
      .where(where)
      .orderBy(desc(leagueRegistrations.createdAt), desc(leagueRegistrations.id))
      .limit(pageSize).offset((current - 1) * pageSize),
    db.select({ total: count() }).from(leagueRegistrations).where(where),
  ])
  return { data, pagination: page(current, pageSize, Number(total.total)) }
}

/** Active, unassigned-to-any-registration eligibility options for the active league. */
export async function readRegistrationTournamentOptions(tenantId: string) {
  const rows = await db.select({ id: tournaments.id, name: tournaments.name, entryFee: tournaments.entryFee, maxTeams: tournaments.maxTeams })
    .from(tournaments)
    .where(and(eq(tournaments.tenantId, tenantId), eq(tournaments.registrationOpen, true)))
    .orderBy(desc(tournaments.createdAt), desc(tournaments.id)).limit(101)
  return { tournaments: rows.slice(0, 100), truncated: rows.length > 100 }
}

export type RegistrationFormOptions = {
  teams: { id: string; name: string }[]
  tournaments: { id: string; name: string; registrationOpen: boolean }[]
  players: { id: string; name: string; teamId: string | null }[]
}

/**
 * Bounded, tenant-scoped pickers for the self-service registration form. Every query
 * is predicated on the caller's resolved tenantId, so the form can only ever offer
 * teams, tournaments and players from the exact active league. Each picker is
 * over-fetched by one row and truncated to the bound, so a caller can detect overflow
 * without an unbounded read.
 */
export async function readRegistrationFormOptions(tenantId: string): Promise<RegistrationFormOptions> {
  const [teamRows, tournamentRows, playerRows] = await Promise.all([
    db.select({ id: teams.id, name: teams.name }).from(teams)
      .where(and(eq(teams.tenantId, tenantId), eq(teams.isActive, true)))
      .orderBy(asc(teams.name), asc(teams.id)).limit(101),
    db.select({ id: tournaments.id, name: tournaments.name, registrationOpen: tournaments.registrationOpen })
      .from(tournaments).where(eq(tournaments.tenantId, tenantId))
      .orderBy(asc(tournaments.name), asc(tournaments.id)).limit(101),
    db.select({ id: players.id, name: players.name, teamId: players.teamId }).from(players)
      .where(eq(players.tenantId, tenantId))
      .orderBy(asc(players.name), asc(players.id)).limit(201),
  ])
  return {
    teams: teamRows.slice(0, 100),
    tournaments: tournamentRows.slice(0, 100),
    players: playerRows.slice(0, 200),
  }
}
