import { describe, expect, it } from "vitest"
import {
  DISPLAY_TIME_ZONE_OPTIONS, isValidTimeZone, isUsableDisplayTimeZone, UTC_FALLBACK_SUFFIX,
} from "@/lib/time-policy"

/**
 * UX-03 display-timezone policy. Pure: Intl IS the contract - a zone is
 * valid exactly when Intl.DateTimeFormat accepts it, and anything a stored
 * preference fails is fall-closed to the explicit UTC-labelled rendering.
 */
describe("display-timezone policy", () => {
  it("accepts real IANA zones and offsets Intl understands", () => {
    expect(isValidTimeZone("UTC")).toBe(true)
    expect(isValidTimeZone("Asia/Karachi")).toBe(true)
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true)
    expect(isValidTimeZone("Europe/London")).toBe(true)
    expect(isValidTimeZone("America/New_York")).toBe(true)
    expect(isValidTimeZone("Etc/GMT+5")).toBe(true)
  })

  it("rejects invented zones, empty strings and nonsense", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false)
    expect(isValidTimeZone("")).toBe(false)
    expect(isValidTimeZone("Asia Karachi")).toBe(false)
    expect(isValidTimeZone("Not/AZone")).toBe(false)
  })

  it("usability requires a string Intl accepts (null/undefined fall closed)", () => {
    expect(isUsableDisplayTimeZone("Asia/Karachi")).toBe(true)
    expect(isUsableDisplayTimeZone(null)).toBe(false)
    expect(isUsableDisplayTimeZone(undefined)).toBe(false)
    expect(isUsableDisplayTimeZone("Mars/Olympus")).toBe(false)
    expect(isUsableDisplayTimeZone(42 as unknown as string)).toBe(false)
  })

  it("offers only valid, unique zones, including the UTC fallback", () => {
    const zones = DISPLAY_TIME_ZONE_OPTIONS as readonly string[]
    expect(new Set(zones).size).toBe(zones.length)
    for (const zone of zones) {
      expect(isValidTimeZone(zone), `offered zone must be Intl-valid: ${zone}`).toBe(true)
    }
    expect(zones).toContain("UTC")
    // Cricket-region choices stay first-class offers.
    expect(zones).toContain("Asia/Karachi")
  })

  it("keeps the fallback suffix in its exported, testable place", () => {
    expect(UTC_FALLBACK_SUFFIX).toBe(" UTC")
  })
})
