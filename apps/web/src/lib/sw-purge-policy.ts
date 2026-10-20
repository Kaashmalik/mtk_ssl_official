/**
 * ENH-01-02: account-transition detection for the service-worker navigation
 * purge. Pure so the auth boundary is testable without a Clerk provider or a
 * service worker.
 *
 * The caller (AuthCacheGuard) keeps the last OBSERVED user id in a ref:
 *   - undefined  = never observed (provider just hydrated)
 *   - string     = a signed-in user id
 *   - null       = observed signed-out state
 * On every Clerk state change it feeds (previous, next) into purgeDecision()
 * and, when told to purge, posts PURGE_NAVIGATION_CACHE to the controller.
 */

export type PurgeDecision = "purge" | "observe" | "none"

export type NextAuthState = {
  isLoaded: boolean
  isSignedIn: boolean
  userId?: string | null
}

export function purgeDecision(
  previousUserId: string | null | undefined,
  next: NextAuthState,
): PurgeDecision {
  if (!next.isLoaded) return "none"
  const nextUserId = next.isSignedIn ? next.userId ?? null : null

  // First observation after hydration: record it. The worker's activation
  // step already purges stale generations at this point; nothing new was
  // cached during this session (the worker never stores navigations).
  if (previousUserId === undefined) return "observe"

  // Sign-out: a real identity existed and is now gone.
  if (nextUserId === null) return previousUserId === null ? "none" : "purge"

  // Account switch: a different user signed in without an observed sign-out.
  if (previousUserId !== null && previousUserId !== nextUserId) return "purge"

  return "none"
}

/** The next observed identity for the caller's ref, per the same rules. */
export function observedUserId(next: NextAuthState): string | null | undefined {
  if (!next.isLoaded) return undefined
  return next.isSignedIn ? next.userId ?? null : null
}
