import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { PgDialect } from "drizzle-orm/pg-core"
import { hashOtp, OTP_MAX_PER_HOUR, OTP_TTL_MS } from "@/lib/otp"
import { sendOtp, verifyLatestOtp } from "@/lib/otp-verification"

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  dispatch: vi.fn(),
  state: {
    selectResults: [] as unknown[][],
    updateResults: [] as unknown[][],
    insertValues: undefined as unknown,
  },
}))

vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { select: mocks.select, update: mocks.update, insert: mocks.insert },
}))
vi.mock("@/lib/otp", async (original) => ({
  ...await original<typeof import("@/lib/otp")>(),
  dispatchOtp: mocks.dispatch,
}))

const dialect = new PgDialect()

interface QueryRecord {
  kind: "select" | "update" | "insert"
  params?: unknown[]
  setValues?: Record<string, unknown>
  result?: unknown[]
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state.selectResults = []
  mocks.state.updateResults = []
  mocks.state.insertValues = undefined
  mocks.dispatch.mockResolvedValue({ mock: false })
  mocks.select.mockImplementation(() => {
    const record: QueryRecord = { kind: "select", params: [] }
    const chain: any = {
      from: () => chain,
      where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
      orderBy: () => chain,
      limit: () => Promise.resolve(mocks.state.selectResults.shift() ?? []),
      then: (resolve: any, reject: any) => Promise.resolve(mocks.state.selectResults.shift() ?? []).then(resolve, reject),
    }
    return chain
  })
  mocks.update.mockImplementation(() => {
    const record: QueryRecord = { kind: "update", result: mocks.state.updateResults.shift() ?? [] }
    const chain: any = {
      set: (values: any) => { record.setValues = values; return chain },
      where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
      returning: () => Promise.resolve(record.result ?? []),
      then: (resolve: any, reject: any) => Promise.resolve(record.result ?? []).then(resolve, reject),
    }
    updateRecords.push(record)
    return chain
  })
  mocks.insert.mockImplementation(() => ({
    values: (values: any) => {
      mocks.state.insertValues = values
      return Promise.resolve([])
    },
  }))
})

// Retrieve update records without disturbing the shared select queue.
const updateRecords: QueryRecord[] = []

beforeEach(() => {
  updateRecords.length = 0
})

const IDENT = "user@example.com"
const CODE = "123456"
const tokenRow = (overrides: Record<string, unknown> = {}) => ({
  id: "tok-1", identifier: IDENT, purpose: "registration", attempts: 0, maxAttempts: 5,
  tokenHash: hashOtp(IDENT, CODE), createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
  ...overrides,
})

// ─── sendOtp ──────────────────────────────────────────────────

describe("otp issue flow", () => {
  it("mints a hashed token inside the TTL and dispatches it", async () => {
    mocks.state.selectResults = [[]] // no recent requests

    const before = Date.now()
    const result = await sendOtp({ identifier: IDENT, channel: "email", purpose: "registration" })

    expect(result).toEqual({ ok: true, mock: false })
    const values = mocks.state.insertValues as Record<string, unknown>
    expect(values).toMatchObject({ identifier: IDENT, channel: "email", purpose: "registration" })
    expect(typeof values.tokenHash).toBe("string")
    expect(values.tokenHash).not.toContain(".")
    const expiry = (values.expiresAt as Date).getTime()
    expect(expiry - before).toBeGreaterThanOrEqual(OTP_TTL_MS - 1000)
    expect(expiry - before).toBeLessThanOrEqual(OTP_TTL_MS + 1000)
  })

  it("rate limits beyond the hourly cap per identifier+purpose", async () => {
    mocks.state.selectResults = [Array.from({ length: OTP_MAX_PER_HOUR }, (_, i) => ({ id: `t${i}`, createdAt: new Date() }))]
    expect(await sendOtp({ identifier: IDENT, channel: "sms", purpose: "registration" })).toEqual({ ok: false, reason: "rate_limited" })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it("enforces the resend cooldown on the most recent request", async () => {
    mocks.state.selectResults = [[{ id: "t1", createdAt: new Date(Date.now() - 10_000) }]] // 10s ago
    expect(await sendOtp({ identifier: IDENT, channel: "sms", purpose: "registration" })).toEqual({ ok: false, reason: "cooldown" })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("sends again once the cooldown window has passed", async () => {
    mocks.state.selectResults = [[{ id: "t1", createdAt: new Date(Date.now() - 61_000) }]] // 61s ago
    expect(await sendOtp({ identifier: IDENT, channel: "sms", purpose: "registration" })).toEqual({ ok: true, mock: false })
  })
})

// ─── verifyLatestOtp ──────────────────────────────────────────

describe("otp verification flow", () => {
  it("answers not_found when no unverified unexpired token exists", async () => {
    mocks.state.selectResults = [[]]
    expect(await verifyLatestOtp({ identifier: IDENT, purpose: "registration", code: CODE })).toEqual({ ok: false, reason: "not_found" })
  })

  it("refuses an already-exhausted token without a verification attempt", async () => {
    mocks.state.selectResults = [[tokenRow({ attempts: 5 })]]
    expect(await verifyLatestOtp({ identifier: IDENT, purpose: "registration", code: CODE })).toEqual({ ok: false, reason: "exhausted" })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("verifies a correct code and stamps the token", async () => {
    mocks.state.selectResults = [[tokenRow()]]
    expect(await verifyLatestOtp({ identifier: IDENT, purpose: "registration", code: CODE })).toEqual({ ok: true })
    const [record] = updateRecords
    expect(record.setValues).toHaveProperty("verifiedAt", expect.any(Date))
  })

  it("claims the wrong-attempt increment under the cap predicate", async () => {
    mocks.state.selectResults = [[tokenRow({ attempts: 1 })]] // token with hash of CODE; we submit a wrong code
    mocks.state.updateResults = [[{ attempts: 2 }]]

    const result = await verifyLatestOtp({ identifier: IDENT, purpose: "registration", code: "000000" })
    expect(result).toEqual({ ok: false, reason: "wrong", remaining: 3 })

    const [record] = updateRecords
    expect(record.setValues).toEqual({ attempts: 2 })
    // Optimistic claim: the increment only applies from the observed attempt
    // count, so concurrent wrong guesses cannot both land past the cap.
    expect(record.params).toEqual(["tok-1", 1, 1])
  })

  it("reports exhausted when a concurrent guess consumed the last attempt", async () => {
    mocks.state.selectResults = [[tokenRow({ attempts: 4 })]]
    mocks.state.updateResults = [[]] // predicated increment lost the race

    expect(await verifyLatestOtp({ identifier: IDENT, purpose: "registration", code: "000000" })).toEqual({ ok: false, reason: "exhausted" })
  })
})

// ─── Route mapping ────────────────────────────────────────────

const { POST: sendPost } = await import("@/app/api/auth/otp/send/route")
const { POST: verifyPost } = await import("@/app/api/auth/otp/verify/route")

const post = (path: string, body: unknown) =>
  new NextRequest(`https://app.test${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  } as ConstructorParameters<typeof NextRequest>[1])

describe("otp route mappings", () => {
  it("send: 400 on invalid input", async () => {
    const response = await sendPost(post("/otp/send", { identifier: "ab", channel: "carrier-pigeon" }))
    expect(response.status).toBe(400)
  })

  it("verify: 400/429/200 mapping", async () => {
    mocks.state.selectResults = [[tokenRow()]]
    expect((await verifyPost(post("/otp/verify", { identifier: IDENT, code: "123456" }))).status).toBe(200)

    mocks.state.selectResults = [[tokenRow({ attempts: 5 })]]
    expect((await verifyPost(post("/otp/verify", { identifier: IDENT, code: CODE }))).status).toBe(429)

    mocks.state.selectResults = [[]]
    expect((await verifyPost(post("/otp/verify", { identifier: IDENT, code: CODE }))).status).toBe(400)
  })
})
