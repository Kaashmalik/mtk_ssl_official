import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The phone menu on the public home page is a native <details> disclosure
 * (hook-free, works before hydration). It regressed once: the header and
 * <main> both carried `relative z-10`, so the later sibling (<main>) painted
 * over the open dropdown and the navigation looked dead on phones even though
 * the <details> did open.
 *
 * These are source pins rather than render assertions because the failure was
 * pure paint order: the markup was always correct.
 */
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const home = readFileSync(join(srcRoot, "components", "home-content.tsx"), "utf8")
const nav = readFileSync(join(srcRoot, "components", "public", "public-nav.tsx"), "utf8")

describe("mobile navigation (home header)", () => {
  it("the header outranks <main> so the open menu is not painted underneath content", () => {
    expect(home).toContain('<header className="container relative z-30')
    expect(home).toContain('<main className="container relative z-10')
  })

  it("the disclosure stays native and closes itself after a tap", () => {
    expect(nav).toContain("<details")
    expect(nav).toContain('aria-label="Open navigation menu"')
    expect(nav).toContain('aria-label="Primary mobile"')
    expect(nav).toContain("z-50")
    expect(nav).toContain('removeAttribute("open")')
  })
})
