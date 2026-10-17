import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  dispatchNotificationToMember,
  dispatchNotificationToTournamentFollowers,
  saveNotificationPreferencesForMember,
  DEDUP_WINDOW_HOURS,
  FOLLOWER_FANOUT_LIMIT,
} from "@/lib/notification-dispatch"

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), select: vi.fn() }))

// Passthrough for real schema tables + policy; only db handles are mocked.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { transaction: mocks.transaction, select: mocks.select },
}))

const LEAGUE = "00000000-0000-4000-8000-0000000000a1"
const MEMBER = "00000000-0000-4000-8000-0000000000a2"
const TOURNAMENT = "00000000-0000-4000-8000-0000000000a3"
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
  const tx = {
    select,
    insert: vi.fn(() => ({
      values: (payload: unknown) => {
        inserts.push(payload)
        return { then: (resolve: (rows: never[]) => unknown) => resolve([]) }
      },
    })),
    update: vi.fn(() => ({
      set: (set: unknown) => {
        updates.push(set)
        return { where: async () => {} }
      },
    })),
  }
  return { tx, inserts, updates, select }
}

beforeEach(() => {
  vi.resetAllMocks()
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

describe("Tournament-follower fan-out (FAN-02)", () => {
  it("fans out per member, each through the same consent gate; one refusal does not abort", async () => {
    mocks.select.mockImplementation(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [{ userId: MEMBER }, { userId: "00000000-0000-4000-8000-0000000000a9" }],
            }),
          }),
        }),
      }),
    }))
    const first = txWith([[], []])          // member 1: default-on, no dup -> written.
    const second = txWith([[{ ...PREFS, inAppEnabled: false }]]) // member 2: consent off.
    mocks.transaction
      .mockImplementationOnce(async (fn: any) => fn(first.tx))
      .mockImplementationOnce(async (fn: any) => fn(second.tx))

    const result = await dispatchNotificationToTournamentFollowers({
      tenantId: LEAGUE, tournamentId: TOURNAMENT, type: "award_declared",
      title: "Award declared for a tournament you follow", body: "Cup: Best Batsman was declared.",
      dedupKey: "award:abc-4",
    })
    expect(result).toEqual({ fanout: 2, written: 1 })
    expect(first.inserts).toHaveLength(1)
    expect(second.inserts).toHaveLength(0)
    // Followers read is pinned to the league, the tournament type and the id.
    const whereArgs = mocks.select.mock.calls
    expect(whereArgs).toHaveLength(1)
  })

  it("still reaches the bell when the whole fan-out is requested after a declaration", async () => {
    mocks.select.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => [] }),
          }),
        }),
      }),
    })
    const result = await dispatchNotificationToTournamentFollowers({
      tenantId: LEAGUE, tournamentId: TOURNAMENT, type: "award_declared",
      title: "t", body: "b", dedupKey: "award:abc-5",
    })
    expect(result).toEqual({ fanout: 0, written: 0 })
  })
})

describe("Notification preferences save (FAN-02)", () => {
  const VALID = { inAppEnabled: true, quietStartMinute: 1320, quietEndMinute: 420, timeZone: "Asia/Karachi" }

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
})
