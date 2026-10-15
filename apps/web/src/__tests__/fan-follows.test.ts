import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { fanFollows, teams, players, tournaments } from "@mtk/database"
import { followEntity, unfollowEntity } from "@/app/actions/follows"
import {
  requireFanContext, assertFollowableInLeague, followFanEntity, unfollowFanEntity,
  getFanFollowerCount, isFanFollowing, getMyFollowingFanEntities,
} from "@/lib/fan-follows"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), tenant: vi.fn(), permission: vi.fn(), revalidate: vi.fn(),
  select: vi.fn(), insert: vi.fn(), values: vi.fn(), onConflict: vi.fn(), remove: vi.fn(), deleteWhere: vi.fn(),
  user: vi.fn(), member: vi.fn(), league: vi.fn(), queries: [] as any[], state: {} as any,
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.tenant, requirePermissionServer: mocks.permission }))
vi.mock("@mtk/database", async (original) => ({ ...await original<typeof import("@mtk/database")>(), db: {
  select: mocks.select, insert: mocks.insert, delete: mocks.remove,
  query: { users: { findFirst: mocks.user }, userTenantRoles: { findFirst: mocks.member }, tenants: { findFirst: mocks.league } } } }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const ACTOR = "00000000-0000-4000-8000-000000000002"
const TEAM = "00000000-0000-4000-8000-000000000003"
const PLAYER = "00000000-0000-4000-8000-000000000004"
const TOURNAMENT = "00000000-0000-4000-8000-000000000005"
const CLERK = "user_clerk_identity"
const actor = { id: ACTOR, clerkId: CLERK, isActive: true }
const member = { userId: ACTOR, tenantId: TENANT, role: "fan", status: "active" }
const dialect = new PgDialect()

function selectChain(fields: any) {
  const record: any = { fields, params: [] }
  mocks.queries.push(record)
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    where: (where: any) => { Object.assign(record, dialect.sqlToQuery(where)); return chain },
    limit: (limit: number) => { record.limit = limit; return chain },
    orderBy: (...order: any[]) => { record.orders = order.map(q => dialect.sqlToQuery(q)); return chain },
    then: (resolve: any, reject: any) => {
      const keys = Object.keys(fields ?? {})
      let rows: any[] = []
      if (record.table === fanFollows && fields === undefined) rows = mocks.state.myFollowing
      else if (keys.includes("total")) rows = [{ total: mocks.state.total }]
      else if (record.table === fanFollows) rows = mocks.state.existing ? [{ id: "follow" }] : []
      else rows = mocks.state.found ? [{ id: record.params[0] }] : []
      return Promise.resolve(rows).then(resolve, reject)
    },
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.state = { actor, member, league: { id: TENANT, isActive: true }, found: true, existing: false,
    total: "0", myFollowing: [] }
  mocks.auth.mockResolvedValue({ userId: CLERK })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockImplementation(async () => mocks.state.actor)
  mocks.member.mockImplementation(async () => "member" in mocks.state ? mocks.state.member : member)
  mocks.league.mockImplementation(async () => mocks.state.league)
  mocks.select.mockImplementation(selectChain)
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockImplementation((row: any) => ({ onConflictDoNothing: mocks.onConflict, row }))
  mocks.onConflict.mockResolvedValue(undefined)
  mocks.remove.mockReturnValue({ where: mocks.deleteWhere })
  mocks.deleteWhere.mockResolvedValue(undefined)
})

describe("Follow writes use the exact active league and the account UUID", () => {
  it("stores the account UUID and active tenant and is idempotent under the unique index", async () => {
    await expect(followEntity(TENANT, "team", TEAM)).resolves.toEqual({ success: true, action: "followed" })
    expect(mocks.permission).toHaveBeenCalledWith("fan:follow", TENANT)
    const inserted = mocks.values.mock.calls[0][0]
    expect(inserted).toMatchObject({ tenantId: TENANT, userId: ACTOR, followableType: "team", followableId: TEAM })
    expect(inserted.userId).not.toBe(CLERK)
    expect(mocks.onConflict).toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalled()
    expect(mocks.revalidate.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.values.mock.invocationCallOrder[0])
  })
  it("returns already_following without inserting a duplicate", async () => {
    mocks.state.existing = true
    await expect(followEntity(TENANT, "player", PLAYER)).resolves.toEqual({ success: true, action: "already_following" })
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("rejects a client tenant that differs from the active league", async () => {
    await expect(followEntity(PLAYER, "team", TEAM)).rejects.toThrow("Invalid tenant")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("rejects an unauthenticated caller before any read", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(followEntity(TENANT, "team", TEAM)).rejects.toThrow("Unauthorized")
    expect(mocks.permission).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("rejects a missing account and a non-fan-eligible membership", async () => {
    mocks.state.actor = undefined
    await expect(followEntity(TENANT, "team", TEAM)).rejects.toThrow("account unavailable")
    mocks.state.actor = actor
    mocks.state.member = null
    await expect(followEntity(TENANT, "team", TEAM)).rejects.toThrow("access unavailable")
    mocks.state.member = { ...member, status: "suspended" }
    await expect(followEntity(TENANT, "team", TEAM)).rejects.toThrow("access unavailable")
    mocks.state.member = { ...member, role: "super_admin" }
    await expect(followEntity(TENANT, "team", TEAM)).rejects.toThrow("access unavailable")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("rejects an inactive league and a denied permission before writing", async () => {
    mocks.state.league = { id: TENANT, isActive: false }
    await expect(followEntity(TENANT, "team", TEAM)).rejects.toThrow("access unavailable")
    mocks.state.league = { id: TENANT, isActive: true }
    mocks.permission.mockImplementation(async (_permission: string, tenantId?: string) => { if (tenantId) throw new Error("Forbidden") })
    await expect(followEntity(TENANT, "team", TEAM)).rejects.toThrow("Forbidden")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it.each([["team", TEAM], ["player", PLAYER], ["tournament", TOURNAMENT]] as const)(
    "rejects a foreign or missing %s target before writing", async (type, id) => {
      mocks.state.found = false
      await expect(followEntity(TENANT, type, id)).rejects.toThrow("unavailable in this league")
      expect(mocks.insert).not.toHaveBeenCalled()
    })
  it("rejects invalid type/id before any database read", async () => {
    await expect(followEntity(TENANT, "match" as any, TEAM)).rejects.toThrow()
    await expect(followEntity(TENANT, "team", "not-a-uuid")).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("scopes the unfollow to the active league and account UUID", async () => {
    await expect(unfollowEntity("team", TEAM)).resolves.toEqual({ success: true, action: "unfollowed" })
    const params = dialect.sqlToQuery(mocks.deleteWhere.mock.calls[0][0]).params
    expect(params).toEqual([TENANT, ACTOR, "team", TEAM])
    expect(params).not.toContain(CLERK)
    expect(mocks.revalidate).toHaveBeenCalled()
  })
  it("refuses an unfollow from a missing/ineligible membership", async () => {
    mocks.state.member = { ...member, status: "pending" }
    await expect(unfollowEntity("team", TEAM)).rejects.toThrow("access unavailable")
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})

describe("Follow reads are exact-league scoped and identity-correct", () => {
  it("assertFollowableInLeague requires the same tenant", async () => {
    await expect(assertFollowableInLeague(TENANT, "tournament", TOURNAMENT)).resolves.toBeUndefined()
    mocks.state.found = false
    await expect(assertFollowableInLeague(TENANT, "tournament", TOURNAMENT)).rejects.toThrow("unavailable in this league")
    expect(mocks.queries.at(-1).params).toEqual([TOURNAMENT, TENANT])
  })
  it("counts followers by the active league and returns zero for invalid ids or no tenant", async () => {
    mocks.state.total = "3"
    await expect(getFanFollowerCount("player", PLAYER)).resolves.toBe(3)
    expect(mocks.queries.at(-1).params).toEqual([TENANT, "player", PLAYER])
    await expect(getFanFollowerCount("player", "nope")).resolves.toBe(0)
    mocks.tenant.mockResolvedValue(null)
    await expect(getFanFollowerCount("player", PLAYER)).resolves.toBe(0)
  })
  it("reads current-user state from the account UUID, never the Clerk identity", async () => {
    mocks.state.total = "1"
    await expect(isFanFollowing("team", TEAM)).resolves.toBe(true)
    expect(mocks.queries.at(-1).params).toEqual([TENANT, ACTOR, "team", TEAM])
    expect(mocks.queries.at(-1).params).not.toContain(CLERK)
    mocks.state.total = "0"
    await expect(isFanFollowing("team", TEAM)).resolves.toBe(false)
  })
  it("treats unsigned or tenant-less follow state as false", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(isFanFollowing("team", TEAM)).resolves.toBe(false)
    mocks.auth.mockResolvedValue({ userId: CLERK })
    mocks.tenant.mockResolvedValue(null)
    await expect(isFanFollowing("team", TEAM)).resolves.toBe(false)
    mocks.tenant.mockResolvedValue(TENANT)
    await expect(isFanFollowing("team", "bad-id")).resolves.toBe(false)
  })
  it("lists the account's own follows in the server-resolved league", async () => {
    mocks.state.myFollowing = [{ id: "f1", userId: ACTOR, tenantId: TENANT, followableType: "team", followableId: TEAM }]
    await expect(getMyFollowingFanEntities()).resolves.toHaveLength(1)
    expect(mocks.queries.at(-1).params).toEqual([TENANT, ACTOR])
    expect(mocks.queries.at(-1).params).not.toContain(CLERK)
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(getMyFollowingFanEntities()).resolves.toEqual([])
  })
  it("exposes the context to callers with the resolved tenant and permission", async () => {
    await expect(requireFanContext()).resolves.toMatchObject({ tenantId: TENANT, actorId: ACTOR, clerkId: CLERK, role: "fan" })
  })
})
