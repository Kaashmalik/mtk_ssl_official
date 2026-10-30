import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Brand-mark surfaces that cannot be rendered under node: the sign-in page
 * transitively imports Clerk and next/image, and the OG card is a Satori
 * ImageResponse. Both are pinned against their source instead — the same
 * discipline the brand-chrome and ISO source scans use.
 *
 * The contract: where the header/sidebar already fall back to <BrandMark>,
 * the sign-in page must too. A null tenant logo (the seeded dead URLs were
 * cleared) must never leave an empty slot or a broken <img>.
 */
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "app")

describe("brand mark fallbacks (sign-in + OG card)", () => {
  const signIn = readFileSync(join(appDir, "sign-in", "[[...sign-in]]", "page.tsx"), "utf8")
  const og = readFileSync(join(appDir, "opengraph-image.tsx"), "utf8")

  it("sign-in renders the platform mark and brand name when the tenant has no logo", () => {
    expect(signIn).toContain('import { BrandMark } from "@/components/brand-mark"')
    // The tenant logo still wins when present...
    expect(signIn).toContain("branding?.logoUrl ?")
    // ...and the else branch is the real mark, not an empty div.
    expect(signIn).toContain('<BrandMark idPrefix="signin-mark"')
    expect(signIn).toContain("resolveBrandName(branding ?? null)")
    // The old shape skipped the slot entirely when logoUrl was null.
    expect(signIn).not.toContain("{branding?.logoUrl && (")
  })

  it("the OG card carries the same pitch-green mark, not the old colour bars", () => {
    expect(og).toContain("#22c55e")
    expect(og).toContain("#047857")
    expect(og).not.toContain("#1e40af")
    expect(og).not.toContain("#0f766e")
  })

  it("Clerk's footer never paints the opaque black panel under dark text", () => {
    // colorBackground: transparent is resolved to rgb(0,0,0) by Clerk for the
    // footer's gradient layer; clearing the footer background is the fix.
    const clerk = readFileSync(join(appDir, "sign-in", "[[...sign-in]]", "clerk-sign-in.tsx"), "utf8")
    expect(clerk).toContain('footer: "bg-none!"')
  })
})
