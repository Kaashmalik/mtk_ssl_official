import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import {
  GRACE_DAYS,
  daysUntil,
  fillTemplate,
  runRenewalSweep,
  secretsMatch,
} from "@/lib/subscription-renewal"

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
  state: {
    selectResults: [] as unknown[][],
    updateResults: [] as unknown[][],
    records: [] as unknown[],
  },
}))

vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { select: mocks.select, update: mocks.update, insert: mocks.insert, transaction: mocks.transaction },
}))

const dialect = new PgDialect()

interface QueryRecord {
  kind: "select" | "update" | "insert"
  params?: unknown[]
  sql?: string
  setValues?: Record<string, unknown>
  values?: Record<string, unknown>
  result?: unknown[]
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state.selectResults = []
  mocks.state.updateResults = []
  mocks.state.records = []
  mocks.select.mockImplementation(() => {
    const record: QueryRecord = { kind: "select", params: [] }
    mocks.state.records.push(record)
    const chain: any = {
      from: () => chain,
      where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
      for: () => chain,
      limit: () => Promise.resolve(mocks.state.selectResults.shift() ?? []),
      then: (resolve: any, reject: any) => Promise.resolve(mocks.state.selectResults.shift() ?? []).then(resolve, reject),
    }
    return chain
  })
  mocks.update.mockImplementation(() => {
    const record: QueryRecord = { kind: "update", params: [], result: mocks.state.updateResults.shift() ?? [] }
    mocks.state.records.push(record)
    const chain: any = {
      set: (values: any) => { record.setValues = values; return chain },
      where: (where: any) => {
        const converted = dialect.sqlToQuery(where)
        record.params = converted.params
        record.sql = converted.sql
        return chain
      },
      returning: () => Promise.resolve(record.result ?? []),
      then: (resolve: any, reject: any) => Promise.resolve(record.result ?? []).then(resolve, reject),
    }
    return chain
  })
  mocks.insert.mockImplementation(() => {
    const record: QueryRecord = { kind: "insert" }
    mocks.state.records.push(record)
    const chain: any = {
      values: (values: any) => { record.values = values; return { returning: () => Promise.resolve([]) } },
      then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
    }
    return chain
  })
  mocks.transaction.mockImplementation(async (fn: any) => fn(mocks))
})

const queryRecords = () => mocks.state.records as QueryRecord[]

const NOW = new Date("2026-10-15T03:00:00.000Z")
const atDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000)
const sub = (overrides: Record<string, unknown> = {}) => ({
  id: "sub-1", tenantId: "t-1", plan: "pro", status: "active", currentPeriodEnd: atDays(7), ...overrides,
})

// ─── Pure helpers ─────────────────────────────────────────────

describe("renewal helpers", () => {
  it("computes whole days until a deadline (floor)", () => {
    expect(daysUntil(atDays(7), NOW)).toBe(7)
    expect(daysUntil(new Date(NOW.getTime() + 6.5 * 86_400_000), NOW)).toBe(6)
    expect(daysUntil(new Date(NOW.getTime() - 8 * 86_400_000), NOW)).toBe(-8)
  })

  it("fills plan and grace-day templates", () => {
    expect(fillTemplate("Plan: {plan}. Renew within {graceDays} days.", "pro")).toBe(`Plan: pro. Renew within ${GRACE_DAYS} days.`)
  })

  it("compares secrets in constant time and across lengths", () => {
    expect(secretsMatch("secret-cron", "secret-cron")).toBe(true)
    expect(secretsMatch("secret-wrong", "secret-cron")).toBe(false)
    expect(secretsMatch("s", "much-longer-secret")).toBe(false) // no throw on length mismatch
  })
})

// ── Renewal sweep ───────────────────────────────────────────

describe("renewal sweep: notify pass", () => {
  it("writes one tenant-wide in-app notification per un-guarded bucket", async () => {
    mocks.state.selectResults = [[sub({ status: "past_due", currentPeriodEnd: atDays(3) })], []] // candidates, no recent notifications

    const result = await runRenewalSweep(NOW)
    expect(result).toMatchObject({ processed: 1, notified: 1, markedPastDue: 0 })

    const [insert] = queryRecords().filter((r) => r.kind === "insert")
    expect(insert.values).toMatchObject({
      tenantId: "t-1", type: "renewal_d3", channel: "in_app", status: "delivered",
      body: "Plan: pro. Renew to keep live streaming and scoring active.",
    })
  })

  it("flips only active subscriptions past their period to past_due", async () => {
    mocks.state.selectResults = [[sub({ currentPeriodEnd: atDays(-0.5) })], []]
    await runRenewalSweep(NOW)

    const flip = queryRecords().find((r) => r.kind === "update")
    expect(flip?.setValues).toMatchObject({ status: "past_due" })
    // The write re-checks status and period so a just-settled payment survives.
    expect(flip?.params).toEqual(["sub-1", "active", NOW.toISOString()])
    // -0.5 days floored to -1 lands in the grace bucket, so a notification goes out too.
    expect(mocks.insert).toHaveBeenCalledTimes(1)
  })

  it("never flips an already past_due subscription and skips buckets with no match", async () => {
    mocks.state.selectResults = [[sub({ status: "past_due", currentPeriodEnd: atDays(2) })], []]
    const result = await runRenewalSweep(NOW)
    expect(result.markedPastDue).toBe(0)
    expect(result.notified).toBe(0) // days=2 is between d3 and d1 buckets
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("is idempotent: a bucket already notified in the last 36h is skipped", async () => {
    mocks.state.selectResults = [[sub()], [{ id: "n-1" }]] // candidates, recent notification found
    const result = await runRenewalSweep(NOW)
    expect(result.notified).toBe(0)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})

describe("renewal sweep: grace-window enforcement", () => {
  it("pauses the subscription and downgrades the tenant in one transaction", async () => {
    mocks.state.selectResults = [
      [], // notify candidates: none
      [sub({ status: "past_due", currentPeriodEnd: atDays(-(GRACE_DAYS + 3)) })], // delinquent
    ]
    mocks.state.updateResults = [[{ id: "sub-1" }]] // claim wins

    const result = await runRenewalSweep(NOW)
    expect(result).toMatchObject({ paused: 1, downgraded: 1 })

    const updates = queryRecords().filter((r) => r.kind === "update")
    const [claim, downgrade] = updates
    // Claim carries the live-status predicate — a concurrent sweep cannot double-pause.
    expect(claim.setValues).toMatchObject({ status: "paused" })
    expect(String(claim.params)).toContain("past_due")
    expect(downgrade.setValues).toEqual({ plan: "free", updatedAt: NOW })
  })

  it("re-checks the expiry inside the pause claim so a just-renewed subscription is untouched", async () => {
    mocks.state.selectResults = [[], [sub({ status: "past_due", currentPeriodEnd: atDays(-(GRACE_DAYS + 3)) })]]
    mocks.state.updateResults = [[{ id: "sub-1" }]]
    await runRenewalSweep(NOW)
    const [claim] = queryRecords().filter((r) => r.kind === "update")
    const cutoff = new Date(NOW.getTime() - GRACE_DAYS * 86_400_000)
    expect(claim.params).toContain(cutoff.toISOString())
    expect(claim.sql).toContain("current_period_end")
  })

  it("does not downgrade the tenant when the pause claim loses the race", async () => {
    mocks.state.selectResults = [
      [], // notify candidates: none
      [sub()], // delinquent
    ]
    mocks.state.updateResults = [[]] // claim lost

    const result = await runRenewalSweep(NOW)
    expect(result.paused).toBe(0)
    expect(result.downgraded).toBe(0)
    expect(mocks.update).toHaveBeenCalledTimes(1) // only the failed claim; no tenants write
  })

  it("sweeps with zero candidates without touching writes", async () => {
    mocks.state.selectResults = [[], [], []]
    const result = await runRenewalSweep(NOW)
    expect(result).toEqual({ processed: 0, notified: 0, markedPastDue: 0, paused: 0, downgraded: 0 })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

// ─── Cron route auth gate ────────────────────────────────────

const { GET } = await import("@/app/api/cron/subscription-renewal/route")

const cronRequest = (header?: string) =>
  new Request("https://app.example/api/cron/subscription-renewal", {
    headers: header ? { authorization: header } : {},
  })

describe("cron route authenticates the invocation and fails closed", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("refuses with 503 when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "")
    const response = await GET(cronRequest("Bearer anything"))
    expect(response.status).toBe(503)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("answers 401 on a wrong bearer token before any read", async () => {
    vi.stubEnv("CRON_SECRET", "secret-cron")
    const response = await GET(cronRequest("Bearer nope"))
    expect(response.status).toBe(401)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("answers 401 when the authorization header is missing entirely", async () => {
    vi.stubEnv("CRON_SECRET", "secret-cron")
    const response = await GET(cronRequest())
    expect(response.status).toBe(401)
  })

  it("runs the sweep and reports counters on a valid bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "secret-cron")
    mocks.state.selectResults = [[], [], []]
    const response = await GET(cronRequest("Bearer secret-cron"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true, processed: 0, notified: 0, markedPastDue: 0, paused: 0, downgraded: 0,
    })
  })

  it("answers 500 and leaks nothing when the sweep fails", async () => {
    vi.stubEnv("CRON_SECRET", "secret-cron")
    mocks.select.mockImplementation(() => { throw new Error("db down") })
    const response = await GET(cronRequest("Bearer secret-cron"))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Cron failed" })
  })
})
