/**
 * Centralized plan limits configuration.
 *
 * Used by:
 *   - Team creation quota checks
 *   - Player count limits
 *   - White-label feature gating
 *   - Custom domain feature gating
 *   - Live streaming feature gating
 *
 * Must match the DB enum: free | starter | pro | enterprise
 */

export type PlanKey = "free" | "starter" | "pro" | "enterprise"

export interface PlanLimits {
  maxTeams: number
  maxPlayers: number
  whiteLabel: boolean
  customDomain: boolean
  liveStreaming: boolean
}

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  free: {
    maxTeams: 4,
    maxPlayers: 40,
    whiteLabel: false,
    customDomain: false,
    liveStreaming: false,
  },
  starter: {
    maxTeams: 16,
    maxPlayers: 200,
    whiteLabel: false,
    customDomain: false,
    liveStreaming: false,
  },
  pro: {
    maxTeams: Infinity,
    maxPlayers: Infinity,
    whiteLabel: true,
    customDomain: false,
    liveStreaming: true,
  },
  enterprise: {
    maxTeams: Infinity,
    maxPlayers: Infinity,
    whiteLabel: true,
    customDomain: true,
    liveStreaming: true,
  },
}

/**
 * Standardized plan prices (PKR per league).
 */
export const PLAN_PRICES: Record<PlanKey, number> = {
  free: 0,
  starter: 4999,
  pro: 14999,
  enterprise: 49999,
}

/**
 * Check if a plan has a specific feature enabled.
 */
export function planHasFeature(plan: PlanKey, feature: keyof PlanLimits): boolean {
  return !!PLAN_LIMITS[plan]?.[feature]
}

/**
 * Get the limits for a given plan.
 */
export function getPlanLimits(plan: PlanKey): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}
