import { db, subscriptionRequests, subscriptions, tenants, payments } from "@mtk/database"
import { and, eq, sql } from "drizzle-orm"
import { createHmac, timingSafeEqual } from "crypto"
import { PLAN_PRICES } from "@mtk/database/lib/plan-limits"

/**
 * Stripe checkout intent + webhook settlement primitives. The web app never
 * writes plan state outside these flows: the owner creates at most one live
 * intent per league (creation is serialized per tenant), and settlement only
 * transitions a `pending` request that was claimed inside this transaction.
 * PKR is a two-decimal currency for Stripe: checkout sends paisa
 * (`amount * 100`), settlement converts back (`amount_total / 100`).
 */

type Request = typeof subscriptionRequests.$inferSelect

export interface CheckoutEventSession {
  id?: string
  client_reference_id?: string | null
  metadata?: Record<string, string>
  amount_total?: number
  currency?: string
  payment_status?: string
}

/**
 * Record the owner's checkout intent. Two concurrent owners cannot both
 * create a live request for one league: the tenant row is locked for update
 * inside the transaction and the pending-check re-runs under the lock.
 * Returns the created intent, or `{ conflict: true }` when a request is
 * already awaiting review.
 */
export async function createSubscriptionIntent(input: {
  tenantId: string
  userId: string
  requestedPlan: string
  currentPlan: string
  amount: number
}): Promise<{ intent: Request } | { conflict: true }> {
  const { tenantId, userId, requestedPlan, currentPlan, amount } = input
  return db.transaction(async (tx) => {
    // Serialize per-tenant intent creation; the pending re-check runs after
    // the lock, so a concurrent checkout loses here instead of double-billing.
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR UPDATE`)
    const [pending] = await tx.select({ id: subscriptionRequests.id }).from(subscriptionRequests)
      .where(and(
        eq(subscriptionRequests.tenantId, tenantId),
        eq(subscriptionRequests.status, "pending"),
      )).limit(1)
    if (pending) return { conflict: true as const }
    const [intent] = await tx.insert(subscriptionRequests).values({
      tenantId,
      userId,
      requestedPlan,
      currentPlan,
      amount: String(amount),
      paymentMethod: "stripe",
      paymentProofUrl: "stripe://pending",
      transactionReference: `stripe_pending_${Date.now()}`,
      status: "pending",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).returning()
    if (!intent) throw new Error("Could not save the subscription request")
    return { intent }
  })
}

/** Reject the intent when its Stripe session could not be created. */
export async function markIntentRejected(requestId: string, adminNotes: string): Promise<void> {
  await db.update(subscriptionRequests)
    .set({ status: "rejected", adminNotes })
    .where(eq(subscriptionRequests.id, requestId))
}

/** Store the live checkout URL as the reconciliable payment reference. */
export async function attachIntentCheckoutUrl(requestId: string, url: string): Promise<void> {
  await db.update(subscriptionRequests)
    .set({ paymentProofUrl: url.slice(0, 500) })
    .where(eq(subscriptionRequests.id, requestId))
}

// ─── Webhook signature (Stripe scheme: t=…,v1=…) ─────────────

export type StripeSignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing_header" | "outside_tolerance" | "invalid" }

/**
 * Manual verification per Stripe's signed-payload scheme: HMAC-SHA256 over
 * `${timestamp}.${rawBody}`, constant-time comparison against every `v1`
 * signature, and a five-minute timestamp tolerance (Stripe's default).
 */
export function verifyStripeSignature(input: {
  secret: string
  header: string
  body: string
  nowMs: number
}): StripeSignatureResult {
  const { secret, header, body, nowMs } = input
  const parts = header.split(",").map((p) => p.split("="))
  const timestamp = parts.find(([k]) => k === "t")?.[1]
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v)

  if (!timestamp || signatures.length === 0) return { ok: false, reason: "missing_header" }

  const age = Math.abs(nowMs / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > 300) return { ok: false, reason: "outside_tolerance" }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
  const ok = signatures.some((sig) => {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  })
  return ok ? { ok: true } : { ok: false, reason: "invalid" }
}

// ─── Settlement ───────────────────────────────────────────────

/**
 * Settle a completed checkout inside one transaction: claim the pending
 * request with the status in the UPDATE predicate (idempotent against Stripe's
 * duplicate deliveries), verify the paid amount against the plan price table,
 * upgrade the league plan, upsert the subscription period, and record the
 * payment. Unknown plans / mismatched amounts throw so the caller rejects the
 * delivery and Stripe retries; resolved requests short-circuit.
 */
export async function settleCheckoutCompleted(session: CheckoutEventSession): Promise<
  "settled" | "ignored" | "expired_request" | "already_resolved"
> {
  const requestId = session.metadata?.requestId ?? session.client_reference_id ?? null
  if (!requestId || session.payment_status !== "paid") return "ignored"

  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(subscriptionRequests)
      .where(eq(subscriptionRequests.id, requestId)).for("update").limit(1)
    if (!request || request.status !== "pending") return "already_resolved" as const

    const now = new Date()
    if (request.expiresAt <= now) {
      await tx.update(subscriptionRequests).set({ status: "expired", updatedAt: now })
        .where(and(eq(subscriptionRequests.id, request.id), eq(subscriptionRequests.status, "pending")))
      return "expired_request" as const
    }

    const plan = request.requestedPlan as keyof typeof PLAN_PRICES
    const monthlyAmount = PLAN_PRICES[plan]
    if (!monthlyAmount) throw new Error("Stripe request has an unknown plan")
    const billedAmount = session.amount_total === undefined ? Number(request.amount) : session.amount_total / 100
    if (billedAmount !== Number(request.amount)) throw new Error("Stripe amount does not match subscription request")
    const periodMonths = billedAmount === monthlyAmount * 10 ? 12 : billedAmount === monthlyAmount ? 1 : 0
    if (!periodMonths) throw new Error("Stripe amount is not a valid monthly or annual plan price")
    const periodEnd = new Date(now)
    const day = periodEnd.getDate()
    periodEnd.setDate(1)
    periodEnd.setMonth(periodEnd.getMonth() + periodMonths)
    periodEnd.setDate(Math.min(day, new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, 0).getDate()))

    const [claimed] = await tx.update(subscriptionRequests).set({
      status: "approved",
      transactionReference: session.id ?? `stripe_${Date.now()}`,
      reviewedAt: now,
      updatedAt: now,
      adminNotes: "Auto-approved via verified Stripe webhook",
    }).where(and(
      eq(subscriptionRequests.id, request.id),
      eq(subscriptionRequests.status, "pending"),
    )).returning({ id: subscriptionRequests.id })
    if (!claimed) return "already_resolved" as const

    await tx.update(tenants).set({ plan, updatedAt: now })
      .where(eq(tenants.id, request.tenantId))
    const [existingSub] = await tx.select().from(subscriptions)
      .where(eq(subscriptions.tenantId, request.tenantId)).limit(1)
    const subscriptionValues = {
      plan,
      status: "active" as const,
      monthlyAmount: String(monthlyAmount),
      currency: (session.currency ?? "pkr").toUpperCase(),
      paymentMethod: "stripe" as const,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      updatedAt: now,
    }
    if (existingSub) {
      await tx.update(subscriptions).set(subscriptionValues)
        .where(eq(subscriptions.id, existingSub.id))
    } else {
      await tx.insert(subscriptions).values({ tenantId: request.tenantId, ...subscriptionValues })
    }

    await tx.insert(payments).values({
      tenantId: request.tenantId,
      userId: request.userId,
      amount: String(billedAmount),
      currency: (session.currency ?? "pkr").toUpperCase(),
      paymentMethod: "stripe",
      status: "completed",
      externalPaymentId: session.id ?? null,
      paidAt: now,
      completedAt: now,
      paymentType: "subscription",
      description: `Stripe checkout: ${request.currentPlan} → ${request.requestedPlan}`,
    })
    return "settled" as const
  })
}

/** Expire a still-pending request when its checkout session expires. */
export async function expireCheckoutSession(requestId: string | null): Promise<void> {
  if (!requestId) return
  await db.update(subscriptionRequests)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(
      eq(subscriptionRequests.id, requestId),
      eq(subscriptionRequests.status, "pending"),
    ))
}
