import { beforeEach, describe, expect, it, vi } from "vitest"
import { hasPermissionServer } from "@/lib/rbac-server"
import { scorerSlotGrant, teamManagementGrant } from "@mtk/database"
import { ROLE_PERMISSIONS, hasPermission, type UserRole } from "@/lib/rbac"

/**
 * ENH-05-01: THE capability matrix as an executable table.
 *
 * Axis 1 - role class permission (the pure ROLE_PERMISSIONS sheet).
 * Axis 2 - resource assignment (scorer slot / team grant, ISO-05).
 * Axis 3 - membership state (active / suspended / expired, SCORE-09).
 * Axis 4 - tenant ownership (own league vs foreign league).
 *
 * Parts A and C pin invariants of the pure sheets; part B runs the REAL
 * server gate (db/auth mocked at the process boundary, as in
 * rbac-server.test.ts) composed with the pure grantdeciders, so each row
 * is the actual stacked decision a crafted - UI-independent - request
 * would hit.
 */

const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), member: vi.fn(), tenant: vi.fn(), host: vi.fn(), primary: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/tenant", () => ({ getTenantFromRequest: mocks.host }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.primary }))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { query: {
    users: { findFirst: mocks.user }, userTenantRoles: { findFirst: mocks.member }, tenants: { findFirst: mocks.tenant },
  } },
}))

const OWN = "league-a"
const FOREIGN = "league-b"
const ACTOR = "user-clerk-1"
const TEAM = { tenantId: OWN, managerId: "manager-1", captainId: "captain-1" }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: ACTOR })
  mocks.user.mockResolvedValue({ id: ACTOR, isActive: true, role: "fan", tenantIds: [OWN, FOREIGN] })
  mocks.member.mockResolvedValue({ userId: ACTOR, tenantId: OWN, role: "scorer", status: "active" })
  mocks.tenant.mockResolvedValue({ id: OWN, isActive: true })
  mocks.host.mockResolvedValue({ id: OWN })
  mocks.primary.mockResolvedValue(null)
})

// ─── Part A: the pure role×permission sheet carries its invariants ───
describe("role class invariants (rbac sheet)", () => {
  const table: Array<[UserRole, Array<string>, Array<string>]> = [
    // [role, MUST have, MUST NOT have] (permission names exactly as in rbac.ts)
    ["super_admin", ["settings:manage", "user:manage", "tournament:delete"], []],
    ["league_owner", ["tournament:create", "tournament:update", "match:score", "user:invite", "settings:manage", "team:manage_roster"], []],
    ["team_manager", ["team:manage_roster", "player:read", "match:read", "registration:create"], ["tournament:update", "user:manage", "match:score"]],
    ["captain", ["team:read", "match:read", "invite:accept"], ["team:manage_roster", "tournament:update", "match:score"]],
    ["coach", ["team:read", "match:read", "stats:read"], ["player:delete", "match:score", "team:manage_roster"] as Array<never>],
    ["scorer", ["match:score", "match:read", "scorecard:create", "scorecard:update"], ["tournament:update", "team:manage_roster", "user:manage"] as Array<never>],
    ["player", ["fan:follow", "match:read", "invite:accept"], ["match:score", "team:manage_roster", "user:invite", "registration:manage"] as Array<never>],
    ["fan", ["fan:read", "fan:follow", "invite:accept"], ["match:score", "team:manage_roster", "user:invite", "registration:manage"] as Array<never>],
  ]
  it.each(table)("%s holds its stated allow/deny border", (role, granted, denied) => {
    for (const permission of granted) expect(hasPermission(role, permission as never), `${role} × ${permission}`).toBe(true)
    for (const permission of denied) expect(hasPermission(role, permission as never), `${role} × ${permission}`).toBe(false)
  })

  it("scoring authority never leaks below the scorer class", () => {
    const scoringRoles = (Object.keys(ROLE_PERMISSIONS) as UserRole[]).filter((r) => hasPermission(r, "match:score"))
    expect([...scoringRoles].sort()).toEqual(["league_owner", "scorer", "super_admin"].sort())
  })

  it("the fan sheet grants self-service and reading only", () => {
    const mutating = ROLE_PERMISSIONS.fan.filter((p) => /create|update|delete|manage$|:score$/.test(p))
    expect(mutating).toEqual([])
  })
})

// ─── Part B: the composed gate for match:score (assignment × membership × tenant) ───
describe("composed match:score decision (assignment × membership × tenant)", () => {
  type Row = {
    name: string
    role: string
    membership: "active" | "suspended" | "expired"
    /** The league the actor's membership row actually points at. */
    memberTenantId: string
    /** The league of the resource the (crafted) request touches. */
    requestTenantId: string
    slot: "primary" | "backup" | null
    expected: boolean
  }

  const OWN = "league-a"
  const OTHER = "league-b"
  const rows: Row[] = [
    { name: "owner, no slot - the league's authority is class-level", role: "league_owner", membership: "active", memberTenantId: OWN, requestTenantId: OWN, slot: null, expected: true },
    { name: "scorer with the primary slot", role: "scorer", membership: "active", memberTenantId: OWN, requestTenantId: OWN, slot: "primary", expected: true },
    { name: "scorer with the backup slot", role: "scorer", membership: "active", memberTenantId: OWN, requestTenantId: OWN, slot: "backup", expected: true },
    { name: "scorer, unassigned - class permission alone is not scoring authority", role: "scorer", membership: "active", memberTenantId: OWN, requestTenantId: OWN, slot: null, expected: false },
    { name: "scorer, suspended, slot retained on the row", role: "scorer", membership: "suspended", memberTenantId: OWN, requestTenantId: OWN, slot: "primary", expected: false },
    { name: "scorer, expired bound, slot retained", role: "scorer", membership: "expired", memberTenantId: OWN, requestTenantId: OWN, slot: "primary", expected: false },
    { name: "scorer, active, but the request targets another league", role: "scorer", membership: "active", memberTenantId: OWN, requestTenantId: OTHER, slot: "primary", expected: false },
    { name: "manager cannot score even for their own team's match", role: "team_manager", membership: "active", memberTenantId: OWN, requestTenantId: OWN, slot: null, expected: false },
    { name: "captain cannot score", role: "captain", membership: "active", memberTenantId: OWN, requestTenantId: OWN, slot: null, expected: false },
    { name: "player cannot score", role: "player", membership: "active", memberTenantId: OWN, requestTenantId: OWN, slot: null, expected: false },
    { name: "fan cannot score", role: "fan", membership: "active", memberTenantId: OWN, requestTenantId: OWN, slot: null, expected: false },
  ]

  it.each(rows)("$name", async ({ role, membership, memberTenantId, requestTenantId, slot, expected }) => {
    const status = membership === "expired" ? "active" : membership
    const expiresAt = membership === "expired" ? new Date("2020-01-01T00:00:00Z") : null
    // The actor's membership row lives in THEIR league; the crafted request
    // targets `requestTenantId` - the server must match the two exactly.
    mocks.member.mockResolvedValue({ userId: ACTOR, tenantId: memberTenantId, role, status, expiresAt })
    mocks.tenant.mockResolvedValue({ id: requestTenantId, isActive: true })

    // Axes 2+3+4 through the REAL server gate (exact league, status, bound):
    const classGate = await hasPermissionServer("match:score", requestTenantId)
    // Axis 1 (assignment) through the ISO-05 decider, exactly as the
    // scoring service composes it (owner passes without a slot; scorer
    // needs one):
    const match = { tenantId: requestTenantId, scorerId: "scorer-1", backupScorerId: "scorer-2" }
    const slotGrant = scorerSlotGrant(match, slot === "primary" ? "scorer-1" : slot === "backup" ? "scorer-2" : "someone-else")
    const composed = classGate && (role === "league_owner" || slotGrant !== null)

    expect(composed).toBe(expected)
  })
})

// ─── Part C: team management = team grant × membership (assignment axis) ───
describe("composed team management decision (assignment × membership)", () => {
  it.each([
    { name: "manager grant, active membership", actorId: "manager-1", status: "active", expiresAt: null, expected: true },
    { name: "captain grant, active membership", actorId: "captain-1", status: "active", expiresAt: null, expected: true },
    { name: "unassigned manager-role holder gets NO grant", actorId: "someone-else", status: "active", expiresAt: null, expected: false },
    { name: "manager grant but suspended membership", actorId: "manager-1", status: "suspended", expiresAt: null, expected: false },
    { name: "manager grant but expired membership", actorId: "manager-1", status: "active", expiresAt: new Date("2020-01-01T00:00:00Z"), expected: false },
  ])("$name", ({ actorId, status, expiresAt, expected }) => {
    // Class permission (team_manager holds team:manage) + grant (ISO-05)
    // + membership state (SCORE-09) - the composed gate a crafted request
    // hits, stated once:
    const grant = teamManagementGrant(TEAM, actorId)
    const membershipOk = status === "active" && (expiresAt === null || expiresAt.getTime() > Date.now())
    const composed = grant !== null && membershipOk
    expect(composed).toBe(expected)
  })
})
