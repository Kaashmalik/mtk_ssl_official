import { beforeEach, describe, expect, it, vi } from "vitest"
import { decodeCursor, encodeCursor, encodeMemberMatchKeyset, type MemberMatch } from "@mtk/contracts"
import { PgDialect } from "drizzle-orm/pg-core"
import { parseMemberMatchListQuery, readMemberMatchPage } from "@/lib/mobile-bff"
import { GET } from "@/app/api/mobile/matches/route"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveTenant: vi.fn(),
  joined: vi.fn(),
  filtered: vi.fn(),
  ordered: vi.fn(),
  paged: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.resolveTenant }))

vi.mock("@mtk/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mtk/database")>()
  // The exact chain readMemberMatchPage builds:
  // select(...).from(...).innerJoin(...).innerJoin(...).where(...).orderBy(...).limit(...)
  mocks.joined.mockReturnThis()
  mocks.filtered.mockReturnThis()
  mocks.ordered.mockReturnThis()
  mocks.paged.mockReturnThis()
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: mocks.joined,
    where: mocks.filtered,
    orderBy: mocks.ordered,
    limit: mocks.paged,
  }
  return { ...actual, db: { select: vi.fn(() => chain) } }
})

const TENANT = "00000000-0000-4000-8000-000000000001"
const USER = "user_clerk"
const TEAM_A = "00000000-0000-4000-8000-00000000000a"
const TEAM_B = "00000000-0000-4000-8000-00000000000b"

const MATCH_ROW = (overrides: {
  id: string
  status: string
  createdAt: Date
  scheduledDate: Date | null
  result?: string | null
}) => ({
  id: overrides.id,
  tenantId: TENANT,
  tournamentId: null,
  teamAId: TEAM_A,
  teamBId: TEAM_B,
  venueId: null,
  matchNumber: 1,
  scheduledDate: overrides.scheduledDate,
  matchFormat: "t20",
  matchType: "group",
  totalOvers: 20,
  status: overrides.status,
  tossWinnerId: null,
  tossDecision: null,
  winnerId: null,
  result: overrides.result ?? null,
  manOfMatchId: null,
  liveStreamUrl: null,
  streamSource: null,
  streamStatus: "idle",
  createdAt: overrides.createdAt,
  updatedAt: overrides.createdAt,
})

function bffRows() {
  // Newest-first fixture: three matches, covering the previously-invisible states.
  return [
    {
      match: MATCH_ROW({
        id: "00000000-0000-4000-8000-00000000m1",
        status: "postponed",
        createdAt: new Date("2026-10-20T10:00:00Z"),
        scheduledDate: new Date("2026-10-21T09:00:00Z"),
      }),
      teamAName: "Alpha XI",
      teamBName: "Beta CC",
    },
    {
      match: MATCH_ROW({
        id: "00000000-0000-4000-8000-00000000m2",
        status: "forfeited",
        createdAt: new Date("2026-10-19T10:00:00Z"),
        scheduledDate: new Date("2026-10-20T09:00:00Z"),
        result: "Beta CC won by forfeit",
      }),
      teamAName: "Alpha XI",
      teamBName: "Beta CC",
    },
    {
      match: MATCH_ROW({
        id: "00000000-0000-4000-8000-00000000m3",
        status: "live",
        createdAt: new Date("2026-10-18T10:00:00Z"),
        scheduledDate: new Date("2026-10-19T09:00:00Z"),
      }),
      teamAName: "Alpha XI",
      teamBName: "Beta CC",
    },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ userId: USER })
  mocks.resolveTenant.mockResolvedValue(TENANT)
})

describe("mobile BFF match list query parsing", () => {
  it("defaults to the documented page size and no status filter", () => {
    const parsed = parseMemberMatchListQuery({})
    expect(parsed).toMatchObject({ ok: true, query: { cursor: null, limit: 25, status: null, teamId: null } })
  })

  it("caps the page at the documented ceiling and refuses non-integers", () => {
    expect(parseMemberMatchListQuery({ limit: "50" })).toMatchObject({ ok: true, query: { limit: 50 } })
    expect(parseMemberMatchListQuery({ limit: "500" }).ok).toBe(false)
    expect(parseMemberMatchListQuery({ limit: "abc" }).ok).toBe(false)
    expect(parseMemberMatchListQuery({ limit: "0" }).ok).toBe(false)
  })

  it("validates status against the COMPLETE 10-value vocabulary - including the states the native union used to miss", () => {
    expect(parseMemberMatchListQuery({ status: "forfeited" })).toMatchObject({ ok: true, query: { status: "forfeited" } })
    expect(parseMemberMatchListQuery({ status: "postponed" })).toMatchObject({ ok: true, query: { status: "postponed" } })
    expect(parseMemberMatchListQuery({ status: "all" })).toMatchObject({ ok: true, query: { status: null } })
    expect(parseMemberMatchListQuery({ status: "cancelled" })).toMatchObject({ ok: true, query: { status: "cancelled" } })
    expect(parseMemberMatchListQuery({ status: "bogus" }).ok).toBe(false)
  })

  it("refuses a corrupted cursor instead of silently rewinding to page one", () => {
    expect(parseMemberMatchListQuery({ cursor: "not-a-cursor" }).ok).toBe(false)
    // A structurally valid envelope whose keyset marker is junk:
    expect(parseMemberMatchListQuery({ cursor: encodeCursor({ v: 1, after: "junk" }) }).ok).toBe(false)
    const valid = encodeCursor({
      v: 1,
      after: encodeMemberMatchKeyset("2026-10-20T10:00:00.000Z", "00000000-0000-4000-8000-00000000m1"),
    })
    expect(parseMemberMatchListQuery({ cursor: valid }).ok).toBe(true)
  })
})

describe("mobile BFF match page reader", () => {
  it("projects member rows (team names joined) with dates serialized to ISO", async () => {
    mocks.paged.mockResolvedValueOnce(bffRows().slice(0, 2))
    const page = await readMemberMatchPage({
      userId: USER,
      tenantId: TENANT,
      query: { cursor: null, limit: 2, status: null, teamId: null },
    })
    expect(page.items).toHaveLength(2)
    const postponed = page.items[0]
    expect(postponed.status).toBe("postponed")
    expect(postponed.teamAName).toBe("Alpha XI")
    expect(postponed.teamBName).toBe("Beta CC")
    expect(postponed.scheduledDate).toBe("2026-10-21T09:00:00.000Z")
    // Fetch asked for 2, got exactly 2 (from a mock handing back only two
    // rows): the reader treats "rows.length <= limit" as the list's end,
    // which is the correct keyset contract - only an OVERFLOW row (the
    // limit+1th) proves more pages exist.
    expect(page.nextCursor).toBeNull()
  })

  it("mints the next cursor from the last returned row when the list continues", async () => {
    const rows = bffRows()
    mocks.paged.mockResolvedValueOnce(rows)
    const page = await readMemberMatchPage({
      userId: USER,
      tenantId: TENANT,
      query: { cursor: null, limit: 2, status: null, teamId: null },
    })
    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).not.toBeNull()
    const marker = decodeCursor(page.nextCursor!)!
    const [iso, id] = marker.after.split("~")
    expect(id).toBe("00000000-0000-4000-8000-00000000m2")
    expect(Date.parse(iso)).not.toBeNaN()
    // Feeding the cursor back in must parse as a valid continuation:
    expect(parseMemberMatchListQuery({ cursor: page.nextCursor }).ok).toBe(true)
    expect(page.items.map((m) => m.id)).toEqual([rows[0].match.id, rows[1].match.id])
  })

  it("scopes the query to the caller's tenant, requested status and keyset marker", async () => {
    mocks.paged.mockResolvedValueOnce([])
    const cursor = encodeCursor({
      v: 1,
      after: encodeMemberMatchKeyset("2026-10-18T10:00:00.000Z", "00000000-0000-4000-8000-00000000m3"),
    })
    await readMemberMatchPage({
      userId: USER,
      tenantId: TENANT,
      query: { cursor, limit: 25, status: "forfeited", teamId: null },
    })
    // Parameterized SQL renders placeholders - the concrete values live in
    // `params`, so the assertion inspects those, never the SQL text.
    const clause = mocks.filtered.mock.calls[0][0]
    const rendered = new PgDialect().sqlToQuery(clause)
    const bound = rendered.params.map((p) => String(p)).join("\n")
    expect(bound).toContain(TENANT)
    expect(bound).toContain("forfeited")
    expect(bound).toContain("2026-10-18T10:00:00")
    expect(bound).toContain("00000000-0000-4000-8000-00000000m3")
  })
})

describe("mobile BFF route boundary", () => {
  it("refuses an unauthenticated call before touching the tenant or the database", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    const res = await GET(new Request("https://x.test/api/mobile/matches"))
    expect(res.status).toBe(401)
    expect(mocks.resolveTenant).not.toHaveBeenCalled()
    expect(mocks.paged).not.toHaveBeenCalled()
  })

  it("refuses a signed-in user with no active league (no tenant guessing)", async () => {
    mocks.resolveTenant.mockResolvedValueOnce(null)
    const res = await GET(new Request("https://x.test/api/mobile/matches"))
    expect(res.status).toBe(403)
    expect(mocks.paged).not.toHaveBeenCalled()
  })

  it("maps an invalid query to 400 with the documented reason", async () => {
    const res = await GET(new Request("https://x.test/api/mobile/matches?limit=9999"))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; detail: string }
    expect(body.error).toBe("invalid_query")
    expect(body.detail).toContain("limit")
  })

  it("serves a page with no-store caching (member data never sits in a shared cache)", async () => {
    mocks.paged.mockResolvedValueOnce(bffRows())
    const res = await GET(new Request("https://x.test/api/mobile/matches"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const body = (await res.json()) as { items: MemberMatch[]; nextCursor: string | null; version: number }
    expect(body.items).toHaveLength(3)
    expect(body.nextCursor).toBeNull()
    expect(body.version).toBe(1)
  })

  it("rejects a malformed matchId before any query", async () => {
    const res = await GET(new Request("https://x.test/api/mobile/matches?matchId=not-a-uuid"))
    expect(res.status).toBe(400)
    expect(mocks.paged).not.toHaveBeenCalled()
  })

  it("serves the single member projection inside the list envelope (zero or one items, null cursor)", async () => {
    const rows = bffRows()
    mocks.paged.mockResolvedValueOnce([rows[0]])
    const res = await GET(new Request("https://x.test/api/mobile/matches?matchId=00000000-0000-4000-8000-0000000000a1"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: MemberMatch[]; nextCursor: string | null }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].status).toBe("postponed")
    // ENH-08-03: an unpublished/postponed fixture has no public playback
    // claim, even on the member read.
    expect(body.items[0].playback).toEqual({ state: "unavailable", hasReplay: false })
    expect(body.nextCursor).toBeNull()
  })
})
