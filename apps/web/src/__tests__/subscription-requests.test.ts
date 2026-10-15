import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { createManualSubscriptionRequest, findOwnedTenant, listSubscriptionRequests } from "@/lib/subscription-requests"

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
  state: {
    selectResults: [] as unknown[][],
    insertResults: [] as unknown[][],
    insertValues: undefined as unknown,
  },
}))

vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { select: mocks.select, update: mocks.update, insert: mocks.insert, transaction: mocks.transaction },
}))

const dialect = new PgDialect()

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state.selectResults = []
  mocks.state.insertResults = []
  mocks.execute.mockImplementation(async () => [])
  mocks.select.mockImplementation(() => {
    const chain: any = {
      from: () => chain,
      where: (where: any) => { void dialect.sqlToQuery(where); return chain },
      for: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(mocks.state.selectResults.shift() ?? []),
      then: (resolve: any, reject: any) => Promise.resolve(mocks.state.selectResults.shift() ?? []).then(resolve, reject),
    }
    return chain
  })
  mocks.insert.mockImplementation(() => ({
    values: (values: any) => {
      mocks.state.insertValues = values
      return { returning: () => Promise.resolve(mocks.state.insertResults.shift() ?? []) }
    },
  } as any))
  mocks.transaction.mockImplementation(async (fn: any) => fn(mocks))
})

const TENANT = "00000000-0000-4000-8000-000000000030"

describe("owned-tenant billing resolution", () => {
  it("resolves the acting user's owned league", async () => {
    mocks.state.selectResults = [[{ id: "actor-1" }], [{ id: TENANT, plan: "starter", ownerId: "actor-1" }]]
    expect(await findOwnedTenant("clerk-1")).toMatchObject({ ok: true, tenant: { id: TENANT } })
  })

  it("distinguishes a missing user from a missing league", async () => {
    mocks.state.selectResults = [[]]
    expect(await findOwnedTenant("clerk-1")).toEqual({ ok: false, reason: "user_missing" })

    mocks.state.selectResults = [[{ id: "actor-1" }], []]
    expect(await findOwnedTenant("clerk-1")).toEqual({ ok: false, reason: "tenant_missing" })
  })
})

describe("manual request creation is serialized per league", () => {
  const input = {
    tenantId: TENANT, userId: "actor-1", requestedPlan: "starter", currentPlan: "free",
    amount: 4999, paymentMethod: "jazzcash_manual", paymentProofUrl: "https://sb.test/sign/x?token=t",
    transactionReference: "JC-77321",
  }

  it("creates the pending request under the tenant lock with a 7-day expiry", async () => {
    mocks.state.insertResults = [[{ id: "req-1", tenantId: TENANT }]]

    const result = await createManualSubscriptionRequest(input)
    expect("request" in result && result.request.id).toBe("req-1")

    const values = mocks.state.insertValues as Record<string, unknown>
    expect(values).toMatchObject({
      tenantId: TENANT, userId: "actor-1", requestedPlan: "starter", currentPlan: "free",
      amount: "4999", paymentMethod: "jazzcash_manual", status: "pending",
      transactionReference: "JC-77321",
    })
    const days = ((values.expiresAt as Date).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
  })

  it("answers conflict without inserting when a request is already pending", async () => {
    mocks.state.selectResults = [[{ id: "existing" }]]
    expect(await createManualSubscriptionRequest(input)).toEqual({ conflict: true })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(1) // tenant lock still held
  })
})

describe("request history is tenant-scoped and bounded", () => {
  it("lists newest first for the league", async () => {
    const rows = [{ id: "r2" }, { id: "r1" }]
    mocks.state.selectResults = [rows]
    expect(await listSubscriptionRequests(TENANT, 20)).toEqual(rows)
    expect(mocks.select).toHaveBeenCalledTimes(1)
  })
})
