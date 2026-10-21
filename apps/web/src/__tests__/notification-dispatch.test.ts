import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  dispatchNotificationToMember,
  saveNotificationPreferencesForMember,
  DEDUP_WINDOW_HOURS,
  FOLLOWER_FANOUT_LIMIT,
} from "@/lib/notification-dispatch"

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), select: vi.fn(), update: vi.fn() }))

// Passthrough for real schema tables + policy; only db handles are mocked.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { transaction: mocks.transaction, select: mocks.select, update: mocks.update },
}))

// Tenant branding is a db read with its own chain; the email tests stub it
// Tenant branding is a db read with its own chain; the email tests stub it
// (implementation re-pinned in beforeEach because the suite resets mocks).
vi.mock("@/lib/tenant", () => ({ getTenantBranding: vi.fn(async () => ({})) }))
import { getTenantBranding } from "@/lib/tenant"

/** Partial branding row for the stub, cast to the strict reader type. */
const brandRow = (row: Record<string, unknown>): Awaited<ReturnType<typeof getTenantBranding>> =>
  row as Awaited<ReturnType<typeof getTenantBranding>>

const LEAGUE = "00000000-0000-4000-8000-0000000000a1"
const MEMBER = "00000000-0000-4000-8000-0000000000a2"
const PREFS = { inAppEnabled: true, quietStartMinute: null, quietEndMinute: null, timeZone: null }

type SelectSpec = unknown[]

/** Builds a tx whose selects pop from `specs`; captures insert payloads/updates. */
function txWith(specs: SelectSpec[]) {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const select = vi.fn(() => {
    const rows = specs.length > 1 ? specs.shift()! : specs[0]!
    return {
      from: () => ({
        where: () => ({
          limit: async () => rows,
          for: () => ({ limit: async () => rows }),
        }),
      }),
    }
  })
  const insert = vi.fn(() => ({
    values: (payload: unknown) => {
      inserts.push(payload)
      // B161 email path needs returning() (its own insert chain); in-app
      // inserts in this suite never call it.
      return {
        then: (resolve: (rows: never[]) => unknown) => resolve([]),
        returning: () => ({ then: (resolve: (rows: unknown[]) => unknown) => resolve([{ id: "row-1" }]) }),
      }
    },
  }))
  const tx = {
    select,
    insert,
    update: vi.fn(() => ({
      set: (set: unknown) => {
        updates.push(set)
        return { where: async () => {} }
      },
    })),
  }
  return { tx, inserts, updates, select, insert }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getTenantBranding).mockImplementation(async () => brandRow({}))
})

describe("Notification dispatch writer (FAN-02)", () => {
  it("keeps the historical default with no saved row: the bell is delivered", async () => {
    const { tx, inserts } = txWith([[], []])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await dispatchNotificationToMember({
      tenantId: LEAGUE, memberId: MEMBER, type: "award_declared",
      title: "Award declared", body: "b", dedupKey: "award:abc-1",
    })
    expect(result).toEqual({ written: true, reason: "ok" })
    expect(inserts).toHaveLength(1)
    expect((inserts[0] as any).channel).toBe("in_app")
    expect((inserts[0] as any).data).toEqual({ dedupKey: "award:abc-1" })
  })

  it("honors in-app consent - a member who turned the bell off receives nothing", async () => {
    const { tx, inserts } = txWith([[{ ...PREFS, inAppEnabled: false }]])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await dispatchNotificationToMember({
      tenantId: LEAGUE, memberId: MEMBER, type: "award_declared",
      title: "t", body: "b", dedupKey: "award:abc-2",
    })
    expect(result).toEqual({ written: false, reason: "consent_off" })
    expect(inserts).toHaveLength(0)
  })

  it("suppresses a repeated fact inside the dedup window instead of spamming the bell", async () => {
    // (1) prefs row, (2) an existing notification with the same dedupKey.
    const { tx, inserts } = txWith([[PREFS], [{ id: "existing-1" }]])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await dispatchNotificationToMember({
      tenantId: LEAGUE, memberId: MEMBER, type: "award_declared",
      title: "t", body: "b", dedupKey: "award:abc-3",
    })
    expect(result).toEqual({ written: false, reason: "deduplicated" })
    expect(inserts).toHaveLength(0)
  })

  it("exposes the dedup window and fan-out bounds as honest named constants", () => {
    expect(DEDUP_WINDOW_HOURS).toBe(24)
    expect(FOLLOWER_FANOUT_LIMIT).toBe(200)
  })
})

describe("Notification preferences save (FAN-02)", () => {
  const VALID = { inAppEnabled: true, emailEnabled: false, pushEnabled: false, quietStartMinute: 1320, quietEndMinute: 420, timeZone: "Asia/Karachi" }

  it("inserts the first preference set", async () => {
    const { tx, inserts, updates } = txWith([[]])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await saveNotificationPreferencesForMember(LEAGUE, MEMBER, VALID)
    expect(result.changed).toBe(true)
    expect(inserts).toHaveLength(1)
    expect(updates).toHaveLength(0)
  })

  it("recognizes an identical replay: nothing is rewritten, the UI is told the truth", async () => {
    const { tx, inserts, updates } = txWith([[{ ...VALID }]])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await saveNotificationPreferencesForMember(LEAGUE, MEMBER, VALID)
    expect(result.changed).toBe(false)
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it("updates a changed preference set and reports the previous values", async () => {
    const { tx, inserts, updates } = txWith([[{ ...VALID }]])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await saveNotificationPreferencesForMember(LEAGUE, MEMBER, { ...VALID, quietStartMinute: 1300 })
    expect(result.changed).toBe(true)
    expect(result.previous).toMatchObject({ quietStartMinute: 1320 })
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(1)
  })

  it("validates quiet-hour boundaries and rejects degenerate windows", async () => {
    const { tx } = txWith([[]])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    await expect(saveNotificationPreferencesForMember(LEAGUE, MEMBER, { ...VALID, quietStartMinute: 1440 }))
      .rejects.toThrow()
    await expect(saveNotificationPreferencesForMember(LEAGUE, MEMBER, { ...VALID, quietStartMinute: -1 }))
      .rejects.toThrow()
    await expect(saveNotificationPreferencesForMember(LEAGUE, MEMBER, { ...VALID, quietStartMinute: 420 }))
      .rejects.toThrow("start and end must differ")
    await expect(saveNotificationPreferencesForMember(LEAGUE, MEMBER, { ...VALID, timeZone: "Mars/Olympus" }))
      .rejects.toThrow("Unknown time zone")
    // Half-set window (start without end) is refused at the boundary.
    await expect(saveNotificationPreferencesForMember(LEAGUE, MEMBER, { ...VALID, quietEndMinute: null }))
      .rejects.toThrow()
  })

  it("B161: persists email consent with the same version-checked upsert", async () => {
    const { tx, updates } = txWith([[{ ...VALID, emailEnabled: true }]])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await saveNotificationPreferencesForMember(LEAGUE, MEMBER, { ...VALID, emailEnabled: true })
    expect(result.changed).toBe(false) // identical replay including email consent
    expect(updates).toHaveLength(0)

    const { tx: t2, inserts: i2, updates: u2 } = txWith([[{ ...VALID }]])
    mocks.transaction.mockImplementation(async (fn: any) => fn(t2))
    const result2 = await saveNotificationPreferencesForMember(LEAGUE, MEMBER, { ...VALID, emailEnabled: true })
    expect(result2.changed).toBe(true)
    expect(result2.previous).toMatchObject({ emailEnabled: false })
    expect(i2).toHaveLength(0)
    expect(u2).toHaveLength(1)
  })
})

describe("B161: notification EMAIL channel", () => {
  const EMAIL_INPUT = {
    tenantId: LEAGUE, memberId: MEMBER, type: "award_declared",
    title: "Award declared", body: "Best Batsman was declared.", dedupKey: "award:email-1",
    channel: "email" as const,
  }
  const EMAIL_READY = { NOTIFICATION_EMAIL_READY: "true", RESEND_API_KEY: "re_test_key", RESEND_FROM_EMAIL: "SSL <test@ssl.example>" }

  const baseSpecs = () => [
    [{ ...PREFS, emailEnabled: true }],            // prefs: consented, no quiet window
    [],                                            // not a duplicate
    [{ email: "member@ssl.example" }],             // active account with address
    [{ name: "SSL Super League" }],                // tenant name for the template
  ]

  it("refuses email for an unconsented member and writes NOTHING (fail-closed)", async () => {
    vi.stubEnv("NOTIFICATION_EMAIL_READY", "true")
    vi.stubEnv("RESEND_API_KEY", "re_test_key")
    const { tx, inserts } = txWith([[{ ...PREFS }]]) // row predates the field
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await dispatchNotificationToMember(EMAIL_INPUT)
    expect(result).toEqual({ written: false, reason: "consent_off" })
    expect(inserts).toHaveLength(0)
  })

  it("refuses email with the unwired reason when the deployment has not enabled the channel", async () => {
    vi.stubEnv("NOTIFICATION_EMAIL_READY", "false")
    const { tx, inserts } = txWith([[{ ...PREFS, emailEnabled: true }]])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await dispatchNotificationToMember(EMAIL_INPUT)
    expect(result).toEqual({ written: false, reason: "channel_unwired" })
    expect(inserts).toHaveLength(0)
  })

  it("writes the row through the same gates and records provider acceptance honestly", async () => {
    vi.mocked(getTenantBranding).mockImplementation(async () => brandRow({ appName: "SSL Super League", primaryColor: "#0ea5e9" }))
    for (const [k, v] of Object.entries(EMAIL_READY)) vi.stubEnv(k, v)
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const { tx, inserts } = txWith(baseSpecs())
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    mocks.update.mockImplementation(() => ({ set: () => ({ where: async () => {} }) }))

    const result = await dispatchNotificationToMember(EMAIL_INPUT)
    expect(result.written).toBe(true)
    expect(result.sendState).toBe("provider_accepted")
    const row = inserts[0] as any
    expect(row.channel).toBe("email")
    expect(row.data).toEqual({ dedupKey: "award:email-1", deliveryState: "queued" })
    // The provider call: branded, idempotency-keyed, plain text only.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.resend.com/emails")
    const body = JSON.parse(String(init.body))
    expect(init.headers).toMatchObject({ "Idempotency-Key": "notification-email/row-1" })
    expect(body.subject).toContain("SSL Super League")
    expect(body.subject).toContain("Award declared")
    expect(body.text).toContain("Best Batsman was declared.")
    expect(body.text).toContain("— SSL Super League")
    expect(body.from).toBe("SSL <test@ssl.example>")
    // Post-commit settle recorded the honest final state.
    expect(mocks.update).toHaveBeenCalledTimes(1)
  })

  it("records a provider refusal without ever claiming delivery", async () => {
    for (const [k, v] of Object.entries(EMAIL_READY)) vi.stubEnv(k, v)
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 422 })))
    const { tx, inserts } = txWith(baseSpecs())
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const updates: any[] = []
    mocks.update.mockImplementation((() => ({ set: (s: unknown) => { updates.push(s); return { where: async () => {} } } })) as any)

    const result = await dispatchNotificationToMember(EMAIL_INPUT)
    expect(result.sendState).toBe("provider_refused")
    expect((inserts[0] as any).data.deliveryState).toBe("queued")
    expect(updates[0].data.deliveryState).toBe("provider_refused")
    expect(updates[0].data.deliveryError).toBe("provider_http_422")
  })

  it("keeps network failures honest too (provider_refused, never sent)", async () => {
    for (const [k, v] of Object.entries(EMAIL_READY)) vi.stubEnv(k, v)
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom") }))
    const { tx } = txWith(baseSpecs())
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const updates: any[] = []
    mocks.update.mockImplementation((() => ({ set: (s: unknown) => { updates.push(s); return { where: async () => {} } } })) as any)

    const result = await dispatchNotificationToMember(EMAIL_INPUT)
    expect(result.sendState).toBe("provider_refused")
    expect(updates[0].data).toEqual({ dedupKey: "award:email-1", deliveryState: "provider_refused", deliveryError: "network_unknown" })
  })

  it("refuses when the member has no deliverable address", async () => {
    vi.stubEnv("NOTIFICATION_EMAIL_READY", "true")
    vi.stubEnv("RESEND_API_KEY", "re_test_key")
    const { tx, inserts } = txWith([
      [{ ...PREFS, emailEnabled: true }],
      [],
      [], // no active account row -> no recipient
    ])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await dispatchNotificationToMember(EMAIL_INPUT)
    expect(result).toEqual({ written: false, reason: "no_recipient" })
    expect(inserts).toHaveLength(0)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
})

describe("B162: notification PUSH channel", () => {
  const PUSH_INPUT = {
    tenantId: LEAGUE, memberId: MEMBER, type: "award_declared",
    title: "Award declared", body: "Best Batsman was declared.", dedupKey: "award:push-1",
    channel: "push" as const,
  }
  const TOKEN = "ExponentPushToken[abcdefghijklmnop]"
  const P_VALID = { inAppEnabled: true, emailEnabled: false, pushEnabled: false, quietStartMinute: 1320, quietEndMinute: 420, timeZone: "Asia/Karachi" }

  const pushSpecs = (tokens: string[]) => [
    [{ ...PREFS, pushEnabled: true }],   // prefs: consented, no quiet window
    [],                                  // not a duplicate
    tokens.map((t) => ({ token: t })),   // active device tokens
  ]

  it("refuses push for an unconsented member and writes NOTHING", async () => {
    vi.stubEnv("NOTIFICATION_PUSH_READY", "true")
    vi.stubEnv("EXPO_ACCESS_TOKEN", "expo_test_token")
    const { tx, inserts } = txWith([[{ ...PREFS }]]) // row predates the field
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await dispatchNotificationToMember(PUSH_INPUT)
    expect(result).toEqual({ written: false, reason: "consent_off" })
    expect(inserts).toHaveLength(0)
  })

  it("reads channel_unwired while the deployment has not enabled push", async () => {
    vi.stubEnv("NOTIFICATION_PUSH_READY", "false")
    const { tx, inserts } = txWith(pushSpecs([TOKEN]))
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await dispatchNotificationToMember(PUSH_INPUT)
    expect(result).toEqual({ written: false, reason: "channel_unwired" })
    expect(inserts).toHaveLength(0)
  })

  it("refuses with no_recipient when the member has no active device token", async () => {
    vi.stubEnv("NOTIFICATION_PUSH_READY", "true")
    vi.stubEnv("EXPO_ACCESS_TOKEN", "expo_test_token")
    const { tx, inserts } = txWith(pushSpecs([]))
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const result = await dispatchNotificationToMember(PUSH_INPUT)
    expect(result).toEqual({ written: false, reason: "no_recipient" })
    expect(inserts).toHaveLength(0)
  })

  it("writes the ledger with tokenCount and records full provider acceptance", async () => {
    vi.stubEnv("NOTIFICATION_PUSH_READY", "true")
    vi.stubEnv("EXPO_ACCESS_TOKEN", "expo_test_token")
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      // ENH-06-03: the field Expo names is `id` (the receipt id).
      json: async () => ({ data: [{ status: "ok", id: "rct-1" }, { status: "ok", id: "rct-2" }] }),
    }))
    vi.stubGlobal("fetch", fetchMock)
    const { tx, inserts } = txWith(pushSpecs([TOKEN, `${TOKEN}2`]))
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const updates: any[] = []
    mocks.update.mockImplementation((() => ({ set: (s: unknown) => { updates.push(s); return { where: async () => {} } } })) as any)

    const result = await dispatchNotificationToMember(PUSH_INPUT)
    expect(result.written).toBe(true)
    expect(result.sendState).toBe("provider_accepted")
    const row = inserts[0] as any
    expect(row.channel).toBe("push")
    expect(row.data).toEqual({ dedupKey: "award:push-1", deliveryState: "queued", tokenCount: 2 })
    // One bounded Expo API call carrying both tokens and the deep-link data.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://exp.host/--/api/v2/push/send")
    expect(init.headers).toMatchObject({ Authorization: "Bearer expo_test_token" })
    const messages = JSON.parse(String(init.body)) as Array<{ to: string; data: Record<string, string> }>
    expect(messages).toHaveLength(2)
    expect(messages[0].data).toEqual({ type: "award_declared", tenantId: LEAGUE, dedupKey: "award:push-1" })
    // Post-commit settle recorded the honest, complete state — B163 adds the
    // receipt ids AND their 1:1 token pairing so the receipts cron can map a
    // late per-device verdict back to its token.
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(updates[0].data).toMatchObject({
      dedupKey: "award:push-1",
      deliveryState: "provider_accepted",
      ok: 2,
      receiptIds: ["rct-1", "rct-2"],
      receiptTokens: [TOKEN, `${TOKEN}2`],
    })
  })

  it("records a PARTIAL failure as provider_refused with the exact counts", async () => {
    vi.stubEnv("NOTIFICATION_PUSH_READY", "true")
    vi.stubEnv("EXPO_ACCESS_TOKEN", "expo_test_token")
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ status: "ok" }, { status: "error", message: "DeviceNotRegistered" }] }),
    })))
    const { tx } = txWith(pushSpecs([TOKEN, `${TOKEN}2`]))
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const updates: any[] = []
    mocks.update.mockImplementation((() => ({ set: (s: unknown) => { updates.push(s); return { where: async () => {} } } })) as any)

    const result = await dispatchNotificationToMember(PUSH_INPUT)
    expect(result.sendState).toBe("provider_refused")
    expect(updates[0].data.deliveryState).toBe("provider_refused")
    // ENH-06-03: the counts AND the reason the device was skipped.
    expect(updates[0].data.deliveryError).toBe("expo_partial_1of2_DeviceNotRegistered")
  })

  it("keeps receipt-count mismatches and network failures refused, never optimistic", async () => {
    vi.stubEnv("NOTIFICATION_PUSH_READY", "true")
    vi.stubEnv("EXPO_ACCESS_TOKEN", "expo_test_token")
    const updates: any[] = []
    mocks.update.mockImplementation((() => ({ set: (s: unknown) => { updates.push(s); return { where: async () => {} } } })) as any)

    // Receipt count does not match the sent messages (two tokens, one receipt).
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ status: "ok" }] }) })))
    const a = txWith(pushSpecs([TOKEN, `${TOKEN}2`]))
    mocks.transaction.mockImplementationOnce(async (fn: any) => fn(a.tx))
    expect((await dispatchNotificationToMember(PUSH_INPUT)).sendState).toBe("provider_refused")
    expect(updates[0].data.deliveryError).toBe("expo_receipt_count_mismatch")

    // Network failure: nothing may pretend the send happened.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    const b = txWith(pushSpecs([TOKEN]))
    mocks.transaction.mockImplementationOnce(async (fn: any) => fn(b.tx))
    expect((await dispatchNotificationToMember(PUSH_INPUT)).sendState).toBe("provider_refused")
    expect(updates[1].data.deliveryError).toBe("network_unknown")
  })

  it("persists push consent in the same version-checked upsert (replay + change)", async () => {
    const { tx, updates } = txWith([[{ ...P_VALID, pushEnabled: true }]])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
    const same = await saveNotificationPreferencesForMember(LEAGUE, MEMBER, { ...P_VALID, pushEnabled: true })
    expect(same.changed).toBe(false)
    expect(updates).toHaveLength(0)

    const { tx: t2, updates: u2 } = txWith([[{ ...P_VALID, pushEnabled: false }]])
    mocks.transaction.mockImplementation(async (fn: any) => fn(t2))
    const flipped = await saveNotificationPreferencesForMember(LEAGUE, MEMBER, { ...P_VALID, pushEnabled: true })
    expect(flipped.changed).toBe(true)
    expect(flipped.previous).toMatchObject({ pushEnabled: false })
    expect(u2).toHaveLength(1)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
})
