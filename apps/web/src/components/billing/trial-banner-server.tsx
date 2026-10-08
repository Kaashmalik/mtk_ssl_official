import { auth } from "@clerk/nextjs/server"
import { getMyTenant } from "@/app/actions/tenants"
import { getSubscriptionStatus } from "@/lib/subscription-status"
import { TrialBanner } from "./trial-banner"

/**
 * Server component wrapper for the trial banner.
 *
 * Resolves session → tenant → subscription status on the server. Only renders
 * the client `TrialBanner` when the subscription is actively trialing and
 * `daysRemaining` is a positive number, so a tenant that has upgraded or whose
 * trial expired never sees the banner.
 *
 * This runs inside the dashboard layout which is already `force-dynamic`, so
 * no extra cache opt-out is needed.
 */
export async function TrialBannerServer() {
  try {
    const { userId } = await auth()
    if (!userId) return null

    const tenant = await getMyTenant()
    if (!tenant) return null

    const info = await getSubscriptionStatus(tenant.id)

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
