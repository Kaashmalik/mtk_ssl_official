import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isSuperAdmin: vi.fn(),
  list: vi.fn(),
  retry: vi.fn(),
  resolve: vi.fn(),
  select: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/super-admin", () => ({ isSuperAdmin: mocks.isSuperAdmin }))
vi.mock("@/lib/notification-jobs-admin", () => ({
  listNotificationJobDeadLetters: mocks.list,
  retryNotificationJob: mocks.retry,
  resolveNotificationJob: mocks.resolve,
}))
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.select },
}))

import { GET, POST } from "@/app/api/admin/notification-jobs/route"

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const JOB = "00000000-0000-4000-8000-0000000000c1"
const ACTOR = "00000000-0000-4000-8000-0000000000d1"

const get = (query = "") =>
  new Request(`https://app.test/api/admin/notification-jobs${query}`)
const post = (body: unknown) =>
  new Request("https://app.test/api/admin/notification-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk_1" })
  mocks.isSuperAdmin.mockResolvedValue(true)
  mocks.list.mockResolvedValue([])
  mocks.retry.mockResolvedValue({ ok: true, id: JOB, state: "pending" })
  mocks.resolve.mockResolvedValue({ ok: true, id: JOB, state: "cancelled" })
  mocks.select.mockReturnValue({
    from: () => ({ where: () => ({ limit: async () => [{ id: ACTOR }] }) }),
  })
})

describe("ENH-06-04: admin dead-letter route", () => {
  it("rejects anonymous callers", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    expect((await GET(get())).status).toBe(401)
    expect((await POST(post({ action: "retry", id: JOB }))).status).toBe(401)
  })

  it("rejects a signed-in non-super-admin", async () => {
    mocks.isSuperAdmin.mockResolvedValue(false)
    expect((await GET(get())).status).toBe(403)
    expect((await POST(post({ action: "retry", id: JOB }))).status).toBe(403)
  })

  it("validates the tenant filter and limit before reading", async () => {
    expect((await GET(get("?tenantId=nope"))).status).toBe(400)
    expect((await GET(get("?limit=0"))).status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it("returns the tenant-scoped dead-letter head", async () => {
    const response = await GET(get(`?tenantId=${TENANT}&limit=25`))
    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({ tenantId: TENANT, limit: 25 })
    expect(await response.json()).toEqual({ jobs: [] })
  })

  it("retries one job as the recorded platform actor", async () => {
    const response = await POST(post({ action: "retry", id: JOB, tenantId: TENANT }))
    expect(response.status).toBe(200)
    expect(mocks.retry).toHaveBeenCalledWith({
      id: JOB, tenantId: TENANT, actorId: ACTOR, actorRole: "super_admin",
    })
    expect(await response.json()).toMatchObject({ ok: true, state: "pending" })
  })

  it("resolves with the operator note", async () => {
    const response = await POST(post({ action: "resolve", id: JOB, note: "recipient deleted" }))
    expect(response.status).toBe(200)
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({
      id: JOB, actorId: ACTOR, actorRole: "super_admin", note: "recipient deleted",
    }))
  })

  it("maps a non-dead job to 409 and a missing one to 404", async () => {
    mocks.retry.mockResolvedValueOnce({ ok: false, reason: "not_dead_lettered" })
    expect((await POST(post({ action: "retry", id: JOB }))).status).toBe(409)
    mocks.retry.mockResolvedValueOnce({ ok: false, reason: "not_found" })
    expect((await POST(post({ action: "retry", id: JOB }))).status).toBe(404)
  })

  it("refuses malformed actions and an actor without a database row", async () => {
    expect((await POST(post({ action: "delete", id: JOB }))).status).toBe(400)
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) })
    expect((await POST(post({ action: "retry", id: JOB }))).status).toBe(403)
    expect(mocks.retry).not.toHaveBeenCalled()
  })
})
