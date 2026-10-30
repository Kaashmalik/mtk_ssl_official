import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The dashboard's phone hamburger opens a Sheet from the shared UI package.
 * Tailwind v4 only auto-scans the app tree, so before this was fixed the
 * Sheet's `inset-y-0` (and `ring-offset-background`, `min-w-[8rem]`, ...)
 * were missing from the shipped CSS. A `fixed` panel with no `top`/`bottom`
 * keeps its static position — below the fold — so the menu opened to a dark
 * overlay with no content: "the hamburger shows nothing".
 *
 * These are deliberately source pins: the failure was a build-time content
 * scan, invisible to component tests that render markup.
 */
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const webCss = readFileSync(join(srcRoot, "app", "globals.css"), "utf8")
const adminCss = readFileSync(
  join(srcRoot, "..", "..", "admin", "src", "app", "globals.css"),
  "utf8",
)
const sheet = readFileSync(
  join(srcRoot, "..", "..", "..", "packages", "ui", "src", "components", "ui", "sheet.tsx"),
  "utf8",
)

describe("Tailwind scans the shared UI kit", () => {
  it("registers packages/ui as a content source in web and admin", () => {
    const source = /@source\s+["'][^"']*packages\/ui\/src["']/
    expect(webCss).toMatch(source)
    expect(adminCss).toMatch(source)
  })

  it("keeps the sheet's side variants pinning the panel to the viewport", () => {
    expect(sheet).toContain("inset-y-0 left-0")
    expect(sheet).toContain("inset-y-0 right-0")
  })
})
