"use client";

import { useEffect, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { observedUserId, purgeDecision } from "@/lib/sw-purge-policy";

/**
 * ENH-01-02: posted to the service worker on sign-out/account switch; the
 * worker deletes the navigation shell cache and re-primes /offline. The
 * message TYPE is the contract with apps/web/public/sw.js.
 */
export const PURGE_NAVIGATION_CACHE = "PURGE_NAVIGATION_CACHE";

/** Best-effort purge request; a missing/blocked worker is not an error. */
export function requestNavigationCachePurge(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    navigator.serviceWorker.controller?.postMessage({ type: PURGE_NAVIGATION_CACHE });
  } catch {
    // Purging is a defense-in-depth step; it must never break sign-out.
  }
}

/**
 * Watches Clerk identity transitions and purges the service worker's
 * navigation cache across them. Mounted inside <ClerkProvider> (Providers) so
 * it exists wherever a real session can, and renders nothing. The worker no
 * longer caches navigations at all; this closes the window for anything a
 * previous worker version stored and for any future in-memory drift between
 * accounts on one browser profile.
 */
export function AuthCacheGuard(): null {
  const { isLoaded, isSignedIn, user } = useUser();
  const lastUserId = useRef<string | null | undefined>(undefined);
  // Clerk's hook types allow undefined while hydrating; the policy expects
  // strict booleans, so the component normalizes at the boundary.
  const userId = user?.id ?? null;

  useEffect(() => {
    const next = { isLoaded: isLoaded === true, isSignedIn: isSignedIn === true, userId };
    const decision = purgeDecision(lastUserId.current, next);
    if (decision === "purge") {
      requestNavigationCachePurge();
    }
    lastUserId.current = observedUserId(next);
  }, [isLoaded, isSignedIn, userId]);

  return null;
}
