import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { chasePendingPushReceipts } from "@/lib/push-receipts"

const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.select, update: mocks.update },
}))

const WAIT = "2026-10-19T12:00:00.000Z"
const TOKEN = "ExponentPushToken[abcdefghijklmnop]"

function ledgerRow(data: Record<string, unknown>, id = "00000000-0000-4000-8000-0000000000b1") {
  return { id, data }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("EXPO_ACCESS_TOKEN", "expo_test_token")
  // Select chain: db.select(...).from(...).where(...).limit(...) -> rows.
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => [],
      }),
    }),
  }))
  // Update chain: db.update(...).set(...).where(...) -> awaitable.
  mocks.update.mockImplementation(() => ({
    set: () => ({ where: async () => {} }),
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("B163: push receipts ledger chase", () => {
  it("closes the loop ONLY on confirmed ok receipts (state stays provider_accepted)", async () => {
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [ledgerRow({ dedupKey: "award:push-1", deliveryState: "provider_accepted", receiptIds: ["r-1"], receiptTokens: [TOKEN] })],
        }),
      }),
    }))
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { "r-1": { status: "ok" } } }),
    })))
    const updates: any[] = []
    mocks.update.mockImplementation((() => ({ set: (s: unknown) => { updates.push(s); return { where: async () => {} } } })) as any)

    const summary = await chasePendingPushReceipts(new Date(WAIT))
    expect(summary).toEqual({ rowsExamined: 1, rowsClosedOk: 1, rowsDowngraded: 0, rowsStillPending: 0, tokensDeactivated: 0 })
    expect(updates).toHaveLength(1)
    expect(updates[0].data.deliveryState).toBe("provider_accepted")
    expect(updates[0].data.receiptsOk).toBe(1)
    expect(typeof updates[0].data.receiptsChased).toBe("string")
  })

  it("leaves rows pending when Expo has produced NO receipts yet", async () => {
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [ledgerRow({ dedupKey: "award:push-1", deliveryState: "provider_accepted", receiptIds: ["r-1"], receiptTokens: [TOKEN] })],
        }),
      }),
    }))
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) })))
    const summary = await chasePendingPushReceipts(new Date(WAIT))
    expect(summary.rowsStillPending).toBe(1)
    expect(summary.rowsClosedOk).toBe(0)
    expect(mocks.update).not.toHaveBeenCalled() // never promoted on absence
  })

  it("ENH-06-03: a PARTIAL answer stays pending - it never claims every device was delivered", async () => {
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [ledgerRow({
            dedupKey: "award:push-1", deliveryState: "provider_accepted",
            receiptIds: ["r-1", "r-2"], receiptTokens: [TOKEN, `${TOKEN}2`],
          })],
        }),
      }),
    }))
    // Only one of the two receipts exists so far.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { "r-1": { status: "ok" } } }),
    })))
    const updates: any[] = []
    mocks.update.mockImplementation((() => ({ set: (s: unknown) => { updates.push(s); return { where: async () => {} } } })) as any)

    const summary = await chasePendingPushReceipts(new Date(WAIT))
    expect(summary.rowsStillPending).toBe(1)
    expect(summary.rowsClosedOk).toBe(0)
    // The row is NOT closed: no receiptsChased (so it is chased again) and no
    // receiptsOk claim about the device that has not answered yet.
    expect(updates).toHaveLength(1)
    expect(updates[0].data.receiptsChased).toBeUndefined()
    expect(updates[0].data.receiptsOk).toBeUndefined()
    // The send ticket's state is preserved verbatim (still provider_accepted,
    // not downgraded) - only the missing receipt is recorded.
    expect(updates[0].data.deliveryState).toBe("provider_accepted")
    expect(updates[0].data.receiptVerdicts["r-1"]).toBe("receipt_ok")
  })

  it("ENH-06-03: a transport failure is UNCERTAIN - the row is retried, never downgraded", async () => {
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [ledgerRow({
            dedupKey: "award:push-1", deliveryState: "provider_accepted",
            receiptIds: ["r-1"], receiptTokens: [TOKEN],
          })],
        }),
      }),
    }))
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    const updates: any[] = []
    mocks.update.mockImplementation((() => ({ set: (s: unknown) => { updates.push(s); return { where: async () => {} } } })) as any)

    const summary = await chasePendingPushReceipts(new Date(WAIT))
    expect(summary.rowsStillPending).toBe(1)
    expect(summary.rowsDowngraded).toBe(0)
    expect(summary.rowsClosedOk).toBe(0)
    // Not chased (still eligible) and not refused - the truth is unknown.
    expect(updates[0].data.receiptsChased).toBeUndefined()
    expect(updates[0].data.deliveryState).toBe("provider_accepted")
    expect(updates[0].data.receiptsLastError).toBe("network_unknown")
  })

  it("downgrades rows on error receipts and deactivates the DeviceNotRegistered token", async () => {
    const token2 = "ExponentPushToken[zzzz]"
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [ledgerRow({
            dedupKey: "award:push-1", deliveryState: "provider_accepted",
            receiptIds: ["r-1", "r-2"], receiptTokens: [TOKEN, token2],
          })],
        }),
      }),
    }))
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { "r-1": { status: "error", details: { error: "DeviceNotRegistered" } }, "r-2": { status: "ok" } } }),
    })))
    const updates: any[] = []
    mocks.update.mockImplementation((() => ({ set: (s: unknown) => { updates.push(s); return { where: async () => {} } } })) as any)

    const summary = await chasePendingPushReceipts(new Date(WAIT))
    expect(summary.rowsDowngraded).toBe(1)
    expect(summary.tokensDeactivated).toBe(1)
    // First update call = pushTokens deactivation; second = the ledger row.
    expect(mocks.update).toHaveBeenCalledTimes(2)
    const ledgerUpdate = updates[1].data
    expect(ledgerUpdate.deliveryState).toBe("provider_refused") // ticket optimism corrected
    expect(ledgerUpdate.deliveryError).toBe("receipt_DeviceNotRegistered")
    expect(ledgerUpdate.receiptVerdicts["r-1"]).toBe("DeviceNotRegistered")
    expect(ledgerUpdate.receiptVerdicts["r-2"]).toBe("receipt_ok")
  })

  it("skips malformed ledger rows instead of chasing guessed fields", async () => {
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [ledgerRow({ deliveryState: "provider_accepted", receiptIds: "not-an-array" })],
        }),
      }),
    }))
    const summary = await chasePendingPushReceipts(new Date(WAIT))
    expect(summary.rowsExamined).toBe(0)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("handles an empty queue without touching the provider", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const summary = await chasePendingPushReceipts(new Date(WAIT))
    expect(summary.rowsExamined).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
