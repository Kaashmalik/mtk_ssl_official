import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Batch 144 (resilience wave, audit #4): the API surface was disciplined
 * everywhere it KNEW it was reading untrusted input, but several id doors
 * let malformed strings reach a Postgres uuid cast and turn a bad link
 * into an unhandled 500 (the root error page) instead of an honest 404
 * or 400:
 *
 *  - the public match page and the PDF scorecard route pass the raw
 *    `[matchId]` segment straight into `readPublishedMatch` /
 *    `eq(matches.id, ...)`;
 *  - the mobile BFF and four mobile routes used a LOOSE 36-char class
 *    (`^[0-9a-fA-F-]{36}$`) that accepts thirty-six dashes;
 *  - only the OG route had the strict canonical uuid shape — and it kept
 *    it locally.
 *
 * The canonical strict shape moves to @mtk/contracts (one definition,
 * every door), the loose classes are deleted, and the tournament award
 * date gets a schema-drift guard.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, "..")
const src = (rel: string) => readFileSync(join(WEB, rel), "utf8")

const STRICT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe("canonical uuid gate (Batch 144)", () => {
  it("one definition in contracts, exactly the OG route's strict shape", async () => {
    const { UUID_RE } = await import("@mtk/contracts")
    expect(UUID_RE.source).toBe(STRICT.source)
  })

  it("accepts exactly the canonical shape — case-insensitively", async () => {
    const { isUuid } = await import("@mtk/contracts")
    expect(isUuid("0b8ddf0e-2f1d-4a3b-9c7d-3f5e6a7b8c9d")).toBe(true)
    expect(isUuid("0B8DDF0E-2F1D-4A3B-9C7D-3F5E6A7B8C9D")).toBe(true)
  })

  it("refuses the loose class's escape hatches — 36 dashes is not a uuid", async () => {
    const { isUuid } = await import("@mtk/contracts")
    expect(isUuid("-".repeat(36))).toBe(false)
    expect(isUuid("a".repeat(36))).toBe(false)
    expect(isUuid("abc")).toBe(false)
    expect(isUuid("0b8ddf0e-2f1d-4a3b-9c7d-3f5e6a7b8c9d-extra")).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid(42)).toBe(false)
  })
})

describe("every id door uses the canonical gate (Batch 144)", () => {
  it("mobile-bff drops the loose class and gates through the shared helper", () => {
    const bff = src("lib/mobile-bff.ts")
    expect(bff).not.toMatch(/\^\[0-9a-fA-F-\]\{36\}\$/)
    expect(bff).toContain("isUuid")
  })

  it("the four mobile routes drop their inline loose regexes", () => {
    for (const route of [
      "app/api/mobile/matches/route.ts",
      "app/api/mobile/scoring/state/route.ts",
      "app/api/mobile/teams/route.ts",
      "app/api/mobile/players/route.ts",
    ]) {
      const source = src(route)
      expect(source.match(/\^\[0-9a-f/g) ?? [], route).toHaveLength(0)
      expect(source, route).toContain("isUuid")
    }
  })

  it("the public match page 404s instead of PG-throwing: the guard sits at the reader", () => {
    const visibility = src("lib/public-visibility.ts")
    // Fail-closed: a non-uuid id resolves to null (the page's existing
    // notFound()) BEFORE any db call. Never a 500. (The reader's param is
    // `id`; the page passes the raw `[matchId]` segment into it.)
    expect(visibility).toMatch(/if \(!isUuid\(id\)\) return null/)
    expect(visibility).toMatch(/export async function readPublishedMatch\(tenantId: string, id: string\)/)
  })

  it("the PDF scorecard route guards the same door before any query", () => {
    const route = src("app/api/scorecards/[matchId]/pdf/route.ts")
    expect(route).toContain("isUuid(matchId)")
  })

  it("the OG route consumes the shared gate instead of its local copy", () => {
    const og = src("app/api/og/match/[id]/route.tsx")
    expect(og).not.toContain("const UUID_RE")
    expect(og).toContain("isUuid")
  })

  it("the tournament award date survives a drifted row (schema-drift guard)", () => {
    const page = src("app/tournaments/[id]/page.tsx")
    // The guard, not the bare call: toISOString only ever runs behind the
    // null check.
    expect(page).toContain("award.declaredAt ?")
    expect(page).not.toContain(">Declared {award.declaredAt")
  })
})
