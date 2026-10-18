import { describe, expect, it } from "vitest"
import {
  DISPLAY_NAME_MAX,
  describeDisplayName,
  normalizeDisplayName,
} from "../lib/profile-policy"

describe("display-name policy (Batch 142, REG-05)", () => {
  it("trims and collapses whitespace honestly", () => {
    expect(normalizeDisplayName("  Ayesha   Khan ")).toEqual({ ok: true, value: "Ayesha Khan" })
  })

  it("empty means REMOVE (null), never an empty string", () => {
    expect(normalizeDisplayName("   ")).toEqual({ ok: true, value: null })
    expect(normalizeDisplayName("")).toEqual({ ok: true, value: null })
    expect(normalizeDisplayName(null)).toEqual({ ok: true, value: null })
    expect(normalizeDisplayName(undefined)).toEqual({ ok: true, value: null })
  })

  it("refuses over-length names with a reason instead of truncating silently", () => {
    const long = "A".repeat(DISPLAY_NAME_MAX + 1)
    const decision = normalizeDisplayName(long)
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toMatch(/at most 60/)
    expect(normalizeDisplayName("A".repeat(DISPLAY_NAME_MAX)).ok).toBe(true)
  })

  it("describe states the fact, including the honest unnamed fallback", () => {
    expect(describeDisplayName("Ayesha Khan")).toContain('"Ayesha Khan"')
    expect(describeDisplayName(null)).toMatch(/unnamed/)
  })
})
