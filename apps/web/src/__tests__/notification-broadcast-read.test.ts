import { beforeEach, describe, expect, it, vi } from "vitest"
import { notificationReads, notifications } from "@mtk/database"
import {
  markAllNotificationsReadFor,
  markNotificationReadById,
  readMyNotifications,
  readUnreadNotificationCount,
} from "@/lib/notification-reads"

/**
 * ENH-06-03: recipient-specific read state.
 *
 * A league-wide notification row (`notifications.user_id IS NULL`) is shared by
 * every member of the league. Writing `read_at` on that shared row marked the
 * broadcast read for EVERYONE - one member closing the bell silenced it for
 * the rest, and "mark all read" wiped the state for all of them. The read
 * marker for a shared row now lives per member, in `notification_reads`.
 */

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mtk/database")>()),
  db: { select: mocks.select, insert: mocks.insert, update: mocks.update },
}))

const TENANT = "00000000-0000-4000-8000-0000000000c1"
const ACTOR = "00000000-0000-4000-8000-0000000000c2"
const BROADCAST = "00000000-0000-4000-8000-0000000000c3"
const PERSONAL = "00000000-0000-4000-8000-0000000000c4"
const context = { tenantId: TENANT, actorId: ACTOR, clerkId: "clerk_1", role: "player" as const }

type Captured = { inserts: any[]; updates: any[]; joins: unknown[]; tables: unknown[] }

beforeEach(() => {
  vi.resetAllMocks()
})

/**
 * Mocks the query chains used by the read/mark helpers:
 *  - select().from().where().limit()          -> single row
 *  - select().from().leftJoin().where().limit() -> list rows
 *  - select().from().leftJoin().where().orderBy().limit()
 */
function mockQueries(rows: any[]): Captured {
  const captured: Captured = { inserts: [], updates: [], joins: [], tables: [] }

  mocks.select.mockImplementation(() => {
    const chain: any = {
      from: (table: unknown) => {
        captured.tables.push(table)
        return chain
      },
      leftJoin: (table: unknown) => {
        captured.joins.push(table)
        return chain
      },
      where: () => chain,
      orderBy: () => chain,
      limit: async () => rows,
      then: (resolve: any) => Promise.resolve(rows).then(resolve),
    }
    return chain
  })

  mocks.insert.mockImplementation(() => ({
    values: (payload: unknown) => {
      captured.inserts.push(payload)
      return {
        onConflictDoUpdate: () => ({ then: (resolve: any) => resolve([]) }),
        onConflictDoNothing: () => ({ then: (resolve: any) => resolve([]) }),
        then: (resolve: any) => resolve([]),
      }
    },
  }))

  mocks.update.mockImplementation(() => ({
    set: (values: unknown) => {
      captured.updates.push(values)
      return { where: async () => {} }
    },
  }))

  return captured
}

describe("ENH-06-03: a league-wide row is read per member", () => {
  it("marks a shared broadcast read for THIS member only", async () => {
    const captured = mockQueries([{ id: BROADCAST, userId: null }])

    await markNotificationReadById(context, BROADCAST)

    // The member's own marker is written...
    expect(captured.inserts).toHaveLength(1)
    expect(captured.inserts[0]).toMatchObject({ notificationId: BROADCAST, userId: ACTOR })
    // ...and the SHARED row is never touched.
    expect(captured.updates).toHaveLength(0)
  })

  it("marks a personal row read on the row itself", async () => {
    const captured = mockQueries([{ id: PERSONAL, userId: ACTOR }])

    await markNotificationReadById(context, PERSONAL)

    expect(captured.inserts).toHaveLength(0)
    expect(captured.updates).toHaveLength(1)
    expect(captured.updates[0]).toMatchObject({ status: "read" })
    expect(captured.updates[0].readAt).toBeInstanceOf(Date)
  })

  it("writes nothing for a notification outside the member's league", async () => {
    const captured = mockQueries([])

    await markNotificationReadById(context, BROADCAST)

    expect(captured.inserts).toHaveLength(0)
    expect(captured.updates).toHaveLength(0)
  })

  it("refuses a crafted id before touching the database", async () => {
    const captured = mockQueries([])
    await expect(markNotificationReadById(context, "not-a-uuid")).rejects.toThrow()
    expect(captured.inserts).toHaveLength(0)
    expect(captured.updates).toHaveLength(0)
  })
})

describe("ENH-06-03: mark-all reads personal rows and marks shared rows per member", () => {
  it("does not stamp read_at on a shared row", async () => {
    const captured = mockQueries([{ id: BROADCAST }])

    await markAllNotificationsReadFor(context)

    // Personal rows are updated in place...
    expect(captured.updates).toHaveLength(1)
    // ...and the shared row only gets a member marker.
    expect(captured.inserts).toHaveLength(1)
    expect(captured.inserts[0]).toMatchObject([{ notificationId: BROADCAST, userId: ACTOR }])
  })

  it("writes no marker when there is no shared row left to read", async () => {
    const captured = mockQueries([])
    await markAllNotificationsReadFor(context)
    expect(captured.inserts).toHaveLength(0)
    expect(captured.updates).toHaveLength(1)
  })
})

describe("ENH-06-03: the effective read state is the member's", () => {
  it("resolves the read state through the member join", async () => {
    const captured = mockQueries([{ id: BROADCAST, readAt: null }])

    const rows = await readMyNotifications(context, 10)

    // The member-scoped join is present (the shared row's marker lives there).
    expect(captured.joins).toContain(notificationReads)
    expect(captured.tables[0]).toBe(notifications)
    expect(rows).toHaveLength(1)
    expect(rows[0].matchId).toBeNull()
  })

  it("counts a shared row as unread only while the member has not read it", async () => {
    mockQueries([{ id: BROADCAST }])
    const unread = await readUnreadNotificationCount(context)
    expect(unread).toBe(1)
  })
})
