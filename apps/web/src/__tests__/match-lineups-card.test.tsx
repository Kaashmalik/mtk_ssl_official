import React from "react"
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { MatchLineups } from "@/lib/match-lineups"

/**
 * Batch 137: the match centre's announced lineups are a PRESENTATION of the
 * fail-closed fold (buildMatchLineups) — this card invents nothing of its
 * own: a complete XI renders as the numbered batting sheet with the marked
 * keeper, a side that never declared a complete XI reads "No XI announced
 * yet" (honest absence, never an empty shell or fabricated zeros), the
 * declared-but-unapproved state shows the note, and linesups with nothing
 * real to show render NOTHING (the page never mounts the card on a null
 * fold — and the component guards it too).
 */

const P = (name: string, wicketkeeper = false) => ({ name, wicketkeeper })

const lineups = (over: Partial<MatchLineups>): MatchLineups => ({
  awaitingApproval: false,
  a: { players: Array.from({ length: 11 }, (_, i) => P(`Player ${i + 1}`, i === 0)) },
  b: { players: Array.from({ length: 11 }, (_, i) => P(`Rival ${i + 1}`, i === 6)) },
  ...over,
})

async function card(data: MatchLineups | null): Promise<string> {
  const { MatchLineupsCard } = await import("../components/matches/match-lineups")
  return renderToStaticMarkup(
    React.createElement(MatchLineupsCard, { lineups: data, teamAName: "Falcons", teamBName: "Tigers" }),
  )
}

describe("Match lineups card (Batch 137)", () => {
  it("renders both batting sheets with the keeper marked, and the disclosure always attached", async () => {
    const html = await card(lineups({}))
    expect(html).toContain("Playing XIs")
    expect(html).toContain("Player 1")
    expect(html).toContain("Rival 7")
    // The keeper is a labeled affordance, not a bare glyph.
    expect(html).toMatch(/wicketkeeper/i)
    expect(html).toContain("exactly as declared")
  })

  it("a side without a complete declaration says so honestly beside the other side's sheet", async () => {
    const html = await card(lineups({ b: null }))
    expect(html).toContain("No XI announced yet")
    expect(html).toContain("Player 1")
  })

  it("a declared-but-unapproved lineup shows the genuine state note; an approved one does not", async () => {
    const pending = await card(lineups({ awaitingApproval: true }))
    expect(pending).toContain("awaiting official approval")
    const approved = await card(lineups({}))
    expect(approved).not.toContain("awaiting official approval")
  })

  it("nothing to render — both sides absent renders NOTHING (never an empty shell)", async () => {
    expect(await card(null)).toBe("")
  })
})
