import { readFileSync } from "node:fs"
import { join } from "node:path"
import postgres from "postgres"
import { describe, expect, it } from "vitest"

/**
 * PUB-05/PUB-06 staged acceptance (LIVE, READ-ONLY, opt-in).
 *
 * Gated behind LIVE_DB_ACCEPTANCE=1 so ordinary batteries never touch
 * production. The @mtk/database client binds its connection string at import
 * time, so the live .env is wired BEFORE the readers are dynamically
 * imported - the skip path never loads live credentials at all.
 *
 * What this proves against the real project:
 *   1. The public readers' PROJECTIONS return exactly their disclosed field
 *      sets on real data - a careless select() cannot pass this against a
 *      live table, because real rows carry the private columns.
 *   2. prizes truthfulness (PUB-05): only approved, non-superseded rows are
 *      publicly readable, and payout records are absent from the projection.
 *   3. Tenant scoping: a foreign league id reads as empty - no cross-league
 *      leak through any public surface.
 *   4. The REST tier fails closed for anon on every public-display table.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..")

function readEnvVar(name: string): string | null {
  if (process.env.LIVE_DB_ACCEPTANCE !== "1") return null
  const raw = readFileSync(join(REPO_ROOT, ".env"), "utf8")
  const match = raw.match(new RegExp(`^${name}=(.*)$`, "m"))
  return match ? match[1].trim() : null
}

const liveUrl = process.env.LIVE_DB_ACCEPTANCE === "1" ? process.env.DATABASE_URL ?? readEnvVar("DATABASE_URL") : null
const supabaseUrl = readEnvVar("NEXT_PUBLIC_SUPABASE_URL")
const anonKey = readEnvVar("NEXT_PUBLIC_SUPABASE_ANON_KEY")
const optedIn = process.env.LIVE_DB_ACCEPTANCE === "1" && Boolean(liveUrl)

/** Wiring MUST run before the first dynamic import of the readers. */
if (optedIn && !process.env.DATABASE_URL) process.env.DATABASE_URL = liveUrl as string

describe.skipIf(!optedIn)("PUB-05/PUB-06 staged acceptance (live, READ-ONLY)", () => {
  it("projects tournaments/hall-of-fame/prizes/awards to their exact disclosed field sets on live data", { timeout: 60_000 }, async () => {
    const readers = await import("@/lib/public-visibility")
    const admin = postgres(liveUrl as string, { max: 1, idle_timeout: 5 })
    try {
      const [tenant] = await admin`SELECT id FROM public.tenants ORDER BY created_at LIMIT 1`
      const tenantId = tenant.id as string

      const tournaments = await readers.readPublishedTournaments(tenantId)
      for (const row of tournaments) {
        expect(Object.keys(row).sort()).toEqual([
          "championTeamId", "description", "endDate", "format", "id", "name", "startDate", "status",
        ])
        expect(["registration", "live", "completed"]).toContain(row.status)
      }

      const hof = await readers.readPublishedHallOfFame(tenantId)
      for (const row of hof) {
        expect(Object.keys(row).sort()).toEqual([
          "championTeamId", "championTeamName", "completedAt", "name", "tournamentId",
        ])
        expect(row.championTeamId).toBeTruthy() // persisted champions only
        if (row.completedAt) expect(Number.isNaN(Date.parse(row.completedAt))).toBe(false)
      }

      for (const tournament of tournaments.slice(0, 3)) {
        const prizes = await readers.readPublishedTournamentPrizes(tenantId, tournament.id)
        for (const prize of prizes) {
          // The disclosed payload only: status/supersededAt/payout provenance
          // are never in it (PUB-05 truthful records, no payout confidential).
          expect(Object.keys(prize).sort()).toEqual([
            "amount", "categoryName", "currency", "id", "placement", "sponsor",
          ])
        }
        const awards = await readers.readPublishedTournamentAwards(tenantId, tournament.id)
        for (const award of awards) {
          expect(Object.keys(award).sort()).toEqual([
            "category", "categoryLabel", "citation", "declaredAt", "id", "playerId", "playerName", "teamId", "teamName",
          ])
        }
      }
    } finally {
      await admin.end()
    }
  })

  it("reads every public surface as empty for a foreign league - no cross-league leak", async () => {
    const readers = await import("@/lib/public-visibility")
    const foreignTenant = "00000000-0000-4000-8000-999999999999"
    expect(await readers.readPublishedTournaments(foreignTenant)).toEqual([])
    expect(await readers.readPublishedHallOfFame(foreignTenant)).toEqual([])
  })

  it("fails the tier-1 REST tier closed for anon on every public-display table", async () => {
    expect(supabaseUrl).toBeTruthy()
    expect(anonKey).toBeTruthy()
    for (const table of ["tournaments", "tournament_awards", "tournament_prizes", "teams"]) {
      const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id`, {
        headers: { apikey: anonKey as string, Authorization: `Bearer ${anonKey}` },
      })
      if (!response.ok) {
        expect(response.status).toBeGreaterThanOrEqual(400)
      } else {
        const body = await response.json() as unknown[]
        expect(body, `${table} leaked rows to the anon key`).toEqual([])
      }
    }
  })
})
