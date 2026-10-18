import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "..")
const source = (rel: string) => readFileSync(join(WEB_SRC, rel), "utf8")

/**
 * Batch 130 dead-surface audit: a "use server" export is reachable over HTTP
 * the moment it exists, whether or not any UI consumes it. Each of these
 * actions had ZERO consumers (the consuming page reads the lib function
 * directly server-side), so the action tier only added an unauthenticated-
 * facing attack surface. This pin keeps them out, and keeps the ONE orphan
 * that should NOT have been deleted - generateFixtures (Batch 49) - actually
 * wired to the dashboard page.
 */
describe("dead-surface audit pin (Batch 130)", () => {
  it("venues: no action-tier reads - pages read lib/venue-reads directly", () => {
    const actions = source("app/actions/venues.ts")
    for (const dead of ["getVenue(", "getVenues(", "getVenueOptions("]) {
      expect(actions).not.toContain(dead)
    }
    expect(actions).not.toContain("venue-reads")
    expect(actions).toContain("createVenue")
    expect(actions).toContain("updateVenue")
  })

  it("tournaments: the superseded paged list is gone; fixture generation stays and is wired", () => {
    const actions = source("app/actions/tournaments.ts")
    expect(actions).not.toContain("getTournaments")
    expect(actions).not.toContain("tournamentFiltersSchema")
    expect(actions).toContain("generateFixtures")
    const page = source("app/dashboard/tournaments/[id]/page.tsx")
    expect(page).toContain("GenerateFixturesButton")
    expect(page).toContain('"match:create"')
    expect(source("components/tournaments/generate-fixtures-button.tsx"))
      .toContain('from "@/app/actions/tournaments"')
  })

  it("users: the superseded roster read and the unwired expiry action are gone", () => {
    const actions = source("app/actions/users.ts")
    expect(actions).not.toContain("getUsers")
    expect(actions).not.toContain("setUserMembershipExpiry")
    expect(actions).toContain("getMemberDirectory")
    expect(actions).toContain("getMemberDetails")
    // The locked writer stays in the lib (SCORE-09 boundary, lib-tested);
    // only the unreachable HTTP surface was removed.
    expect(source("lib/member-management.ts")).toContain("setMemberExpiry")
  })

  it("fan anti-abuse: only the write delegates remain - reads go through the lib", () => {
    const reports = source("app/actions/fan-reaction-reports.ts")
    expect(reports).not.toContain("getOpenReactionReports")
    expect(reports).toContain("reportMatchReactionFeedAction")
    expect(reports).toContain("decideReactionReportAction")
    const blocks = source("app/actions/fan-interaction-blocks.ts")
    expect(blocks).not.toContain("getActiveFanBlocks")
    expect(blocks).toContain("blockFanInteractionAction")
    expect(blocks).toContain("liftFanBlockAction")
    const moderation = source("app/actions/fan-reaction-moderation.ts")
    expect(moderation).not.toContain("getMatchReactionsForModeration")
    expect(moderation).toContain("removeModeratedReaction")
  })
})
