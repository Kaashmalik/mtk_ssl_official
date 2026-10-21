import { auth } from "@clerk/nextjs/server"
import {
  db, users, userTenantRoles, tenants, tournaments, venues, teams, players, matches,
  membershipGrantsAccess,
} from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { teamManagementGrant } from "@mtk/database/lib/resource-grants"
import type { MediaBindingType } from "@mtk/database/lib/media-policy"
import { resolveActiveTenantId } from "./rbac-server"
import { hasPermission, type Permission, type UserRole } from "./rbac"

/**
 * ENH-07-02: authorize an ACTIVE, SCOPED media actor.
 *
 * The class permission says what KIND of operation a role may perform; it does
 * not name a resource. Media authority therefore composes:
 *   active account + active league membership + class permission
 *   + (for team/player media) the durable team grant.
 *
 * A foreign resource id is refused before a quota is reserved or a signature is
 * issued. `super_admin` is a platform identity, not league membership, and is
 * deliberately denied here (admin adapters authorize separately).
 */

export const MEDIA_BINDING_PERMISSION: Record<MediaBindingType, Permission> = {
  branding: "settings:manage",
  tournament: "tournament:update",
  venue: "venue:manage",
  team: "team:update",
  player: "player:update",
  match: "match:update",
}

export type MediaActor = {
  tenantId: string
  actorId: string
  clerkId: string
  role: UserRole
}

export type MediaAuthorizationErrorCode =
  | "unauthorized"
  | "tenant_not_found"
  | "account_unavailable"
  | "membership_unavailable"
  | "permission_denied"
  | "resource_not_found"
  | "foreign_resource"
  | "resource_grant_required"

export class MediaAuthorizationError extends Error {
  constructor(readonly code: MediaAuthorizationErrorCode) {
    super(code)
    this.name = "MediaAuthorizationError"
  }
}

/**
 * Active account + active league membership, WITHOUT a capability check.
 * Used to locate a session before its stored binding type is known; callers
 * must still check the class permission and resource grant.
 */
export async function requireMediaMember(): Promise<MediaActor> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new MediaAuthorizationError("unauthorized")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new MediaAuthorizationError("tenant_not_found")

  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) {
    throw new MediaAuthorizationError("account_unavailable")
  }
  const membership = await db.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actor.id),
    eq(userTenantRoles.tenantId, tenantId),
  ) })
  if (!membership || membership.userId !== actor.id || membership.tenantId !== tenantId
    || !membershipGrantsAccess(membership) || membership.role === "super_admin") {
    throw new MediaAuthorizationError("membership_unavailable")
  }
  const league = await db.query.tenants.findFirst({ where: and(
    eq(tenants.id, tenantId), eq(tenants.isActive, true),
  ) })
  if (!league || league.id !== tenantId) throw new MediaAuthorizationError("tenant_not_found")

  return { tenantId, actorId: actor.id, clerkId, role: membership.role as UserRole }
}

export async function requireMediaActor(bindingType: MediaBindingType): Promise<MediaActor> {
  const actor = await requireMediaMember()
  if (!hasPermission(actor.role, MEDIA_BINDING_PERMISSION[bindingType])) {
    throw new MediaAuthorizationError("permission_denied")
  }
  return actor
}

async function requireTeamGrant(actor: MediaActor, team: {
  tenantId: string
  managerId: string | null
  captainId: string | null
}): Promise<void> {
  if (team.tenantId !== actor.tenantId) throw new MediaAuthorizationError("foreign_resource")
  // Owners hold every grant by scope; other roles must hold the durable pointer.
  if (actor.role === "league_owner") return
  if (teamManagementGrant(team, actor.actorId) === null) {
    throw new MediaAuthorizationError("resource_grant_required")
  }
}

/**
 * Verify the resource belongs to the actor's league and, where the capability
 * is resource-bounded, that the actor holds its grant.
 */
export async function assertMediaResourceAccess(input: {
  actor: MediaActor
  bindingType: MediaBindingType
  resourceId: string
}): Promise<void> {
  const { actor, bindingType, resourceId } = input

  if (bindingType === "branding") {
    if (resourceId !== actor.tenantId) throw new MediaAuthorizationError("foreign_resource")
    return
  }

  if (bindingType === "team") {
    const [team] = await db
      .select({ tenantId: teams.tenantId, managerId: teams.managerId, captainId: teams.captainId })
      .from(teams)
      .where(eq(teams.id, resourceId))
      .limit(1)
    if (!team) throw new MediaAuthorizationError("resource_not_found")
    await requireTeamGrant(actor, team)
    return
  }

  if (bindingType === "player") {
    const [player] = await db
      .select({ tenantId: players.tenantId, teamId: players.teamId })
      .from(players)
      .where(eq(players.id, resourceId))
      .limit(1)
    if (!player) throw new MediaAuthorizationError("resource_not_found")
    if (player.tenantId !== actor.tenantId) throw new MediaAuthorizationError("foreign_resource")
    if (actor.role === "league_owner") return
    if (!player.teamId) throw new MediaAuthorizationError("resource_grant_required")
    const [team] = await db
      .select({ tenantId: teams.tenantId, managerId: teams.managerId, captainId: teams.captainId })
      .from(teams)
      .where(and(eq(teams.id, player.teamId), eq(teams.tenantId, actor.tenantId)))
      .limit(1)
    if (!team) throw new MediaAuthorizationError("resource_grant_required")
    await requireTeamGrant(actor, team)
    return
  }

  if (bindingType === "tournament") {
    const [row] = await db.select({ tenantId: tournaments.tenantId }).from(tournaments)
      .where(eq(tournaments.id, resourceId)).limit(1)
    if (!row) throw new MediaAuthorizationError("resource_not_found")
    if (row.tenantId !== actor.tenantId) throw new MediaAuthorizationError("foreign_resource")
    return
  }

  if (bindingType === "venue") {
    const [row] = await db.select({ tenantId: venues.tenantId }).from(venues)
      .where(eq(venues.id, resourceId)).limit(1)
    if (!row) throw new MediaAuthorizationError("resource_not_found")
    if (row.tenantId !== actor.tenantId) throw new MediaAuthorizationError("foreign_resource")
    return
  }

  const [row] = await db.select({ tenantId: matches.tenantId }).from(matches)
    .where(eq(matches.id, resourceId)).limit(1)
  if (!row) throw new MediaAuthorizationError("resource_not_found")
  if (row.tenantId !== actor.tenantId) throw new MediaAuthorizationError("foreign_resource")
}
