import { describe, expect, it } from "vitest"
import { resolveNoTenantLanding } from "@/lib/onboarding-destination"

/**
 * ENH-02-01 (fan-versus-organizer destination): a no-tenant account used to be
 * redirected to the ORGANIZER setup form no matter who they were — a returning
 * applicant landed on a blank creation form instead of their application
 * status, and a fan was handed league-creation tooling. The resolver picks a
 * truthful landing from the account's own facts; neither branch grants any
 * membership or operational right.
 */

describe("no-tenant landing resolution (ENH-02-01)", () => {
  it("sends a live-application journey back to the application status surface", () => {
    for (const state of ["draft", "submitted", "needs_information"] as const) {
      expect(resolveNoTenantLanding({ applicationState: state })).toEqual({
        kind: "application-status",
        path: "/dashboard/league/apply",
      })
    }
  })

  it("shows the explore-or-organize hub with the previous-application entry after a terminal decision", () => {
    for (const state of ["approved", "rejected", "withdrawn"] as const) {
      expect(resolveNoTenantLanding({ applicationState: state })).toEqual({
        kind: "explore-or-organize",
        withPreviousApplication: true,
      })
    }
    expect(resolveNoTenantLanding({ applicationState: null })).toEqual({
      kind: "explore-or-organize",
      withPreviousApplication: false,
    })
  })

  it("treats an unknown state as no application (never traps a recovery on data drift)", () => {
    expect(resolveNoTenantLanding({ applicationState: "mystery" })).toEqual({
      kind: "explore-or-organize",
      withPreviousApplication: false,
    })
  })
})
