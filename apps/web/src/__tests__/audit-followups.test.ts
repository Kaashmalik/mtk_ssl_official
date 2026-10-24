import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Batch 147 (audit follow-ups): a two-agent review (independent reviewer on
 * Batches 144-146 + a full-surface explorer) found six real defects the
 * batch stream's own pins could not see — one of them in Batch 146 itself.
 * Each pin here would FAIL on the pre-fix tree:
 *
 *  1. createTournament accepted + validated qualificationRule, then SILENTLY
 *     DROPPED it (persistenceValues stripped the field; only the update
 *     writer merged it). Reviewer Major, in B146's own work.
 *  2. readPublishedTournament had NO uuid gate (B144 gated its sibling
 *     readPublishedMatch only) — /tournaments/<garbage> 500s on an
 *     unauthenticated, crawler-visible page.
 *  3. Both JSON-LD emitters serialized user-controlled strings (team and
 *     tournament names) with no "<" escaping — a "</script>" inside a name
 *     closes the raw-text script element and the tail becomes DOM.
 *  4. public-career-profile reached eq(users.id, …) ungated — a doomed
 *     query whose catch rendered a fake "try again" (200) instead of 404.
 *  5. The broadcast overlay-token route passed raw [broadcastId] into the
 *     query → 500 (same class B144 fixed on the PDF route).
 *  6. The tournament wizard's dynamic() step and the root-layout-mounted
 *     CommandPalette lazy() had no .catch — one failed decorative chunk
 *     destroyed an in-progress wizard write or nuked EVERY route to the
 *     root error page. B143's idiom (chunk failure degrades, the product
 *     survives), applied to the two remaining dynamic imports.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, "..")
const src = (rel: string) => readFileSync(join(WEB, rel), "utf8")

describe("Batch 147: the create path honors the organizer's rule", () => {
  it("createTournament merges qualificationRule into rules like the update writer does", () => {
    const actions = src("app/actions/tournaments.ts")
    // The create writer (not just the update writer) merges through the
    // shared policy; a validated input can no longer vanish.
    const createBlock = actions.slice(
      actions.indexOf("export async function createTournament"),
      actions.indexOf("export async function updateTournament"),
    )
    expect(createBlock).toContain("writeQualificationRule")
    expect(createBlock).toContain("qualificationRule")
  })
})

describe("Batch 147: every remaining public reader is uuid-gated", () => {
  it("readPublishedTournament fails closed on a non-uuid id, before any query", () => {
    const visibility = src("lib/public-visibility.ts")
    // Scoped to the SINGLE-TOURNAMENT reader: the file already contains the
    // B144 match-reader gate, so a bare regex would pass vacuously.
    const reader = visibility.slice(
      visibility.indexOf("export async function readPublishedTournament"),
      visibility.indexOf("export async function readPublishedTournaments"),
    )
    expect(reader).toMatch(/if \(!isUuid\(id\)\) return null/)
  })

  it("public-career-profile fails closed on a non-uuid user id", () => {
    const profile = src("lib/public-career-profile.ts")
    expect(profile).toContain("isUuid")
  })

  it("the broadcast overlay-token route 404s on a non-uuid broadcastId", () => {
    const route = src("app/api/broadcast/overlay/[broadcastId]/token/route.ts")
    expect(route).toContain("isUuid(broadcastId)")
  })
})

describe("Batch 147: JSON-LD cannot be broken out of", () => {
  it.each(["components/json-ld.tsx", "components/structured-data.tsx"])(
    "%s injects only the hardened emitter's output",
    (file) => {
      const emitters = src(file)
      // Both sites must route through safeJsonLd (defined once in
      // json-ld.tsx, where the literal escape is pinned) — a bare
      // JSON.stringify injection is the vulnerability.
      expect(emitters).toContain("safeJsonLd")
      expect(emitters).not.toMatch(/__html:\s*JSON\.stringify/)
    },
  )
})

describe("Batch 147: a failed decorative chunk can no longer take the page down", () => {
  it("the wizard's dynamic StepSeeding degrades instead of throwing", () => {
    const wizard = src("components/tournaments/tournament-wizard.tsx")
    expect(wizard).toMatch(/\.catch\(/)
  })

  it("the root-layout CommandPalette lazy chunk degrades instead of throwing", () => {
    const loader = src("components/command-palette-loader.tsx")
    expect(loader).toMatch(/\.catch\(/)
  })
})
