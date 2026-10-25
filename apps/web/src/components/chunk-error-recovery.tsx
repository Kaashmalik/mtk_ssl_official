"use client";

import { useEffect } from "react";

/**
 * Stale-build auto-recovery.
 *
 * After a new deployment, an already-open client session can lazily import a
 * chunk whose hash no longer exists on the server (Webpack
 * "ChunkLoadError" / "Failed to fetch dynamically imported module"). The
 * failure bubbles past every route boundary and lands on app/error.tsx,
 * which reads as "the site is broken" when it is really just an old tab.
 *
 * Recovery: reload once, bound so a genuinely broken route cannot loop.
 * - only reloads for asset-import style failures;
 * - at most once per MINUTE per tab (sessionStorage),
 * - at most twice per tab (sessionStorage counter with short TTL).
 */
export function ChunkErrorRecovery() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const KEY = "ssl:chunk-recovery";
    const WINDOW_MS = 60_000;
    const MAX_HITS = 2;

    const shouldRecover = (): boolean => {
      try {
        const now = Date.now();
        const state = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as number[];
        const recent = state.filter((t) => now - t < WINDOW_MS);
        if (recent.length >= MAX_HITS) return false;
        recent.push(now);
        sessionStorage.setItem(KEY, JSON.stringify(recent.slice(-MAX_HITS)));
        return true;
      } catch {
        return true;
      }
    };

    const isChunkFailure = (message: string): boolean =>
      /ChunkLoadError/i.test(message)
      || /Failed to fetch dynamically imported module/i.test(message)
      || /Loading chunk [\w-]+ failed/i.test(message)
      || /error loading dynamically imported module/i.test(message);

    const onError = (event: ErrorEvent) => {
      if (!isChunkFailure(event.message || "")) return;
      if (!shouldRecover()) return;
      console.warn("[chunk-recovery] stale build detected — reloading once", event.message);
      window.location.reload();
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "");
      if (!isChunkFailure(message)) return;
      if (!shouldRecover()) return;
      console.warn("[chunk-recovery] stale build detected — reloading once", message);
      window.location.reload();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
