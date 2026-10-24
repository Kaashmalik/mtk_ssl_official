import React from "react"
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Batch 139 (ENH-04-03 deferral: per-action pending states and stable
 * scoring controls). The shared Button primitive had no pending story —
 * two call sites hand-rolled Loader2 spinners into children and every
 * scattershot surface re-invented disabled-while-busy. isLoading moves
 * the pattern INTO the primitive: spinner in, button disabled and
 * aria-busy, hover/active affordances suppressed — while remaining
 * byte-compatible for every existing caller (default false renders
 * EXACTLY as before: no spinner, no disabled, no aria attribute).
 */

async function button(over: Record<string, unknown> = {}): Promise<string> {
  const { Button } = await import("../../../../packages/ui/src/components/ui/button")
  return renderToStaticMarkup(React.createElement(Button, { children: "Save", ...over }))
}

describe("Button isLoading (Batch 139)", () => {
  /** `disabled:` CSS utilities ride in every class string; only the
   *  attribute form means the button is actually disabled. */
  const attr = (html: string) => html.match(/\sdisabled="/g) ?? []

  it("default renders exactly as before — zero drift for existing callers", async () => {
    const html = await button()
    expect(html).toContain(">Save</button>")
    expect(html).not.toMatch(/aria-busy/)
    expect(attr(html)).toHaveLength(0)
    expect(html).not.toContain("animate-spin")
  })

  it("isLoading disables the button and announces busy", async () => {
    const html = await button({ isLoading: true })
    expect(attr(html)).toHaveLength(1)
    expect(html).toMatch(/aria-busy="true"/)
  })

  it("isLoading renders an assistive-hidden spinner", async () => {
    const html = await button({ isLoading: true })
    expect(html).toContain("animate-spin")
    expect(html).toMatch(/aria-hidden="true"/)
    // The label survives the spinner (children still render).
    expect(html).toContain("Save")
  })

  it("isLoading respects an explicit disabled too, and asChild stays untouched", async () => {
    const both = await button({ isLoading: true, disabled: true })
    expect(attr(both)).toHaveLength(1)
    // asChild delegates to the child element: the primitive must not inject
    // attributes children don't expect.
    const { Button } = await import("../../../../packages/ui/src/components/ui/button")
    const child = React.createElement("span", { "data-slot": "trigger" }, "go")
    const html = renderToStaticMarkup(React.createElement(Button, { asChild: true, isLoading: true }, child))
    expect(html).toContain("<span")
    expect(html).not.toMatch(/<button/)
  })
})
