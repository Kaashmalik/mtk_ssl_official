import { db, subscriptions, tenants } from "@mtk/database"
import { desc, eq } from "drizzle-orm"

export type DerivedSubscriptionStatus =
  | "active"
  | "expiring"
  | "critical"
  | "grace"
  | "expired"
  | "trialing"
  | "free"

export interface SubscriptionStatusInfo {
  status: DerivedSubscriptionStatus
  daysRemaining: number | null
  currentPeriodEnd: Date | null
  trialEndsAt: Date | null
  plan: string
}

export function deriveSubscriptionStatus(sub: {
  status: string
  currentPeriodEnd: Date | null
  trialEndsAt: Date | null
  cancelAtPeriodEnd?: boolean
} | null): Omit<SubscriptionStatusInfo, "plan"> {
  if (!sub) return { status: "free", daysRemaining: null, currentPeriodEnd: null, trialEndsAt: null }

  const now = Date.now()
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : null

  if (sub.status === "trialing" || (sub.trialEndsAt && new Date(sub.trialEndsAt).getTime() > now)) {
    const tEnd = sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() : null
    return {
      status: "trialing",
      daysRemaining: tEnd ? Math.ceil((tEnd - now) / 86400000) : null,
      currentPeriodEnd: sub.currentPeriodEnd,
      trialEndsAt: sub.trialEndsAt,
    }
  }

  if (sub.status === "canceled" || sub.status === "paused") {
    return { status: "expired", daysRemaining: 0, currentPeriodEnd: sub.currentPeriodEnd, trialEndsAt: null }
  }

  if (end === null) {
    return { status: "active", daysRemaining: null, currentPeriodEnd: null, trialEndsAt: null }
  }

  const days = (end - now) / 86400000
  if (days > 7) return { status: "active", daysRemaining: Math.floor(days), currentPeriodEnd: sub.currentPeriodEnd, trialEndsAt: null }
  if (days > 1) return { status: "expiring", daysRemaining: Math.floor(days), currentPeriodEnd: sub.currentPeriodEnd, trialEndsAt: null }
  if (days >= 0) return { status: "critical", daysRemaining: Math.max(0, Math.floor(days)), currentPeriodEnd: sub.currentPeriodEnd, trialEndsAt: null }
  if (days >= -7) return { status: "grace", daysRemaining: Math.floor(days + 7), currentPeriodEnd: sub.currentPeriodEnd, trialEndsAt: null }
  return { status: "expired", daysRemaining: Math.floor(days), currentPeriodEnd: sub.currentPeriodEnd, trialEndsAt: null }
}

export async function getSubscriptionStatus(tenantId: string): Promise<SubscriptionStatusInfo> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const [sub] = await db.select().from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1)

  const derived = deriveSubscriptionStatus(sub ?? null)
  return { ...derived, plan: tenant?.plan ?? sub?.plan ?? "free" }
}
