import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"

/**
 * PUB-06 - unauthorized export access (route-level verification).
 *
 * GET /api/scorecards/[matchId]/pdf is the ONLY unauthenticated export on the
 * platform. It is safe because it is fail-closed:
 *   1. no resolvable public tenant  -> 404 before touching the database;
 *   2. unpublished (draft/cancelled/other-tenant) match -> 404 before any
 *      scorecard read;
 *   3. a match whose teams are not both in the request tenant -> 404;
 *   4. every query it does issue is tenant-pinned and projects explicit
 *      columns only (no full-row read leaks internal plumbing);
 *   5. it never consults Clerk auth - the export is public BY DESIGN, so it
 *      must not silently start depending on a session;
 *   6. it must not be publicly cacheable: after a tournament is withdrawn the
 *      exported HTML may not be served from a shared/browser cache.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  tenantContext: vi.fn(),
  readPublishedMatch: vi.fn(),
  select: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/public-tenant", () => ({ getPublicTenantContext: mocks.tenantContext }))
vi.mock("@/lib/public-visibility", () => ({ readPublishedMatch: mocks.readPublishedMatch }))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { select: mocks.select },
}))

import { GET } from "@/app/api/scorecards/[matchId]/pdf/route"
import {
  teams,
  matchInnings,
  players,
  battingScorecards,
  bowlingScorecards,
} from "@mtk/database"

const TENANT = "00000000-0000-4000-8000-0000000000aa"
const MATCH = "00000000-0000-4000-8000-0000000000bb"
const TEAM_A = "00000000-0000-4000-8000-0000000000a1"
const TEAM_B = "00000000-0000-4000-8000-0000000000b1"
const INNINGS = "00000000-0000-4000-8000-0000000000c1"
const BATTER = "00000000-0000-4000-8000-0000000000d1"

const PUBLISHED_MATCH = {
  id: MATCH,
  teamAId: TEAM_A,
  teamBId: TEAM_B,
  venueId: null,
  scheduledDate: new Date("2026-10-01T09:00:00Z"),
  matchFormat: "t20",
  totalOvers: 20,
  result: null,
  tossWinnerId: null,
  tossDecision: null,
}

const dialect = new PgDialect()

/** Result sets per table, consumed in query order. */
let queues: Map<unknown, unknown[][]>
/** Every WHERE condition the route built, for tenant-pinning assertions. */
let conditions: unknown[]

function rowsFor(table: unknown): unknown[] {
  const queue = queues.get(table)
  return queue && queue.length ? (queue.shift() as unknown[]) : []
}

function makeSelect() {
  let table: unknown
  const builder = {
    from: (t: unknown) => { table = t; return builder },
    where: (condition: unknown) => { conditions.push(condition); return builder },
    limit: () => Promise.resolve(rowsFor(table)),
    orderBy: () => Promise.resolve(rowsFor(table)),
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rowsFor(table)).then(resolve),
  }
  return builder
}

function queue(table: unknown, ...resultSets: unknown[][]) {
  queues.set(table, resultSets)
}

/** Queues the full happy-path result sets. */
function queueHappyPath() {
  queue(teams, [{ id: TEAM_A, name: "Alpha CC", shortName: "ALP" }], [{ id: TEAM_B, name: "Beta CC", shortName: "BET" }])
  queue(matchInnings, [{
    id: INNINGS, teamId: TEAM_A, totalRuns: 152, totalBalls: 118, totalWickets: 6, extras: 11,
  }])
  queue(battingScorecards, [{
    inningsId: INNINGS, battingPosition: 1, playerId: BATTER, bowlerId: null, fielderId: null,
    dismissalType: "not_out", dismissalText: null, runs: 74, ballsFaced: 52, fours: 8, sixes: 2,
  }])
  queue(bowlingScorecards, [{
    inningsId: INNINGS, bowlingPosition: 1, playerId: BATTER, ballsBowled: 24, maidens: 1,
    runsConceded: 27, wickets: 2, wides: 1, noBalls: 0,
  }])
  queue(players, [{ id: BATTER, name: "Sana Malik" }])
}

const callRoute = () => GET({} as never, { params: Promise.resolve({ matchId: MATCH }) })

beforeEach(() => {
  vi.resetAllMocks()
  queues = new Map()
  conditions = []
  mocks.select.mockImplementation(makeSelect)
  mocks.auth.mockResolvedValue({ userId: "clerk-export" })
  mocks.tenantContext.mockResolvedValue({ tenantId: TENANT })
  mocks.readPublishedMatch.mockResolvedValue(PUBLISHED_MATCH)
})

describe("PUB-06: scorecard PDF export is fail-closed", () => {
  it("404s when no public tenant resolves, before any match or scorecard read", async () => {
    mocks.tenantContext.mockResolvedValue(null)
    queueHappyPath()

    const response = await callRoute()

    expect(response.status).toBe(404)
    expect(mocks.readPublishedMatch).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("404s for an unpublished or foreign-tenant match without reading any scorecard", async () => {
    mocks.readPublishedMatch.mockResolvedValue(null)
    queueHappyPath()

    const response = await callRoute()

    expect(response.status).toBe(404)
    expect(mocks.readPublishedMatch).toHaveBeenCalledWith(TENANT, MATCH)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("404s when one of the match teams is not in the request tenant", async () => {
    // The cross-tenant team row is filtered out by the tenant-pinned read.
    queue(teams, [{ id: TEAM_A, name: "Alpha CC", shortName: "ALP" }], [])

    const response = await callRoute()

    expect(response.status).toBe(404)
    // Only the two team lookups ran - no innings/scorecard/ball-by-ball read.
    expect(mocks.select).toHaveBeenCalledTimes(2)
  })

  it("never consults Clerk auth - the export is public by design", async () => {
    queueHappyPath()

    const response = await callRoute()

    expect(response.status).toBe(200)
    expect(mocks.auth).not.toHaveBeenCalled()
  })
})

describe("PUB-06: scorecard PDF export read discipline", () => {
  it("renders the published scorecard with tenant-pinned, explicit-column reads", async () => {
    queueHappyPath()

    const response = await callRoute()

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8")
    const body = await response.text()
    expect(body).toContain("Alpha CC")
    expect(body).toContain("Beta CC")
    expect(body).toContain("Sana Malik")
    expect(body).toContain("152/6")

    // Every projection lists explicit columns - a select()-everything drift
    // would hand a full row (tenant refs, sync keys) to an unauthenticated
    // response.
    for (const [projection] of mocks.select.mock.calls) {
      expect(projection).toBeTypeOf("object")
      expect(Object.keys(projection as object).length).toBeGreaterThan(0)
    }

    // Every WHERE the route built pins the request tenant.
    expect(conditions.length).toBeGreaterThanOrEqual(4)
    for (const condition of conditions) {
      expect(dialect.sqlToQuery(condition as never).params).toContain(TENANT)
    }
  })

  it("is not publicly cacheable, so a withdrawn tournament's export cannot be re-served", async () => {
    queueHappyPath()

    const response = await callRoute()

    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(response.headers.get("Cache-Control")).not.toContain("public")
  })
})
