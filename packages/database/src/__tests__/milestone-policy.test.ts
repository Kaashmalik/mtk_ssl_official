import { describe, expect, it } from "vitest"
import {
  isMilestoneCentury, isMilestoneFiveFor, compareMilestoneEntries,
  MILESTONE_LIMIT, type MilestoneEntry,
} from "../lib/milestone-policy"

describe("Milestone policy (FAN-03)", () => {
  it("admits exactly integer innings of 100+ runs as centuries", () => {
    expect(isMilestoneCentury({ runs: 100 })).toBe(true)
    expect(isMilestoneCentury({ runs: 214 })).toBe(true)
    expect(isMilestoneCentury({ runs: 99 })).toBe(false)
    expect(isMilestoneCentury({ runs: 100.5 })).toBe(false)
    expect(isMilestoneCentury({ runs: -10 })).toBe(false)
    expect(isMilestoneCentury({ runs: null })).toBe(false)
    expect(isMilestoneCentury({ runs: undefined })).toBe(false)
    expect(isMilestoneCentury({ runs: "120" as unknown as number })).toBe(false)
  })

  it("admits exactly integer innings of 5+ wickets as five-fors (or better)", () => {
    expect(isMilestoneFiveFor({ wickets: 5 })).toBe(true)
    expect(isMilestoneFiveFor({ wickets: 6 })).toBe(true)
    expect(isMilestoneFiveFor({ wickets: 4 })).toBe(false)
    expect(isMilestoneFiveFor({ wickets: 5.5 })).toBe(false)
    expect(isMilestoneFiveFor({ wickets: null })).toBe(false)
    expect(isMilestoneFiveFor({ wickets: undefined })).toBe(false)
  })

  it("orders entries by value best-first with a stable id tiebreak", () => {
    const entry = (playerId: string, value: number): MilestoneEntry => ({
      playerId, playerName: playerId, playerVerified: true, value, recordedAt: "2026-10-18T00:00:00.000Z",
    })
    const rows = [entry("b", 100), entry("d", 214), entry("a", 100), entry("c", 150)]
    const sorted = [...rows].sort(compareMilestoneEntries)
    expect(sorted.map(r => `${r.playerId}:${r.value}`)).toEqual(["d:214", "c:150", "a:100", "b:100"])
  })

  it("keeps the fan-facing bound and stays celebration-only by construction", () => {
    expect(MILESTONE_LIMIT).toBe(10)
  })
})
