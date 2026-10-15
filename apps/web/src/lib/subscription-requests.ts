import { db, subscriptionRequests, tenants, users } from "@mtk/database"
import { and, desc, eq, sql } from "drizzle-orm"

/**
 * Manual (bank/wallet transfer) subscription request flows, the non-Stripe
 * sibling of lib/stripe-billing. Creation is serialized per league with a
 * tenant-row lock + in-transaction pending re-check, so two concurrent
 * submissions of the same owner cannot both mint live requests; the loser
 * reports conflict and the route answers 409.
 */

type Tenant = typeof tenants.$inferSelect
type Request = typeof subscriptionRequests.$inferSelect

export type OwnedTenant =
  | { ok: true; userId: string; tenant: Tenant }
  | { ok: false; reason: "user_missing" | "tenant_missing" }

/** Resolve the Clerk identity to the league it owns (owner-only billing). */
export async function findOwnedTenant(clerkUserId: string): Promise<OwnedTenant> {
  const [user] = await db.select({ id: users.id }).from(users)
    .where(eq(users.clerkId, clerkUserId)).limit(1)
  if (!user) return { ok: false, reason: "user_missing" }

  const [tenant] = await db.select().from(tenants)
    .where(eq(tenants.ownerId, user.id)).limit(1)
  if (!tenant) return { ok: false, reason: "tenant_missing" }

  return { ok: true, userId: user.id, tenant }
}

export async function createManualSubscriptionRequest(input: {
  tenantId: string
  userId: string
  requestedPlan: string
  currentPlan: string
  amount: number
  paymentMethod: string
  paymentProofUrl: string
  transactionReference: string
  /** Requests expire (are stale for approval) after this many days. */
  expiresInDays?: number
}): Promise<{ request: Request } | { conflict: true }> {
  const {
    tenantId, userId, requestedPlan, currentPlan, amount,
    paymentMethod, paymentProofUrl, transactionReference, expiresInDays = 7,
  } = input

  return db.transaction(async (tx) => {
    // Serialize per-tenant request creation; the pending re-check runs after
    // the lock, so a concurrent submission loses here instead of duplicating.
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR UPDATE`)

    const [pending] = await tx.select({ id: subscriptionRequests.id }).from(subscriptionRequests)
      .where(and(
        eq(subscriptionRequests.tenantId, tenantId),
        eq(subscriptionRequests.status, "pending"),
      )).limit(1)
    if (pending) return { conflict: true as const }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)

    const [request] = await tx.insert(subscriptionRequests).values({
      tenantId,
      userId,
      requestedPlan,
      currentPlan,
      amount: String(amount),
      paymentMethod,
      paymentProofUrl,
      transactionReference,
      status: "pending",
      expiresAt,
    }).returning()

    if (!request) throw new Error("Could not save the subscription request")
    return { request }
  })
}

/** Newest-first history for the billing page, bounded. */
export async function listSubscriptionRequests(tenantId: string, limit = 20): Promise<Request[]> {
  return db.select().from(subscriptionRequests)
    .where(eq(subscriptionRequests.tenantId, tenantId))
    .orderBy(desc(subscriptionRequests.createdAt))
    .limit(limit)
}
