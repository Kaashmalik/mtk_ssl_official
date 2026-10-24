import React from "react"
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Batch 132: the tournament-wide Points Table hid the NRR column even
 * though the versioned standings engine COMPUTES it and SORTS by it (the
 * group tables already show it). A reader watching their team sit below
 * another on equal points couldn't see the tiebreak that put them there.
 * The table is extracted into a presentation component (same pattern as
 * GroupStandings) that adds the NRR column with the SAME convention the
 * group tables use: formatNetRunRate when there is complete innings
 * evidence on both sides, an honest "—" until then (a fresh team has no
 * NRR, and inventing 0.00 would be a claim).
 */

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  ruleVersion: 1, teamId: "t1", name: "Falcon CC", shortName: "FAL",
  played: 3, won: 2, lost: 1, noResult: 0, points: 4,
  runsFor: 450, ballsFor: 120, runsAgainst: 440, ballsAgainst: 130,
  netRunRate: 0.1538, hasNetRunRate: true,
  ...over,
})

async function markup(rows: unknown[]): Promise<string> {
  // Fresh module each call; the component is a pure server presentation.
  const { PointsTable } = await import("../components/tournaments/points-table")
  return renderToStaticMarkup(React.createElement(PointsTable, { rows: rows as any }))
}

describe("Points Table NRR (Batch 132)", () => {
  it("shows the NRR column with the formatted rate a reader can verify", async () => {
    const html = await markup([row()])
    expect(html).toContain(">NRR<")
    expect(html).toContain("+0.154")
  })

  it("a team without complete innings evidence shows an honest em-dash, never a fake 0.00", async () => {
    const html = await markup([row({ hasNetRunRate: false, netRunRate: 0 })])
    expect(html).toMatch(/—/) // em-dash present in the NRR cell
    expect(html).not.toContain("0.000")
    expect(html).not.toContain("0.00")
  })

  it("keeps the scanning columns and the long-name truncation untouched", async () => {
    const long = row({ name: "Sir Vivian Richards Memorial Cricket Club North" })
    const html = await markup([long])
    expect(html).toContain(">P<")
    expect(html).toContain(">W<")
    expect(html).toContain(">L<")
    expect(html).toContain(">Pts<")
    expect(html).toContain("truncate")
    expect(html).toContain(`title="Sir Vivian Richards Memorial Cricket Club North"`)
    expect(html).toContain(">4<") // points render
  })
})
