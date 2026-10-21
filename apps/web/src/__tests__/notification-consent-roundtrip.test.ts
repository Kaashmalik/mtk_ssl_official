import { beforeEach, describe, expect, it, vi } from "vitest"
import { notificationPreferences } from "@mtk/database"
import { readMyNotificationPreferences } from "@/lib/notification-reads"
import { saveNotificationPreferencesForMember } from "@/lib/notification-dispatch"

/**
 * ENH-06-03: the notification consent round-trip.
 *
 * The preferences READER returned only the in-app switch, so the settings form
 * rendered the email/push switches OFF for a member who had already consented.
 * The next save wrote those false values back - a quiet-hours tweak silently
 * REVOKED the channel consent. The reader must return every channel consent,
 * and the writer must treat an absent channel as UNKNOWN (keep the stored
 * value), never as "revoked".
 */

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mtk/database")>()),
  db: {
    select: mocks.select,
    transaction: mocks.transaction,
    update: mocks.update,
    insert: mocks.insert,
  },
}))

const TENANT = "00000000-0000-4000-8000-0000000000b1"
const MEMBER = "00000000-0000-4000-8000-0000000000b2"
const context = { tenantId: TENANT, actorId: MEMBER, clerkId: "clerk_1", role: "player" as const }

const STORED = {
  inAppEnabled: true,
  emailEnabled: true,
  pushEnabled: true,
  quietStartMinute: 1320,
  quietEndMinute: 420,
  timeZone: "Asia/Karachi",
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("ENH-06-03: the preferences reader returns every channel consent", () => {
  it("selects the email and push consents next to the in-app switch", async () => {
    let captured: Record<string, unknown> | null = null
    mocks.select.mockImplementation((fields: Record<string, unknown>) => {
      captured = fields
      return {
        from: () => ({ where: () => ({ limit: async () => [{ ...STORED }] }) }),
      }
    })

    const prefs = await readMyNotificationPreferences(context)
    expect(captured).not.toBeNull()
    expect(captured!).toMatchObject({
      inAppEnabled: notificationPreferences.inAppEnabled,
      emailEnabled: notificationPreferences.emailEnabled,
      pushEnabled: notificationPreferences.pushEnabled,
    })
    expect(prefs).toMatchObject({ inAppEnabled: true, emailEnabled: true, pushEnabled: true })
  })
})

describe("ENH-06-03: an absent channel consent is unknown, not revoked", () => {
  /** Builds a tx whose single select returns `rows`; captures writes. */
  function txWith(rows: unknown[]) {
    const inserts: unknown[] = []
    const updates: unknown[] = []
    const tx = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: async () => rows,
            for: () => ({ limit: async () => rows }),
          }),
        }),
      })),
      insert: vi.fn(() => ({
        values: (payload: unknown) => {
          inserts.push(payload)
          return { then: (resolve: (r: never[]) => unknown) => resolve([]) }
        },
      })),
      update: vi.fn(() => ({
        set: (set: unknown) => {
          updates.push(set)
          return { where: async () => {} }
        },
      })),
    }
    return { tx, inserts, updates }
  }

  it("keeps a stored push consent when the save does not mention the channel", async () => {
    const { tx, updates } = txWith([{ ...STORED }])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))

    // A client that knows nothing about the push channel (older build, or a
    // settings page that only edits quiet hours) sends no pushEnabled.
    const result = await saveNotificationPreferencesForMember(TENANT, MEMBER, {
      inAppEnabled: true,
      quietStartMinute: 1300,
      quietEndMinute: 420,
      timeZone: "Asia/Karachi",
    })

    expect(result.changed).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ pushEnabled: true, emailEnabled: true })
  })

  it("keeps a stored email consent when only the in-app switch is written", async () => {
    const { tx, updates } = txWith([{ ...STORED, pushEnabled: false }])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))

    await saveNotificationPreferencesForMember(TENANT, MEMBER, {
      inAppEnabled: false,
      quietStartMinute: null,
      quietEndMinute: null,
      timeZone: null,
    })

    expect(updates[0]).toMatchObject({
      inAppEnabled: false,
      emailEnabled: true,
      pushEnabled: false,
    })
  })

  it("stays fail-closed when no row exists yet: an absent consent is OFF", async () => {
    const { tx, inserts } = txWith([])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))

    await saveNotificationPreferencesForMember(TENANT, MEMBER, {
      inAppEnabled: true,
      quietStartMinute: null,
      quietEndMinute: null,
      timeZone: null,
    })

    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ emailEnabled: false, pushEnabled: false })
  })

  it("an explicit channel value still wins over the stored one", async () => {
    const { tx, updates } = txWith([{ ...STORED }])
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx))

    const result = await saveNotificationPreferencesForMember(TENANT, MEMBER, {
      inAppEnabled: true,
      pushEnabled: false,
      quietStartMinute: 1320,
      quietEndMinute: 420,
      timeZone: "Asia/Karachi",
    })

    expect(result.changed).toBe(true)
    expect(updates[0]).toMatchObject({ pushEnabled: false })
  })
})
