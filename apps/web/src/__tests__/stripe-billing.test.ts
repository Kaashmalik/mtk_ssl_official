import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHmac } from "crypto"
import { PgDialect } from "drizzle-orm/pg-core"
import { createSubscriptionIntent, expireCheckoutSession, settleCheckoutCompleted, verifyStripeSignature } from "@/lib/stripe-billing"

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  state: {
    selectResults: [] as unknown[][],
    updateResults: [] as unknown[][],
    insertResults: [] as unknown[][],
    records: [] as unknown[],
  },
}))

vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { transaction: mocks.transaction, select: mocks.select, update: mocks.update, insert: mocks.insert },
}))

const dialect = new PgDialect()

interface QueryRecord {
  kind: "select" | "update" | "insert" | "execute"
  params?: unknown[]
  setValues?: Record<string, unknown>
  values?: Record<string, unknown>
  result?: unknown[]
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state.selectResults = []
  mocks.state.updateResults = []
  mocks.state.insertResults = []
  mocks.state.records = []
  mocks.execute.mockImplementation(async (query: any) => {
    const converted = dialect.sqlToQuery(query)
    mocks.state.records.push({ kind: "execute", params: converted.params, sql: converted.sql } as QueryRecord)
    return []
  })
  mocks.select.mockImplementation(() => {
    const record: QueryRecord = { kind: "select", params: [] }
    mocks.state.records.push(record)
    const chain: any = {
      from: () => chain,
      where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
      for: () => chain,
      limit: () => Promise.resolve(mocks.state.selectResults.shift() ?? []),
    }
    return chain
  })
  mocks.update.mockImplementation(() => {
    const record: QueryRecord = { kind: "update", params: [], result: mocks.state.updateResults.shift() ?? [] }
    mocks.state.records.push(record)
    const chain: any = {
      set: (values: any) => { record.setValues = values; return chain },
      where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
      returning: () => Promise.resolve(record.result ?? []),
      then: (resolve: any, reject: any) => Promise.resolve(record.result ?? []).then(resolve, reject),
    }
    return chain
  })
  mocks.insert.mockImplementation(() => {
    const record: QueryRecord = { kind: "insert", result: mocks.state.insertResults.shift() ?? [] }
    mocks.state.records.push(record)
    const chain: any = {
      values: (values: any) => { record.values = values; return { returning: () => Promise.resolve(record.result ?? []) } },
      then: (resolve: any, reject: any) => Promise.resolve(record.result ?? []).then(resolve, reject),
    }
    return chain
  })
  mocks.transaction.mockImplementation(async (fn: any) => fn(mocks))
})

const queryRecords = () => mocks.state.records as QueryRecord[]
// ─── Webhook signature ────────────────────────────────────────

const SECRET = "whsec_test"
const BODY = `{"type":"checkout.session.completed"}`
const sign = (payload: string) => createHmac("sha256", SECRET).update(payload).digest("hex")

function headerFor(payload: string, timestampSeconds: number) {
  return `t=${timestampSeconds},v1=${sign(`${timestampSeconds}.${payload}`)}`
}

describe("stripe webhook signature follows the signed-payload scheme", () => {
  const nowMs = Date.now()
  const fresh = Math.floor(nowMs / 1000)

  it("accepts a valid current signature", () => {
    expect(verifyStripeSignature({ secret: SECRET, header: headerFor(BODY, fresh), body: BODY, nowMs })).toEqual({ ok: true })
  })

  it("accepts when one of several v1 signatures matches", () => {
    const header = `t=${fresh},v1=${"f".repeat(64)},v1=${sign(`${fresh}.${BODY}`)}`
    expect(verifyStripeSignature({ secret: SECRET, header, body: BODY, nowMs })).toEqual({ ok: true })
  })

  it.each([
    ["tampered body", headerFor(BODY + " ", fresh), BODY + "x"],
    ["wrong secret", `t=${fresh},v1=${createHmac("sha256", "whsec_attacker").update(`${fresh}.${BODY}`).digest("hex")}`, BODY],
  ])("rejects %s in constant time", (_label, header, body) => {
    expect(verifyStripeSignature({ secret: SECRET, header, body, nowMs })).toEqual({ ok: false, reason: "invalid" })
  })

  it("rejects a replay older than the five-minute tolerance", () => {
    const stale = fresh - 301
    expect(verifyStripeSignature({ secret: SECRET, header: headerFor(BODY, stale), body: BODY, nowMs })).toEqual({ ok: false, reason: "outside_tolerance" })
  })

  it("rejects a missing or malformed header", () => {
    expect(verifyStripeSignature({ secret: SECRET, header: "", body: BODY, nowMs })).toEqual({ ok: false, reason: "missing_header" })
    expect(verifyStripeSignature({ secret: SECRET, header: `v1=${sign(`${fresh}.${BODY}`)}`, body: BODY, nowMs })).toEqual({ ok: false, reason: "missing_header" })
  })
})

// ─── Checkout intent ──────────────────────────────────────────

const TENANT = "00000000-0000-4000-8000-000000000001"
const OWNER = "00000000-0000-4000-8000-000000000002"

describe("checkout intent creation is serialized per league", () => {
  const input = { tenantId: TENANT, userId: OWNER, requestedPlan: "pro", currentPlan: "free", amount: 14999 }

  it("creates the pending request under the tenant lock", async () => {
    const intent = { id: "req-1", tenantId: TENANT }
    mocks.state.insertResults = [[intent]]

    const result = await createSubscriptionIntent(input)
    expect(result).toEqual({ intent })

    const [lock, , insert] = queryRecords()
    expect(lock.kind).toBe("execute")
    expect(String(lock.params)).toContain(TENANT)
    expect(insert.values).toMatchObject({
      tenantId: TENANT, userId: OWNER, requestedPlan: "pro", currentPlan: "free",
      amount: "14999", paymentMethod: "stripe", status: "pending",
      paymentProofUrl: "stripe://pending",
    })
    expect(mocks.select).toHaveBeenCalledTimes(1)
  })

  it("returns conflict without inserting when a request is already pending", async () => {
    mocks.state.selectResults = [[{ id: "existing" }]]
    const result = await createSubscriptionIntent(input)
    expect(result).toEqual({ conflict: true })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(1) // tenant lock still held
  })
})

// ─── Settlement ───────────────────────────────────────────────

const REQUEST_ID = "00000000-0000-4000-8000-000000000003"
const futureExpiry = { expiresAt: new Date(Date.now() + 60_000) }

const pendingRequest = (amount = "14999", requestedPlan = "pro", lease = futureExpiry) => ({
  id: REQUEST_ID, tenantId: TENANT, userId: OWNER, status: "pending",
  currentPlan: "free", requestedPlan, amount, ...lease,
})

const paidSessionWith = (amountTotal: number) => ({
  id: "cs_test_1", metadata: { requestId: REQUEST_ID }, payment_status: "paid", amount_total: amountTotal, currency: "pkr",
})

describe("checkout settlement is idempotent and amount-verified", () => {
  it("ignores events without a request reference or unpaid sessions", async () => {
    expect(await settleCheckoutCompleted({ payment_status: "paid" })).toBe("ignored")
    expect(await settleCheckoutCompleted({ metadata: { requestId: REQUEST_ID } })).toBe("ignored")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("short-circuits resolved requests without any write", async () => {
    mocks.state.selectResults = [[{ ...pendingRequest(), status: "approved" }]]
    expect(await settleCheckoutCompleted(paidSessionWith(1499900))).toBe("already_resolved")
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("expires a pending request past its checkout window", async () => {
    mocks.state.selectResults = [[pendingRequest("14999", "pro", { expiresAt: new Date(Date.now() - 1000) })]]
    expect(await settleCheckoutCompleted(paidSessionWith(1499900))).toBe("expired_request")
    const updates = queryRecords().filter((r) => r.kind === "update")
    expect(updates[0].setValues).toMatchObject({ status: "expired" })
  })

  it("rejects when the paid amount does not match the recorded request", async () => {
    mocks.state.selectResults = [[pendingRequest()]]
    await expect(settleCheckoutCompleted(paidSessionWith(99900))).rejects.toThrow("Stripe amount does not match subscription request")
  })

  it("rejects an amount that is not a valid monthly or annual plan price", async () => {
    // Request amount says monthly, but the paid amount maps to neither 1x nor 10x.
    mocks.state.selectResults = [[{ ...pendingRequest("12300"), currentPlan: "free" }]]
    await expect(settleCheckoutCompleted(paidSessionWith(1230000))).rejects.toThrow("not a valid monthly or annual plan price")
  })

  it("settles a valid payment: claims pending, upgrades plan, upserts subscription, records payment", async () => {
    mocks.state.selectResults = [[pendingRequest()], []] // request row, no existing subscription
    mocks.state.updateResults = [[{ id: REQUEST_ID }]] // claim wins

    expect(await settleCheckoutCompleted(paidSessionWith(1499900))).toBe("settled")

    const updates = queryRecords().filter((r) => r.kind === "update")
    const [claim, planUpdate] = updates
    // The claim predicate carries status = "pending" (idempotency).
    expect(claim.setValues).toMatchObject({ status: "approved" })
    expect(String(claim.params)).toContain("pending")
    expect(planUpdate.setValues).toEqual({ plan: "pro", updatedAt: expect.any(Date) })

    const inserts = queryRecords().filter((r) => r.kind === "insert")
    expect(mocks.insert).toHaveBeenCalledTimes(2)
    // Subscription insert (upsert path) carries the period-bounding fields.
    expect(inserts[0].values).toMatchObject({
      tenantId: TENANT, plan: "pro", status: "active", monthlyAmount: "14999",
      currency: "PKR", paymentMethod: "stripe",
    })
    expect("currentPeriodEnd" in (inserts[0].values as object)).toBe(true)
    // Payment insert records the settled amount and the Stripe references.
    expect(inserts[1].values).toMatchObject({
      amount: "14999", currency: "PKR", status: "completed", paymentType: "subscription", externalPaymentId: "cs_test_1",
    })
  })

  it("keeps the existing subscription row when one is already present", async () => {
    mocks.state.selectResults = [[pendingRequest()], [{ id: "sub-1", tenantId: TENANT }]]
    mocks.state.updateResults = [[{ id: REQUEST_ID }]]
    expect(await settleCheckoutCompleted(paidSessionWith(1499900))).toBe("settled")
    const inserts = queryRecords().filter((r) => r.kind === "insert")
    expect(inserts).toHaveLength(1) // only the payment row; subscription updated in place
  })
})

describe("checkout session expiry", () => {
  it("expires only a still-pending request and ignores missing references", async () => {
    await expireCheckoutSession(null)
    expect(mocks.update).not.toHaveBeenCalled()

    await expireCheckoutSession(REQUEST_ID)
    const [record] = queryRecords().filter((r) => r.kind === "update")
    expect(record.setValues).toMatchObject({ status: "expired" })
    expect(String(record.params)).toContain("pending")
  })
})
