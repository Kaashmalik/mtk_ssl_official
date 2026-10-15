import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { PgDialect } from "drizzle-orm/pg-core"

const dialect = new PgDialect()

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  headerGet: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  insertValues: undefined as unknown,
  conflictSet: undefined as Record<string, unknown> | undefined,
  updateSet: undefined as unknown,
  updateWhereSql: undefined as unknown,
}))

vi.mock("svix", () => ({
  Webhook: class {
    verify = mocks.verify
  },
}))
vi.mock("next/headers", () => ({
  headers: () => ({ get: mocks.headerGet }),
}))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { insert: mocks.insert, update: mocks.update },
}))

import { GET, POST } from "@/app/api/webhooks/clerk/route"

const webhookReq = (init?: { body?: string }) =>
  new NextRequest("https://app.test/api/webhooks/clerk", {
    method: "POST",
    ...init,
  } as ConstructorParameters<typeof NextRequest>[1])

beforeEach(() => {
  vi.resetAllMocks()
  mocks.insertValues = undefined
  mocks.conflictSet = undefined
  mocks.updateSet = undefined
  mocks.updateWhereSql = undefined
  vi.stubEnv("CLERK_WEBHOOK_SECRET", "whsec_test")
  mocks.headerGet.mockImplementation((name: string) => {
    if (name === "svix-id") return "msg_1"
    if (name === "svix-timestamp") return String(Math.floor(Date.now() / 1000))
    if (name === "svix-signature") return "v1,sig"
    return null
  })
  mocks.insert.mockImplementation(() => ({
    values: (values: any) => {
      mocks.insertValues = values
      return {
        onConflictDoUpdate: (arg: any) => {
          mocks.conflictSet = arg.set
          return Promise.resolve([])
        },
      }
    },
  }))
  mocks.update.mockImplementation(() => ({
    set: (values: any) => {
      mocks.updateSet = values
      return {
        where: (where: any) => {
          mocks.updateWhereSql = dialect.sqlToQuery(where).sql
          return Promise.resolve([])
        },
      }
    },
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("clerk webhook gates", () => {
  it("exposes a health alias for dashboard verification", async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ endpoint: "clerk-webhook", status: "active" })
  })

  it("fails closed with 500 when no Svix secret is configured", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", "")
    vi.stubEnv("CLERK_SECRET_KEY", "")
    const response = await POST(webhookReq({ body: "{}" }))
    expect(response.status).toBe(500)
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it("answers 400 when Svix headers are missing", async () => {
    mocks.headerGet.mockReturnValue(null)
    const response = await POST(webhookReq({ body: "{}" }))
    expect(response.status).toBe(400)
  })

  it("answers 400 on a bad signature without touching the database", async () => {
    mocks.verify.mockImplementation(() => { throw new Error("bad signature") })
    const response = await POST(webhookReq({ body: "{}" }))
    expect(response.status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe("clerk webhook event sync", () => {
  it("inserts a fan account on user.created (no last_login backfill)", async () => {
    mocks.verify.mockReturnValue({
      type: "user.created",
      data: {
        id: "user_1",
        email_addresses: [{ email_address: "fan@example.com" }],
        first_name: "Ali",
        last_name: "Raza",
        image_url: "https://img.example/a.png",
      },
    })
    const response = await POST(webhookReq({ body: "{}" }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, type: "user.created" })
    expect(mocks.insertValues).toMatchObject({
      clerkId: "user_1", email: "fan@example.com", displayName: "Ali Raza",
      role: "fan", isActive: true, lastLoginAt: null, avatarUrl: "https://img.example/a.png",
    })
    expect(mocks.conflictSet).toMatchObject({ email: "fan@example.com" })
    expect(mocks.conflictSet?.lastLoginAt).toBeUndefined() // no login backfill on create
  })

  it("falls back to username for display names and stamps login on updates", async () => {
    mocks.verify.mockReturnValue({
      type: "user.updated",
      data: { id: "user_2", email_addresses: [{ email_address: "u2@example.com" }], username: "ali92" },
    })
    const response = await POST(webhookReq({ body: "{}" }))

    expect(response.status).toBe(200)
    expect(mocks.insertValues).toMatchObject({ clerkId: "user_2", displayName: "ali92" })
    expect(mocks.conflictSet).toHaveProperty("lastLoginAt", expect.any(Date))
  })

  it("soft-deletes on user.deleted (isActive false, row retained)", async () => {
    mocks.verify.mockReturnValue({ type: "user.deleted", data: { id: "user_3" } })
    const response = await POST(webhookReq({ body: "{}" }))

    expect(response.status).toBe(200)
    expect(mocks.updateSet).toMatchObject({ isActive: false })
    expect(mocks.updateWhereSql).toContain("clerk_id")
  })

  it("ignores other event types without any write", async () => {
    mocks.verify.mockReturnValue({ type: "session.created", data: { id: "sess_1" } })
    const response = await POST(webhookReq({ body: "{}" }))

    expect(response.status).toBe(200)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
