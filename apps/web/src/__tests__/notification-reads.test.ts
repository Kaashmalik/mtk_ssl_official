import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { notifications } from "@mtk/database"
import {
  requireNotificationMemberContext, resolveNotificationMemberContext,
  myNotificationFilter, readMyNotifications, readUnreadNotificationCount,
  markNotificationReadById, markAllNotificationsReadFor,
} from "@/lib/notification-reads"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), tenant: vi.fn(), select: vi.fn(), update: vi.fn(),
  user: vi.fn(), member: vi.fn(), league: vi.fn(), queries: [] as any[], state: {} as any,
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.tenant }))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: {
    select: mocks.select, update: mocks.update,
    query: { users: { findFirst: mocks.user }, userTenantRoles: { findFirst: mocks.member }, tenants: { findFirst: mocks.league } },
  },
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const ACTOR = "00000000-0000-4000-8000-000000000002"
const CLERK = "user_clerk_identity"
const NOTIFICATION = "00000000-0000-4000-8000-000000000003"
const actor = { id: ACTOR, clerkId: CLERK, isActive: true }
const member = { userId: ACTOR, tenantId: TENANT, role: "player", status: "active" }
const dialect = new PgDialect()

function selectChain(fields: any) {
  const record: any = { fields, params: [] }
  mocks.queries.push(record)
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    where: (where: any) => { Object.assign(record, dialect.sqlToQuery(where)); return chain },
    orderBy: () => chain,
    limit: (limit: number) => { record.limit = limit; return chain },
    then: (resolve: any, reject: any) => Promise.resolve(mocks.state.rows ?? []).then(resolve, reject),
  }
  return chain
}

function updateChain() {
  const record: any = { params: [] }
  mocks.queries.push(record)
  const chain: any = {
    set: (values: any) => { record.values = values; return chain },
    where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return Promise.resolve() },
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.state = { rows: [{ id: NOTIFICATION, title: "New match", readAt: null }] }
  mocks.auth.mockResolvedValue({ userId: CLERK })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.user.mockResolvedValue(actor)
  mocks.member.mockResolvedValue(member)
  mocks.league.mockResolvedValue({ id: TENANT, name: "League", isActive: true })
  mocks.select.mockImplementation(selectChain)
  mocks.update.mockImplementation(updateChain)
})

describe("Notification member context resolves the exact active league", () => {
  it("accepts an active non-owner membership with no management permission", async () => {
    expect(await requireNotificationMemberContext()).toEqual({
      tenantId: TENANT, actorId: ACTOR, clerkId: CLERK, role: "player",
    })
  })

  it("rejects an unauthenticated caller before any lookup", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(requireNotificationMemberContext()).rejects.toThrow("Unauthorized")
    expect(mocks.user).not.toHaveBeenCalled()
  })

  it("rejects when no active league resolves", async () => {
    mocks.tenant.mockResolvedValue(null)
    await expect(requireNotificationMemberContext()).rejects.toThrow("Tenant not found")
    expect(mocks.user).not.toHaveBeenCalled()
  })

  it.each([
    ["missing account", undefined, member, { id: TENANT, isActive: true }],
    ["inactive account", { ...actor, isActive: false }, member, { id: TENANT, isActive: true }],
    ["remapped session", { ...actor, clerkId: "other" }, member, { id: TENANT, isActive: true }],
    ["super-admin-only membership", actor, { ...member, role: "super_admin" }, { id: TENANT, isActive: true }],
    ["suspended membership", actor, { ...member, status: "suspended" }, { id: TENANT, isActive: true }],
    ["missing membership", actor, null, { id: TENANT, isActive: true }],
    ["foreign membership", actor, { ...member, tenantId: "other" }, { id: TENANT, isActive: true }],
    ["inactive league", actor, member, { id: TENANT, isActive: false }],
    ["missing league", actor, member, null],
  ])("fails closed for %s", async (_label, user, membership, league) => {
    mocks.user.mockResolvedValue(user)
    mocks.member.mockResolvedValue(membership)
    mocks.league.mockResolvedValue(league)
    await expect(requireNotificationMemberContext()).rejects.toThrow(/Forbidden/)
  })

  it("returns null (not a throw) for a confirmed non-member and propagates real failures", async () => {
    mocks.user.mockResolvedValue(undefined)
    expect(await resolveNotificationMemberContext()).toBeNull()
    mocks.user.mockRejectedValue(new Error("database unavailable"))
    await expect(resolveNotificationMemberContext()).rejects.toThrow("database unavailable")
  })

  it("returns null for an unauthenticated or league-less visitor", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    expect(await resolveNotificationMemberContext()).toBeNull()
    mocks.auth.mockResolvedValue({ userId: CLERK })
    mocks.tenant.mockResolvedValue(null)
    expect(await resolveNotificationMemberContext()).toBeNull()
  })
})

describe("Notification reads are scoped and bounded", () => {
  const context = { tenantId: TENANT, actorId: ACTOR, clerkId: CLERK, role: "player" as const }

  it("filters list rows by the actor and the exact active league", async () => {
    const rows = await readMyNotifications(context, 10)
    expect(mocks.queries[0].table).toBe(notifications)
    expect(mocks.queries[0].params).toEqual([ACTOR, TENANT, TENANT])
    expect(mocks.queries[0].limit).toBe(10)
    expect(rows).toHaveLength(1)
  })

  it("clamps the list limit and rejects out-of-range values", async () => {
    await readMyNotifications(context, 100)
    expect(mocks.queries[0].limit).toBe(100)
    await expect(readMyNotifications(context, 0)).rejects.toThrow()
    await expect(readMyNotifications(context, 101)).rejects.toThrow()
    await expect(readMyNotifications(context, 1.5)).rejects.toThrow()
  })

  it("counts unread rows with the tenant/ownership predicate", async () => {
    await readUnreadNotificationCount(context)
    expect(mocks.queries[0].params).toEqual([ACTOR, TENANT, TENANT])
  })

  it("the shared filter never references another tenant or actor", () => {
    const params = dialect.sqlToQuery(myNotificationFilter(ACTOR, TENANT)!).params
    expect(params).toEqual([ACTOR, TENANT, TENANT])
    expect(params).not.toContain("other")
  })

  it("marks one read only for a validated UUID inside the active league", async () => {
    await markNotificationReadById(context, NOTIFICATION)
    expect(mocks.queries[0].values).toMatchObject({ status: "read" })
    expect(mocks.queries[0].params).toEqual([NOTIFICATION, ACTOR, TENANT, TENANT])
  })

  it("rejects a crafted non-UUID notification id before any write", async () => {
    await expect(markNotificationReadById(context, "not-a-uuid")).rejects.toThrow()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("marks all unread rows read inside the active league", async () => {
    await markAllNotificationsReadFor(context)
    expect(mocks.queries[0].values).toMatchObject({ status: "read" })
    expect(mocks.queries[0].params).toEqual([ACTOR, TENANT, TENANT])
  })
})
