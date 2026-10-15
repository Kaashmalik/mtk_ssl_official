"use server"

import { createHash, randomBytes } from "crypto"
import { auth, currentUser } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import type { InvitationEmailState } from "@mtk/database"
import { getDashboardContext } from "@/lib/dashboard-context"
import { assertSupportedInvitationScope, hasVerifiedInvitedEmail, invitationBaseUrl,
  invitationRecipientHint, invitationRole, invitationToken, normalizeInvitationEmail } from "@/lib/invitation-policy"
import { claimInvite, findInviteByTokenHash, findPendingInvitePreview, findUserByClerkId,
  issueInviteInLeague, readLeagueInvites, recordEmailAttempt,
  revokePendingInvite, rotateInviteToken } from "@/lib/invite-records"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const createInviteSchema = z.object({
  tenantId: z.string().uuid(), email: z.string().trim().email("Enter a valid email address"),
  role: invitationRole, teamId: z.string().uuid().optional().nullable(),
}).strict()
export type CreateInviteInput = z.infer<typeof createInviteSchema>
export type { InvitationEmailState }
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

/** Synchronous attempt, not a durable queue or delivery confirmation. No secret logs. */
async function sendInviteEmail(inviteId: string, idempotencyKey: string, to: string, inviterName: string, leagueName: string, role: string, link: string): Promise<InvitationEmailState> {
  if (!process.env.RESEND_API_KEY) return "unconfigured"
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || "SSL <onboarding@ssl.mtkcodex.site>", to,
        subject: `You have been invited to join ${leagueName} on SSL`,
        text: `${inviterName} invited you to join "${leagueName}" as ${role.replaceAll("_", " ")}.\n\nAccept: ${link}\n\nExpires in 7 days. Verify the invited email through your sign-in provider before accepting.`,
        // Lets the delivery webhook correlate an event back to the invitation.
        tags: [{ name: "invite_id", value: inviteId }],
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

export async function createInvite(input: CreateInviteInput) {
  const validated = createInviteSchema.parse(input)
  const context = await requireManager(validated.tenantId)
  const teamId = validated.teamId ?? null
  assertSupportedInvitationScope(validated.role, teamId)
  const baseUrl = invitationBaseUrl() // Reject bad configuration before saving.
  const email = normalizeInvitationEmail(validated.email)
  const token = randomBytes(32).toString("base64url")
  const result = await issueInviteInLeague({
    tenantId: context.tenantId, actorId: context.actorId, clerkId: context.clerkId,
    email, role: validated.role, teamId, tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  })
  const link = `${baseUrl}/accept-invite?token=${encodeURIComponent(token)}`
  const emailState = await sendInviteEmail(result.invite.id, `league-invite/${result.invite.id}`, email, result.issuer.displayName || "A league owner", result.league.name, validated.role, link)
  await recordEmailAttempt(result.invite.id, context.tenantId, emailState)
  revalidatePath("/dashboard", "layout")
  return { success: true as const, invite: { id: result.invite.id, email, role: validated.role }, link, emailState }
}

export async function getInvites(expectedTenantId: string) {
  const context = await requireManager(expectedTenantId)
  return readLeagueInvites(context.tenantId)
}

export async function revokeInvite(input: { tenantId: string; inviteId: string }) {
  const validated = z.object({ tenantId: z.string().uuid(), inviteId: z.string().uuid() }).strict().parse(input)
  const context = await requireManager(validated.tenantId)
  await revokePendingInvite({
    tenantId: context.tenantId, actorId: context.actorId, clerkId: context.clerkId, inviteId: validated.inviteId,
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
  const prepared = await rotateInviteToken({
    tenantId: context.tenantId, actorId: context.actorId, clerkId: context.clerkId,
    inviteId: validated.inviteId, tokenHash: hashToken(token),
  })
  const link = `${baseUrl}/accept-invite?token=${encodeURIComponent(token)}`
  // Distinct idempotency key per attempt so the provider does not dedupe a resend.
  const attempt = (prepared.invite.emailAttemptCount ?? 0) + 1
  const emailState = await sendInviteEmail(prepared.invite.id, `league-invite/${prepared.invite.id}/r${attempt}`,
    prepared.invite.email, prepared.issuer.displayName || "A league owner", prepared.league.name, prepared.invite.role, link)
  await recordEmailAttempt(prepared.invite.id, context.tenantId, emailState)
  revalidatePath("/dashboard", "layout")
  return { success: true as const, invite: { id: prepared.invite.id, email: prepared.invite.email, role: prepared.invite.role }, link, emailState }
}

/** Bearer-link preview, never a grant; full email is shown only on its provider account. */
export async function getInvitePreview(token: string) {
  if (!invitationToken.safeParse(token).success) return null
  const preview = await findPendingInvitePreview(hashToken(token))
  if (!preview) return null
  const { userId } = await auth()
  const provider = userId ? await currentUser() : null
  const matches = provider?.id === userId && provider.emailAddresses.some(address => normalizeInvitationEmail(address.emailAddress) === normalizeInvitationEmail(preview.recipientEmail))
  return { recipientHint: invitationRecipientHint(preview.recipientEmail), recipientEmail: matches ? preview.recipientEmail : null,
    role: preview.role, tenantName: preview.leagueName, teamName: preview.teamName, status: "pending" as const, expiresAt: preview.expiresAt }
}

export async function acceptInvite(token: string) {
  invitationToken.parse(token)
  const { userId } = await auth()
  if (!userId) throw new Error("Sign in to accept this invitation")
  const actor = await findUserByClerkId(userId)
  if (!actor || actor.isActive !== true) throw new Error("Your account is unavailable or still provisioning")
  const tokenHash = hashToken(token)
  const initial = await findInviteByTokenHash(tokenHash)
  if (!initial || !initial.invitedBy) throw new Error("Invitation is unavailable. Ask an active owner for a replacement.")
  const provider = await currentUser()
  if (!hasVerifiedInvitedEmail(provider, userId, initial.email)) throw new Error("Verify the invited email on your signed-in account before accepting.")

  const accepted = await claimInvite({ clerkId: userId, provider, actor, initial, tokenHash })
  revalidatePath("/dashboard", "layout")
  return { success: true as const, ...accepted }
}
