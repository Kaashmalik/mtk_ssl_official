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
    expect(source).toContain("RECAP_LABELS.title")
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
    expect(source).toContain("OVERLAY_LABELS.recordedDeliveries")
    // The overlay build sits after the single ball-row read; the page keeps
    // exactly one matchBalls select (the wicketBalls read the FoW map uses).
    expect(source.match(/from\(matchBalls\)/g)?.length).toBe(1)
  })
})
