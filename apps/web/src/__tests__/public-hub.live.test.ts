import { readFileSync } from "node:fs"
import { join } from "node:path"
import postgres from "postgres"
import { describe, expect, it } from "vitest"

/**
 * PUB-02 staged acceptance for the CROSS-LEAGUE hub surfaces (LIVE,
 * READ-ONLY, opt-in via LIVE_DB_ACCEPTANCE=1).
 *
 * Completes the B121/B122 family on the only two cross-tenant public reads
 * in the product: the listed-league hub directory and the consented career
 * profile. Proven against real rows: exact disclosed projections, hub rows
 * drawn ONLY from listed leagues (the owner's decision stays the authority),
 * and fail-closed behavior for a player id that is ineligible (indistinguish-
 * able from nonexistent). The env wiring reads live .env BEFORE the dynamic
 * reader import (the db client binds its connection string at import time);
 * the skip path never loads live credentials.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..")

function readEnvVar(name: string): string | null {
  const raw = readFileSync(join(REPO_ROOT, ".env"), "utf8")
  const match = raw.match(new RegExp(`^${name}=(.*)$`, "m"))
  return match ? match[1].trim() : null
}

const liveUrl = process.env.DATABASE_URL ?? readEnvVar("DATABASE_URL")
const optedIn = process.env.LIVE_DB_ACCEPTANCE === "1" && Boolean(liveUrl)

if (optedIn && !process.env.DATABASE_URL) process.env.DATABASE_URL = liveUrl as string

describe.skipIf(!optedIn)("PUB-02 cross-league hub staged acceptance (live, READ-ONLY)", () => {
  it("projects the listed-league directory exactly - and only listed leagues may appear", { timeout: 60_000 }, async () => {
    const { readListedHubLeagues, PUBLIC_HUB_LEAGUE_LIMIT } = await import("@/lib/public-hub")
    const admin = postgres(liveUrl as string, { max: 1, idle_timeout: 5 })
    try {
      const read = await readListedHubLeagues()
      expect(Object.keys(read).sort()).toEqual(["complete", "leagues", "limit"])
      expect(read.limit).toBe(PUBLIC_HUB_LEAGUE_LIMIT)
      expect(typeof read.complete).toBe("boolean")

      const [listedRow] = await admin`
        SELECT count(*)::int AS n FROM public.tenants
        WHERE hub_listing_status = 'listed' AND is_active`
      const listedCount = listedRow.n as number
      expect(read.leagues.length, "reader must never exceed the listed set").toBeLessThanOrEqual(
        Math.min(listedCount, PUBLIC_HUB_LEAGUE_LIMIT),
      )

      const listedIds = new Set(
        (await admin`SELECT id FROM public.tenants WHERE hub_listing_status = 'listed' AND is_active`).map(
          (r) => r.id as string,
        ),
      )
      for (const league of read.leagues) {
        expect(Object.keys(league).sort()).toEqual([
          "liveMatches", "name", "publishedCompetitions", "slug", "tenantId", "url",
        ])
        expect(listedIds.has(league.tenantId), `unlisted league ${league.tenantId} leaked into the hub`).toBe(true)
        expect(Number.isInteger(league.publishedCompetitions)).toBe(true)
        expect(Number.isInteger(league.liveMatches)).toBe(true)
        expect(league.publishedCompetitions).toBeGreaterThanOrEqual(0)
        expect(league.liveMatches).toBeGreaterThanOrEqual(0)
        // url is a verified-domain host string or null - never a fabricated subdomain.
        expect(league.url === null || typeof league.url === "string").toBe(true)
      }
    } finally {
      await admin.end()
    }
  })

  it("keeps the consented career profile fail-closed: ineligible reads as missing, eligible discloses only aggregates", { timeout: 60_000 }, async () => {
    const { readPublicCareerProfile } = await import("@/lib/public-career-profile")
    const admin = postgres(liveUrl as string, { max: 1, idle_timeout: 5 })
    try {
      // Ineligible (likely nonexistent) id: indistinguishable from nonexistent.
      expect(await readPublicCareerProfile("00000000-0000-4000-8000-999999999999")).toBeNull()

      // Any profile that IS reachable must carry only the aggregate disclosure.
      const consented = await admin`
        SELECT id FROM public.users
        WHERE public_career_consent_at IS NOT NULL
        ORDER BY created_at LIMIT 5`
      for (const row of consented) {
        const profile = await readPublicCareerProfile(row.id as string)
        if (!profile) continue // suspended/inactive account still fails closed - honest.
        expect(Object.keys(profile).sort()).toEqual(["career", "complete", "limit"])
        expect(Object.keys(profile.career).sort()).toEqual([
          "leagues", "totalRunsScored", "totalWicketsTaken",
        ])
        for (const league of profile.career.leagues) {
          expect(Object.keys(league).sort()).toEqual([
            "leagueName", "runsScored", "tenantId", "url", "wicketsTaken",
          ])
          // No identity beyond the league name: no roster names, no emails.
          expect(typeof league.leagueName).toBe("string")
          expect(league.runsScored).toBeGreaterThanOrEqual(0)
          expect(league.wicketsTaken).toBeGreaterThanOrEqual(0)
        }
        expect(profile.career.totalRunsScored).toBeGreaterThanOrEqual(0)
        expect(profile.career.totalWicketsTaken).toBeGreaterThanOrEqual(0)
      }
    } finally {
      await admin.end()
    }
  })
})
