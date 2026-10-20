import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  decodeCursor,
  encodeCursor,
  encodeNameKeyset,
  type MemberPlayer,
  type MemberTeam,
} from "@mtk/contracts"
import { PgDialect } from "drizzle-orm/pg-core"
import {
  parseMemberDirectoryListQuery,
  parseMemberMatchListQuery,
  readAnnouncements,
  readMemberPlayer,
  readMemberPlayers,
  readMemberTeams,
} from "@/lib/mobile-bff"

const mocks = vi.hoisted(() => ({
  joined: vi.fn(),
  leftJoined: vi.fn(),
  filtered: vi.fn(),
  ordered: vi.fn(),
  paged: vi.fn(),
}))

vi.mock("@mtk/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mtk/database")>()
  mocks.joined.mockReturnThis()
  mocks.leftJoined.mockReturnThis()
  mocks.filtered.mockReturnThis()
  mocks.ordered.mockReturnThis()
  mocks.paged.mockReturnThis()
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: mocks.joined,
    leftJoin: mocks.leftJoined,
    where: mocks.filtered,
    orderBy: mocks.ordered,
    limit: mocks.paged,
  }
  return { ...actual, db: { select: vi.fn(() => chain) } }
})

const TENANT = "00000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.clearAllMocks()
  // Reset implementations AND once-queues: a query that terminates at
  // .orderBy (the stats read) never consumes the .limit mock queue, and a
  // leftover value must not bleed into the next test.
  for (const m of [mocks.joined, mocks.leftJoined, mocks.filtered, mocks.ordered, mocks.paged]) {
    m.mockReset()
    m.mockReturnThis()
  }
})

describe("directory list query parsing", () => {
  it("inherits the page ceiling from the shared parser", () => {
    expect(parseMemberDirectoryListQuery({})).toMatchObject({ ok: true, query: { cursor: null, limit: 25 } })
    expect(parseMemberDirectoryListQuery({ limit: "500" }).ok).toBe(false)
    expect(parseMemberDirectoryListQuery({ limit: "50" })).toMatchObject({ ok: true, query: { limit: 50 } })
  })

  it("refuses corrupted cursors and name-keyset junk, accepts a valid roundtrip", () => {
    expect(parseMemberDirectoryListQuery({ cursor: "junk" }).ok).toBe(false)
    expect(parseMemberDirectoryListQuery({ cursor: encodeCursor({ v: 1, after: "no-tilde" }) }).ok).toBe(false)
    const valid = encodeCursor({ v: 1, after: encodeNameKeyset("Alpha XI", "00000000-0000-4000-8000-00000000000a") })
    expect(parseMemberDirectoryListQuery({ cursor: valid })).toMatchObject({ ok: true })
  })

  it("validates the matches teamId fixtures filter as a uuid", () => {
    expect(parseMemberMatchListQuery({ teamId: "nope" }).ok).toBe(false)
    expect(parseMemberMatchListQuery({ teamId: "00000000-0000-4000-8000-0000000000a1" })).toMatchObject({ ok: true, query: { teamId: "00000000-0000-4000-8000-0000000000a1" } })
    expect(parseMemberMatchListQuery({})).toMatchObject({ ok: true, query: { teamId: null } })
  })
})

describe("member teams read", () => {
  it("returns the PublicTeam disclosure set with a name-keyset continuation", async () => {
    const rows = [
      { id: "00000000-0000-4000-8000-00000000000a", name: "Alpha XI", shortName: "ALP", city: null, logoUrl: null, primaryColor: null, secondaryColor: null, homeGround: null, foundedYear: null },
      { id: "00000000-0000-4000-8000-00000000000b", name: "Beta CC", shortName: null, city: null, logoUrl: null, primaryColor: null, secondaryColor: null, homeGround: null, foundedYear: null },
      { id: "00000000-0000-4000-8000-00000000000c", name: "Gamma CC", shortName: null, city: null, logoUrl: null, primaryColor: null, secondaryColor: null, homeGround: null, foundedYear: null },
    ]
    mocks.paged.mockResolvedValueOnce(rows)
    const page = await readMemberTeams({ tenantId: TENANT, query: { cursor: null, limit: 2 } })
    expect(page.items).toHaveLength(2)
    expect((page.items[0] as MemberTeam).name).toBe("Alpha XI")
    expect(page.nextCursor).not.toBeNull()
    const marker = decodeCursor(page.nextCursor!)!
    // name~id, split on the LAST tilde so names containing '~' survive:
    expect(marker.after.endsWith("~00000000-0000-4000-8000-00000000000b")).toBe(true)
    expect(parseMemberDirectoryListQuery({ cursor: page.nextCursor }).ok).toBe(true)
    // Tenant scoping is bound in the where clause:
    const rendered = new PgDialect().sqlToQuery(mocks.filtered.mock.calls[0][0])
    expect(rendered.params.map(String).join("\n")).toContain(TENANT)
  })
})

describe("member players read", () => {
  const PLAYER_ROWS = (teamId: string | null) => [
    {
      id: "00000000-0000-4000-8000-0000000000a1",
      name: "Aman Verma",
      teamId,
      teamName: "Alpha XI",
      jerseyNumber: 7,
      role: "batsman",
      battingStyle: "right",
      bowlingStyle: null,
    },
  ]

  it("projects the roster with the joined team name and typed vocabulary", async () => {
    mocks.paged.mockResolvedValueOnce(PLAYER_ROWS("00000000-0000-4000-8000-00000000000a"))
    const page = await readMemberPlayers({
      tenantId: TENANT,
      teamId: "00000000-0000-4000-8000-00000000000a",
      query: { cursor: null, limit: 25 },
    })
    expect(page.items).toHaveLength(1)
    const player = page.items[0] as MemberPlayer
    expect(player.teamName).toBe("Alpha XI")
    expect(player.role).toBe("batsman")
    expect(player.battingStyle).toBe("right")
    expect(player.seasonStats).toBeUndefined()
    const rendered = new PgDialect().sqlToQuery(mocks.filtered.mock.calls[0][0])
    const bound = rendered.params.map(String).join("\n")
    expect(bound).toContain(TENANT)
    expect(bound).toContain("00000000-0000-4000-8000-00000000000a")
  })

  it("embeds per-tournament season stats on the single read", async () => {
    const statsRows = [
      {
        id: "00000000-0000-4000-8000-0000000000s1",
        tenantId: TENANT,
        playerId: "00000000-0000-4000-8000-000000000001",
        tournamentId: "00000000-0000-4000-8000-0000000000t1",
          matchesPlayed: 5,
          runsScored: 212,
          ballsFaced: 180,
          inningsBatted: 5,
          notOuts: 1,
          fours: 20,
          sixes: 8,
          highestScore: 78,
          isHighestScoreNotOut: false,
          fifties: 2,
          hundreds: 0,
          ducks: 0,
          battingAverage: "53.00",
          strikeRate: "117.78",
          wicketsTaken: 0,
          oversBowled: "0.0",
          ballsBowled: 0,
          runsConceded: 0,
          inningsBowled: 0,
          maidens: 0,
          bowlingAverage: null,
          economyRate: null,
          bowlingStrikeRate: null,
          bestBowlingWickets: 0,
          bestBowlingRuns: 0,
          fourWicketHauls: 0,
          fiveWicketHauls: 0,
          catches: 3,
          runOuts: 1,
          stumpings: 0,
          lastUpdatedMatchId: null,
          createdAt: new Date("2026-10-01T00:00:00Z"),
          updatedAt: new Date("2026-10-01T00:00:00Z"),
      },
    ]
    // Query 1 (player) terminates at .limit; query 2 (stats) terminates at
    // .orderBy with no limit - so the stats rows come from the ordered mock.
    mocks.paged.mockResolvedValueOnce(PLAYER_ROWS("00000000-0000-4000-8000-00000000000a"))
    mocks.ordered.mockResolvedValueOnce(statsRows)
    const player = await readMemberPlayer({
      tenantId: TENANT,
      playerId: "00000000-0000-4000-8000-000000000001",
    })
    expect(player).not.toBeNull()
    expect(player!.seasonStats).toHaveLength(1)
    expect(player!.seasonStats![0].tournamentId).toBe("00000000-0000-4000-8000-0000000000t1")
    // Decimals stay EXACT strings - the client never re-rounds:
    expect(player!.seasonStats![0].strikeRate).toBe("117.78")
  })

  it("returns null for a player outside the caller's league", async () => {
    mocks.paged.mockResolvedValueOnce([])
    expect(await readMemberPlayer({ tenantId: TENANT, playerId: "00000000-0000-4000-8000-000000000099" })).toBeNull()
  })
})

describe("announcements read", () => {
  const ANN_ROWS = (n: number) =>
    // Newest-first (the reader preserves DB order; the query orders DESC).
    Array.from({ length: n }, (_, i) => ({
      id: `00000000-0000-4000-8000-0000000000a${i}`,
      title: `Notice ${n - 1 - i}`,
      message: `Body ${n - 1 - i}`,
      type: "info",
      priority: "medium",
      isActive: true,
      targetAudience: "all",
      startDate: null,
      endDate: null,
      actionUrl: i === 0 ? "https://example.com/cts" : null,
      actionText: i === 0 ? "Read more" : null,
      createdBy: null,
      createdAt: new Date(`2026-10-${String(10 + (n - 1 - i)).padStart(2, "0")}T00:00:00Z`),
      updatedAt: new Date(`2026-10-${String(10 + (n - 1 - i)).padStart(2, "0")}T00:00:00Z`),
    }))

  it("serves the public view with summary/gate mapping and timestamp keyset", async () => {
    mocks.paged.mockResolvedValueOnce(ANN_ROWS(3))
    const page = await readAnnouncements({ tenantId: null, tenantPlan: null, query: { cursor: null, limit: 25 } })
    expect(page.items).toHaveLength(3)
    expect(page.items[0]).toMatchObject({ title: "Notice 2", summary: "Body 2", type: "info", priority: "medium" })
    expect(page.items[0].publishedAt).toBe("2026-10-12T00:00:00.000Z")
    expect(page.items[0].actionText).toBe("Read more")
    expect(page.nextCursor).toBeNull()
    const clause = mocks.filtered.mock.calls[0][0]
    const rendered = new PgDialect().sqlToQuery(clause)
    // Signed-out audience gate: only the 'all' branch, bound as a param.
    expect(rendered.params.map(String).join("\n")).toContain("all")
  })

  it("adds plan and tenant targeting for a signed-in member", async () => {
    mocks.paged.mockResolvedValueOnce(ANN_ROWS(1))
    await readAnnouncements({
      tenantId: TENANT,
      tenantPlan: "enterprise",
      query: { cursor: null, limit: 25 },
    })
    const clause = mocks.filtered.mock.calls[0][0]
    const rendered = new PgDialect().sqlToQuery(clause)
    const bound = rendered.params.map(String).join("\n")
    expect(bound).toContain("enterprise")
    expect(bound).toContain(TENANT)
  })

  it("mints a continuation cursor from the last announcement when the list continues", async () => {
    mocks.paged.mockResolvedValueOnce(ANN_ROWS(3))
    const page = await readAnnouncements({ tenantId: null, tenantPlan: null, query: { cursor: null, limit: 2 } })
    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).not.toBeNull()
    expect(parseMemberDirectoryListQuery({ cursor: page.nextCursor }).ok).toBe(true)
  })
})
