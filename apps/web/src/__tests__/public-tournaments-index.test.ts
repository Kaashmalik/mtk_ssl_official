import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * PUB-03 / PUB-06: the public tournaments index is an unauthenticated page
 * that must not read the database with an unprojection (raw db.select()). The
 * only public reads allowed are the allowlist readers in lib/public-visibility.
 */
const page = readFileSync(join(WEB_SRC, "app/tournaments/page.tsx"), "utf8")

describe("PUB-06: public tournaments index is allowlist-only", () => {
  it("forbids raw db.select().from(...) and uses readPublishedTournaments instead", () => {
    expect(page).not.toContain("db.select().from(")
    expect(page).toContain("readPublishedTournaments(tenantId)")
    expect(page).toContain("requirePublicTenantId()")
  })

  it("renders an honest empty state and a full published list", () => {
    expect(page).toContain("No published tournaments")
    expect(page).toContain("tournaments.map(")
    expect(page).toContain("href={`/tournaments/${tournament.id}`}")
  })

  it("interlinks to the hall of fame (discoverable both ways)", () => {
    expect(page).toContain('href="/hall-of-fame"')
    expect(page).toContain("Hall of fame")
  })

  it("is a dynamic server page with its own cache-control", () => {
    expect(page).toContain("dynamic = \"force-dynamic\"")
    expect(page).toContain("noStore()")
  })

  it("projects only allowlisted visible fields in the UI", () => {
    const fields = ["tournament.name", "tournament.description", "tournament.format", "tournament.status", "tournament.startDate", "tournament.endDate"]
    expect(fields.every((f) => page.includes(f))).toBe(true)
    // No private data leaks into the public markup.
    expect(page).not.toContain("championTeamId")
  })

  it("extends the PUBLIC_FILES allowlist guard", () => {
    const hygiene = readFileSync(join(WEB_SRC, "__tests__/public-page-hygiene.test.ts"), "utf8")
    expect(hygiene).toContain(`"app/tournaments/page.tsx"`)
    // Hygiene itself cross-checks the projecting-mock suite (which module-mocks
    // the database); the page must stay inside that regime, never raw db.
    expect(hygiene).toContain("public-allowlist.test.ts")
  })

  it("gates the list query to published statuses in SQL, not in the UI", () => {
    // The fake-db mocks ignore WHERE, so the publication gate itself is
    // asserted structurally: the reader filters in the query via the shared
    // policy values, exactly like the single read's isTournamentPublished.
    const reader = readFileSync(join(WEB_SRC, "lib/public-visibility.ts"), "utf8")
    expect(reader).toContain("inArray(tournaments.status, PUBLISHED_TOURNAMENT_STATUS_VALUES)")
  })
})
