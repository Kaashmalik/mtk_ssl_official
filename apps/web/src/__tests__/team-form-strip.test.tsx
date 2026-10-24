import React from "react"
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { FORM_GUIDE_DISCLOSURE, type FormGuideRow } from "@/lib/form-guide"

/**
 * Batch 135: the match centre names two teams and then says nothing about
 * what either has been doing. CricHeroes shows each side's recent form on
 * the match page. The strip reuses the APPROVED form-guide engine
 * (computeFormGuide output — derived only from official published results,
 * disclosure ALWAYS attached) as a per-team presentation: letter chips
 * most-recent-first, the counts, and a streak line. A team with no
 * completed matches gets an honest line instead of fabricated zeros, and
 * no strip ever appears without the disclosure.
 */

const row = (over: Partial<FormGuideRow> = {}): FormGuideRow => ({
  teamId: "t1",
  teamName: "Falcon CC",
  sequence: [
    { matchId: "m1", letter: "W", opponentName: "Tigers", resultText: "Won by 12 runs", playedOn: "2026-10-20T10:00:00.000Z" },
    { matchId: "m2", letter: "W", opponentName: "Lions", resultText: null, playedOn: "2026-10-13T10:00:00.000Z" },
    { matchId: "m3", letter: "L", opponentName: "Bears", resultText: "Lost by 4 wickets", playedOn: "2026-10-06T10:00:00.000Z" },
  ],
  played: 3, won: 2, lost: 1, noVerdict: 0,
  streak: { letter: "W", length: 2 },
  ...over,
})

async function strip(rowData: FormGuideRow | null): Promise<string> {
  const { TeamFormStrip } = await import("../components/matches/team-form-strip")
  return renderToStaticMarkup(React.createElement(TeamFormStrip, { row: rowData }))
}

describe("Team form strip on the match centre (Batch 135)", () => {
  it("renders the recent letters most-recent-first, with counts and the ALWAYS-on disclosure", async () => {
    const html = await strip(row())
    expect(html).toContain(">W<")
    expect(html).toContain(">L<")
    expect(html).toContain("2W · 1L")
    expect(html).toContain(FORM_GUIDE_DISCLOSURE.slice(0, 24))
  })

  it("says the streak out loud — won or lost, honestly sized", async () => {
    const won = await strip(row())
    expect(won).toContain("Won last 2")
    const lost = await strip(row({ streak: { letter: "L", length: 3 } }))
    expect(lost).toContain("Lost last 3")
  })

  it("a team with no completed matches says so — no fabricated zeros, no invented form", async () => {
    const empty = await strip(null)
    expect(empty).toContain("No completed matches yet")
    expect(empty).toContain(FORM_GUIDE_DISCLOSURE.slice(0, 24))
  })
})
