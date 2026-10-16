import { describe, expect, it } from "vitest"
import { computeMembershipBound, formatMembershipBound, invitationBoundPresets } from "@/lib/invite-expiry-options"

const NOW = new Date("2026-10-16T12:00:00.000Z")

describe("invitation membership bound presets (SCORE-09, rule v1)", () => {
  it("offers a no-bound default plus fixed-day presets, values stable for the select", () => {
    expect(invitationBoundPresets.map(preset => preset.value)).toEqual(["none", "30", "90", "180", "365"])
    expect(invitationBoundPresets[0]).toMatchObject({ days: null, label: "No membership bound" })
  })

  it("computes strictly future instants from the caller's clock and nothing otherwise", () => {
    expect(computeMembershipBound("none", NOW)).toBeNull()
    expect(computeMembershipBound("unknown-value", NOW)).toBeNull()
    expect(computeMembershipBound("30", NOW)).toEqual(new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000))
    const year = computeMembershipBound("365", NOW)
    expect(year).toBeInstanceOf(Date)
    expect(year!.getTime()).toBeGreaterThan(NOW.getTime())
  })

  it("formats bounds for list rows; absence reads as an explicit no-bound", () => {
    expect(formatMembershipBound(null)).toBe("No bound")
    expect(formatMembershipBound(undefined)).toBe("No bound")
    expect(formatMembershipBound("2026-11-15T00:00:00.000Z")).toMatch(/^15 Nov 2026$/)
    expect(formatMembershipBound(new Date("2026-11-15T00:00:00.000Z"))).toBe(formatMembershipBound("2026-11-15T00:00:00.000Z"))
  })
})
