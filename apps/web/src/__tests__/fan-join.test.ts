import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * ENH-02-03 (fan-only joining): the approved fan entry command grants a
 * membership with `role: "fan"` and NOTHING else — no operational rights, no
 * expiry tricks, no staff-invite reuse, no ownership change. The command must
 * be idempotent and truthful: an account that already has ANY membership row
 * (fan, scorer, league_owner) never gets a second row, and the reply says so.
 */

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}))

const { joinLeagueAsFan } = await import("@/app/actions/tenants")
const { db, userTenantRoles } = await import("@mtk/database")

const USER = "da7c0ab5-0810-482a-a92c-886a87754b20"
const TENANT = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"

/** Queues outer select results in call order: [account, tenant, membership]. */
function queueOuterSelects(rows: unknown[][]) {
  const select = vi.fn()
  rows.forEach((r) => select.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: async () => r,
      }),
    }),
  }))
  ;(db as any).select = select
  return select
}

function insertHarness(returningRows: unknown[] = []) {
  const values = vi.fn((_granted: Record<string, unknown>) => ({
    onConflictDoNothing: () => ({
      returning: async () => returningRows,
    }),
  }))
  ;(db as any).insert = vi.fn(() => ({ values }))
  return { values }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk-1" })
})

describe("joinLeagueAsFan (ENH-02-03)", () => {
  it("grants a plain active fan membership and nothing else", async () => {
    queueOuterSelects([
      [{ id: USER, isActive: true, role: "fan" }],
      [{ id: TENANT, slug: "the-league", isActive: true }],
      [],
    ])
    const { values } = insertHarness([{ userId: USER, tenantId: TENANT, role: "fan" }])

    const result = await joinLeagueAsFan({ slug: "the-league" })

    expect(result).toEqual({ joined: true, role: "fan" })
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER,
      tenantId: TENANT,
      role: "fan",
      status: "active",
      isPrimary: false,
    }))
    // A fan join is a membership, not a bounded delegation or an invite.
    const granted = values.mock.calls[0][0]
    expect(granted.expiresAt).toBeNull()
    expect(granted.delegatedByUserId).toBeNull()
    expect(db.update).not.toHaveBeenCalled()
  })

  it("is idempotent: an existing row of any role is never doubled or altered", async () => {
    queueOuterSelects([
      [{ id: USER, isActive: true, role: "fan" }],
      [{ id: TENANT, slug: "the-league", isActive: true }],
      [{ userId: USER, tenantId: TENANT, role: "league_owner", status: "active" }],
    ])

    const result = await joinLeagueAsFan({ slug: "the-league" })

    expect(result).toEqual({ joined: false, role: "league_owner" })
    expect(db.insert).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
  })

  it("answers truthfully when a parallel request won the insert race", async () => {
    queueOuterSelects([
      [{ id: USER, isActive: true, role: "fan" }],
      [{ id: TENANT, slug: "the-league", isActive: true }],
      [],
      [{ role: "fan" }],
    ])
    insertHarness([])

    const result = await joinLeagueAsFan({ slug: "the-league" })

    expect(result).toEqual({ joined: false, role: "fan" })
  })

  it("refuses unknown or deactivated leagues", async () => {
    queueOuterSelects([
      [{ id: USER, isActive: true, role: "fan" }],
      [],
    ])

    await expect(joinLeagueAsFan({ slug: "mystery-league" })).rejects.toThrow(/not found or is not open/)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it("refuses an inactive account", async () => {
    queueOuterSelects([[{ id: USER, isActive: false }]])

    await expect(joinLeagueAsFan({ slug: "the-league" })).rejects.toThrow(/inactive/)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it("refuses an unauthenticated caller without any read", async () => {
    mocks.auth.mockResolvedValue({})

    await expect(joinLeagueAsFan({ slug: "the-league" })).rejects.toThrow()
    expect(db.select).not.toHaveBeenCalled()
  })

  it("never writes a staff role (fan is the ceiling of this command)", async () => {
    queueOuterSelects([
      [{ id: USER, isActive: true, role: "fan" }],
      [{ id: TENANT, slug: "the-league", isActive: true }],
      [],
    ])
    const { values } = insertHarness([{}])

    await joinLeagueAsFan({ slug: "the-league" })

    const granted = values.mock.calls[0][0]
    expect(granted.role).toBe("fan")
    expect(["scorer", "captain", "league_owner", "super_admin"]).not.toContain(granted.role)
    expect(userTenantRoles).toBeDefined()
  })
})
