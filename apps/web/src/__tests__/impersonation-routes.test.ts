import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { PgDialect } from "drizzle-orm/pg-core"

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  update: vi.fn(),
  updateResults: [] as unknown[][],
  records: [] as Array<{ setValues?: Record<string, unknown>; params: unknown[]; result: unknown[] }>,
  select: vi.fn(),
  selectResult: [] as unknown[],
}))

vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  verifyImpersonationToken: mocks.verify,
  db: { update: mocks.update, select: mocks.select },
}))

import { GET } from "@/app/api/impersonation/session/route"
import { POST } from "@/app/api/impersonation/exit/route"
import { claimIssuedImpersonationSession, revokeImpersonationSession } from "@/lib/impersonation-ledger"

const JTI = "jti-123"
const TOKEN = "cGF5bG9hZA.sig"
const TARGET_ID = "target-user"
const TARGET_EMAIL = "target@example.test"
const WEB_COOKIE = "__ssl_impersonating"
const dialect = new PgDialect()

interface UpdateRecord { setValues?: Record<string, unknown>; params: unknown[]; result: unknown[] }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.updateResults.length = 0
  mocks.records.length = 0
  mocks.selectResult = []
  mocks.verify.mockResolvedValue({ ok: true, payload: { jti: JTI, targetUserId: TARGET_ID, targetEmail: TARGET_EMAIL } })
  mocks.update.mockImplementation(() => {
    const record: UpdateRecord = { params: [], result: mocks.updateResults.shift() ?? [] }
    mocks.records.push(record)
    const chain: any = {
      set: (values: any) => { record.setValues = values; return chain },
      where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
      returning: () => Promise.resolve(record.result),
    }
    return chain
  })
  mocks.select.mockReturnValue({
    from: () => ({ where: () => ({ limit: () => Promise.resolve(mocks.selectResult) }) }),
  })
})

function updateRecords(): UpdateRecord[] {
  return mocks.records as UpdateRecord[]
}

const sessionRequest = (query = `?token=${encodeURIComponent(TOKEN)}`) =>
  GET(new NextRequest(`http://localhost/api/impersonation/session${query}`))

const exitRequest = (body?: unknown) =>
  POST(new Request("http://localhost/api/impersonation/exit", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  }))

const cookieValue = (res: NextResponse) => res.cookies.get(WEB_COOKIE)?.value ?? null

/** Next's cookies.delete() emits an empty value rather than removing the entry. */
const cookieCleared = (res: NextResponse) => {
  const value = res.cookies.get(WEB_COOKIE)?.value
  return value === undefined || value === ""
}

describe("impersonation session claim is single-use and race-safe", () => {
  it("requires a token before anything else", async () => {
    const res = await sessionRequest("")
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "token is required" })
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("rejects an invalid token with its reason, before the ledger", async () => {
    mocks.verify.mockResolvedValue({ ok: false, reason: "expired" })
    const res = await sessionRequest()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Invalid or expired token (expired)" })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("claims the issued ledger row atomically and returns the target identity", async () => {
    mocks.updateResults = [[{ jti: JTI, adminEmail: "admin@example.test" }]]
    mocks.selectResult = [{ id: TARGET_ID, email: TARGET_EMAIL, displayName: "Target" }]

    const res = await sessionRequest()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      success: true,
      target: { id: TARGET_ID, email: TARGET_EMAIL, displayName: "Target" },
      adminEmail: "admin@example.test",
      jti: JTI,
    })

    const [record] = updateRecords()
    // The race fix: the claim predicate carries status = "issued" inside the UPDATE.
    expect(record.setValues).toMatchObject({ status: "active", consumedAt: expect.any(Date) })
    expect(record.params).toContain("issued")
    expect(await cookieValue(res)).toBe(JSON.stringify({ email: TARGET_EMAIL, jti: JTI }))
    expect(res.cookies.get(WEB_COOKIE)?.httpOnly).toBe(true)
    expect(res.cookies.get(WEB_COOKIE)?.sameSite).toBe("lax")
    expect(res.cookies.get(WEB_COOKIE)?.path).toBe("/")
  })

  it("answers 409 without a cookie when the claim loses (already used/revoked/concurrent)", async () => {
    const res = await sessionRequest()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "Token already used or revoked" })
    expect(cookieValue(res)).toBeNull()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("fails closed with 500 and no cookie when the ledger errors", async () => {
    mocks.update.mockImplementation(() => {
      throw new Error("Database unavailable")
    }) as unknown as typeof mocks.update
    const res = await sessionRequest()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Failed to start impersonation" })
    expect(cookieValue(res)).toBeNull()
  })
})

describe("impersonation exit clears the marker on every path", () => {
  it("clears the cookie without touching the ledger when no token is supplied", async () => {
    const res = await exitRequest()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(cookieCleared(res)).toBe(true)
  })

  it("revokes only a live session for a valid token and clears the cookie", async () => {
    mocks.updateResults = [[{ id: "row-1" }]]
    const res = await exitRequest({ token: TOKEN })
    expect(res.status).toBe(200)
    const [record] = updateRecords()
    expect(record.setValues).toMatchObject({ status: "revoked", revokedAt: expect.any(Date) })
    expect(record.params).toContain("active")
    expect(record.params).toContain("issued")
    expect(cookieCleared(res)).toBe(true)
  })

  it("ignores an invalid token but still clears the cookie", async () => {
    mocks.verify.mockResolvedValue({ ok: false, reason: "bad_signature" })
    const res = await exitRequest({ token: "forged" })
    expect(res.status).toBe(200)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(cookieCleared(res)).toBe(true)
  })

  it("clears the cookie even when the ledger errors", async () => {
    mocks.verify.mockRejectedValue(new Error("Database unavailable"))
    const res = await exitRequest({ token: TOKEN })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Failed to exit impersonation" })
    expect(cookieCleared(res)).toBe(true)
  })
})

describe("impersonation ledger primitives", () => {
  it("claim returns null when the predicate did not match", async () => {
    expect(await claimIssuedImpersonationSession(JTI)).toBeNull()
    expect(await claimIssuedImpersonationSession(JTI)).toBeNull()
  })

  it("revoke reports false when the session is already resolved", async () => {
    expect(await revokeImpersonationSession(JTI)).toBe(false)
    mocks.updateResults = [[{ id: "row-1" }]]
    expect(await revokeImpersonationSession(JTI)).toBe(true)
  })
})
