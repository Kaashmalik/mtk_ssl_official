"use server"

import { createHash, randomBytes } from "crypto"
import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db, userInvites, userTenantRoles, users, teams, tenants, notifications, withTenantContext } from "@mtk/database"
import { and, desc, eq, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"
import { ROLE_HIERARCHY } from "@/lib/rbac"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const INVITABLE_ROLES = ["team_manager", "coach", "scorer"] as const

const createInviteSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  role: z.enum(INVITABLE_ROLES),
  teamId: z.string().uuid().optional().nullable(),
}).superRefine((input, ctx) => {
  if (input.role === "team_manager" && !input.teamId) {
    ctx.addIssue({ code: "custom", path: ["teamId"], message: "A team manager invitation must be assigned to a team" })
  }
})

export type CreateInviteInput = z.infer<typeof createInviteSchema>

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function appBaseUrl(): string {
  return (process.env.WEB_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001").replace(/\/$/, "")
}

async function requireTenant() {
  const tenant = await getMyTenant()
  if (!tenant) throw new Error("Tenant not found")
  return tenant
}

/** Fire-and-forget invite email. Falls back to a server log when unconfigured. */
async function sendInviteEmail(to: string, inviterName: string, tenantName: string, role: string, link: string) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(`[invite][mock] to=${to} role=${role} link=${link}`)
    return
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || "SSL <onboarding@ssl.mtkcodex.site>",
      to,
      subject: `You have been invited to join ${tenantName} on SSL`,
      text: [
        `${inviterName} invited you to join "${tenantName}" as ${role.replace("_", " ")}.`,
        ``,
        `Accept the invitation: ${link}`,
        ``,
        `This link expires in 7 days and can only be used once.`,
      ].join("\n"),
    }),
  })
  if (!res.ok) throw new Error(`Invite email failed (${res.status})`)
}

export const createInvite = withAuth("user:invite", async (input: CreateInviteInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const [actor] = await db.select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users).where(eq(users.clerkId, userId)).limit(1)
  if (!actor) throw new Error("Your account is still provisioning. Please try again.")
  const validated = createInviteSchema.parse(input)
  const tenantId = tenant.id

  return withTenantContext({ userId, tenantId }, async () => {
    // Team-scoped roles must target a team in this tenant.
    if (validated.teamId) {
      const [team] = await db.select({ id: teams.id }).from(teams)
        .where(and(eq(teams.id, validated.teamId), eq(teams.tenantId, tenantId)))
        .limit(1)
      if (!team) throw new Error("Team not found")
    }

    const email = validated.email.trim().toLowerCase()

    // Don't stack duplicate pending invites for the same email + role.
    const existing = await db.select().from(userInvites)
      .where(and(
        eq(userInvites.tenantId, tenantId),
        eq(userInvites.email, email),
        eq(userInvites.role, validated.role),
        eq(userInvites.status, "pending"),
      ))
      .limit(1)
    if (existing.length > 0) {
      throw new Error("A pending invite already exists for this email and role")
    }

    const token = randomBytes(32).toString("base64url")
    const [invite] = await db.insert(userInvites).values({
      tenantId,
      email,
      role: validated.role,
      teamId: validated.teamId ?? null,
      tokenHash: hashToken(token),
      status: "pending",
      invitedBy: actor.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    }).returning()

    const link = `${appBaseUrl()}/accept-invite?token=${encodeURIComponent(token)}`

    // Delivery is best-effort. The invite row already exists and is valid, and
    // the plaintext token is returned below specifically for deployments where
    // email is unconfigured. Throwing here would report the whole action as
    // failed while the invite remains — the owner retries, hits the duplicate
    // guard, and is told a pending invite already exists with no way to get the
    // link. So: log the failure, still return the link.
    let emailDelivered = false
    try {
      await sendInviteEmail(
        email,
        actor.displayName || actor.email || "A league owner",
        tenant.name,
        validated.role,
        link,
      )
      emailDelivered = true
    } catch (err) {
      console.error("[invite] email delivery failed; invite row created without it", err)
    }

    revalidatePath("/dashboard/users")
    // The plaintext token is returned once so the owner can copy the link
    // (emails are frequently unconfigured in self-hosted deployments).
    return {
      success: true,
      invite: { id: invite.id, email, role: validated.role },
      link,
      emailDelivered,
    }
  })
})

export const getInvites = withAuth("user:read", async () => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  return db.select({
    id: userInvites.id,
    email: userInvites.email,
    role: userInvites.role,
    status: userInvites.status,
    teamId: userInvites.teamId,
    expiresAt: userInvites.expiresAt,
    acceptedAt: userInvites.acceptedAt,
    createdAt: userInvites.createdAt,
  })
    .from(userInvites)
    .where(eq(userInvites.tenantId, tenant.id))
    .orderBy(desc(userInvites.createdAt))
    .limit(100)
})

export const revokeInvite = withAuth("user:invite", async (inviteId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [updated] = await db.update(userInvites)
      .set({ status: "revoked" })
      .where(and(eq(userInvites.id, inviteId), eq(userInvites.tenantId, tenant.id), eq(userInvites.status, "pending")))
      .returning()
    if (!updated) throw new Error("Invite not found or already resolved")
    revalidatePath("/dashboard/users")
    return { success: true }
  })
})

/**
 * Public redemption endpoint (no session required — the token is the secret).
 * Provisions the tenant role for an existing user, or returns the info the
 * sign-up screen needs so the account can be created first.
 */
export async function getInvitePreview(token: string) {
  if (!token) return null
  const [invite] = await db.select().from(userInvites)
    .where(eq(userInvites.tokenHash, hashToken(token)))
    .limit(1)
  if (!invite) return null

  const [tenant] = await db.select({ id: tenants.id, name: tenants.name })
    .from(tenants).where(eq(tenants.id, invite.tenantId)).limit(1)

  let teamName: string | null = null
  if (invite.teamId) {
    const [team] = await db.select({ name: teams.name }).from(teams)
      .where(eq(teams.id, invite.teamId)).limit(1)
    teamName = team?.name ?? null
  }

  return {
    email: invite.email,
    role: invite.role,
    status: invite.status,
    tenantName: tenant?.name ?? "your league",
    teamName,
    expiresAt: invite.expiresAt,
    expired: invite.expiresAt.getTime() < Date.now(),
  }
}

/**
 * Accept an invite as the signed-in Clerk user. Idempotent for the same role.
 */
export const acceptInvite = withAuth("invite:accept", async (token: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Sign in to accept this invitation")

  const [invite] = await db.select().from(userInvites)
    .where(eq(userInvites.tokenHash, hashToken(token)))
    .limit(1)
  if (!invite) throw new Error("This invitation is invalid")
  if (invite.status === "revoked") throw new Error("This invitation was revoked")
  if (invite.status === "accepted") throw new Error("This invitation was already accepted")
  if (invite.expiresAt.getTime() < Date.now()) {
    await db.update(userInvites).set({ status: "expired" }).where(eq(userInvites.id, invite.id))
    throw new Error("This invitation has expired")
  }

  return withTenantContext({ userId, tenantId: invite.tenantId }, async () => {
    // The Clerk webhook may not have created the row yet.
    const [user] = await db.select().from(users).where(eq(users.clerkId, userId)).limit(1)
    if (!user) throw new Error("Your account is still provisioning. Try again in a moment.")

    // Email match is enforced so an invite can't be redeemed by another account.
    if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      throw new Error(`This invitation was sent to ${invite.email}. Sign in with that email to accept it.`)
    }

    // Everything below runs in one transaction, and the redemption is *claimed*
    // with a conditional UPDATE before any side effect.
    //
    // Previously the status was only read at the top and set at the end, so two
    // concurrent redemptions of the same token both passed the
    // `status === "accepted"` guard and both ran — producing a duplicate
    // "invite_accepted" notification and a duplicate role write. The conditional
    // update makes the claim atomic: exactly one caller updates a row, and the
    // loser is told the invitation is already used.
    await db.transaction(async (tx) => {
      const claimed = await tx.update(userInvites)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(and(eq(userInvites.id, invite.id), eq(userInvites.status, "pending")))
        .returning({ id: userInvites.id })

      if (claimed.length === 0) {
        throw new Error("This invitation was already accepted")
      }

      const [roleRow] = await tx.select().from(userTenantRoles)
        .where(and(
          eq(userTenantRoles.userId, user.id),
          eq(userTenantRoles.tenantId, invite.tenantId),
        )).limit(1)

      if (roleRow) {
        // Redeeming a lesser-scoped invitation must not demote an owner or
        // another existing tenant role.
        if (ROLE_HIERARCHY[invite.role] > ROLE_HIERARCHY[roleRow.role]) {
          await tx.update(userTenantRoles)
            .set({ role: invite.role, updatedAt: new Date() })
            .where(eq(userTenantRoles.id, roleRow.id))
        }
      } else {
        await tx.insert(userTenantRoles).values({
          userId: user.id,
          tenantId: invite.tenantId,
          role: invite.role,
          isPrimary: false,
        })
      }

      if (invite.role === "team_manager" && invite.teamId) {
        const [assignedTeam] = await tx.update(teams)
          .set({ managerId: user.id, updatedAt: new Date() })
          .where(and(
            eq(teams.id, invite.teamId),
            eq(teams.tenantId, invite.tenantId),
            or(isNull(teams.managerId), eq(teams.managerId, user.id)),
          ))
          .returning({ id: teams.id })
        if (!assignedTeam) throw new Error("This team already has a different manager or the team no longer exists")
      }

      // Keep the legacy array in sync for the tenant-wide notification filter.
      await tx.update(users)
        .set({
          tenantIds: sql`array_append(${users.tenantIds}, ${invite.tenantId})`,
          updatedAt: new Date()
        })
        .where(and(
          eq(users.id, user.id),
          sql`NOT (${invite.tenantId} = ANY(${users.tenantIds}))`
        ))

      await tx.insert(notifications).values({
        tenantId: invite.tenantId,
        userId: user.id,
        type: "invite_accepted",
        channel: "in_app",
        title: "Invitation accepted",
        body: `You joined as ${invite.role.replace("_", " ")}.`,
        status: "delivered",
        deliveredAt: new Date(),
      })
    })

    revalidatePath("/dashboard")
    return { success: true, role: invite.role, tenantId: invite.tenantId }
  })
})
