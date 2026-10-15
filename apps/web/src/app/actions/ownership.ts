"use server"

import { randomUUID } from "crypto"
import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db, users, tenants, userTenantRoles, ownershipTransfers, auditLogs } from "@mtk/database"
import { and, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { getDashboardContext } from "@/lib/dashboard-context"
import { hasPermission } from "@/lib/rbac"

/** Roles the outgoing owner may keep; ownership and platform authority are excluded. */
const demotableRoles = ["team_manager", "coach", "scorer", "player", "fan"] as const
/** A pending handover lapses after this window and must be re-issued. */
const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000

const initiateInput = z.object({
  tenantId: z.string().uuid(),
  recipientMembershipId: z.string().uuid(),
  demotedRole: z.enum(demotableRoles),
}).strict()
const transferKey = z.object({
  tenantId: z.string().uuid(),
  transferId: z.string().uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
}).strict()

export type OwnershipTransferInitiate = z.infer<typeof initiateInput>
export type OwnershipTransferResolve = z.infer<typeof transferKey>

async function requireActor() {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const access = await getDashboardContext(userId)
  if (access.status !== "ready") throw new Error("Forbidden: an active league membership is required")
  return { ...access.context, clerkId: userId }
}

async function requireOwner() {
  const context = await requireActor()
  if (context.role !== "league_owner" || !hasPermission(context.role, "user:manage")) {
    throw new Error("Forbidden: league ownership transfer requires an active owner membership")
  }
  return context
}

/**
 * The single open handover for the caller's league, visible only to its two
 * parties. Returns `null` for anyone else so unrelated members cannot probe it.
 */
export async function getOwnershipTransfer(expectedTenantId?: string) {
  const context = await requireActor()
  if (expectedTenantId !== undefined && z.string().uuid().parse(expectedTenantId) !== context.tenantId) {
    throw new Error("Workspace changed. Reload before viewing.")
  }
  const [transfer] = await db.select({
    id: ownershipTransfers.id, status: ownershipTransfers.status,
    demotedRole: ownershipTransfers.demotedRole, expiresAt: ownershipTransfers.expiresAt,
    version: ownershipTransfers.version, fromUserId: ownershipTransfers.fromUserId,
    toUserId: ownershipTransfers.toUserId,
    fromDisplayName: users.displayName, fromEmail: users.email,
  }).from(ownershipTransfers)
    .innerJoin(users, eq(users.id, ownershipTransfers.fromUserId))
    .where(and(eq(ownershipTransfers.tenantId, context.tenantId), eq(ownershipTransfers.status, "pending")))
    .limit(1)
  if (!transfer || (transfer.fromUserId !== context.actorId && transfer.toUserId !== context.actorId)) {
    return null
  }
  return {
    ...transfer,
    viewer: transfer.fromUserId === context.actorId ? ("initiator" as const) : ("recipient" as const),
  }
}

/**
 * Offer ownership of this league to an active member. Only the recorded owner
 * (`tenants.owner_id`, not merely an owner-role row) may initiate, and nothing
 * moves until the recipient accepts.
 */
export async function initiateOwnershipTransfer(input: OwnershipTransferInitiate) {
  const parsed = initiateInput.parse(input)
  const context = await requireOwner()
  if (parsed.tenantId !== context.tenantId) throw new Error("Workspace changed. Reload members before saving.")

  const result = await db.transaction(async (tx) => {
    const recipient = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.id, parsed.recipientMembershipId), eq(userTenantRoles.tenantId, context.tenantId),
    ) })
    if (!recipient || recipient.tenantId !== context.tenantId || recipient.id !== parsed.recipientMembershipId) {
      throw new Error("Member not found in this league")
    }
    const recipientUserId = recipient.userId
    // Same lock order as every other membership command: users, league, memberships.
    const ids = [...new Set([context.actorId, recipientUserId])].sort()
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${inArray(users.id, ids)} ORDER BY ${users.id} FOR UPDATE`)
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${context.tenantId} FOR SHARE`)
    await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
      WHERE ${and(eq(userTenantRoles.tenantId, context.tenantId), inArray(userTenantRoles.userId, ids))}
      ORDER BY ${userTenantRoles.id} FOR UPDATE`)

    const actor = await tx.query.users.findFirst({ where: eq(users.id, context.actorId) })
    const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, context.tenantId) })
    const actorMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, context.actorId), eq(userTenantRoles.tenantId, context.tenantId),
    ) })
    if (!actor || actor.id !== context.actorId || actor.isActive !== true || actor.clerkId !== context.clerkId
      || !league || league.id !== context.tenantId || league.isActive !== true
      || !actorMember || actorMember.userId !== context.actorId || actorMember.tenantId !== context.tenantId
      || actorMember.status !== "active" || actorMember.role !== "league_owner"
      // The junction role alone is not enough: only the recorded owner may hand over.
      || league.ownerId !== context.actorId) {
      throw new Error("Forbidden: only the recorded league owner may transfer ownership")
    }
    const targetMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, recipientUserId), eq(userTenantRoles.tenantId, context.tenantId),
    ) })
    const targetAccount = await tx.query.users.findFirst({ where: eq(users.id, recipientUserId) })
    if (!targetMember || targetMember.id !== recipient.id || targetMember.userId !== recipientUserId
      || targetMember.tenantId !== context.tenantId || targetMember.status !== "active"
      || !targetAccount || targetAccount.id !== recipientUserId || targetAccount.isActive !== true) {
      throw new Error("The selected member is not an active member of this league")
    }
    if (recipientUserId === context.actorId) throw new Error("You cannot transfer ownership to yourself")
    if (targetMember.role === "league_owner" || targetMember.role === "super_admin" || targetAccount.role === "super_admin") {
      throw new Error("Ownership cannot be offered to an owner or platform account")
    }

    // Sweep any lapsed request so a fresh offer is not blocked by a dead one.
    const [open] = await tx.select({ id: ownershipTransfers.id, expiresAt: ownershipTransfers.expiresAt,
      version: ownershipTransfers.version }).from(ownershipTransfers)
      .where(and(eq(ownershipTransfers.tenantId, context.tenantId), eq(ownershipTransfers.status, "pending")))
      .limit(1)
    if (open && open.expiresAt.getTime() > Date.now()) {
      throw new Error("A transfer is already pending for this league. Cancel it first.")
    }
    if (open) {
      const [expired] = await tx.update(ownershipTransfers)
        .set({ status: "expired", resolvedAt: new Date(), version: sql`${ownershipTransfers.version} + 1` })
        .where(and(eq(ownershipTransfers.id, open.id), eq(ownershipTransfers.tenantId, context.tenantId),
          eq(ownershipTransfers.status, "pending"), eq(ownershipTransfers.version, open.version),
          sql`${ownershipTransfers.expiresAt} <= clock_timestamp()`))
        .returning({ id: ownershipTransfers.id })
      if (!expired) throw new Error("Transfer changed or has not expired. Reload before sending a new one.")
    }

    const expiresAt = new Date(Date.now() + TRANSFER_TTL_MS)
    const [created] = await tx.insert(ownershipTransfers).values({
      tenantId: context.tenantId, fromUserId: context.actorId, toUserId: recipientUserId,
      demotedRole: parsed.demotedRole, status: "pending", version: 0, expiresAt,
    }).returning({ id: ownershipTransfers.id, expiresAt: ownershipTransfers.expiresAt })
    if (!created) throw new Error("Could not create the transfer request")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId: context.tenantId, actorId: context.actorId,
      actorRole: actorMember.role, method: "OWNERSHIP_TRANSFER_INITIATE", path: "/dashboard/settings/members", statusCode: "200",
      payload: { transferId: created.id, fromUserId: context.actorId, toUserId: recipientUserId,
        demotedRole: parsed.demotedRole, expiresAt: created.expiresAt },
    })
    return created
  })
  revalidatePath("/dashboard", "layout")
  return { success: true as const, transferId: result.id, expiresAt: result.expiresAt }
}

/**
 * Accept a handover addressed to the caller. This is the second party's
 * consent and the only path that moves ownership. The recipient is promoted in
 * the same transaction that rewrites `tenants.owner_id` and demotes the
 * outgoing owner, so the league is never left without an owner.
 */
export async function acceptOwnershipTransfer(input: OwnershipTransferResolve) {
  const parsed = transferKey.parse(input)
  const context = await requireActor()
  if (parsed.tenantId !== context.tenantId) throw new Error("Workspace changed. Reload before accepting.")

  const result = await db.transaction(async (tx) => {
    const initial = await tx.query.ownershipTransfers.findFirst({ where: and(
      eq(ownershipTransfers.id, parsed.transferId), eq(ownershipTransfers.tenantId, context.tenantId),
    ) })
    if (!initial || initial.tenantId !== context.tenantId || initial.id !== parsed.transferId) {
      throw new Error("Transfer not found in this league")
    }
    // Only the named recipient can accept — the initiator cannot self-complete.
    if (initial.toUserId !== context.actorId) {
      throw new Error("Forbidden: only the named recipient can accept this transfer")
    }
    const ids = [...new Set([initial.fromUserId, initial.toUserId])].sort()
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${inArray(users.id, ids)} ORDER BY ${users.id} FOR UPDATE`)
    // FOR UPDATE: this transaction rewrites tenants.owner_id.
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${context.tenantId} FOR UPDATE`)
    await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
      WHERE ${and(eq(userTenantRoles.tenantId, context.tenantId), inArray(userTenantRoles.userId, ids))}
      ORDER BY ${userTenantRoles.id} FOR UPDATE`)
    await tx.execute(sql`SELECT ${ownershipTransfers.id} FROM ${ownershipTransfers}
      WHERE ${and(eq(ownershipTransfers.id, parsed.transferId), eq(ownershipTransfers.tenantId, context.tenantId))} FOR UPDATE`)

    const transfer = await tx.query.ownershipTransfers.findFirst({ where: and(
      eq(ownershipTransfers.id, parsed.transferId), eq(ownershipTransfers.tenantId, context.tenantId),
    ) })
    if (!transfer || transfer.id !== parsed.transferId || transfer.tenantId !== context.tenantId
      || transfer.toUserId !== context.actorId) {
      throw new Error("Transfer not found in this league")
    }
    // Do not authorize a different party whose account/membership was not locked.
    if (transfer.fromUserId !== initial.fromUserId || transfer.toUserId !== initial.toUserId
      || transfer.fromUserId === transfer.toUserId) throw new Error("Transfer parties changed. Reload before accepting.")
    const demotedRole = z.enum(demotableRoles).parse(transfer.demotedRole)
    if (transfer.status !== "pending") throw new Error("This transfer is no longer pending")
    if (transfer.version !== parsed.expectedVersion) throw new Error("Transfer changed. Reload before accepting.")
    if (transfer.expiresAt.getTime() <= Date.now()) {
      // Throwing rolls this transaction back. Leave expiry cleanup to the next
      // authorized issuance rather than pretending an update here would persist.
      throw new Error("This transfer has expired. Ask the owner to send a new one.")
    }

    const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, context.tenantId) })
    const fromMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, transfer.fromUserId), eq(userTenantRoles.tenantId, context.tenantId),
    ) })
    const toMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, transfer.toUserId), eq(userTenantRoles.tenantId, context.tenantId),
    ) })
    const fromAccount = await tx.query.users.findFirst({ where: eq(users.id, transfer.fromUserId) })
    const toAccount = await tx.query.users.findFirst({ where: eq(users.id, transfer.toUserId) })
    // The initiator must still be the recorded owner and still hold owner access.
    if (!league || league.id !== context.tenantId || league.isActive !== true
      || league.ownerId !== transfer.fromUserId) {
      throw new Error("Ownership changed since this transfer was created. Reload before accepting.")
    }
    if (!fromAccount || fromAccount.id !== transfer.fromUserId || fromAccount.isActive !== true
      || !fromMember || fromMember.userId !== transfer.fromUserId || fromMember.tenantId !== context.tenantId
      || fromMember.status !== "active" || fromMember.role !== "league_owner") {
      throw new Error("The current owner's access changed. This transfer is no longer valid.")
    }
    if (!toMember || toMember.userId !== transfer.toUserId || toMember.tenantId !== context.tenantId
      || toMember.status !== "active") {
      throw new Error("Your membership in this league is no longer active")
    }
    if (!toAccount || toAccount.id !== transfer.toUserId || toAccount.isActive !== true
      || toAccount.clerkId !== context.clerkId) {
      throw new Error("Your account or session changed. Sign in again before accepting.")
    }
    if (toMember.role === "league_owner" || toMember.role === "super_admin" || toAccount.role === "super_admin") {
      throw new Error("Ownership cannot be accepted by an owner or platform account")
    }

    // Promote the successor first, then demote and re-point ownership. Every
    // write is conditional on the version read under lock, so a concurrent
    // change rolls the whole handover back rather than half-applying it.
    const [promoted] = await tx.update(userTenantRoles).set({ role: "league_owner", status: "active" })
      .where(and(eq(userTenantRoles.id, toMember.id), eq(userTenantRoles.tenantId, context.tenantId),
        eq(userTenantRoles.version, toMember.version)))
      .returning({ membershipId: userTenantRoles.id, role: userTenantRoles.role,
        status: userTenantRoles.status, version: userTenantRoles.version })
    if (!promoted) throw new Error("Your membership changed. Reload before accepting.")
    const [demoted] = await tx.update(userTenantRoles).set({ role: demotedRole, status: "active" })
      .where(and(eq(userTenantRoles.id, fromMember.id), eq(userTenantRoles.tenantId, context.tenantId),
        eq(userTenantRoles.version, fromMember.version)))
      .returning({ membershipId: userTenantRoles.id, role: userTenantRoles.role,
        status: userTenantRoles.status, version: userTenantRoles.version })
    if (!demoted) throw new Error("The owner's membership changed. Reload before accepting.")
    const [reassigned] = await tx.update(tenants).set({ ownerId: transfer.toUserId })
      .where(and(eq(tenants.id, context.tenantId), eq(tenants.ownerId, transfer.fromUserId)))
      .returning({ id: tenants.id })
    if (!reassigned) throw new Error("Ownership changed since this transfer was created. Reload before accepting.")
    const [resolved] = await tx.update(ownershipTransfers)
      .set({ status: "accepted", resolvedAt: sql`clock_timestamp()`, resolvedBy: context.actorId,
        version: sql`${ownershipTransfers.version} + 1` })
      // PostgreSQL now() is fixed at transaction start. Use the wall clock at
      // the final claim, so time spent waiting/working cannot extend consent.
      .where(and(eq(ownershipTransfers.id, transfer.id), eq(ownershipTransfers.tenantId, context.tenantId),
        eq(ownershipTransfers.fromUserId, transfer.fromUserId), eq(ownershipTransfers.toUserId, context.actorId),
        eq(ownershipTransfers.status, "pending"), eq(ownershipTransfers.version, transfer.version),
        sql`${ownershipTransfers.expiresAt} > clock_timestamp()`))
      .returning({ id: ownershipTransfers.id })
    if (!resolved) throw new Error("Transfer changed or expired. Reload before accepting.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId: context.tenantId, actorId: context.actorId,
      actorRole: "league_owner", method: "OWNERSHIP_TRANSFER_ACCEPT", path: "/dashboard", statusCode: "200",
      payload: { transferId: transfer.id, newOwnerId: transfer.toUserId,
        before: { ownerId: transfer.fromUserId, demoted: { role: fromMember.role, status: fromMember.status, version: fromMember.version } },
        after: { ownerId: transfer.toUserId, promoted: promoted, demoted: demoted } },
    })
    return { transferId: transfer.id, newOwnerId: transfer.toUserId }
  })
  revalidatePath("/dashboard", "layout")
  return { success: true as const, ...result }
}

/**
 * Cancel a pending handover. Either party may withdraw: the owner can rescind
 * the offer and the recipient can decline it.
 */
export async function cancelOwnershipTransfer(input: OwnershipTransferResolve) {
  const parsed = transferKey.parse(input)
  const context = await requireActor()
  if (parsed.tenantId !== context.tenantId) throw new Error("Workspace changed. Reload before cancelling.")

  await db.transaction(async (tx) => {
    const initial = await tx.query.ownershipTransfers.findFirst({ where: and(
      eq(ownershipTransfers.id, parsed.transferId), eq(ownershipTransfers.tenantId, context.tenantId),
    ) })
    if (!initial || initial.tenantId !== context.tenantId || initial.id !== parsed.transferId) {
      throw new Error("Transfer not found in this league")
    }
    if (initial.fromUserId !== context.actorId && initial.toUserId !== context.actorId) {
      throw new Error("Forbidden: only the two parties may cancel this transfer")
    }
    const ids = [...new Set([initial.fromUserId, initial.toUserId])].sort()
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${inArray(users.id, ids)} ORDER BY ${users.id} FOR UPDATE`)
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${context.tenantId} FOR SHARE`)
    await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
      WHERE ${and(eq(userTenantRoles.tenantId, context.tenantId), inArray(userTenantRoles.userId, ids))}
      ORDER BY ${userTenantRoles.id} FOR UPDATE`)
    await tx.execute(sql`SELECT ${ownershipTransfers.id} FROM ${ownershipTransfers}
      WHERE ${and(eq(ownershipTransfers.id, parsed.transferId), eq(ownershipTransfers.tenantId, context.tenantId))} FOR UPDATE`)

    const transfer = await tx.query.ownershipTransfers.findFirst({ where: and(
      eq(ownershipTransfers.id, parsed.transferId), eq(ownershipTransfers.tenantId, context.tenantId),
    ) })
    if (!transfer || transfer.id !== parsed.transferId || transfer.tenantId !== context.tenantId
      || (transfer.fromUserId !== context.actorId && transfer.toUserId !== context.actorId)) {
      throw new Error("Transfer not found in this league")
    }
    if (transfer.fromUserId !== initial.fromUserId || transfer.toUserId !== initial.toUserId) {
      throw new Error("Transfer parties changed. Reload before cancelling.")
    }
    if (transfer.status !== "pending") throw new Error("This transfer is no longer pending")
    if (transfer.version !== parsed.expectedVersion) throw new Error("Transfer changed. Reload before cancelling.")
    const actor = await tx.query.users.findFirst({ where: eq(users.id, context.actorId) })
    const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, context.tenantId) })
    const actorMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, context.actorId), eq(userTenantRoles.tenantId, context.tenantId),
    ) })
    // Withdrawal grants no authority, so the other party need not remain active.
    // The caller must still have this identity and active league access, and an
    // initiator must still be the recorded owner (not just a stale owner role).
    if (!actor || actor.id !== context.actorId || actor.isActive !== true || actor.clerkId !== context.clerkId
      || !league || league.id !== context.tenantId || league.isActive !== true
      || !actorMember || actorMember.userId !== context.actorId || actorMember.tenantId !== context.tenantId
      || actorMember.status !== "active"
      || (context.actorId === transfer.fromUserId && (league.ownerId !== context.actorId || actorMember.role !== "league_owner"))) {
      throw new Error("Forbidden: your transfer-cancellation access changed")
    }
    const [cancelled] = await tx.update(ownershipTransfers)
      .set({ status: "cancelled", resolvedAt: new Date(), resolvedBy: context.actorId,
        version: sql`${ownershipTransfers.version} + 1` })
      .where(and(eq(ownershipTransfers.id, transfer.id), eq(ownershipTransfers.tenantId, context.tenantId),
        eq(ownershipTransfers.fromUserId, transfer.fromUserId), eq(ownershipTransfers.toUserId, transfer.toUserId),
        eq(ownershipTransfers.status, "pending"), eq(ownershipTransfers.version, transfer.version)))
      .returning({ id: ownershipTransfers.id })
    if (!cancelled) throw new Error("Transfer changed. Reload before cancelling.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId: context.tenantId, actorId: context.actorId,
      actorRole: actorMember.role, method: "OWNERSHIP_TRANSFER_CANCEL", path: "/dashboard/settings/members", statusCode: "200",
      payload: { transferId: transfer.id, fromUserId: transfer.fromUserId, toUserId: transfer.toUserId,
        cancelledBy: context.actorId === transfer.fromUserId ? "initiator" : "recipient" },
    })
  })
  revalidatePath("/dashboard", "layout")
  return { success: true as const, transferId: parsed.transferId }
}
