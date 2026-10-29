import { describe, it, expect, vi, beforeEach } from "vitest"

// REGRESSION PIN (Batch 173, found on the live deployment): `clerkMiddleware`
// hands the callback a CALLABLE `auth` object in @clerk/nextjs v6 - claims are
// only available after `await auth()`. The previous implementation read
// `auth.sessionClaims` on the unresolved object, which is ALWAYS undefined, so
// every protected route redirected signed-in users to /sign-in (and the
// sign-in page then rendered empty for an authenticated client - the
// "black screen" seen in production). This file pins the corrected contract.

const state = vi.hoisted(() => ({
  cb: undefined as undefined | ((auth: unknown, req: unknown) => Promise<unknown>),
}))

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (cb: (auth: unknown, req: unknown) => Promise<unknown>) => {
    state.cb = cb
    return cb
  },
  createRouteMatcher: (routes: string[]) => {
    const exact = new Set(routes.filter((r) => !r.endsWith("(.*)")))
    const prefixes = routes.filter((r) => r.endsWith("(.*)")).map((r) => r.slice(0, -5))
    return (req: { nextUrl: { pathname: string } }) =>
      exact.has(req.nextUrl.pathname) || prefixes.some((p) => req.nextUrl.pathname.startsWith(p))
  },
}))

vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ success: true, remaining: 59, reset: 60 })) }))
vi.mock("@/lib/tenant-host", () => ({ tenantSlugFromHost: vi.fn(() => null) }))

import apply from "@/middleware"

function fakeRequest(pathname: string, method = "GET") {
  return {
    method,
    headers: new Headers({ "x-request-id": "rid-test" }),
    url: "https://mtk-ssl.vercel.app" + pathname,
    nextUrl: new URL("https://mtk-ssl.vercel.app" + pathname),
  } as unknown as Parameters<NonNullable<typeof state.cb>>[1]
}

// The v6 shape: a callable resolving to the claims object.
function authOf(userId: string | null) {
  return vi.fn(async () => ({ userId }))
}

async function run(path: string, userId: string | null): Promise<Response> {
  return (await state.cb!(authOf(userId), fakeRequest(path))) as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  // middleware.ts executes clerkMiddleware at import, so the callback is here.
  expect(state.cb).toBeDefined()
  expect(apply).toBeTypeOf("function")
})

describe("middleware auth gate (v6 callable auth contract)", () => {
  it("lets a signed-in user reach a protected dashboard route (no redirect)", async () => {
    const res = await run("/dashboard", "user_abc")
    expect(res.status).not.toBe(307)
    expect(res.headers.get("location")).toBeNull()
  })

  it("redirects a signed-out page request to /sign-in with redirect_url", async () => {
    const res = await run("/dashboard", null)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/sign-in")
    expect(res.headers.get("location")).toContain("redirect_url")
  })

  it("answers a signed-out API request with a 401 JSON body, never an HTML redirect", async () => {
    const res = await run("/api/admin/leagues", null)
    expect(res.status).toBe(401)
    expect(res.headers.get("content-type")).toContain("json")
  })

  it("never redirects a signed-in API request", async () => {
    const res = await run("/api/subscriptions/request", "user_abc")
    expect(res.status).not.toBe(307)
  })

  it("does not gate public routes even when signed out", async () => {
    const res = await run("/leaderboards", null)
    expect(res.status).not.toBe(307)
  })

  it("serves the public content and policy pages to signed-out visitors and crawlers", async () => {
    for (const path of ["/guides", "/guides/net-run-rate-explained", "/about", "/contact", "/privacy", "/terms", "/ads.txt", "/tournaments", "/hall-of-fame"]) {
      const res = await run(path, null)
      expect(res.status, path).not.toBe(307)
    }
  })

  it("lets an unknown path fall through to the 404 page instead of a sign-in redirect", async () => {
    const res = await run("/this-page-does-not-exist", null)
    expect(res.status).not.toBe(307)
    expect(res.headers.get("location")).toBeNull()
  })

  it("still gates every private area and the scorer view when signed out", async () => {
    for (const path of ["/dashboard/teams", "/settings", "/broadcast/abc", "/impersonation/start", "/matches/abc/scoring"]) {
      const res = await run(path, null)
      expect(res.status, path).toBe(307)
    }
  })
})
