"use server"

import { createHash, randomBytes, randomUUID } from "crypto"
import { auth, currentUser } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db, userInvites, userTenantRoles, users, teams, tenants, notifications, auditLogs } from "@mtk/database"
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm"
import { z } from "zod"
import { getDashboardContext } from "@/lib/dashboard-context"
import { assertSupportedInvitationScope, hasVerifiedInvitedEmail, invitationBaseUrl,
  invitationRecipientHint, invitationRole, invitationToken, normalizeInvitationEmail } from "@/lib/invitation-policy"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Minimum delay between dispatch attempts for one invitation. */
const RESEND_COOLDOWN_MS = 60 * 1000
const createInviteSchema = z.object({
  tenantId: z.string().uuid(), email: z.string().trim().email("Enter a valid email address"),
  role: invitationRole, teamId: z.string().uuid().optional().nullable(),
}).strict()
export type CreateInviteInput = z.infer<typeof createInviteSchema>
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

async function requireManager(expectedTenantId: string) {
  z.string().uuid().parse(expectedTenantId)
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const access = await getDashboardContext(userId)
  if (access.status !== "ready" || access.context.role !== "league_owner") throw new Error("Forbidden: active league owner required")
  if (access.context.tenantId !== expectedTenantId) throw new Error("Workspace changed. Reload invitations.")
  return { ...access.context, clerkId: userId }
}

/** Shared user -> league -> memberships order; no provider/network calls under locks. */
async function lockInvitationAuthority(tx: Transaction, tenantId: string, issuerId: string, recipientId?: string, issuing = false, issuerClerkId?: string) {
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
    || membership.status !== "active" || membership.role !== "league_owner") {
    throw new Error("Invitation authority changed. Contact an active league owner.")
  }
  return { issuer, league }
}

async function auditInvite(tx: Transaction, tenantId: string, actorId: string, action: string, payload: object) {
  await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId,
    method: action, path: "/dashboard/settings/members", statusCode: "200", payload })
}

export type InvitationEmailState = "unconfigured" | "provider_accepted" | "failed" | "unknown"
/** Synchronous attempt, not a durable queue or delivery confirmation. No secret logs. */
async function sendInviteEmail(idempotencyKey: string, to: string, inviterName: string, leagueName: string, role: string, link: string): Promise<InvitationEmailState> {
  if (!process.env.RESEND_API_KEY) return "unconfigured"
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || "SSL <onboarding@ssl.mtkcodex.site>", to,
        subject: `You have been invited to join ${leagueName} on SSL`,
        text: `${inviterName} invited you to join "${leagueName}" as ${role.replaceAll("_", " ")}.\n\nAccept: ${link}\n\nExpires in 7 days. Verify the invited email through your sign-in provider before accepting.`,
      }),
    })
    if (response.ok) return "provider_accepted"
    // Server errors/timeouts/idempotency conflicts are not proof of non-delivery.
    return response.status >= 500 || response.status === 408 || response.status === 409 ? "unknown" : "failed"
  } catch {
    // An interrupted response is ambiguous: the provider may have accepted it.
    return "unknown"
  }
}

/**
 * Best-effort persistence of the last dispatch outcome (IAM-04). This runs after
 * the invitation is committed, so a bookkeeping failure must not roll the invite
 * back or report a false send failure. It never stores the token or link.
 */
async function recordEmailAttempt(inviteId: string, tenantId: string, state: InvitationEmailState) {
  try {
    await db.update(userInvites).set({
      emailState: state, emailAttemptedAt: new Date(),
      emailAttemptCount: sql`${userInvites.emailAttemptCount} + 1`,
    }).where(and(eq(userInvites.id, inviteId), eq(userInvites.tenantId, tenantId)))
  } catch { /* invitation is already saved; the outcome stays unknown until the next attempt */ }
}

export async function createInvite(input: CreateInviteInput) {
  const validated = createInviteSchema.parse(input)
  const context = await requireManager(validated.tenantId)
  const teamId = validated.teamId ?? null
  assertSupportedInvitationScope(validated.role, teamId)
  const baseUrl = invitationBaseUrl() // Reject bad configuration before saving.
  const email = normalizeInvitationEmail(validated.email)
  const token = randomBytes(32).toString("base64url")
  const result = await db.transaction(async tx => {
    const authority = await lockInvitationAuthority(tx, context.tenantId, context.actorId, undefined, true, context.clerkId)
    if (teamId) {
      await tx.execute(sql`SELECT ${teams.id} FROM ${teams} WHERE ${and(eq(teams.id, teamId), eq(teams.tenantId, context.tenantId))} FOR SHARE`)
      const team = await tx.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.tenantId, context.tenantId)) })
      if (!team || team.id !== teamId || team.tenantId !== context.tenantId || team.isActive !== true || team.managerId !== null) {
        throw new Error("Team is unavailable or already has a manager")
      }
    }
    const duplicate = await tx.query.userInvites.findFirst({ where: and(
      eq(userInvites.tenantId, context.tenantId), eq(userInvites.email, email), eq(userInvites.role, validated.role),
      eq(userInvites.status, "pending"), sql`${userInvites.expiresAt} > clock_timestamp()`,
    ) })
    if (duplicate) throw new Error("A live pending invite already exists. Revoke it before creating a replacement.")
    const [invite] = await tx.insert(userInvites).values({ tenantId: context.tenantId, email, role: validated.role,
      teamId, tokenHash: hashToken(token), status: "pending", invitedBy: context.actorId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    }).returning({ id: userInvites.id })
    if (!invite) throw new Error("Could not save invitation")
    await auditInvite(tx, context.tenantId, context.actorId, "INVITE_CREATE", { inviteId: invite.id, role: validated.role, teamId })
    return { invite, ...authority }
  })
  const link = `${baseUrl}/accept-invite?token=${encodeURIComponent(token)}`
  const emailState = await sendInviteEmail(`league-invite/${result.invite.id}`, email, result.issuer.displayName || "A league owner", result.league.name, validated.role, link)
  await recordEmailAttempt(result.invite.id, context.tenantId, emailState)
  revalidatePath("/dashboard", "layout")
  return { success: true as const, invite: { id: result.invite.id, email, role: validated.role }, link, emailState }
}

export async function getInvites(expectedTenantId: string) {
  const context = await requireManager(expectedTenantId)
  return db.select({ id: userInvites.id, email: userInvites.email, role: userInvites.role,
    status: sql<string>`CASE WHEN ${userInvites.status} = 'pending' AND ${userInvites.expiresAt} <= clock_timestamp() THEN 'expired' ELSE ${userInvites.status} END`,
    teamId: userInvites.teamId, expiresAt: userInvites.expiresAt, acceptedAt: userInvites.acceptedAt, createdAt: userInvites.createdAt,
    emailState: userInvites.emailState, emailAttemptedAt: userInvites.emailAttemptedAt,
  }).from(userInvites).where(eq(userInvites.tenantId, context.tenantId)).orderBy(desc(userInvites.createdAt)).limit(100)
}

export async function revokeInvite(input: { tenantId: string; inviteId: string }) {
  const validated = z.object({ tenantId: z.string().uuid(), inviteId: z.string().uuid() }).strict().parse(input)
  const context = await requireManager(validated.tenantId)
  await db.transaction(async tx => {
    await lockInvitationAuthority(tx, context.tenantId, context.actorId, undefined, false, context.clerkId)
    const [updated] = await tx.update(userInvites).set({ status: "revoked" }).where(and(
      eq(userInvites.id, validated.inviteId), eq(userInvites.tenantId, context.tenantId), eq(userInvites.status, "pending"),
    )).returning({ id: userInvites.id })
    if (!updated) throw new Error("Invitation not found or already resolved")
    await auditInvite(tx, context.tenantId, context.actorId, "INVITE_REVOKE", { inviteId: updated.id })
  })
  revalidatePath("/dashboard", "layout")
  return { success: true as const }
}

/**
 * Re-dispatch a pending invitation with a freshly rotated token. Rotating the
 * hash invalidates the previous link (the plaintext was never stored), so a
 * resend is effectively a safe replacement rather than a duplicate. The
 * cooldown and expiry are rechecked under lock; the original expiry is kept so
 * a resend cannot extend an invitation indefinitely.
 */
export async function resendInvite(input: { tenantId: string; inviteId: string }) {
  const validated = z.object({ tenantId: z.string().uuid(), inviteId: z.string().uuid() }).strict().parse(input)
  const context = await requireManager(validated.tenantId)
  const baseUrl = invitationBaseUrl() // Reject bad configuration before rotating the token.
  const token = randomBytes(32).toString("base64url")
  const prepared = await db.transaction(async tx => {
    const authority = await lockInvitationAuthority(tx, context.tenantId, context.actorId, undefined, false, context.clerkId)
    await tx.execute(sql`SELECT ${userInvites.id} FROM ${userInvites}
      WHERE ${and(eq(userInvites.id, validated.inviteId), eq(userInvites.tenantId, context.tenantId))} FOR UPDATE`)
    const invite = await tx.query.userInvites.findFirst({ where: and(
      eq(userInvites.id, validated.inviteId), eq(userInvites.tenantId, context.tenantId),
    ) })
    if (!invite || invite.id !== validated.inviteId || invite.tenantId !== context.tenantId) {
      throw new Error("Invitation not found in this league")
    }
    if (invite.status !== "pending") throw new Error("Only pending invitations can be resent")
    if (invite.expiresAt.getTime() <= Date.now()) throw new Error("Invitation expired. Revoke it and create a replacement.")
    if (invite.emailAttemptedAt && Date.now() - invite.emailAttemptedAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new Error("Please wait a moment before resending this invitation.")
    }
    assertSupportedInvitationScope(invite.role, invite.teamId)
    const [updated] = await tx.update(userInvites).set({ tokenHash: hashToken(token) }).where(and(
      eq(userInvites.id, invite.id), eq(userInvites.tenantId, context.tenantId), eq(userInvites.status, "pending"),
    )).returning({ id: userInvites.id })
    if (!updated) throw new Error("Invitation changed. Reload before resending.")
    await auditInvite(tx, context.tenantId, context.actorId, "INVITE_RESEND", { inviteId: invite.id, role: invite.role, teamId: invite.teamId })
    return { invite, ...authority }
  })
  const link = `${baseUrl}/accept-invite?token=${encodeURIComponent(token)}`
  // Distinct idempotency key per attempt so the provider does not dedupe a resend.
  const attempt = (prepared.invite.emailAttemptCount ?? 0) + 1
  const emailState = await sendInviteEmail(`league-invite/${prepared.invite.id}/r${attempt}`,
    prepared.invite.email, prepared.issuer.displayName || "A league owner", prepared.league.name, prepared.invite.role, link)
  await recordEmailAttempt(prepared.invite.id, context.tenantId, emailState)
  revalidatePath("/dashboard", "layout")
  return { success: true as const, invite: { id: prepared.invite.id, email: prepared.invite.email, role: prepared.invite.role }, link, emailState }
}

/** Bearer-link preview, never a grant; full email is shown only on its provider account. */
export async function getInvitePreview(token: string) {
  if (!invitationToken.safeParse(token).success) return null
  const invite = await db.query.userInvites.findFirst({ where: and(eq(userInvites.tokenHash, hashToken(token)),
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
  const { userId } = await auth()
  const provider = userId ? await currentUser() : null
  const matches = provider?.id === userId && provider.emailAddresses.some(address => normalizeInvitationEmail(address.emailAddress) === normalizeInvitationEmail(invite.email))
  return { recipientHint: invitationRecipientHint(invite.email), recipientEmail: matches ? invite.email : null,
    role: invite.role, tenantName: league.name, teamName, status: "pending" as const, expiresAt: invite.expiresAt }
}

export async function acceptInvite(token: string) {
  invitationToken.parse(token)
  const { userId } = await auth()
  if (!userId) throw new Error("Sign in to accept this invitation")
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, userId) })
  if (!actor || actor.isActive !== true) throw new Error("Your account is unavailable or still provisioning")
  const tokenHash = hashToken(token)
  const initial = await db.query.userInvites.findFirst({ where: eq(userInvites.tokenHash, tokenHash) })
  if (!initial || !initial.invitedBy) throw new Error("Invitation is unavailable. Ask an active owner for a replacement.")
  const provider = await currentUser()
  if (!hasVerifiedInvitedEmail(provider, userId, initial.email)) throw new Error("Verify the invited email on your signed-in account before accepting.")

  const accepted = await db.transaction(async tx => {
    await lockInvitationAuthority(tx, initial.tenantId, initial.invitedBy!, actor.id)
    const recipient = await tx.query.users.findFirst({ where: eq(users.id, actor.id) })
    if (!recipient || recipient.id !== actor.id || recipient.clerkId !== userId || recipient.isActive !== true) throw new Error("Your account access changed")
    await tx.execute(sql`SELECT ${userInvites.id} FROM ${userInvites} WHERE ${and(eq(userInvites.id, initial.id), eq(userInvites.tenantId, initial.tenantId))} FOR UPDATE`)
    const invite = await tx.query.userInvites.findFirst({ where: and(eq(userInvites.id, initial.id), eq(userInvites.tenantId, initial.tenantId), eq(userInvites.tokenHash, tokenHash)) })
    if (!invite || invite.id !== initial.id || invite.tenantId !== initial.tenantId || invite.tokenHash !== tokenHash
      || invite.invitedBy !== initial.invitedBy || invite.status !== "pending" || invite.expiresAt.getTime() <= Date.now()) {
      throw new Error("Invitation expired, revoked or already used. Ask the owner for a replacement.")
    }
    if (!hasVerifiedInvitedEmail(provider, userId, invite.email)) throw new Error("Invitation recipient changed. Verify the invited email.")
    assertSupportedInvitationScope(invite.role, invite.teamId)
    const membership = await tx.query.userTenantRoles.findFirst({ where: and(eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, invite.tenantId)) })
    if (membership && (membership.userId !== actor.id || membership.tenantId !== invite.tenantId || membership.status !== "active")) {
      throw new Error("Your membership is suspended or unavailable. Contact the league owner.")
    }
    // Invitation redemption is not a rank-based role promotion or demotion.
    if (membership && membership.role !== invite.role) throw new Error("Existing league role differs. Ask the owner to update Members & access.")
    if (invite.teamId) {
      await tx.execute(sql`SELECT ${teams.id} FROM ${teams} WHERE ${and(eq(teams.id, invite.teamId), eq(teams.tenantId, invite.tenantId))} FOR UPDATE`)
      const team = await tx.query.teams.findFirst({ where: and(eq(teams.id, invite.teamId), eq(teams.tenantId, invite.tenantId)) })
      if (!team || team.id !== invite.teamId || team.tenantId !== invite.tenantId || team.isActive !== true
        || (team.managerId !== null && team.managerId !== actor.id)) throw new Error("Invited team is unavailable or has a different manager")
      const otherTeam = await tx.query.teams.findFirst({ where: and(eq(teams.tenantId, invite.tenantId), eq(teams.managerId, actor.id), ne(teams.id, invite.teamId)) })
      if (otherTeam) throw new Error("You already manage another team in this league. Ask the owner to review the assignment.")
    }
    const [claimed] = await tx.update(userInvites).set({ status: "accepted", acceptedAt: new Date() }).where(and(
      eq(userInvites.id, invite.id), eq(userInvites.tenantId, invite.tenantId), eq(userInvites.tokenHash, tokenHash),
      eq(userInvites.status, "pending"), sql`${userInvites.expiresAt} > clock_timestamp()`,
    )).returning({ id: userInvites.id })
    if (!claimed) throw new Error("Invitation expired, revoked or already used")
    if (!membership) await tx.insert(userTenantRoles).values({ userId: actor.id, tenantId: invite.tenantId, role: invite.role, isPrimary: false })
    if (invite.teamId) {
      const [assigned] = await tx.update(teams).set({ managerId: actor.id, updatedAt: new Date() }).where(and(
        eq(teams.id, invite.teamId), eq(teams.tenantId, invite.tenantId), eq(teams.isActive, true), or(isNull(teams.managerId), eq(teams.managerId, actor.id)),
      )).returning({ id: teams.id })
      if (!assigned) throw new Error("Team assignment changed")
    }
    await auditInvite(tx, invite.tenantId, actor.id, "INVITE_ACCEPT", { inviteId: invite.id, issuerId: invite.invitedBy,
      role: invite.role, teamId: invite.teamId, membershipCreated: !membership })
    await tx.insert(notifications).values({ tenantId: invite.tenantId, userId: actor.id, type: "invite_accepted", channel: "in_app",
      title: "Invitation accepted", body: `You joined as ${invite.role.replaceAll("_", " ")}.`, status: "delivered", deliveredAt: new Date() })
    return { role: invite.role, tenantId: invite.tenantId }
  })
  revalidatePath("/dashboard", "layout")
  return { success: true as const, ...accepted }
}
