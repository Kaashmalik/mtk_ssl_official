import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { chasePushReceipts, notificationPushReady } from "@/lib/push-delivery"

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("B163: push receipt chase (FAN-02 delivery tracking)", () => {
  it("keeps not-yet-produced receipts ABSENT - pending is a third state, never delivered", async () => {
    vi.stubEnv("EXPO_ACCESS_TOKEN", "expo_test_token")
    // Two receipts exist (one ok, one error), one missing entirely.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { "r-1": { status: "ok" }, "r-2": { status: "error", details: { error: "DeviceNotRegistered" } } } }),
    })))
    const verdicts = await chasePushReceipts(["r-1", "r-2", "r-3"])
    expect(verdicts["r-1"]).toBe("receipt_ok")
    expect(verdicts["r-2"]).toBe("DeviceNotRegistered")
    expect("r-3" in verdicts).toBe(false) // pending, re-chased on a later run
  })

  it("transport failures name an explicit error per receipt - never silence", async () => {
    vi.stubEnv("EXPO_ACCESS_TOKEN", "expo_test_token")
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    const verdicts = await chasePushReceipts(["r-1", "r-2"])
    expect(verdicts["r-1"]).toBe("network_unknown")
    expect(verdicts["r-2"]).toBe("network_unknown")
  })

  it("http failures and unreadable bodies are explicit refusals, not assumed deliveries", async () => {
    vi.stubEnv("EXPO_ACCESS_TOKEN", "expo_test_token")
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429 })))
    expect((await chasePushReceipts(["r-1"]))["r-1"]).toBe("receipts_http_429")
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json") } })))
    expect((await chasePushReceipts(["r-1"]))["r-1"]).toBe("receipts_response_unreadable")
  })

  it("without a configured token the chase refuses explicitly instead of pretending", async () => {
    vi.stubEnv("EXPO_ACCESS_TOKEN", "   ")
    const verdicts = await chasePushReceipts(["r-1"])
    expect(verdicts["r-1"]).toBe("provider_unconfigured")
  })

  it("push wiring requires BOTH the flag and the access token", () => {
    vi.stubEnv("NOTIFICATION_PUSH_READY", "true")
    vi.stubEnv("EXPO_ACCESS_TOKEN", "token")
    expect(notificationPushReady()).toBe(true)
    vi.stubEnv("EXPO_ACCESS_TOKEN", "")
    expect(notificationPushReady()).toBe(false)
    vi.stubEnv("NOTIFICATION_PUSH_READY", "false")
    vi.stubEnv("EXPO_ACCESS_TOKEN", "token")
    expect(notificationPushReady()).toBe(false)
  })
})
