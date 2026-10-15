import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { users, tenants, whiteLabelRequests } from "@mtk/database"
import { requestWhiteLabel } from "@/app/actions/white-label"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), resolveActiveTenant: vi.fn(), select: vi.fn(), insert: vi.fn(),
  withoutTenantContext: vi.fn(), withTenantContext: vi.fn(), getPlanLimits: vi.fn(),
  rows: {} as any, inserted: [] as any[], queries: [] as any[],
}))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.resolveActiveTenant, requirePermissionServer: vi.fn() }))
vi.mock("@/app/actions/action-guard", () => ({ withAuth: (_permission: string, handler: any) => handler }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: () => { throw new Error("getMyTenant must not be used") } }))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { select: mocks.select, insert: mocks.insert },
  withTenantContext: mocks.withTenantContext,
  withoutTenantContext: mocks.withoutTenantContext,
  getPlanLimits: mocks.getPlanLimits,
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000ff"
const ACTOR = "00000000-0000-4000-8000-000000000002"
const REQUEST = "00000000-0000-4000-8000-000000000004"
const dialect = new PgDialect()

function rowsFor(record: any) {
  if (record.table === tenants) return mocks.rows.tenants
  if (record.table === users) return mocks.rows.users
  if (record.table === whiteLabelRequests) return mocks.rows.whiteLabel
  return []
}

function selectChain() {
  const record: any = { params: [] }
  mocks.queries.push(record)
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
    limit: () => chain,
    then: (resolve: any, reject: any) => Promise.resolve(rowsFor(record)).then(resolve, reject),
  }
  return chain
}

function insertChain() {
  const chain: any = {
    values: (values: any) => { mocks.inserted.push(values); return chain },
    returning: () => Promise.resolve([{ id: REQUEST, status: "pending" }]),
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.inserted.length = 0
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.resolveActiveTenant.mockResolvedValue(TENANT)
  mocks.rows = {
    tenants: [{ id: TENANT, plan: "pro" }],
    users: [{ id: ACTOR }],
    whiteLabel: [],
  }
  mocks.select.mockImplementation(selectChain)
  mocks.insert.mockImplementation(insertChain)
  mocks.withoutTenantContext.mockImplementation(async (cb: any) => cb())
  mocks.withTenantContext.mockImplementation(async (_context: any, cb: any) => cb())
  mocks.getPlanLimits.mockReturnValue({ whiteLabel: true, customDomain: true })
})

describe("requestWhiteLabel targets the exact active league", () => {
  it("resolves the active league and never the account's primary league", async () => {
    const result = await requestWhiteLabel({ customAppName: "Premier", hideBranding: false })
    expect(mocks.resolveActiveTenant).toHaveBeenCalled()
    const tenantQuery = mocks.queries.find((query) => query.table === tenants)!
    expect(tenantQuery.params).toEqual([TENANT, true])
    expect(tenantQuery.params).not.toContain(OTHER_TENANT)
    expect(mocks.inserted[0]).toMatchObject({ tenantId: TENANT, requestedBy: ACTOR, status: "pending" })
    expect(result).toEqual({ success: true, request: { id: REQUEST, status: "pending" } })
  })

  it("fails closed when there is no active league and writes nothing", async () => {
    mocks.resolveActiveTenant.mockResolvedValue(null)
    await expect(requestWhiteLabel({ hideBranding: true })).rejects.toThrow("League not found")
    expect(mocks.inserted).toHaveLength(0)
  })

  it("enforces plan limits against the resolved league's plan", async () => {
    mocks.rows.tenants = [{ id: TENANT, plan: "free" }]
    mocks.getPlanLimits.mockReturnValue({ whiteLabel: false, customDomain: false })
    await expect(requestWhiteLabel({ hideBranding: true })).rejects.toThrow("Pro plan or above")
    expect(mocks.inserted).toHaveLength(0)
  })

  it("refuses a second pending request for the same league", async () => {
    mocks.rows.whiteLabel = [{ id: REQUEST }]
    await expect(requestWhiteLabel({ hideBranding: false, customDomain: "league.example.com" })).rejects.toThrow("awaiting review")
    expect(mocks.inserted).toHaveLength(0)
  })
})
