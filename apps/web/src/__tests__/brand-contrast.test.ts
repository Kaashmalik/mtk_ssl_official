import { describe, expect, it } from "vitest"
import { brandPresentation, brandVariables } from "@/lib/brand-presentation"

/**
 * ENH-04-01 acceptance (code-side arm): injected tenant brand colors always
 * pair with a foreground that meets WCAG AA (>= 4.5:1) large-text-safe
 * contrast, across the full 24-bit color space sweep + known presets.
 */

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

describe("tenant brand contrast (ENH-04-01)", () => {
  it("pairs every accepted brand color with an AA-contrast foreground", () => {
    // Deterministic sweep: every 997th (prime stride) of the 24-bit space
    // (~16.7k pairs) plus the extreme corners and the league's preset
    // greens. Violations are collected and asserted once - that is both
    // cheaper than per-iteration expects and under the 5s cap.
    const samples: string[] = ["#000000", "#ffffff", "#16a34a", "#0ea5e9", "#e11d48", "#f59e0b"]
    for (let i = 0; i < 0x1000000; i += 997) {
      samples.push(`#${i.toString(16).padStart(6, "0")}`)
    }
    const violations: Array<{ bg: string; fg: string; ratio: number }> = []
    let worst = { bg: "#000000", fg: "#ffffff", ratio: 21 }
    for (const bg of samples) {
      const branding = brandPresentation({ primaryColor: bg, secondaryColor: bg, accentColor: bg })
      if (!branding) throw new Error(`brandPresentation rejected ${bg}`)
      const vars = brandVariables(branding)
      const foreground = vars["--primary-foreground"]!
      const ratio = contrastRatio(bg, foreground)
      if (ratio < worst.ratio) worst = { bg, fg: foreground, ratio }
      if (ratio < 4.5) violations.push({ bg, fg: foreground, ratio })
    }
    expect(violations, `worst contrast: ${JSON.stringify(worst)}`).toEqual([])
  })

  it("refuses junk colors instead of injecting them", () => {
    expect(brandPresentation({ primaryColor: "javascript:alert(1)" })).toMatchObject({ primaryColor: undefined })
    expect(brandPresentation({ primaryColor: "#12345" })).toMatchObject({ primaryColor: undefined })
    expect(brandPresentation({ primaryColor: 42 })).toMatchObject({ primaryColor: undefined })
  })
})
