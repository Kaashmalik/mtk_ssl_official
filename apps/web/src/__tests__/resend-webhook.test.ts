import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ verify: vi.fn(), apply: vi.fn() }))
vi.mock("svix", () => ({ Webhook: class { verify(...args: unknown[]) { return mocks.verify(...args) } } }))
vi.mock("@/lib/invitation-delivery", () => ({ applyInvitationDeliveryEvent: mocks.apply }))

import { GET, POST } from "@/app/api/webhooks/resend/route"

const svixHeaders = { "svix-id": "id", "svix-timestamp": "1", "svix-signature": "sig" }
const makeReq = (headers: Record<string, string>, body = "{}") => ({
  headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
  text: async () => body,
}) as never

beforeEach(() => {
  vi.resetAllMocks()
  mocks.apply.mockResolvedValue({ applied: true, inviteId: "invite", state: "delivered" })
})
afterEach(() => { vi.unstubAllEnvs() })

describe("Resend delivery webhook", () => {
  it("fails closed with 503 when the signing secret is unset", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "")
    const res = await POST(makeReq(svixHeaders))
    expect(res.status).toBe(503)
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
  })
  it("rejects a request without Svix headers before verifying", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test")
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it("rejects an unverifiable signature without applying it", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test")
    mocks.verify.mockImplementation(() => { throw new Error("bad signature") })
    const res = await POST(makeReq(svixHeaders))
    expect(res.status).toBe(400)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
  it("applies a verified event and returns the recorded outcome", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test")
    const event = { type: "email.delivered", data: { tags: [{ name: "invite_id", value: "invite" }] } }
    mocks.verify.mockReturnValue(event)
    const res = await POST(makeReq(svixHeaders, JSON.stringify(event)))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ received: true, applied: true, state: "delivered" })
    expect(mocks.apply).toHaveBeenCalledWith(event)
  })
  it("returns 500 on update failure without leaking the error or payload", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test")
    mocks.verify.mockReturnValue({ type: "email.bounced", data: {} })
    mocks.apply.mockRejectedValue(new Error("db down"))
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await POST(makeReq(svixHeaders))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain("db down")
    err.mockRestore()
  })
  it("exposes a GET health check", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ endpoint: "resend-webhook" })
  })
})
