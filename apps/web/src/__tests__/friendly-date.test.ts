import { describe, expect, it } from "vitest"

/**
 * Batch 133: the fixtures card shows raw locale dates ("Oct 24, 2:00 PM")
 * for every row, including LIVE ones. A reader has to do calendar math to
 * learn the live match they're looking at started TODAY. CricHeroes-style
 * humanization, still honest: the date is always derived from the actual
 * scheduled timestamp — Today/Tomorrow when the calendar says so (without
 * a year so it never goes stale-looking), a weekday prefix for everything
 * else this year, and the year only when the fixture falls outside the
 * current one. The builder takes `now` explicitly so the daylight-saving
 * and year-boundary behavior is pinnable. Anything unverifiable (a null
 * timestamp) stays exactly what the page already said: "TBD".
 */

const todayNoon = new Date(2026, 9, 24, 12, 0) // local Sat, Oct 24 2026

describe("Friendly fixture dates (Batch 133)", () => {
  it("a fixture later TODAY says so — that's the whole point", async () => {
    const { friendlyFixtureDate } = await import("../lib/friendly-date")
    expect(friendlyFixtureDate(new Date(2026, 9, 24, 14, 30), todayNoon)).toBe("Today, 2:30 PM")
  })

  it("tomorrow gets its word; yesterday (past results) does NOT get 'Yesterday' — it keeps the weekday", async () => {
    const { friendlyFixtureDate } = await import("../lib/friendly-date")
    expect(friendlyFixtureDate(new Date(2026, 9, 25, 9, 0), todayNoon)).toBe("Tomorrow, 9:00 AM")
    expect(friendlyFixtureDate(new Date(2026, 9, 23, 15, 0), todayNoon)).toBe("Fri, Oct 23, 3:00 PM")
  })

  it("another date this year keeps a weekday prefix; another year adds THE YEAR — never a misleading bare date", async () => {
    const { friendlyFixtureDate } = await import("../lib/friendly-date")
    expect(friendlyFixtureDate(new Date(2026, 10, 7, 18, 45), todayNoon)).toBe("Sat, Nov 7, 6:45 PM")
    expect(friendlyFixtureDate(new Date(2027, 2, 14, 10, 15), todayNoon)).toBe("Sun, Mar 14, 2027, 10:15 AM")
  })

  it("an unknown timestamp stays 'TBD' — nothing is invented", async () => {
    const { friendlyFixtureDate } = await import("../lib/friendly-date")
    expect(friendlyFixtureDate(null, todayNoon)).toBe("TBD")
    expect(friendlyFixtureDate(undefined, todayNoon)).toBe("TBD")
  })
})
