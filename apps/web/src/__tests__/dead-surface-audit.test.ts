import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
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

  it("users: the superseded roster read is gone and expiry has a real consumer", () => {
    const actions = source("app/actions/users.ts")
    expect(actions).not.toContain("getUsers")
    expect(actions).not.toContain("setUserMembershipExpiry")
    expect(actions).toContain("getMemberDirectory")
    expect(actions).toContain("getMemberDetails")
    // The locked writer stays in the lib (SCORE-09 boundary, lib-tested);
    // only the unreachable HTTP surface was removed.
    expect(source("lib/member-management.ts")).toContain("setMemberExpiry")
    expect(actions).toContain("updateMemberExpiry")
    expect(source("components/users/member-expiry-form.tsx")).toContain("updateMemberExpiry")
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

describe("dead-surface audit tier 2: lib exports with no consumers (Batch 131)", () => {
  /**
   * The lib tier is not HTTP-reachable, but a needless `export` invites
   * future drift (something CAN import it, so something eventually WILL).
   * Everything below is used only inside its own module or was fully dead;
   * each name keeps its implementation, loses the outward surface.
   */
  const UNEXPORTED: Array<[string, string]> = [
    ["lib/award-dispute-records.ts", "raiseAwardDisputeInputSchema"],
    ["lib/award-dispute-records.ts", "resolveAwardDisputeInputSchema"],
    ["lib/award-dispute-records.ts", "AWARD_DISPUTE_QUEUE_BOUND"],
    ["lib/award-dispute-records.ts", "readAwardDisputeAffordance"],
    ["lib/award-records.ts", "declareAwardInputSchema"],
    ["lib/award-records.ts", "AWARD_MANAGER_BOUND"],
    ["lib/award-records.ts", "revokeAwardInputSchema"],
    ["lib/fan-follows.ts", "fanFollowSchema"],
    ["lib/fan-reaction-moderation.ts", "REACTION_MODERATION_LIMIT"],
    ["lib/form-drafts.ts", "DRAFT_KEY_PREFIX"],
    ["lib/invite-records.ts", "resendCooldownMs"],
    ["lib/league-settings-reads.ts", "leagueBrandingColumns"],
    ["lib/match-records.ts", "umpireMembership"],
    ["lib/member-directory-filters.ts", "memberDirectoryExpiryStates"],
    ["lib/member-management.ts", "memberEditableRoles"],
    ["lib/member-management.ts", "leagueMemberLimit"],
    ["lib/notification-dispatch.ts", "notificationPreferencesInputSchema"],
    ["lib/prize-records.ts", "PRIZE_MANAGER_BOUND"],
    ["lib/public-career-profile.ts", "PUBLIC_CAREER_PROFILE_LEAGUE_LIMIT"],
    ["lib/public-visibility.ts", "PUBLIC_TOURNAMENT_OPTIONS_LIMIT"],
    ["lib/public-visibility.ts", "PUBLIC_HALL_OF_FAME_LIMIT"],
    ["lib/rbac.ts", "ROLE_HIERARCHY"],
    ["lib/roster-history.ts", "rosterPerformanceScope"],
    ["lib/roster-reads.ts", "rosterPlayerColumns"],
    ["lib/roster-reads.ts", "editablePlayerColumns"],
    ["lib/subscription-status.ts", "deriveSubscriptionStatus"],
    ["lib/env.ts", "isConfigured"],
  ]

  it.each(UNEXPORTED)("%s no longer exports %s", (file, name) => {
    const src = source(file)
    expect(src).toMatch(new RegExp(`\\b${name}\\b`)) // still implemented
    expect(src).not.toMatch(new RegExp(`export (const|async function|function) ${name}(?![A-Za-z0-9_])`))
  })

  it("fully dead lib code was removed, not just un-exported", () => {
    expect(() => source("lib/api-client.ts")).toThrow()
    const env = source("lib/env.ts")
    for (const dead of ["isFeatureReady", "requireFeature", "allFeatureReadiness", "isDevelopment", "FeatureNotConfiguredError"]) {
      expect(env).not.toContain(dead)
    }
    // featureReadiness survives: a live route consumes it.
    expect(env).toContain("export function featureReadiness")
    for (const [file, dead] of [
      ["lib/offline-ball-queue.ts", "clearQueue"],
      ["lib/otp.ts", "OTP_MAX_ATTEMPTS"],
      ["lib/public-tenant.ts", "export async function requirePublicTenant("],
      ["lib/rbac-server.ts", "getUserRoleAndTenantIds"],
      ["lib/rbac.ts", "getPermissions"],
      ["lib/registration-reads.ts", "registrationPageNumber"],
      ["lib/scoring-revision-client.ts", "isScoringRevisionConflict"],
      ["lib/scoring-socket.ts", "disconnectScoringSocket"],
      ["lib/award-dispute-records.ts", "readMyAwardDisputes"],
    ] as const) {
      expect(source(file)).not.toContain(dead)
    }
  })

  it("packages/ui: the unexported cricket PointsTable twin is GONE - it fabricated NRR (Batch 141)", () => {
    // A second, never-exported PointsTable lived in packages/ui/cricket:
    // its NRR cell printed `entry.nrr.toFixed(3)` (a team with no innings
    // evidence renders a factual-looking 0.000) and it decorated the
    // OWNER-GATED qualification-zone markers as ready-made dead code -
    // a landmine for the next feature that reaches for a points table.
    // The canonical table is apps/web components/tournaments/points-table.tsx
    // (Batch 132), whose NRR honesty is pinned in the standings suites.
    expect(existsSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/ui/src/components/cricket/points-table.tsx"))).toBe(false)
    // The honest canonical table stays untouched.
    const canonical = readFileSync(join(WEB_SRC, "components/tournaments/points-table.tsx"), "utf8")
    expect(canonical).toContain("hasNetRunRate ? formatNetRunRate(s.netRunRate) : \"—\"")
  })
})
