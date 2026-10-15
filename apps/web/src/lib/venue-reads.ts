import { auth } from "@clerk/nextjs/server"
import { db, users, userTenantRoles, tenants, venues } from "@mtk/database"
import { and, eq, asc, desc } from "drizzle-orm"
import { z } from "zod"
import { resolveActiveTenantId, requirePermissionServer } from "./rbac-server"
import { hasPermission, type Permission, type UserRole } from "./rbac"

export type VenueReadContext = { tenantId: string; actorId: string; clerkId: string; role: UserRole }

/** Request-local authorization, not a lock or a read-versus-revocation guarantee. */
export async function requireVenueReadContext(permission: Permission): Promise<VenueReadContext> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) throw new Error("Forbidden: venue account unavailable")
  const membership = await db.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId)) })
  const league = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!membership || membership.userId !== actor.id || membership.tenantId !== tenantId
    || membership.status !== "active" || membership.role === "super_admin" || !hasPermission(membership.role, permission)
    || !league || league.id !== tenantId || league.isActive !== true) throw new Error("Forbidden: venue access unavailable")
  return { tenantId, actorId: actor.id, clerkId, role: membership.role }
}

export const venueListLimit = 200

/**
 * Bounded venue list for the dashboard, scoped to the exact active league. Active
 * venues sort first; the list is over-fetched by one row so a caller can detect
 * overflow without an unbounded read.
 */
export async function readVenueList(tenantId: string) {
  const rows = await db.select().from(venues)
    .where(eq(venues.tenantId, tenantId))
    .orderBy(desc(venues.isActive), asc(venues.name), asc(venues.id))
    .limit(venueListLimit + 1)
  const truncated = rows.length > venueListLimit
  return { truncated, venues: truncated ? rows.slice(0, venueListLimit) : rows }
}

/** A single venue by id, scoped to the exact active league. A foreign id is not found. */
export async function readVenue(tenantId: string, id: string) {
  z.string().uuid().parse(id)
  const [venue] = await db.select().from(venues)
    .where(and(eq(venues.id, id), eq(venues.tenantId, tenantId))).limit(1)
  return venue ?? null
}

export type VenueOption = { id: string; name: string; city: string | null }

/**
 * Bounded active-venue picker for the same league (e.g. linking a fixture to a
 * ground). Archived venues are excluded so a schedule cannot reference a retired
 * ground by accident.
 */
export async function readVenueOptions(tenantId: string): Promise<VenueOption[]> {
  const rows = await db.select({ id: venues.id, name: venues.name, city: venues.city }).from(venues)
    .where(and(eq(venues.tenantId, tenantId), eq(venues.isActive, true)))
    .orderBy(asc(venues.name), asc(venues.id)).limit(201)
  return rows.slice(0, 200)
}
