import { describe, expect, it } from "vitest"

/**
 * COMP-07 (Batch 153): competition-control policy pins. Forfeit,
 * postponement and rescheduling are owner moves with a fixed vocabulary.
 * Terminal result states (completed/abandoned/cancelled/no_result) can
 * NEVER be rewritten into a forfeit or postponement - that would be a
 * silent result change. Rescheduling is only possible while the match
 * has a future (scheduled or postponed).
 */
import { canForfeit, canPostpone, canReschedule, describeMatchControl } from "@mtk/database"

describe("COMP-07 (Batch 153): competition-control policy", () => {
  it("allows forfeit only from open states", () => {
    for (const open of ["scheduled", "toss", "live", "innings_break"]) expect(canForfeit(open)).toBe(true)
    for (const closed of ["completed", "abandoned", "cancelled", "no_result", "forfeited", "postponed", "anything-else"]) {
      expect(canForfeit(closed)).toBe(false)
    }
  })

  it("allows postponement only from open states", () => {
    for (const open of ["scheduled", "toss", "live", "innings_break"]) expect(canPostpone(open)).toBe(true)
    for (const closed of ["completed", "cancelled", "no_result", "postponed"]) expect(canPostpone(closed)).toBe(false)
  })

  it("allows rescheduling only while a date is meaningful", () => {
    expect(canReschedule("scheduled")).toBe(true)
    expect(canReschedule("postponed")).toBe(true)
    for (const closed of ["live", "completed", "cancelled", "forfeited", "innings_break"]) expect(canReschedule(closed)).toBe(false)
  })

  it("describes controlled states honestly, never pretending a result", () => {
    expect(describeMatchControl("forfeited")).toContain("result stands as recorded")
    expect(describeMatchControl("postponed")).toContain("new date")
    expect(describeMatchControl("cancelled")).toContain("No result")
    expect(describeMatchControl("live")).toContain("still open")
  })

  it("never lets a terminal result state masquerade as open", () => {
    // The state machine guard: completed matches are outside the forfeit
    // and postponement vocabularies entirely.
    expect(canForfeit("completed")).toBe(false)
    expect(canPostpone("completed")).toBe(false)
    expect(canReschedule("completed")).toBe(false)
  })
})
