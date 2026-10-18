import { randomUUID } from "crypto"
import {
  db, userInvites, userTenantRoles, users, teams, tenants, notifications, auditLogs,
  membershipGrantsAccess, type InvitationEmailState,
} from "@mtk/database"
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm"
import { assertSupportedInvitationScope, hasVerifiedInvitedEmail } from "@/lib/invitation-policy"

/**
 * Invitation/membership record operations. Every function is predicated on an
 * explicit, caller-resolved `tenantId` (and, for the management flows, an
 * authority re-check under row locks). No provider/network calls happen under
 * locks here — email dispatch stays outside the transactions in the action
 * module, which only gates, validates and shapes responses. Writes are locked
 * and audited; reads are single-league.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Actor = typeof users.$inferSelect
type Invite = typeof userInvites.$inferSelect
/** Exactly the roles an invitation may grant. */
type InvitableRole = "team_manager" | "captain" | "coach" | "scorer" | "player"
type ProviderUser = {
  id: string
  emailAddresses: { emailAddress: string; verification: { status: string | null } | null }[]
} | null

export interface InviteAuthority {
  issuer: Actor
  league: typeof tenants.$inferSelect
}

/** Minimum delay between dispatch attempts for one invitation. */
const resendCooldownMs = 60 * 1000

/** Shared user -> league -> memberships order; no provider/network calls under locks. */
async function lockInvitationAuthority(
  tx: Tx, tenantId: string, issuerId: string,
  recipientId?: string, issuing = false, issuerClerkId?: string,
) {
  const ids = [...new Set([issuerId, ...(recipientId ? [recipientId] : [])])].sort()
  await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${inArray(users.id, ids)} ORDER BY ${users.id} FOR UPDATE`)
  // Issuance serializes the duplicate check for all owners in this league.
  await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} ${issuing ? sql`FOR UPDATE` : sql`FOR SHARE`}`)
  await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
    WHERE ${and(eq(userTenantRoles.tenantId, tenantId), inArray(userTenantRoles.userId, ids))}
    ORDER BY ${userTenantRoles.id} FOR UPDATE`)
  const issuer = await tx.query.users.findFirst({ where: eq(users.id, issuerId) })
  const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  const membership = await tx.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, issuerId), eq(userTenantRoles.tenantId, tenantId),
  ) })
  if (!issuer || issuer.id !== issuerId || issuer.isActive !== true || (issuerClerkId !== undefined && issuer.clerkId !== issuerClerkId)
    || !league || league.id !== tenantId || league.isActive !== true
    || !membership || membership.userId !== issuerId || membership.tenantId !== tenantId
    || !membershipGrantsAccess(membership) || membership.role !== "league_owner") {
    throw new Error("Invitation authority changed. Contact an active league owner.")
  }
  return { issuer, league }
}

async function auditInvite(tx: Tx, tenantId: string, actorId: string, action: string, payload: object) {
  await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId,
    method: action, path: "/dashboard/settings/members", statusCode: "200", payload })
}

/**
 * Best-effort persistence of the last dispatch outcome (IAM-04). This runs after
 * the invitation is committed, so a bookkeeping failure must not roll the invite
 * back or report a false send failure. It never stores the token or link.
 */
export async function recordEmailAttempt(inviteId: string, tenantId: string, state: InvitationEmailState) {
  try {
    await db.update(userInvites).set({
      emailState: state, emailAttemptedAt: new Date(),
      emailAttemptCount: sql`${userInvites.emailAttemptCount} + 1`,
    }).where(and(eq(userInvites.id, inviteId), eq(userInvites.tenantId, tenantId)))
  } catch { /* invitation is already saved; the outcome stays unknown until the next attempt */ }
}

/** All invitations of the league, newest first, with expiry folded into status. */
export async function readLeagueInvites(tenantId: string) {
  return db.select({ id: userInvites.id, email: userInvites.email, role: userInvites.role,
    status: sql<string>`CASE WHEN ${userInvites.status} = 'pending' AND ${userInvites.expiresAt} <= clock_timestamp() THEN 'expired' ELSE ${userInvites.status} END`,
    teamId: userInvites.teamId, expiresAt: userInvites.expiresAt, acceptedAt: userInvites.acceptedAt, createdAt: userInvites.createdAt,
    membershipExpiresAt: userInvites.membershipExpiresAt,
    emailState: userInvites.emailState, emailAttemptedAt: userInvites.emailAttemptedAt,
  }).from(userInvites).where(eq(userInvites.tenantId, tenantId)).orderBy(desc(userInvites.createdAt)).limit(100)
}

export async function findUserByClerkId(clerkId: string) {
  return db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
}

export async function findInviteByTokenHash(tokenHash: string) {
  return db.query.userInvites.findFirst({ where: eq(userInvites.tokenHash, tokenHash) })
}

/**
 * Bearer-link preview context for a live pending invitation: recipient email,
 * role, league/team names and expiry. Throws on an unsupported invitation
 * scope (as before) and returns null when the invite, league or team is not
 * currently available.
 */
export async function findPendingInvitePreview(tokenHash: string) {
  const invite = await db.query.userInvites.findFirst({ where: and(eq(userInvites.tokenHash, tokenHash),
    eq(userInvites.status, "pending"), sql`${userInvites.expiresAt} > clock_timestamp()`) })
  if (!invite || invite.status !== "pending" || invite.expiresAt.getTime() <= Date.now()) return null
  assertSupportedInvitationScope(invite.role, invite.teamId)
  const league = await db.query.tenants.findFirst({ where: eq(tenants.id, invite.tenantId) })
  if (!league || league.id !== invite.tenantId || league.isActive !== true) return null
  let teamName: string | null = null
  if (invite.teamId) {
    const team = await db.query.teams.findFirst({ where: and(eq(teams.id, invite.teamId), eq(teams.tenantId, invite.tenantId)) })
    if (!team || team.id !== invite.teamId || team.tenantId !== invite.tenantId || team.isActive !== true) return null
    teamName = team.name
  }
  return { recipientEmail: invite.email, role: invite.role, leagueName: league.name, teamName, expiresAt: invite.expiresAt,
    membershipExpiresAt: invite.membershipExpiresAt }
}

/**
 * Create (issue) an invitation for the league. Authority is re-verified under
 * locks, a team target must be an active unmanaged team in this league, and
 * only one live pending invite per (email, role) may exist.
 */
export async function issueInviteInLeague(input: {
  tenantId: string
  actorId: string
  clerkId: string
  email: string
  role: InvitableRole
  teamId: string | null
  tokenHash: string
  expiresAt: Date
  /** Optional membership bound proposed at invite time; must strictly postdate now. */
  membershipExpiresAt: Date | null
}): Promise<InviteAuthority & { invite: { id: string } }> {
  const { tenantId, actorId, clerkId, email, role, teamId, tokenHash, expiresAt, membershipExpiresAt } = input
  if (membershipExpiresAt !== null && !(membershipExpiresAt.getTime() > Date.now())) {
    throw new Error("The proposed membership expiry must be in the future")
  }
  return db.transaction(async tx => {
    const authority = await lockInvitationAuthority(tx, tenantId, actorId, undefined, true, clerkId)
    if (teamId) {
      // Issue-time team checks are role-specific (Batch 134): a manager
      // invitation requires the manager pointer free; a captain invitation
      // requires the captain pointer free. The redemption writer re-checks
      // under the row lock - this is the fail-fast sibling, not the gate.
      await tx.execute(sql`SELECT ${teams.id} FROM ${teams} WHERE ${and(eq(teams.id, teamId), eq(teams.tenantId, tenantId))} FOR SHARE`)
      const team = await tx.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)) })
      if (!team || team.id !== teamId || team.tenantId !== tenantId || team.isActive !== true) {
        throw new Error("Team is unavailable or already has a manager")
      }
      if (role === "team_manager" && team.managerId !== null) throw new Error("Team is unavailable or already has a manager")
      if (role === "captain" && team.captainId !== null) throw new Error("Team is unavailable or already has a captain")
    }
    const duplicate = await tx.query.userInvites.findFirst({ where: and(
      eq(userInvites.tenantId, tenantId), eq(userInvites.email, email), eq(userInvites.role, role),
      eq(userInvites.status, "pending"), sql`${userInvites.expiresAt} > clock_timestamp()`,
    ) })
    if (duplicate) throw new Error("A live pending invite already exists. Revoke it before creating a replacement.")
    const [invite] = await tx.insert(userInvites).values({ tenantId, email, role,
      teamId, tokenHash, status: "pending", invitedBy: actorId, expiresAt, membershipExpiresAt,
    }).returning({ id: userInvites.id })
    if (!invite) throw new Error("Could not save invitation")
    await auditInvite(tx, tenantId, actorId, "INVITE_CREATE", { inviteId: invite.id, role, teamId,
      membershipExpiresAt: membershipExpiresAt ? membershipExpiresAt.toISOString() : null })
    return { invite, ...authority }
  })
}

/**
 * Revoke a live pending invitation with a CLASSIFIED replay (IAM-05 command
 * idempotency): revoking an already-REVOKED invitation replays as a pure read
 * (no write, no duplicate audit — the league's intent is already recorded
 * truth); an already-ACCEPTED invitation refuses honestly (a membership now
 * exists; use member removal instead); an unknown invitation is a distinct
 * error so a retry can never mask a wrong-league attempt. Expired-but-pending
 * rows still revoke (housekeeping clears the list); replay of the SAME revoke
 * is the only silent no-op.
 */
export async function revokePendingInvite(input: {
  tenantId: string
  actorId: string
  clerkId: string
  inviteId: string
}): Promise<{ inviteId: string; changed: boolean }> {
  const { tenantId, actorId, clerkId, inviteId } = input
  return db.transaction(async tx => {
    await lockInvitationAuthority(tx, tenantId, actorId, undefined, false, clerkId)
    const invite = await tx.query.userInvites.findFirst({ where: and(
      eq(userInvites.id, inviteId), eq(userInvites.tenantId, tenantId),
    ) })
    if (!invite || invite.id !== inviteId || invite.tenantId !== tenantId) {
      throw new Error("Invitation not found in this league")
    }
    if (invite.status === "revoked") {
      return { inviteId: invite.id, changed: false }
    }
    if (invite.status !== "pending") {
      throw new Error("This invitation is already resolved and can no longer be revoked; if it was accepted, remove the member instead")
    }
    const [updated] = await tx.update(userInvites).set({ status: "revoked" }).where(and(
      eq(userInvites.id, inviteId), eq(userInvites.tenantId, tenantId), eq(userInvites.status, "pending"),
    )).returning({ id: userInvites.id })
    if (!updated) throw new Error("Invitation changed. Reload before revoking.")
    await auditInvite(tx, tenantId, actorId, "INVITE_REVOKE", { inviteId: updated.id })
    return { inviteId: updated.id, changed: true }
  })
}

/**
 * Rotate a pending invitation's token hash under lock so a resend is a safe
 * replacement, never a duplicate. The cooldown, pending status and original
 * expiry are rechecked under lock; a resend cannot extend an invitation.
 */
export async function rotateInviteToken(input: {
  tenantId: string
  actorId: string
  clerkId: string
  inviteId: string
  tokenHash: string
}): Promise<InviteAuthority & { invite: Invite }> {
  const { tenantId, actorId, clerkId, inviteId, tokenHash } = input
  return db.transaction(async tx => {
    const authority = await lockInvitationAuthority(tx, tenantId, actorId, undefined, false, clerkId)
    await tx.execute(sql`SELECT ${userInvites.id} FROM ${userInvites}
      WHERE ${and(eq(userInvites.id, inviteId), eq(userInvites.tenantId, tenantId))} FOR UPDATE`)
    const invite = await tx.query.userInvites.findFirst({ where: and(
      eq(userInvites.id, inviteId), eq(userInvites.tenantId, tenantId),
    ) })
    if (!invite || invite.id !== inviteId || invite.tenantId !== tenantId) {
      throw new Error("Invitation not found in this league")
    }
    if (invite.status !== "pending") throw new Error("Only pending invitations can be resent")
    if (invite.expiresAt.getTime() <= Date.now()) throw new Error("Invitation expired. Revoke it and create a replacement.")
    if (invite.emailAttemptedAt && Date.now() - invite.emailAttemptedAt.getTime() < resendCooldownMs) {
      throw new Error("Please wait a moment before resending this invitation.")
    }
    assertSupportedInvitationScope(invite.role, invite.teamId)
    const [updated] = await tx.update(userInvites).set({ tokenHash }).where(and(
      eq(userInvites.id, invite.id), eq(userInvites.tenantId, tenantId), eq(userInvites.status, "pending"),
    )).returning({ id: userInvites.id })
    if (!updated) throw new Error("Invitation changed. Reload before resending.")
    await auditInvite(tx, tenantId, actorId, "INVITE_RESEND", { inviteId: invite.id, role: invite.role, teamId: invite.teamId })
    return { invite, ...authority }
  })
}

/**
 * Redeem a pending invitation under locks: re-verify the issuer's authority,
 * the recipient's account and provider-verified invited email, claim the
 * invite row with every precondition in the UPDATE predicate, then create the
 * membership and (for team managers) the team assignment. Audited, and the
 * recipient gets an in-app notification. Not a rank-based role promotion.
 */
export async function claimInvite(input: {
  clerkId: string
  provider: ProviderUser
  actor: Actor
  initial: Invite
  tokenHash: string
}): Promise<{ role: string; tenantId: string }> {
  const { clerkId, provider, actor, initial, tokenHash } = input
  return db.transaction(async tx => {
    await lockInvitationAuthority(tx, initial.tenantId, initial.invitedBy!, actor.id)
    const recipient = await tx.query.users.findFirst({ where: eq(users.id, actor.id) })
    if (!recipient || recipient.id !== actor.id || recipient.clerkId !== clerkId || recipient.isActive !== true) throw new Error("Your account access changed")
    await tx.execute(sql`SELECT ${userInvites.id} FROM ${userInvites} WHERE ${and(eq(userInvites.id, initial.id), eq(userInvites.tenantId, initial.tenantId))} FOR UPDATE`)
    const invite = await tx.query.userInvites.findFirst({ where: and(eq(userInvites.id, initial.id), eq(userInvites.tenantId, initial.tenantId), eq(userInvites.tokenHash, tokenHash)) })
    if (!invite || invite.id !== initial.id || invite.tenantId !== initial.tenantId || invite.tokenHash !== tokenHash
      || invite.invitedBy !== initial.invitedBy || invite.status !== "pending" || invite.expiresAt.getTime() <= Date.now()) {
      throw new Error("Invitation expired, revoked or already used. Ask the owner for a replacement.")
    }
    if (!hasVerifiedInvitedEmail(provider, clerkId, invite.email)) throw new Error("Invitation recipient changed. Verify the invited email.")
    assertSupportedInvitationScope(invite.role, invite.teamId)
    const membership = await tx.query.userTenantRoles.findFirst({ where: and(eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, invite.tenantId)) })
    if (membership && (membership.userId !== actor.id || membership.tenantId !== invite.tenantId || !membershipGrantsAccess(membership))) {
      throw new Error("Your membership is suspended, expired or unavailable. Contact the league owner.")
    }
    // Invitation redemption is not a rank-based role promotion or demotion.
    if (membership && membership.role !== invite.role) throw new Error("Existing league role differs. Ask the owner to update Members & access.")
    if (invite.teamId) {
      await tx.execute(sql`SELECT ${teams.id} FROM ${teams} WHERE ${and(eq(teams.id, invite.teamId), eq(teams.tenantId, invite.tenantId))} FOR UPDATE`)
      const team = await tx.query.teams.findFirst({ where: and(eq(teams.id, invite.teamId), eq(teams.tenantId, invite.tenantId)) })
      if (!team || team.id !== invite.teamId || team.tenantId !== invite.tenantId || team.isActive !== true) throw new Error("Invited team is unavailable or has a different manager")
      if (invite.role === "team_manager") {
        if (team.managerId !== null && team.managerId !== actor.id) throw new Error("Invited team is unavailable or has a different manager")
        const otherTeam = await tx.query.teams.findFirst({ where: and(eq(teams.tenantId, invite.tenantId), eq(teams.managerId, actor.id), ne(teams.id, invite.teamId)) })
        if (otherTeam) throw new Error("You already manage another team in this league. Ask the owner to review the assignment.")
      } else if (invite.role === "captain" && team.captainId !== null && team.captainId !== actor.id) {
        // A captain is assigned to exactly one team via the invitation; the
        // pointer is currently held by someone else.
        throw new Error("Invited team already has a different captain")
      }
    }
    const [claimed] = await tx.update(userInvites).set({ status: "accepted", acceptedAt: new Date() }).where(and(
      eq(userInvites.id, invite.id), eq(userInvites.tenantId, invite.tenantId), eq(userInvites.tokenHash, tokenHash),
      eq(userInvites.status, "pending"), sql`${userInvites.expiresAt} > clock_timestamp()`,
    )).returning({ id: userInvites.id })
    if (!claimed) throw new Error("Invitation expired, revoked or already used")
    // Apply the invited membership bound (SCORE-09): new memberships carry it
    // with the issuing owner as provenance; an existing active membership of
    // the same role has its bound replaced (issuer is a verified active owner,
    // and this write is audited below). No proposed bound leaves membership
    // rows untouched - redemption is never an unbound-ing.
    const proposedBound = invite.membershipExpiresAt ?? null
    if (!membership) {
      const membershipValues: typeof userTenantRoles.$inferInsert = { userId: actor.id, tenantId: invite.tenantId, role: invite.role, isPrimary: false }
      if (proposedBound) {
        membershipValues.expiresAt = proposedBound
        membershipValues.delegatedByUserId = invite.invitedBy
      }
      await tx.insert(userTenantRoles).values(membershipValues)
    } else if (proposedBound) {
      await tx.update(userTenantRoles).set({ expiresAt: proposedBound, delegatedByUserId: invite.invitedBy })
        .where(and(eq(userTenantRoles.id, membership.id), eq(userTenantRoles.tenantId, invite.tenantId)))
    }
    if (invite.teamId && invite.role === "team_manager") {
      const [assigned] = await tx.update(teams).set({ managerId: actor.id, updatedAt: new Date() }).where(and(
        eq(teams.id, invite.teamId), eq(teams.tenantId, invite.tenantId), eq(teams.isActive, true), or(isNull(teams.managerId), eq(teams.managerId, actor.id)),
      )).returning({ id: teams.id })
      if (!assigned) throw new Error("Team assignment changed")
    }
    // REG-05 (Batch 134): a redeemed captain invitation assigns the team's
    // captain pointer with the same null-or-self guarantee the manager path
    // carries - optimistic predicate, verified through returning().
    if (invite.teamId && invite.role === "captain") {
      const [assigned] = await tx.update(teams).set({ captainId: actor.id, updatedAt: new Date() }).where(and(
        eq(teams.id, invite.teamId), eq(teams.tenantId, invite.tenantId), eq(teams.isActive, true), or(isNull(teams.captainId), eq(teams.captainId, actor.id)),
      )).returning({ id: teams.id })
      if (!assigned) throw new Error("Team assignment changed")
    }
    await auditInvite(tx, invite.tenantId, actor.id, "INVITE_ACCEPT", { inviteId: invite.id, issuerId: invite.invitedBy,
      role: invite.role, teamId: invite.teamId, membershipCreated: !membership,
      membershipExpiresAt: proposedBound ? proposedBound.toISOString() : null, membershipBoundApplied: proposedBound !== null })
    await tx.insert(notifications).values({ tenantId: invite.tenantId, userId: actor.id, type: "invite_accepted", channel: "in_app",
      title: "Invitation accepted", body: proposedBound
        ? `You joined as ${invite.role.replaceAll("_", " ")}. Your access is bounded until ${proposedBound.toISOString().slice(0, 10)}.`
        : `You joined as ${invite.role.replaceAll("_", " ")}.`, status: "delivered", deliveredAt: new Date() })
    return { role: invite.role, tenantId: invite.tenantId }
  })
}
