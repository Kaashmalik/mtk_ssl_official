import { describe, expect, it } from "vitest"
import { isMatchPublished, isTournamentPublished } from "../lib/publication-policy"

describe("Shared lifecycle publication policy", () => {
  it.each(["registration", "live", "completed"])("allows public tournament status %s", status => {
    expect(isTournamentPublished(status)).toBe(true)
  })
  it.each(["draft", "cancelled", "unknown", "", null, undefined])("denies unpublished/ambiguous tournament %s", status => {
    expect(isTournamentPublished(status)).toBe(false)
  })
  it.each(["scheduled", "toss", "live", "innings_break", "completed", "abandoned", "no_result"])("allows public match status %s", status => {
    expect(isMatchPublished(status)).toBe(true)
  })
  it.each(["cancelled", "unknown", "", null, undefined])("denies unpublished/ambiguous match %s", status => {
    expect(isMatchPublished(status)).toBe(false)
  })
})
