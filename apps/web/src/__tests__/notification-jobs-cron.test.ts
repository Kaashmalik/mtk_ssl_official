import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  processJobs: vi.fn(),
  secretsMatch: vi.fn(),
}))

vi.mock("@/lib/notification-jobs", () => ({
  processNotificationJobs: mocks.processJobs,
}))
vi.mock("@/lib/subscription-renewal", () => ({
  secretsMatch: mocks.secretsMatch,
}))

import { GET } from "@/app/api/cron/notification-jobs/route"

const req = (authorization?: string) =>
  new Request("https://app.test/api/cron/notification-jobs", {
    headers: authorization ? { authorization } : {},
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("CRON_SECRET", "cron-secret")
  mocks.secretsMatch.mockImplementation((provided: string, expected: string) => provided === expected)
  mocks.processJobs.mockResolvedValue({
    enabled: true, claimed: 0, accepted: 0, cancelled: 0, retrying: 0, deadLettered: 0,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("ENH-06-04: notification jobs cron", () => {
  it("fails closed when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "")
    const response = await GET(req("Bearer anything"))
    expect(response.status).toBe(503)
    expect(mocks.processJobs).not.toHaveBeenCalled()
  })

  it("refuses a wrong bearer", async () => {
    const response = await GET(req("Bearer wrong"))
    expect(response.status).toBe(401)
    expect(mocks.processJobs).not.toHaveBeenCalled()
  })

  it("runs the bounded worker with the configured secret", async () => {
    const response = await GET(req("Bearer cron-secret"))
    expect(response.status).toBe(200)
    expect(mocks.secretsMatch).toHaveBeenCalledWith("cron-secret", "cron-secret")
    expect(mocks.processJobs).toHaveBeenCalledOnce()
    expect(await response.json()).toMatchObject({ enabled: true })
  })

  it("answers 503 when the worker is unavailable", async () => {
    mocks.processJobs.mockRejectedValue(new Error("db down"))
    const response = await GET(req("Bearer cron-secret"))
    expect(response.status).toBe(503)
  })
})
