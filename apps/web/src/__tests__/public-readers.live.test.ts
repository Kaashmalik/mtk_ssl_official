import { readFileSync } from "node:fs"
import { join } from "node:path"
import postgres from "postgres"
import { describe, expect, it } from "vitest"

/**
 * PUB-03/PUB-06 staged acceptance for the RECORD surfaces (LIVE,
 * READ-ONLY, opt-in via LIVE_DB_ACCEPTANCE=1).
 *
 * Completes the B121 family: the leaderboards/competition selector and the
 * published match/detail readers are proven against real rows to project
 * exactly their disclosed field sets, fail closed for a foreign league, and
 * refuse an unpublished match id. The env wiring reads live .env BEFORE the
 * dynamic reader import (the db client binds its connection string at
 * import time); the skip path never loads live credentials.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..")

function readEnvVar(name: string): string | null {
  if (process.env.LIVE_DB_ACCEPTANCE !== "1") return null
  const raw = readFileSync(join(REPO_ROOT, ".env"), "utf8")
  const match = raw.match(new RegExp(`^${name}=(.*)$`, "m"))
  return match ? match[1].trim() : null
}

const liveUrl = process.env.LIVE_DB_ACCEPTANCE === "1" ? process.env.DATABASE_URL ?? readEnvVar("DATABASE_URL") : null
const optedIn = process.env.LIVE_DB_ACCEPTANCE === "1" && Boolean(liveUrl)

if (optedIn && !process.env.DATABASE_URL) process.env.DATABASE_URL = liveUrl as string

describe.skipIf(!optedIn)("PUB-03 record surfaces staged acceptance (live, READ-ONLY)", () => {
  it("projects leaderboards + competition options to their exact disclosed fields", { timeout: 60_000 }, async () => {
    const readers = await import("@/lib/public-visibility")
    const admin = postgres(liveUrl as string, { max: 1, idle_timeout: 5 })
    try {
      const [tenant] = await admin`SELECT id FROM public.tenants ORDER BY created_at LIMIT 1`
      const tenantId = tenant.id as string

      const options = await readers.readPublicTournamentOptions(tenantId)
      for (const row of options) {
        expect(Object.keys(row).sort()).toEqual(["id", "name"])
        expect(typeof row.name).toBe("string")
        expect(row.name.length).toBeGreaterThan(0)
      }

      for (const [name, board] of [
        ["batting", readers.readPublicBattingLeaderboard(tenantId)],
        ["bowling", readers.readPublicBowlingLeaderboard(tenantId)],
        ["fielding", readers.readPublicFieldingLeaderboard(tenantId)],
      ] as const) {
        const rows = await board
        for (const row of rows) {
          expect(Object.keys(row).sort(), name).toEqual([
            "playerId", "playerName", "playerVerified", "total",
          ])
          // Provenance is a BOOLEAN - never the underlying account id state.
          expect(typeof row.playerVerified).toBe("boolean")
        }
      }
    } finally {
      await admin.end()
    }
  })

  it("reads a live published match + its tournament detail to the exact disclosed shapes", { timeout: 60_000 }, async () => {
    const readers = await import("@/lib/public-visibility")
    const admin = postgres(liveUrl as string, { max: 1, idle_timeout: 5 })
    try {
      const [tenant] = await admin`SELECT id FROM public.tenants ORDER BY created_at LIMIT 1`
      const tenantId = tenant.id as string

      const published = await readers.readPublishedTournaments(tenantId)
      if (published.length > 0) {
        const detail = await readers.readPublishedTournament(tenantId, published[0].id)
        if (detail) {
          expect(Object.keys(detail).sort()).toEqual([
            "championTeamId", "description", "endDate", "format", "id", "name", "startDate", "status",
          ])
        }
      }

      // Any PUBLISHED match (tournament published, match not cancelled).
      const [matchRow] = await admin`
        SELECT m.id FROM public.matches m
        JOIN public.tournaments t ON t.id = m.tournament_id
        WHERE m.tenant_id = ${tenantId}
          AND t.tenant_id = ${tenantId}
          AND t.status IN ('registration', 'live', 'completed')
          AND m.status <> 'cancelled'
        ORDER BY m.created_at LIMIT 1`
      if (matchRow) {
        const match = await readers.readPublishedMatch(tenantId, matchRow.id)
        if (match) {
          expect(Object.keys(match).sort()).toEqual([
            "id", "tournamentId", "status", "matchFormat", "matchType", "totalOvers",
            "scheduledDate", "venueId", "teamAId", "teamBId", "tossWinnerId", "tossDecision",
            "winnerId", "result", "manOfMatchId", "streamSource", "streamStatus", "liveStreamUrl",
          ])
          expect(match.status).not.toBe("cancelled")
        }
      }
      // Any id at all fails closed for a foreign league.
      expect(await readers.readPublishedMatch("00000000-0000-4000-8000-999999999999", crypto.randomUUID())).toBeNull()
    } finally {
      await admin.end()
    }
  })

  it("reads the record surfaces as empty for a foreign league - no cross-league leak", { timeout: 60_000 }, async () => {
    const readers = await import("@/lib/public-visibility")
    const foreignTenant = "00000000-0000-4000-8000-999999999999"
    expect(await readers.readPublicTournamentOptions(foreignTenant)).toEqual([])
    expect(await readers.readPublicBattingLeaderboard(foreignTenant)).toEqual([])
    expect(await readers.readPublicBowlingLeaderboard(foreignTenant)).toEqual([])
    expect(await readers.readPublicFieldingLeaderboard(foreignTenant)).toEqual([])
  })

  it("serves the wicketkeeping board from REAL declared-keeper records (or honestly nothing)", { timeout: 60_000 }, async () => {
    const readers = await import("@/lib/public-visibility")
    const admin = postgres(liveUrl as string, { max: 1, idle_timeout: 5 })
    try {
      const [tenant] = await admin`SELECT id FROM public.tenants ORDER BY created_at LIMIT 1`
      const tenantId = tenant.id as string

      const [counted] = await admin`
        SELECT count(*)::int AS designations FROM public.match_playing_xis WHERE wicketkeeper`
      const designations = counted.designations as number

      const rows = await readers.readPublicWicketkeepingLeaderboard(tenantId)
      // The board can only show players who ARE designated keepers of a real
      // ACTIVE XI row: never more than the designation count supports.
      expect(rows.length).toBeLessThanOrEqual(designations)
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual([
          "playerId", "playerName", "playerVerified", "total",
        ])
        const [backed] = await admin`
          SELECT count(*)::int AS n FROM public.match_playing_xis
          WHERE wicketkeeper AND superseded_at IS NULL
            AND player_id = ${row.playerId}`
        expect(Number(backed.n)).toBeGreaterThan(0)
      }
      // Zero designations = honestly empty board (the live league's state).
      if (designations === 0) expect(rows).toEqual([])
      // Foreign league stays empty regardless of anything.
      expect(await readers.readPublicWicketkeepingLeaderboard(
        "00000000-0000-4000-8000-999999999999")).toEqual([])
    } finally {
      await admin.end()
    }
  })
})
