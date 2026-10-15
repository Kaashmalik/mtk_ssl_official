import { auth } from "@clerk/nextjs/server"
import { db, users, userTenantRoles, tenants, leagueRegistrations, teams, tournaments } from "@mtk/database"
import { and, eq, desc, count } from "drizzle-orm"
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
    || membership.status !== "active" || membership.role === "super_admin" || !hasPermission(membership.role, permission)
    || !league || league.id !== tenantId || league.isActive !== true) throw new Error("Forbidden: registration access unavailable")
  return { tenantId, actorId: actor.id, clerkId, role: membership.role }
}

export function canWithdrawRegistration(context: RegistrationReadContext, team: { isActive: boolean; managerId: string | null; captainId: string | null }) {
  return team.isActive && (context.role === "league_owner" || (context.role === "team_manager"
    && (team.managerId === context.actorId || team.captainId === context.actorId)))
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

export function registrationPageNumber(value: unknown) { return z.coerce.number().int().min(1).max(1000000).parse(value ?? 1) }

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
