/*
 * SSL service worker — offline app shell + runtime caching.
 *
 * Strategy:
 *   - Navigations: network-first, fall back to the pre-cached /offline shell.
 *     Runtime navigations are NEVER cached (ENH-01-02): the old worker stored
 *     every type:"basic" response, which kept PROTECTED HTML (dashboard,
 *     settings) on disk where the next signed-in (or signed-out) offline user
 *     of the same browser could read it.
 *   - Static assets (/_next/static, /icons): cache-first, they are immutable.
 *   - API/WS traffic: never cached (scoring data must stay live).
 *   - Sign-out/account switch: the app posts PURGE_NAVIGATION_CACHE, the shell
 *     cache is deleted and /offline is re-primed, so an auth transition never
 *     leaves a previous account's pages retrievable.
 *   - The shell generation (v2) is bumped so activation deletes cached files
 *     left behind by the older worker.
 */

const SHELL_CACHE = "ssl-shell-v2";
const ASSET_CACHE = "ssl-assets-v1";
const OFFLINE_URL = "/offline";

const SHELL_ASSETS = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

const offlineKey = () => new URL(OFFLINE_URL, self.location.origin).toString();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Sign-out / account switch (sent by the auth cache guard): drop every cached
// navigation artifact, then make sure the offline shell is still available.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PURGE_NAVIGATION_CACHE") {
    event.waitUntil(
      caches
        .delete(SHELL_CACHE)
        .then(() => caches.open(SHELL_CACHE))
        .then((cache) =>
          fetch(offlineKey())
            .then((response) => (response.ok ? cache.put(offlineKey(), response) : undefined))
            .catch(() => undefined),
        ),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API, WebSocket or scoring endpoints.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/socket.io/") ||
    request.headers.get("accept")?.includes("text/event-stream")
  ) {
    return;
  }

  // Immutable build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
        }
        return response;
      }),
    );
    return;
  }

  // Navigations: network-first with the offline shell as the ONLY fallback.
  // ENH-01-02: no navigation response is ever written to a cache here.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(request)
          .then(
            (exact) =>
              exact ||
              caches.match(offlineKey()).then((shell) => shell || Response.error()),
          ),
      ),
    );
  }
});
