import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Batch 148 (explorer P3 close-out): 39 route segments still had no own
 * error boundary (every one landed on a styled PARENT boundary — a gap,
 * not a bug — but on dashboard WRITE surfaces, the on-stream chroma overlay
 * and the live match viewer a contextual fallback with the right way home
 * matters), and 21 had no loading state (a bare spinner or nothing while
 * their server component ran).
 *
 * Scope honesty, pinned in code:
 *  - EXCLUDED: sign-in/sign-up (Clerk-owned surfaces with their own error
 *    handling — a custom card would interfere), impersonation/callback
 *    (transient window-opener flow).
 *  - NO loading state for: accept-invite, broadcast/overlay/[broadcastId]
 *    (token-gated chroma render — a skeleton mid-stream is wrong),
 *    offline (static client UX), verify-otp (instant client flow).
 *
 * Everything shares the one RouteErrorBoundary (B145) and the shared
 * skeletons — zero hand-rolled copies, segment-specific copy only.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, "../app")

// [dir, homeHref, skeleton | null] — null means NO loading assertion. A
// pre-existing loading.tsx is left alone (one was found mid-cycle:
// dashboard/matches/live/[id] already ships ScoringSkeleton — the honest
// shape for a live view — and the pin table was corrected, not the file).
const SEGMENTS: Array<[string, string, string | null]> = [
  ["accept-invite", "/", null],
  ["broadcast/overlay/[broadcastId]", "/", null],
  ["dashboard/account", "/dashboard", "DetailSkeleton"],
  ["dashboard/account/security", "/dashboard", "FormSkeleton"],
  ["dashboard/league/apply", "/dashboard", "FormSkeleton"],
  ["dashboard/matches/[id]", "/dashboard", "DetailSkeleton"],
  ["dashboard/matches/[id]/edit", "/dashboard", "FormSkeleton"],
  ["dashboard/matches/live/[id]", "/dashboard", null],
  ["dashboard/matches/new", "/dashboard", "FormSkeleton"],
  ["dashboard/players/[id]", "/dashboard", "DetailSkeleton"],
  ["dashboard/players/[id]/edit", "/dashboard", "FormSkeleton"],
  ["dashboard/players/id-card/[id]", "/dashboard", "DetailSkeleton"],
  ["dashboard/players/id-cards", "/dashboard", "CardGridSkeleton"],
  ["dashboard/players/new", "/dashboard", "FormSkeleton"],
  // Pre-existing honest B114 loading (matches the page's shape) — the
  // table yields, it does not replace prior work.
  ["dashboard/registrations/[id]", "/dashboard", null],
  ["dashboard/registrations/new", "/dashboard", "FormSkeleton"],
  // Pre-existing custom loading (page-shaped Skeleton grid) — yields.
  ["dashboard/settings/billing", "/dashboard", null],
  ["dashboard/settings/billing/[id]", "/dashboard", "DetailSkeleton"],
  ["dashboard/settings/billing/invoices", "/dashboard", "CardGridSkeleton"],
  ["dashboard/settings/broadcast", "/dashboard", "DetailSkeleton"],
  ["dashboard/settings/fan-interactions", "/dashboard", "DetailSkeleton"],
  ["dashboard/settings/members/[membershipId]", "/dashboard", "DetailSkeleton"],
  ["dashboard/stats/compare", "/dashboard", "DetailSkeleton"],
  ["dashboard/teams/[id]", "/dashboard", "DetailSkeleton"],
  ["dashboard/teams/[id]/analytics", "/dashboard", "DetailSkeleton"],
  ["dashboard/teams/[id]/edit", "/dashboard", "FormSkeleton"],
  ["dashboard/teams/new", "/dashboard", "FormSkeleton"],
  ["dashboard/tournaments/[id]", "/dashboard", "DetailSkeleton"],
  ["dashboard/tournaments/[id]/edit", "/dashboard", "FormSkeleton"],
  ["dashboard/tournaments/new", "/dashboard", "FormSkeleton"],
  ["dashboard/venues", "/dashboard", "CardGridSkeleton"],
  ["dashboard/venues/[id]/edit", "/dashboard", "FormSkeleton"],
  ["dashboard/venues/new", "/dashboard", "FormSkeleton"],
  ["hub/players/[userId]", "/hub", "DetailSkeleton"],
  ["matches/[matchId]/live", "/", "ScoringSkeleton"],
  ["offline", "/", null],
  ["settings/branding", "/", "FormSkeleton"],
  ["tournaments/new", "/tournaments", "FormSkeleton"],
  ["verify-otp", "/sign-in", null],
]

describe("every remaining segment carries its own honest boundary (Batch 148)", () => {
  it("the boundary files exist", () => {
    for (const [dir] of SEGMENTS) {
      expect(existsSync(join(APP, dir, "error.tsx")), `${dir}/error.tsx`).toBe(true)
    }
  })

  it.each(SEGMENTS)("boundary for %s is shared-component, client, and points the right way home", (dir, home) => {
    const source = readFileSync(join(APP, dir, "error.tsx"), "utf8")
    expect(source).toContain('"use client"')
    expect(source).toContain("RouteErrorBoundary")
    expect(source).toContain(`homeHref="${home}"`)
    // Segment-specific copy: every boundary names its segment (never the
    // root page's generic "Something went wrong").
    expect(source).toMatch(/title="[^"]{6,}"/)
    // Honest descriptions only: no claimed auto-recovery, no fabricated status.
    expect(source).not.toContain("will be restored")
    expect(source).not.toContain("shortly")
  })

  it("loading states render the shared skeleton they promise", () => {
    for (const [dir, , skeleton] of SEGMENTS) {
      if (!skeleton) continue
      const file = join(APP, dir, "loading.tsx")
      expect(existsSync(file), `${dir}/loading.tsx`).toBe(true)
      const source = readFileSync(file, "utf8")
      expect(source, dir).toContain(skeleton)
      expect(source, dir).toContain("@/components/shared/route-skeletons")
    }
  })

  it("the boundaries that deliberately opted out of skeletons stay out", () => {
    // on-stream chroma page must NOT gain a loading skeleton (a placeholder
    // graphic mid-broadcast is worse than a flash) — recorded as intent.
    expect(existsSync(join(APP, "broadcast/overlay/[broadcastId]/loading.tsx"))).toBe(false)
  })
})
