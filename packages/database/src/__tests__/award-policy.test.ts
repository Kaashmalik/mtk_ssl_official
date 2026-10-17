import { describe, expect, it } from "vitest"
import { AWARD_CATEGORIES, AWARD_CATEGORY_LABELS, isAwardCategory, isAwardVisible, PUBLIC_AWARD_LIMIT } from "../lib/award-policy"

describe("Official award policy (PUB-04)", () => {
  it("exposes a fixed, non-empty category set with a display label for every category", () => {
    expect(AWARD_CATEGORIES.length).toBeGreaterThan(0)
    expect(new Set(AWARD_CATEGORIES).size).toBe(AWARD_CATEGORIES.length)
    for (const category of AWARD_CATEGORIES) {
      expect(typeof AWARD_CATEGORY_LABELS[category]).toBe("string")
      expect(AWARD_CATEGORY_LABELS[category].length).toBeGreaterThan(0)
    }
  })

  it("recognizes exactly the declared categories and nothing else", () => {
    for (const category of AWARD_CATEGORIES) expect(isAwardCategory(category)).toBe(true)
    expect(isAwardCategory("best_keeper")).toBe(false)
    expect(isAwardCategory("fan_favorite")).toBe(false)
    expect(isAwardCategory("")).toBe(false)
    expect(isAwardCategory(42)).toBe(false)
    expect(isAwardCategory(null)).toBe(false)
  })

  it("fails closed on ambiguous or superseded rows and on unpublished tournaments", () => {
    const player = { playerId: "p", teamId: null, supersededAt: null }
    const team = { playerId: null, teamId: "t", supersededAt: null }
    expect(isAwardVisible(player, true)).toBe(true)
    expect(isAwardVisible(team, true)).toBe(true)
    // Publication is a caller obligation the policy still re-asserts.
    expect(isAwardVisible(player, false)).toBe(false)
    // Superseded rows are history, never gallery rows.
    expect(isAwardVisible({ ...player, supersededAt: new Date() }, true)).toBe(false)
    // Ambiguity (both or neither winner) can never be publicized.
    expect(isAwardVisible({ playerId: "p", teamId: "t", supersededAt: null }, true)).toBe(false)
    expect(isAwardVisible({ playerId: null, teamId: null, supersededAt: null }, true)).toBe(false)
    // Defensive null handling.
    expect(isAwardVisible(null, true)).toBe(false)
    expect(isAwardVisible(undefined, true)).toBe(false)
  })

  it("bounds the public gallery", () => {
    expect(PUBLIC_AWARD_LIMIT).toBeGreaterThan(0)
    expect(PUBLIC_AWARD_LIMIT).toBeLessThanOrEqual(50)
  })
})
