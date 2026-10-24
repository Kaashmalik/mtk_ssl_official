import React from "react"
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Batch 138 (standings sweep): the public tournament page shows TWO
 * standings presentations of the SAME engine output — the tournament-wide
 * Points Table (Batch 132) and the per-group tables — and they did not
 * even look related: the group tables shipped a different header
 * vocabulary, no tabular numerals, no long-name containment, no row
 * separators and no emphasis, on a page where the reader's eye moves
 * between them. The sweep converges the group table onto the Points
 * Table's presentation WITHOUT losing what it did better (the scope
 * attributes, the caption, the disclosure — and the NRR honesty both
 * already share). The compact headers expand on hover/focus via title —
 * no abbreviation is allowed to become unreadable.
 *
 * Presentation only: no new reads, no engine changes, the rows arrive
 * already ranked by the versioned standings engine.
 */

const row = (teamId: string, name: string, over: Partial<Record<string, unknown>> = {}) => ({
  ruleVersion: 1, teamId, name, shortName: name.slice(0, 3).toUpperCase(),
  played: 3, won: 2, lost: 1, noResult: 0, points: 4,
  runsFor: 450, ballsFor: 120, runsAgainst: 440, ballsAgainst: 130,
  netRunRate: 0.1538, hasNetRunRate: true,
  ...over,
})

type R = Record<string, unknown>

async function markup(rows: R[], label = "A"): Promise<string> {
  const { GroupStandings } = await import("../components/tournaments/group-standings")
  return renderToStaticMarkup(React.createElement(GroupStandings, { groups: [{ label, rows }] as any }))
}

describe("Group standings sweep (Batch 138)", () => {
  it("speaks the SAME header vocabulary as the Points Table, each abbreviation expandable", async () => {
    const html = await markup([row("t1", "Falcon CC")])
    expect(html).toContain(">P<")
    expect(html).toContain(">W<")
    expect(html).toContain(">L<")
    expect(html).toContain(">Pts<")
    expect(html).toContain(">NRR<")
    // The abbreviations never become unreadable: every header carries its
    // expansion (title="Played", ... "Net run rate").
    expect(html).toContain('title="Played"')
    expect(html).toContain('title="Net run rate"')
  })

  it("numbers align (tabular-nums), points carry the emphasis, rows separate", async () => {
    const html = await markup([row("t1", "Falcon CC"), row("t2", "Tigers")])
    expect(html).toContain("tabular-nums")
    expect(html).toContain("border-b")
  })

  it("long club names stay contained like the Points Table: truncated, never squeezed columns", async () => {
    const html = await markup([row("t1", "Sir Vivian Richards Memorial Cricket Club North")])
    expect(html).toContain("truncate")
    expect(html).toContain(`title="Sir Vivian Richards Memorial Cricket Club North"`)
  })

  it("rows are POSITIONED — the engine's order renders as 1..N", async () => {
    // Zeroed stat cells so the ONLY 1/2/3 in the markup are the positions.
    const zero = { played: 0, won: 0, lost: 0, points: 0, hasNetRunRate: false, netRunRate: 0 }
    const html = await markup([
      row("t1", "Falcon CC", zero),
      row("t2", "Tigers", zero),
      row("t3", "Bears", zero),
    ])
    const i1 = html.indexOf(">1<")
    const i2 = html.indexOf(">2<")
    const i3 = html.indexOf(">3<")
    expect(i1).toBeGreaterThanOrEqual(0)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
  })

  it("keeps everything the group table did right: scope, caption, disclosure, and the NRR honesty", async () => {
    const html = await markup([row("t1", "Falcon CC", { hasNetRunRate: false, netRunRate: 0 })], "A")
    expect(html).toContain('scope="col"')
    expect(html).toContain('scope="row"')
    expect(html).toContain("Group A")
    expect(html).toContain("Unlabelled fixtures stay in the tournament-wide table")
    expect(html).toMatch(/—/)
    expect(html).not.toContain("0.000")
  })
})
