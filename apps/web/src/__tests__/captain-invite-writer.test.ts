import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * REG-05 (Batch 134): captain-invitation redemption assigns the team's
 * captain pointer under the same lock + null-or-self guarantee as the
 * manager path; a manager invitation still targets managerId and rejects a
 * foreign manager pointer; a player invitation writes no team pointer at
 * all. The membership insert carries the invited role verbatim.
 */

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  inviteFindFirst: vi.fn(),
  recipientFindFirst: vi.fn(),
  membershipFindFirst: vi.fn(),
  leagueFindFirst: vi.fn(),
  teamFindFirst: vi.fn(),
  otherTeamFindFirst: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  returning: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  auditValues: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: "u-recipient" })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({
  resolveActiveTenantId: vi.fn(async () => TENANT),
  requirePermissionServer: vi.fn(async () => undefined),
}))

const st = vi.hoisted(() => ({
  invite: null as Record<string, unknown> | null,
  claimed: null as Array<Record<string, unknown>> | null,
}))

vi.mock("@mtk/database", async original => ({
  ...await original<typeof import("@mtk/database")>(),
  db: {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({
      execute: mocks.execute,
      update: mocks.update,
      insert: mocks.insert,
      query: {
        userInvites: { findFirst: mocks.inviteFindFirst },
        users: { findFirst: mocks.recipientFindFirst },
        userTenantRoles: { findFirst: mocks.membershipFindFirst },
        tenants: { findFirst: mocks.leagueFindFirst },
        teams: { findFirst: mocks.teamFindFirst },
      },    }),
  },
  auditLogs: {},
  notifications: {},
}))

import { claimInvite } from "@/lib/invite-records"

const TENANT = "00000000-0000-4000-8000-000000000001"
const ACTOR = "00000000-0000-4000-8000-000000000003"
const TEAM = "00000000-0000-4000-8000-000000000002"
const OWNER = "00000000-0000-4000-8000-000000000004"

function chain(role: "team_manager" | "captain" | "player", opts: { captainId: string | null; managerId: string | null; hasMembership: boolean }) {
  const invite = {
    id: "00000000-0000-4000-8000-000000000005", tenantId: TENANT, email: "invited@example.test",
    role, teamId: role === "player" ? null : TEAM, tokenHash: "tok", invitedBy: OWNER,
    status: "pending", expiresAt: new Date(Date.now() + 86_400_000), membershipExpiresAt: null,
  }
  st.invite = invite
  st.claimed = [{ id: invite.id }]
  mocks.inviteFindFirst.mockResolvedValue(invite)
  // Two users reads in order: lockInvitationAuthority's ISSUER (the league
  // owner that issued the invite), then the RECIPIENT accepting it.
  let userCall = 0
  mocks.recipientFindFirst.mockImplementation(async () => {
    userCall += 1
    if (userCall === 1) return { id: OWNER, isActive: true }
    return { id: ACTOR, clerkId: "u-recipient", isActive: true }
  })
  mocks.leagueFindFirst.mockResolvedValue({ id: TENANT, isActive: true })
  // Two membership reads: the issuer's (owner authority), then the
  // recipient's (existing membership, when the test wants one).
  let memberCall = 0
  mocks.membershipFindFirst.mockImplementation(async () => {
    memberCall += 1
    if (memberCall === 1) {
      return { userId: OWNER, tenantId: TENANT, role: "league_owner", status: "active", expiresAt: null }
    }
    return opts.hasMembership
      ? { id: "00000000-0000-4000-8000-000000000006", userId: ACTOR, tenantId: TENANT, role, status: "active", expiresAt: null }
      : null
  })
  mocks.teamFindFirst.mockResolvedValue({
    id: TEAM, tenantId: TENANT, isActive: true, managerId: opts.managerId, captainId: opts.captainId,
  })
  mocks.otherTeamFindFirst.mockResolvedValue(null)
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: () => ({ returning: mocks.returning }) })
  mocks.returning.mockResolvedValue(st.claimed)
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue(undefined)
}

beforeEach(() => {
  vi.clearAllMocks()
})

const verifiedProvider = {
  id: "u-recipient",
  emailAddresses: [{ emailAddress: "invited@example.test", verification: { status: "verified" } }],
}

const input = () => ({
  clerkId: "u-recipient",
  provider: verifiedProvider,
  actor: { id: ACTOR, clerkId: "u-recipient" },
  initial: { id: "00000000-0000-4000-8000-000000000005", tenantId: TENANT, invitedBy: OWNER, tokenHash: "tok" } as never,
  tokenHash: "tok",
})

describe("captain invitation redemption (Batch 134, REG-05)", () => {
  it("assigns the team captain pointer, not the manager pointer", async () => {
    chain("captain", { captainId: null, managerId: OWNER, hasMembership: false })
    await expect(claimInvite(input() as never)).resolves.toMatchObject({ role: "captain", tenantId: TENANT })
    const setCalls = mocks.set.mock.calls.map(call => call[0] as Record<string, unknown>)
    expect(setCalls.some(payload => payload.captainId === ACTOR)).toBe(true)
    expect(setCalls.some(payload => payload.managerId === ACTOR)).toBe(false)
    // the membership row carries the captain role
    const memberValues = mocks.values.mock.calls
      .map(call => call[0] as Record<string, unknown> | undefined)
      .find(values => values && values.role !== undefined)
    expect((memberValues as Record<string, unknown> | undefined)?.role).toBe("captain")
  })

  it("refuses a captain invitation when the pointer is held by someone else", async () => {
    chain("captain", { captainId: OWNER, managerId: null, hasMembership: false })
    await expect(claimInvite(input() as never)).rejects.toThrow("already has a different captain")
  })

  it("still routes manager invitations to the manager pointer and its guards", async () => {
    chain("team_manager", { captainId: OWNER, managerId: OWNER, hasMembership: false })
    await expect(claimInvite(input() as never)).rejects.toThrow("different manager")
  })

  it("a player invitation writes no team pointer", async () => {
    chain("player", { captainId: OWNER, managerId: OWNER, hasMembership: false })
    await expect(claimInvite(input() as never)).resolves.toMatchObject({ role: "player" })
    const setCalls = mocks.set.mock.calls.map(call => call[0] as Record<string, unknown>)
    expect(setCalls.some(payload => payload.captainId !== undefined || payload.managerId !== undefined)).toBe(false)
  })
})
