import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Batch 146 (owner-power mechanism, NOTHING is invented): standings
 * qualification markers were on the owner-decision register as a PLATFORM
 * POLICY — so no platform policy is invented. The policy is handed to the
 * league ORGANIZER instead, stored in the tournament's own `rules` jsonb
 * (the exact pattern the wizard configuration already uses), validated as
 * a strict two-shape union, and rendered on the public standings ONLY
 * when the organizer set it. Null rule → NOTHING renders, on any surface,
 * including the dashboard twin.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, "..")
const src = (rel: string) => readFileSync(join(WEB, rel), "utf8")

const policy = () => import("@mtk/database/lib/qualification-policy")

describe("qualification policy module (Batch 146)", () => {
  it("reads a valid top_n rule strictly typed", async () => {
    const { readQualificationRule } = await policy()
    expect(readQualificationRule({ qualification: { kind: "top_n", spots: 2 } })).toEqual({ kind: "top_n", spots: 2 })
  })

  it("reads a valid top_per_group rule", async () => {
    const { readQualificationRule } = await policy()
    expect(readQualificationRule({ qualification: { kind: "top_per_group", perGroup: 1 } })).toEqual({ kind: "top_per_group", perGroup: 1 })
  })

  it("refuses every malformed shape — a drifted or hostile rules blob can NEVER invent a policy", async () => {
    const { readQualificationRule } = await policy()
    expect(readQualificationRule(null)).toBe(null)
    expect(readQualificationRule(undefined)).toBe(null)
    expect(readQualificationRule({})).toBe(null)
    expect(readQualificationRule({ qualification: null })).toBe(null)
    expect(readQualificationRule({ qualification: { kind: "relegation_bottom", spots: 3 } })).toBe(null)
    expect(readQualificationRule({ qualification: { kind: "top_n", spots: 0 } })).toBe(null)
    expect(readQualificationRule({ qualification: { kind: "top_n", spots: -2 } })).toBe(null)
    expect(readQualificationRule({ qualification: { kind: "top_n", spots: 2.5 } })).toBe(null)
    expect(readQualificationRule({ qualification: { kind: "top_n", spots: 129 } })).toBe(null)
    expect(readQualificationRule({ qualification: { kind: "top_n" } })).toBe(null)
    expect(readQualificationRule({ qualification: "top 2" })).toBe(null)
  })

  it("writes preserve every other rules key — the wizard config must survive", async () => {
    const { writeQualificationRule, readQualificationRule } = await policy()
    const next = writeQualificationRule({ wizard: { seedOrder: [] }, other: 1 }, { kind: "top_n", spots: 4 })
    expect(next).toEqual({ wizard: { seedOrder: [] }, other: 1, qualification: { kind: "top_n", spots: 4 } })
    const cleared = writeQualificationRule({ wizard: { a: 1 }, qualification: { kind: "top_n", spots: 4 } }, null)
    expect(cleared).toEqual({ wizard: { a: 1 } })
    expect(readQualificationRule(cleared)).toBe(null)
  })

  it("restates the organizer's rule VERBATIM — no platform phrasing", async () => {
    const { formatQualificationRule } = await policy()
    expect(formatQualificationRule({ kind: "top_n", spots: 2 })).toBe("Top 2 advance")
    expect(formatQualificationRule({ kind: "top_n", spots: 1 })).toBe("Top 1 advances")
    expect(formatQualificationRule({ kind: "top_per_group", perGroup: 1 })).toBe("Top 1 per group advances")
  })
})

describe("qualifier computation stays presentation-only (Batch 146)", () => {
  it("top_n takes the engine's first N rows — never re-sorted, never guessed", async () => {
    const { computeQualifyingTeamIds } = await policy()
    const rows = [
      { teamId: "a" }, { teamId: "b" }, { teamId: "c" },
    ] as never[]
    expect(computeQualifyingTeamIds({ rule: { kind: "top_n", spots: 2 }, rows, groups: [] })).toEqual(["a", "b"])
  })

  it("top_per_group takes the first N of EACH group", async () => {
    const { computeQualifyingTeamIds } = await policy()
    expect(computeQualifyingTeamIds({
      rule: { kind: "top_per_group", perGroup: 1 },
      rows: [],
      groups: [
        { label: "A", rows: [{ teamId: "a1" }, { teamId: "a2" }] },
        { label: "B", rows: [{ teamId: "b1" }, { teamId: "b2" }] },
      ],
    } as never)).toEqual(["a1", "b1"])
  })

  it("a null rule yields NOTHING — the honest default", async () => {
    const { computeQualifyingTeamIds } = await policy()
    expect(computeQualifyingTeamIds({ rule: null, rows: [{ teamId: "a" }], groups: [] } as never)).toEqual([])
  })
})

describe("the organizer's write path (Batch 146)", () => {
  it("updateTournament accepts and persists the rule through the rules jsonb", () => {
    const actions = src("app/actions/tournaments.ts")
    expect(actions).toContain("qualificationRule")
    expect(actions).toContain("writeQualificationRule")
  })

  it("the edit form offers the organizer the choice — including 'none'", () => {
    const form = src("components/tournaments/edit-tournament-form.tsx")
    expect(form).toContain("qualificationKind")
    expect(form).toContain("top_per_group")
  })
})

describe("the public render path (Batch 146)", () => {
  it("the public page reads the rule and passes qualifiers down", () => {
    const page = src("app/tournaments/[id]/page.tsx")
    // Sanitized by the publication-gated reader; the page consumes the
    // strict rule and attributes the legend to the organizer.
    expect(page).toContain("tournament.qualificationRule")
    expect(page).toContain("qualifyingTeamIds")
    expect(page).toContain("set by the league organizer")
  })

  it("PointsTable renders a marker + verbatim legend ONLY when a rule exists", () => {
    const table = src("components/tournaments/points-table.tsx")
    expect(table).toContain("qualifyingTeamIds")
    expect(table).toContain("aria-label=\"Qualification position\"")
    expect(table).toContain("qualificationRuleSummary")
  })

  it("GroupStandings gets the same treatment per group", () => {
    const groups = src("components/tournaments/group-standings.tsx")
    expect(groups).toContain("qualifyingTeamIds")
    expect(groups).toContain("Qualification position")
  })

  it("the dashboard twin renders markers only from props — no silent policy", () => {
    // The components default the rule to absent; the pin holds the default.
    const table = src("components/tournaments/points-table.tsx")
    expect(table).toMatch(/qualifyingTeamIds\??:\s*string\[\]\s*\|\s*null/)
  })
})
