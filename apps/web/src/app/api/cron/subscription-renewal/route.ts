import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db, subscriptions, notifications, tenants } from "@mtk/database";
import { and, eq, inArray, isNotNull, lte, gte } from "drizzle-orm";
import { logger } from "@mtk/observability";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron: subscription renewal sweep.
 *
 * Scheduled daily (see vercel.json `crons`). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` on each invocation.
 *
 * Runs two independent passes:
 *
 *   1. NOTIFY — for subscriptions inside a renewal bucket (D-7 .. grace),
 *      insert one tenant-wide in-app notification per bucket. Idempotent: a
 *      retry or an accidental double-invocation must not stack duplicate
 *      notifications, so each bucket is guarded by a recent-row check.
 *
 *   2. ENFORCE — for subscriptions that blew past the grace window, pause the
 *      subscription and downgrade the tenant to the free plan. Transactional per
 *      subscription so a crash cannot leave a paused subscription attached to a
 *      still-paid tenant (or vice versa).
 *
 * These are deliberately separate queries. The notify window is bounded
 * (now-30d .. now+7d); the enforce window is unbounded in the past. Folding
 * enforcement into the notify loop made it unreachable — a subscription 10 days
 * past due is outside every notify bucket, so the `days < -7` branch could
 * never run and delinquent tenants were never downgraded.
 */

const MS_PER_DAY = 86_400_000;

/** Grace period before a subscription is paused and the tenant downgraded. */
const GRACE_DAYS = 7;

/**
 * Constant-time secret comparison.
 *
 * Hashing first makes the comparison safe for differing lengths —
 * `timingSafeEqual` throws on length mismatch, which would itself leak length
 * through an exception path.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

interface NotifyBucket {
  type: string;
  title: string;
  body: string;
  /** Inclusive day range, in days until `currentPeriodEnd`. */
  minDays: number;
  maxDays: number;
}

/**
 * Day-range buckets rather than exact-day equality.
 *
 * Exact equality (`days === 7`) silently drops the whole bucket if a single run
 * is missed or lands slightly off schedule, and the tenant then never hears
 * about the renewal at all. Ranges tolerate a late or early invocation.
 */
const NOTIFY_BUCKETS: readonly NotifyBucket[] = [
  {
    type: "renewal_d7",
    title: "Your subscription renews in 7 days",
    body: "Plan: {plan}. Renew to keep live streaming and scoring active.",
    minDays: 6,
    maxDays: 7,
  },
  {
    type: "renewal_d3",
    title: "Only 3 days left on your subscription",
    body: "Plan: {plan}. Renew to keep live streaming and scoring active.",
    minDays: 3,
    maxDays: 4,
  },
  {
    type: "renewal_d1",
    title: "Your subscription expires tomorrow",
    body: "Plan: {plan}. Renew to keep live streaming and scoring active.",
    minDays: 1,
    maxDays: 1,
  },
  {
    type: "renewal_d0",
    title: "Subscription expired — grace period active",
    body: "Plan: {plan}. Renew within {graceDays} days to avoid interruption.",
    minDays: 0,
    maxDays: 0,
  },
  {
    type: "renewal_grace3",
    title: "3 days left in your grace period",
    body: "Plan: {plan}. Your subscription will be paused after {graceDays} days past due.",
    minDays: -3,
    maxDays: -1,
  },
];

function daysUntil(date: Date, now: Date): number {
  return Math.floor((date.getTime() - now.getTime()) / MS_PER_DAY);
}

function fillTemplate(template: string, plan: string): string {
  return template.replace("{plan}", plan).replace("{graceDays}", String(GRACE_DAYS));
}

export async function GET(request: Request) {
  // --- Authenticate the cron invocation ---
  // Fail closed. Comparing against an unset CRON_SECRET would make
  // `undefined !== undefined` evaluate false and authorise the caller.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error("[cron/subscription-renewal] CRON_SECRET is not set — refusing to run");
    return NextResponse.json(
      { error: "Cron not configured" },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const providedSecret = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  if (!secretsMatch(providedSecret, cronSecret)) {
    logger.warn("[cron/subscription-renewal] Unauthorized cron invocation", {
      hasAuth: Boolean(authHeader),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  try {
    // ── Pass 1: renewal notifications ──────────────────────────
    const notifyWindowEnd = new Date(now.getTime() + 7 * MS_PER_DAY);
    // Look back far enough to still catch a bucket whose original run was
    // missed, while bounding the result set.
    const notifyWindowStart = new Date(now.getTime() - 30 * MS_PER_DAY);

    const candidates = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.status, ["active", "past_due", "trialing"]),
          isNotNull(subscriptions.currentPeriodEnd),
          lte(subscriptions.currentPeriodEnd, notifyWindowEnd),
          gte(subscriptions.currentPeriodEnd, notifyWindowStart),
        ),
      );

    let notified = 0;
    let markedPastDue = 0;

    for (const sub of candidates) {
      const days = daysUntil(sub.currentPeriodEnd, now);

      // Renewal ran out but we have not yet flipped the status.
      if (days < 0 && sub.status === "active") {
        await db
          .update(subscriptions)
          .set({ status: "past_due", updatedAt: now })
          .where(eq(subscriptions.id, sub.id));
        markedPastDue++;
      }

      const bucket = NOTIFY_BUCKETS.find(
        (b) => days <= b.maxDays && days >= b.minDays,
      );
      if (!bucket) continue;

      // Idempotency guard: skip if this bucket already produced a notification
      // for this tenant in the last 36h. Vercel retries failed cron
      // invocations, and a manual re-run should be harmless.
      const recentlyNotified = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.tenantId, sub.tenantId),
            eq(notifications.type, bucket.type),
            gte(notifications.createdAt, new Date(now.getTime() - 36 * 3_600_000)),
          ),
        )
        .limit(1);

      if (recentlyNotified.length > 0) continue;

      await db.insert(notifications).values({
        tenantId: sub.tenantId,
        userId: null,
        type: bucket.type,
        channel: "in_app",
        title: bucket.title,
        body: fillTemplate(bucket.body, sub.plan),
        status: "delivered",
        deliveredAt: now,
      });
      notified++;
    }

    // ── Pass 2: enforce the grace window ───────────────────────
    // Unbounded lookback, independent of the notify window.
    const enforceCutoff = new Date(now.getTime() - GRACE_DAYS * MS_PER_DAY);

    const delinquent = await db
      .select({
        id: subscriptions.id,
        tenantId: subscriptions.tenantId,
        status: subscriptions.status,
      })
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.status, ["active", "past_due", "trialing"]),
          lte(subscriptions.currentPeriodEnd, enforceCutoff),
        ),
      );

    let paused = 0;
    let downgraded = 0;

    for (const sub of delinquent) {
      // Both writes in one transaction: a half-applied downgrade would leave a
      // tenant paused but still on a paid plan, or worse, free while still
      // entitled to a live subscription.
      const result = await db.transaction(async (tx) => {
        const updated = await tx
          .update(subscriptions)
          .set({ status: "paused", updatedAt: now })
          .where(
            and(
              eq(subscriptions.id, sub.id),
              inArray(subscriptions.status, ["active", "past_due", "trialing"]),
            ),
          )
          .returning({ id: subscriptions.id });

        // Lost a race with another invocation — do not double-downgrade.
        if (updated.length === 0) return false;

        await tx
          .update(tenants)
          .set({ plan: "free", updatedAt: now })
          .where(eq(tenants.id, sub.tenantId));

        return true;
      });

      if (result) {
        paused++;
        downgraded++;
      }
    }

    logger.info("[cron/subscription-renewal] Sweep complete", {
      notifyCandidates: candidates.length,
      notified,
      markedPastDue,
      delinquent: delinquent.length,
      paused,
      downgraded,
    });

    return NextResponse.json({
      success: true,
      processed: candidates.length,
      notified,
      markedPastDue,
      paused,
      downgraded,
    });
  } catch (error) {
    logger.error("[cron/subscription-renewal] Sweep failed", error);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
