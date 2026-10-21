import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * ENH-03-03: the mobile BFF read boundary. The native app reads the league
 * through THESE routes, never through raw Supabase rows: an explicit member
 * DTO with resolved team names and the FULL fixture lifecycle vocabulary
 * (forfeited and postponed included), cursor pagination that can page past
 * 50 fixtures without truncation, and standings computed by the shared
 * canonical rule (v2), never re-derived on device.
 *
 * One documented mobile BFF convention: member reads live under
 * `/api/mobile/<resource>`, authenticate with the Clerk session, resolve the
 * tenant SERVER-SIDE (a query tenantId can never widen the read), and return
 * the shared contracts envelope. An alternative version prefix requires ADR
 * review. There is deliberately no second convention for native reads.
 */

const dbState = vi.hoisted(() => ({
  /** One entry per db.select() call, in call order; each resolves rows. */
  queued: [] as unknown[][],
  pages: [] as number[],
}))

function chainFor(resolveRows: unknown[]): unknown {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const method of ["from", "where", "orderBy", "limit", "leftJoin", "innerJoin", "groupBy", "having"]) {
    chain[method] = passthrough
  }
  chain.then = (onFulfilled: (rows: unknown[]) => any, onRejected?: any) =>
    Promise.resolve(resolveRows).then(onFulfilled, onRejected)
  return chain
}

vi.mock("@mtk/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mtk/database")>()
  const { db: _real, ...withoutDb } = actual as Record<string, unknown>
  return {
    ...withoutDb,
    db: {
      select: vi.fn(() => {
        dbState.pages.push(1)
        return chainFor(dbState.queued.shift() ?? [])
      }),
    },
  }
})

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: vi.fn() }))

import { auth } from "@clerk/nextjs/server"
import { resolveActiveTenantId } from "@/lib/rbac-server"
import { GET as fixturesGET } from "@/app/api/mobile/fixtures/route"
import { GET as fixtureGET } from "@/app/api/mobile/fixtures/[id]/route"
import { GET as standingsGET } from "@/app/api/mobile/standings/route"
import { computeStandings, STANDINGS_RULE_VERSION } from "@/lib/standings"
import { decodePageCursor, parseMobileFixturePage } from "@mtk/contracts"

const TENANT = "00000000-0000-4000-8000-000000000001"
const TOURNAMENT = "00000000-0000-4000-8000-000000000002"
const FOREIGN_TENANT = "00000000-0000-4000-8000-000000000099"
const TEAM_A = "00000000-0000-4000-8000-00000000000a"
const TEAM_B = "00000000-0000-4000-8000-00000000000b"
const TEAM_C = "00000000-0000-4000-8000-00000000000c"
const MATCH_ID = "00000000-0000-4000-8000-000000000000"

let seq = 0
function fixtureRow(status = "completed", scheduled = "2026-03-01T10:00:00.000Z") {
  seq += 1
  return {
    id: MATCH_ID.slice(0, -String(seq).length) + String(seq),
    tenantId: TENANT,
    tournamentId: TOURNAMENT,
    status,
    scheduledDate: new Date(scheduled),
    startedAt: null,
    completedAt: status === "completed" ? new Date(scheduled) : null,
    team1Id: TEAM_A,
    team2Id: TEAM_B,
    team1Name: null,
    team2Name: null,
    winnerId: status === "completed" ? TEAM_A : null,
    result: "Alpha XI won by 4 runs",
    tossWinnerId: TEAM_A,
    tossDecision: "bat",
    liveStreamUrl: null,
    streamStatus: "idle",
  }
}

const TEAM_ROWS = [
  { id: TEAM_A, name: "Alpha XI", shortName: "ALP" },
  { id: TEAM_B, name: "Beta XI", shortName: "BET" },
  { id: TEAM_C, name: "Gamma XI", shortName: "GAM" },
]

const NAME_ROWS = [
  { id: TEAM_A, name: "Alpha XI" },
  { id: TEAM_B, name: "Beta XI" },
  { id: TEAM_C, name: "Gamma XI" },
]

function requestWith(query: string): Request {
  return new Request(`http://localhost/api/mobile/${query}`, { headers: { "Content-Type": "application/json" } })
}

beforeEach(() => {
  vi.clearAllMocks()
  dbState.queued = []
  dbState.pages = []
  vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never)
  vi.mocked(resolveActiveTenantId).mockResolvedValue(TENANT)
})

describe("ENH-03-03: mobile fixtures BFF (member scope)", () => {
  it("pages more than 50 fixtures until exhaustion, without dropping or duplicating one", async () => {
    const all = Array.from({ length: 60 }, (_, i) => fixtureRow("completed", new Date(Date.UTC(2026, 2, 1 + i)).toISOString()))
    // Page request 1: the reader stops after 25, so 26 rows prove it.
    // Queue order mirrors the reader's calls: fixtures page, count, names.
    dbState.queued.push(all.slice(0, 26), [{ value: 60 }], NAME_ROWS)
    const page1 = await fixturesGET(requestWith("fixtures"))
    expect(page1.status).toBe(200)
    const body1 = parseMobileFixturePage(await page1.json())
    expect(body1.items).toHaveLength(25)
    expect(body1.revision).toBe(60)
    expect(page1.headers.get("x-mtk-tenant")).toBe(TENANT)
    const cursor = body1.nextCursor
    expect(cursor).not.toBeNull()
    expect(decodePageCursor(cursor as string)).toEqual({
      sortKey: new Date(Date.UTC(2026, 2, 25)).toISOString(),
      id: all[24].id,
    })

    // Page request 2: the keyset continues AFTER the anchor (the 26th row
    // of the fed window is its lookahead edge); enqueue its 26-row window.
    dbState.queued.push(all.slice(25, 51), [{ value: 60 }], NAME_ROWS)
    const page2 = await fixturesGET(requestWith(`fixtures?cursor=${encodeURIComponent(cursor as string)}`))
    const body2 = parseMobileFixturePage(await page2.json())
    expect(body2.items).toHaveLength(25)

    // Final page: everything the anchor has not passed yet.
    dbState.queued.push(all.slice(50, 60), [{ value: 60 }], NAME_ROWS)
    const page3 = await fixturesGET(requestWith(`fixtures?cursor=${encodeURIComponent(body2.nextCursor as string)}`))
    const body3 = parseMobileFixturePage(await page3.json())
    expect(body3.items.length).toBeGreaterThan(0)
    expect(body3.nextCursor).toBeNull()

    const seen = [...body1.items, ...body2.items, ...body3.items].map((f) => f.id)
    expect(new Set(seen).size).toBe(60)
  })

  it("keeps forfeited, postponed, cancelled and no-result states explicit", async () => {
    const statuses = ["forfeited", "postponed", "cancelled", "no_result", "abandoned"] as const
    const rows = statuses.map((status) => fixtureRow(status))
    dbState.queued.push(rows, [{ value: rows.length }], NAME_ROWS)
    const response = await fixturesGET(requestWith("fixtures"))
    const body = parseMobileFixturePage(await response.json())
    expect(body.items.map((f) => f.status)).toEqual(expect.arrayContaining(["forfeited", "postponed", "cancelled", "no_result", "abandoned"]))
    expect(body.items).toHaveLength(statuses.length)
  })

  it("serves resolved team names, never a raw row", async () => {
    dbState.queued.push([fixtureRow()], [{ value: 1 }], [{ id: TEAM_A, name: "Alpha XI" }, { id: TEAM_B, name: "Beta XI" }])
    const response = await fixturesGET(requestWith("fixtures"))
    const body = parseMobileFixturePage(await response.json())
    expect(body.items[0].team1Name).toBe("Alpha XI")
    expect(body.items[0].team2Name).toBe("Beta XI")
    expect(Object.keys(body.items[0]).sort()).toEqual([
      "completedAt", "id", "liveStreamUrl", "result", "scheduledDate",
      "startedAt", "status", "streamStatus", "team1Id", "team1Name",
      "team2Id", "team2Name", "tenantId", "tossDecision", "tossWinnerId",
      "tournamentId", "winnerId",
    ])
  })

  it("resolves the tenant server-side; a query tenantId can never widen the read", async () => {
    dbState.queued.push([fixtureRow()], [{ value: 1 }], NAME_ROWS)
    const response = await fixturesGET(requestWith(`fixtures?tenantId=${FOREIGN_TENANT}`))
    expect(response.status).toBe(200)
    expect(response.headers.get("x-mtk-tenant")).toBe(TENANT)
  })

  it("refuses garbage cursors and malformed tournament filters loudly", async () => {
    const badCursor = await fixturesGET(requestWith("fixtures?cursor=%%%not-a-cursor"))
    expect(badCursor.status).toBe(400)
    const badTournament = await fixturesGET(requestWith("fixtures?tournamentId=not-a-uuid"))
    expect(badTournament.status).toBe(400)
  })

  it("requires a session and an active league", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never)
    expect((await fixturesGET(requestWith("fixtures"))).status).toBe(401)
    vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never)
    vi.mocked(resolveActiveTenantId).mockResolvedValue(null)
    expect((await fixturesGET(requestWith("fixtures"))).status).toBe(403)
  })
})

describe("ENH-03-03: single fixture BFF", () => {
  it("returns the projected fixture with resolved names, 404 for a foreign or missing id", async () => {
    dbState.queued.push([fixtureRow()], [{ id: TEAM_A, name: "Alpha XI" }, { id: TEAM_B, name: "Beta XI" }])
    const found = await fixtureGET(new Request(`http://localhost/api/mobile/fixtures/${MATCH_ID.slice(0, -1)}1`), {      params: Promise.resolve({ id: `${MATCH_ID.slice(0, -1)}1` }),
    } as never)
    expect(found.status).toBe(200)
    const fixture = parseMobileFixturePage({ items: [await found.json()], nextCursor: null, revision: 1 }).items[0]
    expect(fixture.team1Name).toBe("Alpha XI")

    dbState.queued.push([]) // the foreign/missing id reads nothing
    const missing = await fixtureGET(new Request(`http://localhost/api/mobile/fixtures/${MATCH_ID}`), {
      params: Promise.resolve({ id: MATCH_ID }),
    } as never)
    expect(missing.status).toBe(404)
  })
})

describe("ENH-03-03: mobile canonical standings BFF", () => {
  it("computes the same table as the canonical rule v2 fold, including forfeited exclusions", async () => {
    const teams = TEAM_ROWS
    // Fake rows are POST-alias shapes: what drizzle's select() actually
    // resolves (teamAId/teamBId, same as the fixtures feed's team1Id/team2Id).
    const matchRows = [
      { id: "m1", teamAId: TEAM_A, teamBId: TEAM_B, status: "completed", winnerId: TEAM_A, groupLabel: null },
      { id: "m2", teamAId: TEAM_B, teamBId: TEAM_C, status: "no_result", winnerId: null, groupLabel: null },
      // A forfeited fixture is NOT a played fixture under rule v2 — the
      // canonical rule decides, not the transport.
      { id: "m3", teamAId: TEAM_A, teamBId: TEAM_C, status: "forfeited", winnerId: TEAM_A, groupLabel: null },
    ]
    const innings = [
      { matchId: "m1", teamId: TEAM_A, runs: 160, balls: 120 },
      { matchId: "m1", teamId: TEAM_B, runs: 140, balls: 120 },
    ]
    dbState.queued.push(teams, matchRows, innings)
    const response = await standingsGET(requestWith("standings"))
    expect(response.status).toBe(200)
    const body = await response.json()
    const expected = computeStandings({
      teams: teams.map(({ id, name, shortName }) => ({ id, name, shortName })),
      matches: [
        { matchId: "m1", teamAId: TEAM_A, teamBId: TEAM_B, status: "completed", winnerId: TEAM_A, groupLabel: null,
          innings: [{ teamId: TEAM_A, runs: 160, balls: 120 }, { teamId: TEAM_B, runs: 140, balls: 120 }] },
        { matchId: "m2", teamAId: TEAM_B, teamBId: TEAM_C, status: "no_result", winnerId: null, groupLabel: null, innings: [] },
        { matchId: "m3", teamAId: TEAM_A, teamBId: TEAM_C, status: "forfeited", winnerId: TEAM_A, groupLabel: null, innings: [] },
      ],
    })
    expect(body.ruleVersion).toBe(STANDINGS_RULE_VERSION)
    expect(body.rows).toEqual(expected)
    expect(body.revision).toBe(3)
  })

  it("requires a session and an active league, and pins the rule version it served", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never)
    expect((await standingsGET(requestWith("standings"))).status).toBe(401)
    vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never)
    vi.mocked(resolveActiveTenantId).mockResolvedValue(null)
    expect((await standingsGET(requestWith("standings"))).status).toBe(403)
  })
})
