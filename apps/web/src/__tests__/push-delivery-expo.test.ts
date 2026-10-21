import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sendPushToTokens } from "@/lib/push-delivery"

/**
 * ENH-06-03: the Expo send contract.
 *
 * Expo names the send ticket `id` (`{ "status": "ok", "id": "..." }`). The
 * reader looked for `receiptId` only, so every accepted ticket landed on the
 * ledger WITHOUT a receipt id: the receipts chase had nothing to chase, and
 * the 1:1 receipt/token pairing (needed to deactivate a dead device) could
 * never be built. The deep link to the match the notification is about also
 * never left the server: the push payload carried no match id, so tapping a
 * push could not open the match.
 */

const TOKEN = "ExponentPushToken[abcdefghijklmnop]"
const MATCH = "00000000-0000-4000-8000-0000000000d1"
const TENANT = "00000000-0000-4000-8000-0000000000d2"

const content = {
  title: "Match started",
  body: "Falcons vs Lions is now live",
  type: "match_started",
  tenantId: TENANT,
  dedupKey: "match:abc:started",
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("EXPO_ACCESS_TOKEN", "expo_test_token")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("ENH-06-03: the Expo ticket id is the receipt id", () => {
  it("reads the id Expo actually returns", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ status: "ok", id: "ticket-1" }] }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const outcome = await sendPushToTokens([TOKEN], content)

    expect(outcome).toEqual({
      state: "provider_accepted",
      ok: 1,
      total: 1,
      receiptIds: ["ticket-1"],
    })
  })

  it("still accepts the legacy receiptId spelling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ status: "ok", receiptId: "legacy-1" }] }),
      }))
    )

    const outcome = await sendPushToTokens([TOKEN], content)
    expect(outcome).toMatchObject({ state: "provider_accepted", receiptIds: ["legacy-1"] })
  })

  it("names the reason a device was skipped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { status: "ok", id: "ticket-1" },
            {
              status: "error",
              message: "Device not registered",
              details: { error: "DeviceNotRegistered" },
            },
          ],
        }),
      }))
    )

    const outcome = await sendPushToTokens([TOKEN, `${TOKEN}2`], content)

    expect(outcome.state).toBe("provider_refused")
    expect((outcome as { error: string }).error).toBe("expo_partial_1of2_DeviceNotRegistered")
  })
})

describe("ENH-06-03: the push payload carries the match it is about", () => {
  it("sends the match id in the message data", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ status: "ok", id: "ticket-1" }] }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    await sendPushToTokens([TOKEN], { ...content, matchId: MATCH })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const messages = JSON.parse(String(init.body)) as Array<{ data: Record<string, string> }>
    expect(messages[0].data).toEqual({
      type: "match_started",
      tenantId: TENANT,
      dedupKey: "match:abc:started",
      matchId: MATCH,
    })
  })

  it("omits the match id when the notification is not about a match", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ status: "ok", id: "ticket-1" }] }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    await sendPushToTokens([TOKEN], content)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const messages = JSON.parse(String(init.body)) as Array<{ data: Record<string, string> }>
    expect(messages[0].data).not.toHaveProperty("matchId")
  })
})
