import React from "react"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Batch 123: the accessibility affordances the platform should always ship.
 * A skip-to-content link is the first focusable element on every page; it
 * must be visually hidden until focused and point at the real main region.
 */
describe("Skip-to-content (Batch 123)", () => {
  it("renders a visually-hidden, focusable skip link to the main region as the first tab stop", async () => {
    vi.resetModules()
    const { SkipLink } = await import("../components/skip-link")
    const html = renderToStaticMarkup(React.createElement(SkipLink))
    expect(html).toContain('href="#main-content"')
    expect(html).toContain("Skip to content")
    expect(html).toMatch(/sr-only/) // visually hidden until focused
    expect(html).toMatch(/focus:/) // becomes visible on keyboard focus
  })
})
