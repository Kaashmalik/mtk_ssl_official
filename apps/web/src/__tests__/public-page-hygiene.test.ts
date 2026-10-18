import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * PUB-06/PUB-02 static guard: the UNAUTHENTICATED surfaces must never issue
 * a full-row `db.select().from(table)` - every raw query on a public page or
 * route lists its columns explicitly, so internal-only fields (createdBy,
 * captain/manager ids, contact provenance, tenant plumbing, sync keys)
 * never load, let alone travel. Row spreads into rendered objects
 * (`...m`) are equally banned on those surfaces.
 *
 * If a legitimate new public read needs a full row, the allowlist must be
 * widened in code review - and these files' patterns updated deliberately.
 */

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "..")
const PUBLIC_FILES = [
  "app/tournaments/[id]/page.tsx",
  "app/tournaments/page.tsx",
  "app/hall-of-fame/page.tsx",
  "app/matches/[matchId]/page.tsx",
  "app/matches/[matchId]/live/page.tsx",
  "app/api/scorecards/[matchId]/pdf/route.ts",
  "lib/public-visibility.ts",
]

describe("PUB-06: public surfaces use explicit column selects only", () => {
  it("has no full-row db.select().from() on any unauthenticated surface", () => {    for (const rel of PUBLIC_FILES) {
      const source = readFileSync(join(WEB_SRC, rel), "utf8")
      const offenders = source
        .split("\n")
        .map((line, i) => ({ line: line.trim(), no: i + 1 }))
        .filter(({ line }) => /db\.select\(\)\s*\.from\(/.test(line))
      expect(offenders, `${rel} full-row selects: ${JSON.stringify(offenders)}`).toEqual([])
    }
  })

  it("spreads no raw row into a rendered object on the public tournament page", () => {
    const source = readFileSync(join(WEB_SRC, "app/tournaments/[id]/page.tsx"), "utf8")
    expect(/return\s*\{[^}]*\.\.\.m\b/.test(source)).toBe(false)
  })

  it("keeps the public reader key-set regressions in the projecting-mock suite", () => {
    const suite = readFileSync(join(WEB_SRC, "__tests__/public-allowlist.test.ts"), "utf8")
    expect(suite).toContain('"championTeamId"')
    expect(suite).toContain('"captainId"')
  })
})

describe("PUB-06 (Batch 133): official-record public surfaces gate minor NAMES", () => {
  const read = (rel: string) => readFileSync(join(WEB_SRC, rel), "utf8")

  it("the public match page loads the gate columns and resolves names through the policy", () => {
    const source = read("app/matches/[matchId]/page.tsx")
    expect(source).toContain("applyMinorNameGate(playerRows)")
    expect(source).toContain("guardianConsentAt: players.guardianConsentAt")
    expect(source).not.toContain("new Map(playerRows.map(p => [p.id, p.name]))")
  })

  it("the printable scorecard resolves names through the same gate", () => {
    const source = read("app/api/scorecards/[matchId]/pdf/route.ts")
    expect(source).toContain("applyMinorNameGate(playerRows)")
    expect(source).toContain("guardianConsentAt: players.guardianConsentAt")
  })

  it("the FAN-03 recap derives from already-loaded official rows only", () => {
    const source = read("app/matches/[matchId]/page.tsx")
    expect(source).toContain("deriveMatchRecap(")
    // Batch 143 supersedes the RECAP_LABELS.title pin: labels now render
    // through the matchRecap dictionary (the FAN-04 block below pins the
    // full shape; the policy's English labels stay the canonical fallback).
    expect(source).toContain('tRecap("title")')
    // The recap must not open new database reads - inputs come from the
    // rows the page already loaded (inningsRaw + the mapped `innings`).
    expect(source).not.toMatch(/deriveMatchRecap\(\{[\s\S]{0,120}db\./)
  })

  // SCORE-13 (Batch 137): Match Center overlays are folded views of the
  // SAME recorded ball rows - the strip never opens its own read and never
  // claims legal deliveries it cannot verify.
  it("the Match Center partnership/recent strip folds the shared ball rows, never a new read", () => {
    const source = read("app/matches/[matchId]/page.tsx")
    expect(source).toContain("deriveInningsOverlay(ballsByInnings.get(inn.id) ?? [])")
    // UX-03 (Batch 139): strip labels render through the message dictionary,
    // with the policy's partnership basis arriving as a KEY, not a sentence.
    expect(source).toContain('tMC("recordedDeliveries")')
    expect(source).toContain("deriveInningsOverlay(")
    expect(source).toContain('getTranslations("matchCenter")')
    // The overlay build sits after the single ball-row read; the page keeps
    // exactly one matchBalls select (the wicketBalls read the FoW map uses).
    expect(source).not.toContain("OVERLAY_LABELS.")
    expect(source.match(/from\(matchBalls\)/g)?.length).toBe(1)
  })

  // FAN-04 (Batch 143): the automatic recap is the page's only "summary"
  // surface, and it is DERIVED, not AI-authored. Its gates: the policy
  // deriveMatchRecap is the only recap source (pure fold of official rows),
  // labels render through the message dictionary (English RECAP_LABELS in
  // the policy stay the canonical fallback record), and the derivedNotice
  // rides inside the same conditional card - a recap is never rendered
  // without its "not a fabricated narrative" disclaimer.
  it("the recap renders only through deriveMatchRecap with dictionary labels and its notice always attached", () => {
    const source = read("app/matches/[matchId]/page.tsx")
    expect(source).toContain("deriveMatchRecap({")
    expect(source).toContain('getTranslations("matchRecap")')
    expect(source).toContain('tRecap("derivedNotice")')
    // The derive call sits inside the same `recap &&` conditional that
    // renders the card: no recap without the notice, never a stray label.
    expect(source).toContain("{recap && (")
    expect(source).not.toContain("RECAP_LABELS.")
    // The policy keeps the English labels as the canonical fallback record.
    const policy = read("../../../packages/database/src/lib/match-recap.ts")
    expect(policy).toContain("derivedNotice:")
  })
})
