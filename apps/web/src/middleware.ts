import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { tenantSlugFromHost } from "@/lib/tenant-host";

// NOTE: This file runs in the Edge runtime. We intentionally do NOT import
// @mtk/observability here — it uses node:crypto / node:async_hooks
// (AsyncLocalStorage) which are Node-only and crash the Edge bundle.
// Edge-compatible request-id + lightweight logging are inlined below.

// Public routes that don't require authentication.
// Cron routes are public — they authenticate via CRON_SECRET in the handler,
// not via Clerk (Vercel Cron can't obtain a Clerk session).
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/ssl(.*)",
  "/api/health",
  "/api/cron/(.*)",
  "/api/webhooks/(.*)",
  "/api/auth/(.*)",
  "/verify-otp",
  // PWA assets must load pre-auth or the app cannot be installed.
  "/manifest.json",
  "/sw.js",
  "/icons/(.*)",
  "/favicon.ico",
  // Service-worker offline fallback: must render without a session.
  "/offline",
  // Token-gated handoff: the HMAC-signed single-use token is the auth.
  "/impersonation/callback",
  // Invite redemption: the hashed single-use token is the auth.
  "/accept-invite",
  "/matches/(.*)",
  "/tournaments/(.*)",
  "/leaderboards",
  // NOTE: there is deliberately no `/teams` or `/players` entry. No such
  // top-level routes exist — team/player screens live under `/dashboard/*`,
  // which is already protected. Previously listed here, which would have
  // silently publicised them had the routes ever been added.
]);

/** Edge-safe request id: prefer the inbound header, else generate a UUIDv4. */
function resolveRequestId(headers: Headers): string {
  const inbound =
    headers.get("x-request-id") || headers.get("x-correlation-id");
  if (inbound) return inbound;
  // Web Crypto is available in the Edge runtime.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Last-resort fallback for runtimes without crypto.randomUUID.
  return "rid-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Tenant slug is parsed by the shared, Edge-safe helper so this file and
// `lib/tenant-host.ts` cannot disagree. The DB-backed resolution lives in
// `lib/public-tenant.ts` (server components only — no DB in the Edge bundle).

export default clerkMiddleware(async (auth, request: NextRequest) => {
  const requestId = resolveRequestId(request.headers);
  const path = request.nextUrl?.pathname ?? request.url;
  const method = request.method;

  try {
    const host =
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
      request.headers.get("host") ??
      "";
    const subdomain = tenantSlugFromHost(host);

    // Rate limiting for mutation requests (POST, PUT, PATCH, DELETE)
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const authData = auth as unknown as { sessionClaims?: { sub?: string } };
      const userId = authData.sessionClaims?.sub;

      // Fallback to IP address if no userId is present
      const ip =
        request.headers.get("x-forwarded-for") ||
        request.headers.get("x-real-ip") ||
        "127.0.0.1";
      const key = userId ? `user:${userId}` : `ip:${ip}`;

      // Limit to 60 requests per minute.
      // `rateLimit` is async — it uses Redis when available (Node runtime)
      // and falls back to in-memory on Edge runtime.
      const { success, remaining, reset } = await rateLimit(key, 60, 60000);

      if (!success) {
        console.warn("[middleware] Rate limit exceeded", { key, path });
        return new NextResponse(
          JSON.stringify({ error: "Too many requests. Please try again later." }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "X-RateLimit-Limit": "60",
              "X-RateLimit-Remaining": remaining.toString(),
              "X-RateLimit-Reset": reset.toString(),
              "X-Request-Id": requestId,
            },
          }
        );
      }
    }

    // Forward the resolved tenant slug on the REQUEST headers as well as the
    // response. Setting it only on the response (the previous behaviour) meant
    // no server component or route handler could ever read it, making the
    // header inert for its stated purpose. Request-side headers are what
    // `headers()` exposes downstream.
    const requestHeaders = new Headers(request.headers);
    if (subdomain) {
      requestHeaders.set("x-tenant-slug", subdomain);
    }

    // Create response with tenant info in headers (actual tenant lookup happens in server components/API)
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("X-Request-Id", requestId);

    if (subdomain) {
      response.headers.set("x-tenant-slug", subdomain);
    }

    // Handle authentication for protected routes
    const scoringPath = /^\/matches\/[^/]+\/scoring/.test(path);
    if (!isPublicRoute(request) || scoringPath) {
      // ClerkMiddlewareAuth doesn't expose userId directly in types
      // We use sessionClaims?.sub as the user identifier
      const authData = auth as unknown as { sessionClaims?: { sub?: string } };
      const userId = authData.sessionClaims?.sub;
      if (!userId) {
        // API routes must answer with JSON status codes, never an HTML redirect.
        // The handler performs its own authorization and returns the real reason.
        if (path.startsWith("/api/")) {
          return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401, headers: { "X-Request-Id": requestId } },
          );
        }
        const signInUrl = new URL("/sign-in", request.url);
        signInUrl.searchParams.set("redirect_url", request.url);
        return NextResponse.redirect(signInUrl);
      }
    }

    return response;
  } catch (err) {
    // Any uncaught error must be surfaced as a 500 rather than crashing silently.
    // Structured logging + Sentry capture happens in the server components/API
    // (Node runtime) — here we only emit a console record.
    console.error("[middleware] Internal error", {
      requestId,
      method,
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return new NextResponse(
      JSON.stringify({ error: "Internal middleware error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      }
    );
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
