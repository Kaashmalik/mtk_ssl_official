import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Batch 131: a fresh match renders the reaction bar as five buttons that
 * all read "0" — no invitation, no context, and a first-time fan has no
 * idea reactions are safe (engagement-only, never affecting results).
 * When — and ONLY when — every count is genuinely zero, the bar says so
 * honestly ("Be the first to react…", carrying the engagement-only truth).
 * Any real reaction makes the prompt disappear (it would then be false).
 * The toggle/refusal/blocked handling below is untouched.
 */

afterEach(() => {
  vi.resetModules()
})

vi.mock("@/app/actions/fan-reactions", () => ({
  toggleMatchReaction: vi.fn(async () => ({ action: "refused", reason: "rate_limited" })),
}))

const ZERO_COUNTS = { four: 0, six: 0, wicket: 0, clap: 0, fire: 0 }

async function barMarkup(counts: Record<string, number>, mine: string[] = []): Promise<string> {
  vi.resetModules()
  const { MatchReactionBar } = await import("../components/shared/match-reaction-bar")
  return renderToStaticMarkup(
    React.createElement(MatchReactionBar, { matchId: "m1", initialCounts: counts as any, initialMine: mine as any }),
  )
}

describe("Match reaction bar empty state (Batch 131)", () => {
  it("a fresh match INVITES the first fan — honestly, with the engagement-only caveat", async () => {
    const markup = await barMarkup(ZERO_COUNTS)
    expect(markup).toContain("Be the first to react")
    expect(markup).toContain("never affect")
  })

  it("with any real reaction the prompt is GONE — it would be false", async () => {
    const markup = await barMarkup({ ...ZERO_COUNTS, fire: 3 }, [])
    expect(markup).not.toContain("Be the first to react")
    // The count badge still shows the real number.
    expect(markup).toContain("3")
  })
})
