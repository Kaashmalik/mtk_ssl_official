import React from "react"
import type { DashboardContext } from "@/lib/dashboard-context"
import { hasPermission } from "@/lib/rbac"
import { getSubscriptionStatus } from "@/lib/subscription-status"
import { TrialBanner } from "./trial-banner"

/**
 * Server component wrapper for the trial banner.
 *
 * Uses the dashboard's authorized active tenant, never a different primary
 * membership. Only renders to roles allowed to manage settings, and renders
 * the client `TrialBanner` when the subscription is actively trialing and
 * `daysRemaining` is a positive number, so a tenant that has upgraded or whose
 * trial expired never sees the banner.
 *
 * This runs inside the dashboard layout which is already `force-dynamic`, so
 * no extra cache opt-out is needed.
 */
export async function TrialBannerServer({ context }: { context: DashboardContext }) {
  try {
    if (!hasPermission(context.role, "settings:manage")) return null
    const info = await getSubscriptionStatus(context.tenantId)

    // Only show for actively trialing subscriptions with time left
    if (info.status !== "trialing" || info.daysRemaining === null || info.daysRemaining <= 0) {
      return null
    }

    return (
      <TrialBanner
        daysRemaining={info.daysRemaining}
        plan={info.plan}
      />
    )
  } catch {
    // Never crash the dashboard layout due to a billing lookup failure
    return null
  }
}
