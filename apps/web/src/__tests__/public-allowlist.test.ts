import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  readPublishedTournament, readPublishedTournaments, readPublishedHallOfFame,
  readPublishedMatch, readPublishedMatchTeams,
} from "@/lib/public-visibility"

/**
 * PUB-06: public field allowlist regressions. The unauthenticated surface
 * receives ONLY the disclosed fields - provenance (createdBy), authority
 * (captainId/managerId, competition locks) and tenant plumbing never leave
 * the server, even when the row itself passed the publication gate.
 *
 * The fake db PROJECTS each queued full row (with planted secrets) onto the
 * caller's selected columns -faithfully emulating drizzle. A future
 * "just select everything" refactor resolves to the planted secrets and
 * fails here instead of leaking.
 */

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const TOURNAMENT = "00000000-0000-4000-8000-0000000000b1"
const MATCH = "00000000-0000-4000-8000-0000000000c1"
const TEAM_A = "00000000-0000-4000-8000-0000000000d1"
const TEAM_B = "00000000-0000-4000-8000-0000000000d2"

const queue: Record<string, unknown>[][] = []

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    // cols is present for allowlisted selects; WITHOUT it (select()) the full
    // row flows through - exactly the behavior this suite must catch.
    select: (cols?: Record<string, unknown>) => ({
      from: () => {
        // Terminal shapes served per read: limit-terminated single reads,
        // orderBy-terminated list reads (tournament index) AND
        // orderBy().limit() reads (hall of fame) - so orderBy returns a
        // thenable that also carries limit, projecting identically at every
        // terminal.
        const project = async () => {
          const rows = queue.shift() ?? []
          if (!cols) return rows
          const aliases = Object.keys(cols)
          return rows.map(row => Object.fromEntries(aliases.map(alias => [alias, row[alias] ?? null])))
        }
        const terminals = () => ({
          limit: project,
          orderBy: () => ({
            then: (onFulfilled?: (rows: Record<string, unknown>[]) => unknown, onRejected?: (err: unknown) => unknown) =>
              project().then(onFulfilled, onRejected),
            catch: (onRejected: (err: unknown) => unknown) => project().catch(onRejected),
            limit: project,
          }),
        })
        return {
          // Join-shaped reads (hall of fame: tournaments INNER JOIN teams)
          // resolve the ON clause in innerJoin, THEN hit where(); the
          // projection discipline is identical at the terminal.
          innerJoin: () => ({ where: terminals }),
          where: terminals,
        }
      },
    }),
  },
}))

beforeEach(() => {
  queue.length = 0
})

const fullTournamentRow = {
  id: TOURNAMENT, tenantId: TENANT, name: "Autumn Cup", slug: "autumn-cup",
  description: "A cup", format: "knockout", startDate: "2026-10-01", endDate: "2026-10-30",
  registrationOpen: true, competitionLockedAt: new Date(), competitionLockedBy: TEAM_B,
  createdBy: "00000000-0000-4000-8000-0000000000ee",
  createdAt: new Date(), updatedAt: new Date(), status: "live", championTeamId: null,
}

const fullMatchRow = {
  id: MATCH, tenantId: TENANT, tournamentId: null, matchNumber: 3, status: "scheduled",
  matchFormat: "t20", matchType: "group", totalOvers: 20,
  scheduledDate: "2026-10-20", venueId: null, teamAId: TEAM_A, teamBId: TEAM_B,
  tossWinnerId: TEAM_A, tossDecision: "bat", winnerId: null, result: null,
  manOfMatchId: null, streamSource: "youtube", streamStatus: "scheduled",
  liveStreamUrl: "https://youtube.com/x", createdBy: "00000000-0000-4000-8000-0000000000ef",
  scoringSessionId: "00000000-0000-4000-8000-0000000000f1",
  createdAt: new Date(), updatedAt: new Date(),
}

const fullTeamRow = (id: string, name: string) => ({
  id, tenantId: TENANT, tournamentId: TOURNAMENT, name, shortName: "SN",
  slug: `slug-${id}`, description: "internal", city: "Lahore",
  logoUrl: null, bannerUrl: "https://banner", primaryColor: "#102030",
  secondaryColor: "#403020", captainId: "00000000-0000-4000-8000-0000000000ca",
  managerId: "00000000-0000-4000-8000-0000000000cb", jerseyColor: "green",
  homeGround: "Gaddafi", foundedYear: 2019, maxSquadSize: 15, isActive: true,
  createdBy: "00000000-0000-4000-8000-0000000000cc",
  createdAt: new Date(), updatedAt: new Date(),
})

describe("PUB-06: tournament allowlist", () => {
  it("returns exactly the disclosed fields - no provenance, no locks, no tenant plumbing", async () => {
    queue.push([fullTournamentRow])
    const row = await readPublishedTournament(TENANT, TOURNAMENT)
    expect(row).not.toBeNull()
    expect(Object.keys(row as object).sort()).toEqual([
      "championTeamId", "description", "endDate", "format", "id", "name",
      "startDate", "status",
    ])
    expect(JSON.stringify(row)).not.toContain("createdBy")
    expect(JSON.stringify(row)).not.toContain("competitionLocked")
  })

  it("index reader: every listed row carries exactly the disclosed fields - planted secrets are dropped by the projection", async () => {
    // A full row (as a careless select() would return it) with provenance,
    // tenant plumbing and locks planted for this regression.
    queue.push([{
      ...fullTournamentRow,
      tenantId: TENANT,
      slug: "autumn-cup",
      registrationOpen: true,
      competitionLockedAt: new Date(),
      competitionLockedBy: TEAM_B,
      createdBy: "00000000-0000-4000-8000-0000000000ee",
    }])
    const rows = await readPublishedTournaments(TENANT)
    expect(rows).toHaveLength(1)
    expect(Object.keys(rows[0]).sort()).toEqual([
      "championTeamId", "description", "endDate", "format", "id", "name",
      "startDate", "status",
    ])
    expect(JSON.stringify(rows)).not.toContain("createdBy")
    expect(JSON.stringify(rows)).not.toContain("competitionLocked")
    expect(JSON.stringify(rows)).not.toContain("tenantId")
  })

  it("hall of fame: only the aggregate champion record is disclosed - planted team provenance is dropped", async () => {
    // A careless select() on the tournaments+teams join would flow the full
    // rows through: team captain/manager ids, provenance, tenant plumbing.
    // The projection must pass exactly the five disclosed fields.
    queue.push([{
      tournamentId: TOURNAMENT,
      name: "Champions Cup",
      championTeamId: TEAM_A,
      championTeamName: "Title Holders",
      updatedAt: new Date("2026-10-18T00:00:00Z"),
      tenantId: TENANT,
      slug: "champions-cup",
      competitionLockedBy: "00000000-0000-4000-8000-0000000000ee",
      captainId: "00000000-0000-4000-8000-0000000000ca",
      managerId: "00000000-0000-4000-8000-0000000000cb",
    }])
    const entries = await readPublishedHallOfFame(TENANT)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      tournamentId: TOURNAMENT,
      name: "Champions Cup",
      championTeamId: TEAM_A,
      championTeamName: "Title Holders",
      completedAt: "2026-10-18T00:00:00.000Z",
    })
    expect(JSON.stringify(entries)).not.toContain("captainId")
    expect(JSON.stringify(entries)).not.toContain("managerId")
    expect(JSON.stringify(entries)).not.toContain("competitionLocked")
    expect(JSON.stringify(entries)).not.toContain("tenantId")
  })
})

describe("PUB-06: match allowlist", () => {
  it("returns exactly the disclosed fields - no scoring session, no author", async () => {
    // Friendlies path (tournamentId null) keeps the harness to one select.
    queue.push([fullMatchRow])
    const row = await readPublishedMatch(TENANT, MATCH)
    expect(row).not.toBeNull()
    expect(Object.keys(row as object).sort()).toEqual([
      "id", "liveStreamUrl", "manOfMatchId", "matchFormat", "matchType",
      "result", "scheduledDate", "status", "streamSource", "streamStatus",
      "teamAId", "teamBId", "tossDecision", "tossWinnerId", "totalOvers",
      "tournamentId", "venueId", "winnerId",
    ])
    expect(JSON.stringify(row)).not.toContain("createdBy")
    expect(JSON.stringify(row)).not.toContain("scoringSessionId")
  })

  it("hides a match whose parent tournament is unpublished (two-gate rule intact)", async () => {
    queue.push([{ ...fullMatchRow, tournamentId: TOURNAMENT }])
    queue.push([{ status: "draft" }])
    expect(await readPublishedMatch(TENANT, MATCH)).toBeNull()
  })

  it("hides a match with a broken parent reference (fail closed)", async () => {
    queue.push([{ ...fullMatchRow, tournamentId: TOURNAMENT }])
    queue.push([])
    expect(await readPublishedMatch(TENANT, MATCH)).toBeNull()
  })
})

describe("PUB-06: team allowlist", () => {
  it("returns exactly the disclosed identity fields - never captain/manager/author ids", async () => {
    queue.push([fullTeamRow(TEAM_A, "Lions")])
    queue.push([fullTeamRow(TEAM_B, "Eagles")])
    const { teamA, teamB } = await readPublishedMatchTeams(TENANT, { teamAId: TEAM_A, teamBId: TEAM_B })
    const expectedKeys = [
      "city", "foundedYear", "homeGround", "id", "logoUrl", "name",
      "primaryColor", "secondaryColor", "shortName",
    ]
    expect(Object.keys(teamA as object).sort()).toEqual(expectedKeys)
    expect(Object.keys(teamB as object).sort()).toEqual(expectedKeys)
    const serialized = JSON.stringify({ teamA, teamB })
    expect(serialized).not.toContain("captainId")
    expect(serialized).not.toContain("managerId")
    expect(serialized).not.toContain("createdBy")
    expect(serialized).not.toContain("bannerUrl")
  })
})
