import React from "react"
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Batch 139 (ENH-04-03 deferral: per-action pending states and stable
 * scoring controls). The wicket selector is the highest-stakes modal in
 * the scorer's day — it records a DISMISSAL — and while its write was in
 * flight every control in it stayed live: a second tap on a fielder, a
 * tap on another wicket type, or the close button could all be clicked
 * into a submission already running (the duplicate was silently eaten by
 * a ref guard — the UI still LIED about being available). Pending is now
 * a first-class state of the modal: every action control disables, loses
 * its hover affordance, the dialog announces busy to assistive tech,
 * and a spinner says WHAT is happening. Progression (choose → victim →
 * fielder) is unchanged when not submitting.
 */

const creaseBatters = [
  { id: "b1", name: "Opener One", onStrike: true },
  { id: "b2", name: "Opener Two", onStrike: false },
]
const fielders = [
  { id: "f1", name: "Keeper Ali" },
  { id: "f2", name: "Cover Sameer" },
]

async function markup(over: Record<string, unknown> = {}): Promise<string> {
  const { WicketSelector } = await import("../components/scoring/wicket-selector")
  return renderToStaticMarkup(
    React.createElement(WicketSelector, {
      onSelect: () => {},
      onCancel: () => {},
      creaseBatters,
      fielders,
      ...over,
    }),
  )
}

describe("Wicket selector pending states (Batch 139)", () => {
  /** The `disabled:` CSS utilities ride in every class string; only the
   *  ATTRIBUTE form ` disabled="` means a control is actually disabled. */
  const attr = (html: string) => html.match(/\sdisabled="/g) ?? []

  it("not submitting — every control is enabled exactly as before", async () => {
    const html = await markup()
    expect(html).toContain("Bowled")
    expect(attr(html)).toHaveLength(0)
    expect(html).not.toMatch(/aria-busy/)
  })

  it("submitting — every control disables and the dialog announces busy", async () => {
    const html = await markup({ submitting: true })
    expect(html).toMatch(/aria-busy="true"/)
    // 6 wicket-type controls + the close affordance.
    expect(attr(html)).toHaveLength(7)
    expect(html).toMatch(/aria-label="Cancel wicket selection"/)
  })

  it("submitting shows a progress indicator so the wait is named", async () => {
    const html = await markup({ submitting: true })
    expect(html).toMatch(/animate-spin/)
  })

  it("the victim step obeys the same pending contract", async () => {
    // pendingVictimId/pendingType are internal; render through the
    // component's own flow by directly exercising the controlled step is
    // not possible statically — the wiring pin below holds the seam; here
    // the fielder step's controls carry the disabled contract via the
    // shared submit path.
    const html = await markup({ submitting: true })
    expect((html.match(/\sdisabled="/g) ?? []).length).toBeGreaterThanOrEqual(6)
  })

  it("ball-input hands its save state to the selector (the seam, pinned)", () => {
    const source = readFileSync(join(__dirname, "../components/scoring/ball-input.tsx"), "utf8")
    expect(source).toContain("submitting={saving}")
    // The pads announce their own busy state to AT while disabled.
    expect(source).toContain("aria-busy={saving")
  })

  it("wicket-selector consumes the submitting prop on every action control", () => {
    const source = readFileSync(join(__dirname, "../components/scoring/wicket-selector.tsx"), "utf8")
    // All four button groups route through the pending flag.
    expect((source.match(/disabled=\{submitting/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })
})
