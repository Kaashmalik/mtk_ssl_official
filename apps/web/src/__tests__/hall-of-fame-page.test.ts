import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * FAN-03: the public hall of fame is an unauthenticated page that must read
 * ONLY through the allowlist reader (never raw db), stay dynamic per-host,
 * and state the record-honesty rules in its empty state: champions are
 * persisted at completion and never re-derived for legacy competitions.
 */
const page = readFileSync(join(WEB_SRC, "app/hall-of-fame/page.tsx"), "utf8")

describe("FAN-03: public hall of fame page", () => {
  it("forbids raw db reads and uses the allowlist reader only", () => {
    expect(page).not.toContain("db.select().from(")
    expect(page).toContain("readPublishedHallOfFame(tenantId)")
    expect(page).toContain("requirePublicTenantId()")
  })

  it("is a dynamic server page with noStore", () => {
    expect(page).toContain("dynamic = \"force-dynamic\"")
    expect(page).toContain("noStore()")
  })

  it("renders an honest empty state that states the no-guessing record rule", () => {
    expect(page).toContain("No champions recorded")
    expect(page).toContain("never guessed")
    expect(page).toContain("never re-derived")
    expect(page).toContain("entries.map(")
  })

  it("links each champion record to its published tournament detail page", () => {
    expect(page).toContain("href={`/tournaments/${entry.tournamentId}`}")
    // Aggregate surface: champion team NAME only, never internal team ids.
    expect(page).toContain("entry.championTeamName")
    expect(page).not.toContain("entry.championTeamId")
  })

  it("is covered by the PUBLIC_FILES hygiene guard", () => {
    const hygiene = readFileSync(join(WEB_SRC, "__tests__/public-page-hygiene.test.ts"), "utf8")
    expect(hygiene).toContain(`"app/hall-of-fame/page.tsx"`)
    expect(hygiene).toContain("public-allowlist.test.ts")
  })
})
