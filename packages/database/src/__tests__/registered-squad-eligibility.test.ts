import { describe, expect, it } from "vitest"
import { matchRegistrationMap, registrationAllowsPlayer, type SquadRegistration } from "../lib/registered-squad-eligibility"

const registration: SquadRegistration = { tenantId: "league", tournamentId: "cup", teamId: "a", status: "approved", squadPlayerIds: ["batter"] }

describe("Registered squad eligibility v2 (pure, not database locking proof)", () => {
  it("permits an explicitly declared player", () => {
    expect(registrationAllowsPlayer(registration, "batter")).toBe(true)
  })
  it("rejects an undeclared player", () => {
    expect(registrationAllowsPlayer(registration, "outsider")).toBe(false)
  })
  it.each([{ squadPlayerIds: null }, { squadPlayerIds: [] }])("retains legacy active-roster eligibility for approved squad $squadPlayerIds", ({ squadPlayerIds }) => {
    expect(registrationAllowsPlayer({ ...registration, squadPlayerIds }, "batter")).toBe(true)
  })
  it("retains legacy eligibility when no registration exists", () => {
    expect(registrationAllowsPlayer(undefined, "batter")).toBe(true)
  })
  it.each(["pending", "withdrawn", "rejected", "waitlisted", "", "unknown"])("does not turn %s registration into unrestricted roster access", status => {
    expect(registrationAllowsPlayer({ ...registration, status }, "batter")).toBe(false)
    expect(registrationAllowsPlayer({ ...registration, status, squadPlayerIds: [] }, "batter")).toBe(false)
  })
  it("maps each exact-league match side once", () => {
    const rows = [registration, { ...registration, teamId: "b" }]
    expect([...matchRegistrationMap(rows, "league", "cup", ["a", "b"]).keys()]).toEqual(["a", "b"])
  })
  it.each([{ tenantId: "other" }, { tournamentId: "other" }, { teamId: "other" }])("rejects inconsistent scope %s", change => {
    expect(() => matchRegistrationMap([{ ...registration, ...change }], "league", "cup", ["a", "b"])).toThrow("require review")
  })
  it("rejects duplicate registrations rather than choosing the last row", () => {
    expect(() => matchRegistrationMap([registration, registration], "league", "cup", ["a", "b"])).toThrow("require review")
  })
  it("rejects the third-row corruption sentinel", () => {
    expect(() => matchRegistrationMap([registration, registration, registration], "league", "cup", ["a", "b"])).toThrow("require review")
  })
  it("requires two distinct sides", () => {
    expect(() => matchRegistrationMap([], "league", "cup", ["a", "a"])).toThrow("require review")
  })
})
