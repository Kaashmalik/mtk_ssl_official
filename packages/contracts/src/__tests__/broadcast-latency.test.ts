import { describe, expect, it } from "vitest"
import {
  GRAPHICS_OFFSET_MS_MAX,
  GRAPHICS_OFFSET_MS_MIN,
  GRAPHICS_OFFSET_MS_STEP,
  SNAPSHOT_STALE_AFTER_MS,
  clampGraphicsOffsetMs,
  normalizeGraphicsOffsetValue,
} from "../broadcast-latency"

/**
 * ENH-09-04 (Batch 101): graphics-offset policy. The offset is a RENDERING
 * delay for overlay events only - these pins guarantee it can never go
 * negative, exceed the band, or let junk settings break/delay the stream
 * arbitrarily.
 */

describe("Batch 101: graphics offset clamping", () => {
  it("keeps in-band values on the step grid", () => {
    expect(clampGraphicsOffsetMs(0)).toBe(0)
    expect(clampGraphicsOffsetMs(2_000)).toBe(2_000)
    expect(clampGraphicsOffsetMs(GRAPHICS_OFFSET_MS_MAX)).toBe(GRAPHICS_OFFSET_MS_MAX)
    // Fractional input rounds to the nearest step, never a sub-step smear.
    expect(clampGraphicsOffsetMs(1_999)).toBe(2_000)
    expect(clampGraphicsOffsetMs(2_124)).toBe(2_000)
    expect(clampGraphicsOffsetMs(2_130)).toBe(2_250)
  })

  it("clamps out-of-band and collapses junk to 0 instead of failing", () => {
    expect(clampGraphicsOffsetMs(-1)).toBe(GRAPHICS_OFFSET_MS_MIN)
    expect(clampGraphicsOffsetMs(-10_000)).toBe(GRAPHICS_OFFSET_MS_MIN)
    expect(clampGraphicsOffsetMs(GRAPHICS_OFFSET_MS_MAX + GRAPHICS_OFFSET_MS_STEP)).toBe(GRAPHICS_OFFSET_MS_MAX)
    expect(clampGraphicsOffsetMs(60_000)).toBe(GRAPHICS_OFFSET_MS_MAX)
    for (const junk of [NaN, Infinity, -Infinity, "abc", "", "   ", null, undefined, {}, []]) {
      expect(clampGraphicsOffsetMs(junk)).toBe(0)
    }
    // Numeric strings stay the operator's typed value, clamped.
    expect(clampGraphicsOffsetMs("1500")).toBe(1_500)
  })

  it("keeps the bounds coherent with the operator step", () => {
    expect(GRAPHICS_OFFSET_MS_MIN).toBe(0)
    expect(GRAPHICS_OFFSET_MS_MAX % GRAPHICS_OFFSET_MS_STEP).toBe(0)
    expect(GRAPHICS_OFFSET_MS_STEP).toBeGreaterThan(0)
    // The staleness threshold must outlive one missed 5s poll but stay
    // operator-noticeable.
    expect(SNAPSHOT_STALE_AFTER_MS).toBeGreaterThanOrEqual(10_000)
    expect(SNAPSHOT_STALE_AFTER_MS).toBeLessThanOrEqual(30_000)
  })
})

describe("Batch 101: offsetMs URL parameter normalization", () => {
  it("normalizes numeric values and clamps out-of-band ones", () => {
    expect(normalizeGraphicsOffsetValue("2500")).toBe(2_500)
    expect(normalizeGraphicsOffsetValue(" 1000 ")).toBe(1_000)
    expect(normalizeGraphicsOffsetValue("-500")).toBe(0)
    expect(normalizeGraphicsOffsetValue("99000")).toBe(GRAPHICS_OFFSET_MS_MAX)
    expect(normalizeGraphicsOffsetValue("2.5")).toBe(0) // rounds to step grid
  })

  it("returns null for absent/empty/junk so the stored preference applies", () => {
    expect(normalizeGraphicsOffsetValue(undefined)).toBeNull()
    expect(normalizeGraphicsOffsetValue(null)).toBeNull()
    expect(normalizeGraphicsOffsetValue("")).toBeNull()
    expect(normalizeGraphicsOffsetValue("   ")).toBeNull()
    expect(normalizeGraphicsOffsetValue("suv")).toBeNull()
    expect(normalizeGraphicsOffsetValue("2500;drop")).toBeNull()
    // Negative zero/decimal strings still parse as numbers.
    expect(normalizeGraphicsOffsetValue("0")).toBe(0)
    expect(normalizeGraphicsOffsetValue("1000.0")).toBe(1_000)
  })
})
