import { describe, expect, it } from "vitest"
import { scorerSlotGrant, teamManagementGrant, isPlatformRole, PLATFORM_ROLES } from "../lib/resource-grants"

const ACTOR = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"

describe("Resource-scoped grant design (ISO-05)", () => {
  it.each([
    ["primary", { scorerId: ACTOR, backupScorerId: null }],
    ["backup", { scorerId: null, backupScorerId: ACTOR }],
  ] as const)("derives the %s scoring slot for its grantee", (expected, match) => {
    expect(scorerSlotGrant(match, ACTOR)).toBe(expected)
  })

  it("derives no scoring slot for a non-grantee or an unassigned match", () => {
    expect(scorerSlotGrant({ scorerId: OTHER, backupScorerId: OTHER }, ACTOR)).toBeNull()
    expect(scorerSlotGrant({ scorerId: null, backupScorerId: null }, ACTOR)).toBeNull()
  })

  it("the primary slot wins whenever a corrupt row holds both", () => {
    expect(scorerSlotGrant({ scorerId: ACTOR, backupScorerId: ACTOR }, ACTOR)).toBe("primary")
  })

  it.each([
    ["manager", { managerId: ACTOR, captainId: null }],
    ["captain", { managerId: null, captainId: ACTOR }],
  ] as const)("derives the %s team-management grant for its holder", (expected, team) => {
    expect(teamManagementGrant(team, ACTOR)).toBe(expected)
  })

  it("derives no team grant for a non-holder or an unassigned team", () => {
    expect(teamManagementGrant({ managerId: OTHER, captainId: OTHER }, ACTOR)).toBeNull()
    expect(teamManagementGrant({ managerId: null, captainId: null }, ACTOR)).toBeNull()
  })

  it("matches grants strictly on the actor id, never loosely", () => {
    expect(scorerSlotGrant({ scorerId: ACTOR, backupScorerId: null }, "")).toBeNull()
    expect(teamManagementGrant({ managerId: ACTOR, captainId: ACTOR }, `${ACTOR.slice(0, -1)}2`)).toBeNull()
  })

  it("platform roles are enumerable, separate from league roles, and carry no grants", () => {
    expect([...PLATFORM_ROLES]).toEqual(["super_admin"])
    expect(isPlatformRole("super_admin")).toBe(true)
    expect(isPlatformRole("league_owner")).toBe(false)
    expect(isPlatformRole("scorer")).toBe(false)
    expect(isPlatformRole("team_manager")).toBe(false)
    expect(isPlatformRole("player")).toBe(false)
  })
})
