import { describe, expect, it } from "vitest"
import {
  LEAGUE_APPLICATION_ACTIONS,
  LEAGUE_APPLICATION_ACTIVE_STATES,
  LEAGUE_APPLICATION_STATES,
  isLeagueApplicationAction,
  isLeagueApplicationActiveState,
  isLeagueApplicationState,
  leagueApplicationProvisioningDecision,
  leagueApplicationTransition,
} from "../lib/league-application-policy"

const TERMINAL_STATES = ["approved", "rejected", "withdrawn"] as const

describe("League application policy vocabulary", () => {
  it("declares the full lifecycle with three terminal states", () => {
    expect([...LEAGUE_APPLICATION_STATES]).toEqual([
      "draft",
      "submitted",
      "needs_information",
      "approved",
      "rejected",
      "withdrawn",
    ])
  })

  it("treats only draft/submitted/needs_information as active (slot-occupying) states", () => {
    expect([...LEAGUE_APPLICATION_ACTIVE_STATES]).toEqual(["draft", "submitted", "needs_information"])
    for (const state of LEAGUE_APPLICATION_ACTIVE_STATES) {
      expect(isLeagueApplicationActiveState(state)).toBe(true)
    }
    for (const state of TERMINAL_STATES) {
      expect(isLeagueApplicationActiveState(state)).toBe(false)
    }
    expect(isLeagueApplicationActiveState("banana")).toBe(false)
    expect(isLeagueApplicationActiveState(undefined)).toBe(false)
  })

  it("guards states and actions against unknown input", () => {
    expect(isLeagueApplicationState("submitted")).toBe(true)
    expect(isLeagueApplicationState("pending")).toBe(false)
    expect(isLeagueApplicationState(undefined)).toBe(false)
    expect(isLeagueApplicationAction("approve")).toBe(true)
    expect(isLeagueApplicationAction("delete")).toBe(false)
    expect(isLeagueApplicationAction(null)).toBe(false)
  })
})

describe("leagueApplicationTransition is the single transition table", () => {
  it("submits a draft", () => {
    expect(leagueApplicationTransition("draft", "submit")).toEqual({
      outcome: "allowed",
      nextState: "submitted",
      requiresReason: false,
    })
  })

  it("resubmits after a request for information", () => {
    expect(leagueApplicationTransition("needs_information", "submit")).toEqual({
      outcome: "allowed",
      nextState: "submitted",
      requiresReason: false,
    })
  })

  it("allows withdrawal from every active state", () => {
    for (const state of LEAGUE_APPLICATION_ACTIVE_STATES) {
      expect(leagueApplicationTransition(state, "withdraw")).toEqual({
        outcome: "allowed",
        nextState: "withdrawn",
        requiresReason: false,
      })
    }
  })

  it("carries a mandatory reason on request_information and reject", () => {
    expect(leagueApplicationTransition("submitted", "request_information")).toEqual({
      outcome: "allowed",
      nextState: "needs_information",
      requiresReason: true,
    })
    expect(leagueApplicationTransition("submitted", "reject")).toEqual({
      outcome: "allowed",
      nextState: "rejected",
      requiresReason: true,
    })
    // A reviewer may reject while the applicant is mid-answer.
    expect(leagueApplicationTransition("needs_information", "reject")).toEqual({
      outcome: "allowed",
      nextState: "rejected",
      requiresReason: true,
    })
  })

  it("approves only a submitted application", () => {
    expect(leagueApplicationTransition("submitted", "approve")).toEqual({
      outcome: "allowed",
      nextState: "approved",
      requiresReason: false,
    })
    // Approving while waiting for the applicant's information is contradictory.
    expect(leagueApplicationTransition("needs_information", "approve")).toEqual({
      outcome: "refused",
      code: "illegal-transition",
    })
  })

  it("refuses illegal transitions from active states", () => {
    const refused: Array<[string, string]> = [
      ["draft", "approve"],
      ["draft", "reject"],
      ["draft", "request_information"],
      ["submitted", "submit"],
      ["needs_information", "request_information"],
    ]
    for (const [state, action] of refused) {
      expect(leagueApplicationTransition(state, action)).toEqual({
        outcome: "refused",
        code: "illegal-transition",
      })
    }
  })

  it("never leaves a terminal state, for any action", () => {
    for (const state of TERMINAL_STATES) {
      for (const action of LEAGUE_APPLICATION_ACTIONS) {
        expect(leagueApplicationTransition(state, action)).toEqual({
          outcome: "refused",
          code: "illegal-transition",
        })
      }
    }
  })

  it("fails closed on unknown states and actions", () => {
    expect(leagueApplicationTransition("banana", "approve")).toEqual({
      outcome: "refused",
      code: "unknown-state",
    })
    expect(leagueApplicationTransition("submitted", "explode")).toEqual({
      outcome: "refused",
      code: "unknown-action",
    })
  })
})

describe("leagueApplicationProvisioningDecision gates approval->provisioning", () => {
  const applicant = { isActive: true }

  it("provisions a submitted, never-provisioned application of an active ownerless applicant", () => {
    expect(
      leagueApplicationProvisioningDecision({
        state: "submitted",
        provisionedTenantId: null,
        applicant,
        ownedTenant: null,
      }),
    ).toEqual({ outcome: "provision" })
  })

  it("refuses everything that is not a submitted application", () => {
    for (const state of ["draft", "needs_information", "approved", "rejected", "withdrawn"]) {
      expect(
        leagueApplicationProvisioningDecision({
          state,
          provisionedTenantId: null,
          applicant,
          ownedTenant: null,
        }),
      ).toEqual({ outcome: "refused", code: "not-submitted" })
    }
    // Precedence: a state problem wins over every other signal.
    expect(
      leagueApplicationProvisioningDecision({
        state: "rejected",
        provisionedTenantId: "t1",
        applicant: null,
        ownedTenant: { id: "t1" },
      }),
    ).toEqual({ outcome: "refused", code: "not-submitted" })
  })

  it("refuses a double provisioning receipt", () => {
    expect(
      leagueApplicationProvisioningDecision({
        state: "submitted",
        provisionedTenantId: "t1",
        applicant,
        ownedTenant: null,
      }),
    ).toEqual({ outcome: "refused", code: "already-provisioned" })
  })

  it("refuses a missing or inactive applicant", () => {
    expect(
      leagueApplicationProvisioningDecision({
        state: "submitted",
        provisionedTenantId: null,
        applicant: null,
        ownedTenant: null,
      }),
    ).toEqual({ outcome: "refused", code: "applicant-missing" })
    expect(
      leagueApplicationProvisioningDecision({
        state: "submitted",
        provisionedTenantId: null,
        applicant: { isActive: false },
        ownedTenant: null,
      }),
    ).toEqual({ outcome: "refused", code: "applicant-inactive" })
  })

  it("re-checks the one-league cap at approval time", () => {
    expect(
      leagueApplicationProvisioningDecision({
        state: "submitted",
        provisionedTenantId: null,
        applicant,
        ownedTenant: { id: "already-owned" },
      }),
    ).toEqual({ outcome: "refused", code: "already-owns-league" })
  })
})
