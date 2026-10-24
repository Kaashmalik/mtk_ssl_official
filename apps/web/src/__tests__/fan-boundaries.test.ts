import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Batch 145 (resilience wave): Batch 143 gave ONLY the scoring segment a
 * route-scoped error boundary and skeleton. Every other public segment —
 * match detail, tournaments (list + detail), the hub, leaderboards, hall
 * of fame — and the dashboard ROOT still fell through to the generic root
 * boundary, which (a) loses all segment context and navigation, and (b)
 * for the fan pages renders an unstyled page that claims "Our team has
 * been notified" whether or not segment context was preserved.
 *
 * Honest boundaries per segment: Sentry is reported (the root's claim is
 * therefore true there too), the digest is shown, the copy is segment-
 * specific and never leaks error.message internals, and loading states use
 * the shared skeletons instead of a bare spinner.
 *
 * Honest correction to the batch plan: there is NO `/matches` list route
 * (only `/matches/[matchId]`), so no boundary is pinned for a route that
 * does not exist.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, "../app")
const src = (rel: string) => readFileSync(join(APP, rel), "utf8")

const SEGMENTS: Array<[string, string, string]> = [
  // [route dir, error title, home href] — /matches has no list route, so
  // the match detail's way home is the site root.
  ["matches/[matchId]", "Match page error", "/"],
  ["tournaments", "Tournaments list error", "/"],
  ["tournaments/[id]", "Tournament page error", "/tournaments"],
  ["hub", "Hub error", "/"],
  ["leaderboards", "Leaderboards error", "/"],
  ["hall-of-fame", "Hall of fame error", "/"],
  ["dashboard", "Dashboard error", "/dashboard"],
]

describe("every public segment has its own error boundary (Batch 145)", () => {
  it("the boundary files exist — no segment falls through to the root page", () => {
    for (const [dir] of SEGMENTS) {
      expect(existsSync(join(APP, dir, "error.tsx")), `${dir}/error.tsx`).toBe(true)
    }
  })

  it.each(SEGMENTS)("boundary for %s is segment-specific, honest, and reports", (dir, title, home) => {
    const source = src(`${dir}/error.tsx`)
    // Shared component, not eight hand-rolled copies.
    expect(source).toContain("RouteErrorBoundary")
    expect(source).toContain(title)
    expect(source).toContain(home)
    // "use client" — error boundaries only work as client components.
    expect(source).toContain('"use client"')
  })
})

describe("the shared boundary component (Batch 145)", () => {
  const boundary = readFileSync(join(HERE, "../components/shared/route-error-boundary.tsx"), "utf8")

  it("reports to Sentry so the 'notified' contract is actually true", () => {
    expect(boundary).toContain("Sentry.captureException")
  })

  it("shows the digest for support correlation, never the raw error message", () => {
    // error.message can carry query internals; the digest is the stable
    // public identifier (same policy as the root boundary).
    expect(boundary).toContain("error.digest")
    expect(boundary).not.toMatch(/\{error\.message\}/)
  })

  it("offers an honest way forward: retry and a segment home link", () => {
    expect(boundary).toContain("reset")
    expect(boundary).toContain("href={homeHref}")
  })
})

describe("loading states use the shared skeletons (Batch 145)", () => {
  it("a card-grid skeleton exists for the list segments", () => {
    const skeletons = readFileSync(join(HERE, "../components/shared/route-skeletons.tsx"), "utf8")
    expect(skeletons).toContain("export function CardGridSkeleton")
  })

  const LOADING: Array<[string, string]> = [
    ["matches/[matchId]/loading.tsx", "DetailSkeleton"],
    ["tournaments/loading.tsx", "CardGridSkeleton"],
    ["tournaments/[id]/loading.tsx", "DetailSkeleton"],
    ["hub/loading.tsx", "CardGridSkeleton"],
    ["leaderboards/loading.tsx", "CardGridSkeleton"],
    ["hall-of-fame/loading.tsx", "CardGridSkeleton"],
  ]
  it.each(LOADING)("%s renders a shared skeleton", (file, skeleton) => {
    const source = src(file)
    expect(source).toContain(skeleton)
    expect(source).toContain("@/components/shared/route-skeletons")
  })
})
