import { describe, expect, it } from "vitest"
import { membershipExpiryDisplay } from "@/lib/membership-display"

const NOW = new Date("2026-10-16T12:00:00.000Z")
const ISO = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * 3_600_000).toISOString()

describe("membership expiry display (IAM-02, rule v1)", () => {
  it("unbounded memberships report no expiry at all", () => {
    for (const value of [null, undefined]) {
      const display = membershipExpiryDisplay(value, NOW)
      expect(display.state).toBe("unbounded")
      expect(display.short).toBe("No expiry")
    }
  })

  it("live bounds show the future date; passed bounds render as expired", () => {
    const live = membershipExpiryDisplay(ISO(48), NOW)
    expect(live.state).toBe("live")
    expect(live.short).toMatch(/^Expires \d{1,2} \w{3} \d{4}$/)

    const expired = membershipExpiryDisplay(ISO(-1), NOW)
    expect(expired.state).toBe("expired")
    expect(expired.short).toMatch(/^Expired \d{1,2} \w{3} \d{4}$/)
    expect(expired.detail).toContain("clear or extend the expiry, not just the status")
  })

  it("unparseable bounds are a distinct fail-closed state, never 'no expiry'", () => {
    const display = membershipExpiryDisplay("not-a-date", NOW)
    expect(display.state).toBe("invalid")
    expect(display.detail).toContain("withheld")
  })

  it("accepts Date instances and matches string rendering", () => {
    const date = new Date(ISO(24))
    expect(membershipExpiryDisplay(date, NOW).state).toBe("live")
    expect(membershipExpiryDisplay(date, NOW).short).toBe(membershipExpiryDisplay(date.toISOString(), NOW).short)
  })

  it("the exact boundary instant counts as expired", () => {
    const edge = NOW.toISOString()
    expect(membershipExpiryDisplay(edge, NOW).state).toBe("expired")
  })
})
