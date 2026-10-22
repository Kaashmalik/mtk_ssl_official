import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { enqueueTournamentFollowerJobs } from "@/lib/notification-fanout"

/**
 * ENH-06-04: league fan-out is a durable producer.
 *
 * It must select followers inside ONE league, write an in-app job per follower
 * plus email/push only for that member's stored opt-ins (bounded), and never
 * touch provider HTTP. Replayed producers collide on the unique
 * event/recipient/channel key instead of double-sending.
 */

type Follower = {
  userId: string
  inAppEnabled?: boolean
  emailEnabled?: boolean
  pushEnabled?: boolean
}

const mocks = vi.hoisted(() => ({
  followers: [] as Follower[],
  inserted: [] as Array<{ id: string }>,
  select: vi.fn(),
  insert: vi.fn(),
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.select, insert: mocks.insert },
}))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const TOURNAMENT = "00000000-0000-4000-8000-0000000000a3"
const MATCH = "00000000-0000-4000-8000-0000000000a4"
const MEMBER_A = "00000000-0000-4000-8000-0000000000b1"
const MEMBER_B = "00000000-0000-4000-8000-0000000000b2"
const dialect = new PgDialect()

type Captured = { where?: unknown; limit?: number; values?: unknown[]; conflictTarget?: unknown[] }

function harness() {
  const captured: Captured = {}
  mocks.select.mockImplementation(() => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (where: unknown) => { captured.where = where; return chain },
      orderBy: () => chain,
      limit: (limit: number) => { captured.limit = limit; return Promise.resolve(mocks.followers) },
    }
    return chain
  })
  mocks.insert.mockImplementation(() => ({
    values: (values: unknown[]) => {
      captured.values = values
      return {
        onConflictDoNothing: (arg: { target: unknown[] }) => {
          captured.conflictTarget = arg.target
          return { returning: async () => mocks.inserted.slice(0, values.length) }
        },
      }
    },
  }))
  return captured
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.followers = [{ userId: MEMBER_A }, { userId: MEMBER_B }]
  mocks.inserted = [{ id: "job-a" }, { id: "job-b" }]
})

describe("ENH-06-04: durable tournament-follower fan-out", () => {
  it("enqueues one in-app job per follower, scoped to the league and bounded", async () => {
    const captured = harness()

    const result = await enqueueTournamentFollowerJobs({
      tenantId: TENANT,
      tournamentId: TOURNAMENT,
      type: "match_started",
      title: "Match started",
      body: "Lions vs Falcons is now live",
      eventId: `match:${MATCH}:started`,
      matchId: MATCH,
    })

    expect(result).toEqual({
      fanout: 2, enqueued: 2, channels: { inApp: 2, email: 0, push: 0 },
    })
    expect(captured.limit).toBe(200)
    expect(captured.values).toHaveLength(2)
    expect(captured.values?.[0]).toMatchObject({
      tenantId: TENANT,
      recipientUserId: MEMBER_A,
      eventId: `match:${MATCH}:started`,
      channel: "in_app",
      type: "match_started",
      data: { matchId: MATCH },
    })
    expect(captured.values?.[1]).toMatchObject({ recipientUserId: MEMBER_B })
    // Tenant and tournament are both predicates on the follower read; the
    // notice can never reach a follower row from another league.
    const params = dialect.sqlToQuery(captured.where as any).params
    expect(params).toContain(TENANT)
    expect(params).toContain(TOURNAMENT)
    expect(params).toContain("tournament")
  })

  it("dedupes a replayed producer on event/recipient/channel", async () => {
    mocks.inserted = []
    const captured = harness()

    const result = await enqueueTournamentFollowerJobs({
      tenantId: TENANT, tournamentId: TOURNAMENT, type: "match_started",
      title: "t", body: "b", eventId: `match:${MATCH}:started`,
    })

    expect(result).toEqual({
      fanout: 2, enqueued: 0, channels: { inApp: 2, email: 0, push: 0 },
    })
    expect(captured.conflictTarget).toHaveLength(3)
  })

  it("does not insert when nobody follows the tournament", async () => {
    mocks.followers = []
    harness()

    const result = await enqueueTournamentFollowerJobs({
      tenantId: TENANT, tournamentId: TOURNAMENT, type: "award_declared",
      title: "t", body: "b", eventId: "award:abc-1",
    })

    expect(result).toEqual({
      fanout: 0, enqueued: 0, channels: { inApp: 0, email: 0, push: 0 },
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("queues email/push only for members who opted in to that channel in this league", async () => {
    mocks.followers = [
      { userId: MEMBER_A, inAppEnabled: true, emailEnabled: true, pushEnabled: false },
      { userId: MEMBER_B, inAppEnabled: true, emailEnabled: false, pushEnabled: true },
    ]
    mocks.inserted = [{ id: "job-a" }, { id: "job-b" }, { id: "job-c" }, { id: "job-d" }]
    const captured = harness()

    const result = await enqueueTournamentFollowerJobs({
      tenantId: TENANT, tournamentId: TOURNAMENT, type: "match_started",
      title: "Match started", body: "Live now", eventId: `match:${MATCH}:started`,
      matchId: MATCH,
    })

    expect(result).toEqual({
      fanout: 2, enqueued: 4, channels: { inApp: 2, email: 1, push: 1 },
    })
    expect(captured.values?.map(row => (row as { channel: string }).channel).sort())
      .toEqual(["email", "in_app", "in_app", "push"])
    expect(captured.values).toContainEqual(expect.objectContaining({
      recipientUserId: MEMBER_A, channel: "email",
    }))
    expect(captured.values).toContainEqual(expect.objectContaining({
      recipientUserId: MEMBER_B, channel: "push",
    }))
  })

  it("respects an explicit in-app opt-out and an absent preference row", async () => {
    mocks.followers = [
      { userId: MEMBER_A, inAppEnabled: false, emailEnabled: false, pushEnabled: false },
      { userId: MEMBER_B },
    ]
    const captured = harness()

    const result = await enqueueTournamentFollowerJobs({
      tenantId: TENANT, tournamentId: TOURNAMENT, type: "match_started",
      title: "t", body: "b", eventId: `match:${MATCH}:started`,
    })

    expect(result).toEqual({
      fanout: 2, enqueued: 1, channels: { inApp: 1, email: 0, push: 0 },
    })
    expect(captured.values).toHaveLength(1)
    expect(captured.values?.[0]).toMatchObject({ recipientUserId: MEMBER_B, channel: "in_app" })
  })

  it("refuses malformed tenant, tournament, match or event ids before any write", async () => {
    harness()
    const base = {
      tenantId: TENANT, tournamentId: TOURNAMENT, type: "match_started",
      title: "t", body: "b", eventId: "match:started",
    }
    await expect(enqueueTournamentFollowerJobs({ ...base, tenantId: "not-a-uuid" })).rejects.toThrow()
    await expect(enqueueTournamentFollowerJobs({ ...base, tournamentId: "nope" })).rejects.toThrow()
    await expect(enqueueTournamentFollowerJobs({ ...base, matchId: "nope" })).rejects.toThrow()
    await expect(enqueueTournamentFollowerJobs({ ...base, eventId: "short" })).rejects.toThrow()
    await expect(enqueueTournamentFollowerJobs({ ...base, unexpected: true } as any)).rejects.toThrow()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
