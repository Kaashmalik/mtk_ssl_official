import { describe, expect, it } from "vitest"

/**
 * Batch 129: the fixtures list on the public tournament page reads in
 * CricHeroes order — LIVE matches first, then upcoming, then everything
 * decided. A flat stream makes a live match (the most important row) hide
 * between two decisive results. The builder is a pure/read-only fold over
 * the SAME already-listed match rows: it only re-orders and groups, never
 * relabels — each row's own status badge stays the truthful label. Empty
 * groups are omitted (no empty shells); a tournament with no matches at
 * all yields null (the page keeps its own honest empty line).
 */

type FixtureRow = { id: string; status: string }

const row = (id: string, status: string): FixtureRow & Record<string, unknown> => ({ id, status })

describe("Fixture state grouping (Batch 129)", () => {
  it("groups live-first, then upcoming, then results; original order preserved within a group", async () => {
    const { buildFixtureGroups } = await import("../lib/fixture-groups")
    const groups = buildFixtureGroups([
      row("a", "completed"),
      row("b", "live"),
      row("c", "scheduled"),
      row("d", "live"),
      row("e", "completed"),
    ])!
    expect(groups.map(g => g.key)).toEqual(["live", "upcoming", "results"])
    expect(groups[0].matches.map(m => m.id)).toEqual(["b", "d"])
    expect(groups[1].matches.map(m => m.id)).toEqual(["c"])
    expect(groups[2].matches.map(m => m.id)).toEqual(["a", "e"])
  })

  it("empty groups are omitted; unknown statuses are still SHOWN — folded into results with their own badge", async () => {
    const { buildFixtureGroups } = await import("../lib/fixture-groups")
    const groups = buildFixtureGroups([row("a", "completed")])!
    expect(groups.map(g => g.key)).toEqual(["results"])
    // A status the builder has never heard of is never dropped.
    const unknown = buildFixtureGroups([row("x", "some-new-status"), row("y", "scheduled")])!
    expect(unknown.map(g => g.key)).toEqual(["upcoming", "results"])
    expect(unknown[1].matches.map(m => m.id)).toEqual(["x"])
  })

  it("counts are carried per group and a no-match tournament yields null", async () => {
    const { buildFixtureGroups } = await import("../lib/fixture-groups")
    const none = buildFixtureGroups([])
    expect(none).toBeNull()
    const groups = buildFixtureGroups([row("a", "live"), row("b", "live"), row("c", "completed")])!
    expect(groups[0].count).toBe(2)
    expect(groups[1].count).toBe(1)
  })
})
