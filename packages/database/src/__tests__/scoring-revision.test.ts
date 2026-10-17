import { describe, expect, it } from "vitest"
import { MAX_SCORING_REVISION, scoringRevisionDecision } from "../lib/scoring-revision"

describe("Durable canonical scoring revision policy", () => {
  it("permits a missing token only before the first mutation", () => {
    expect(scoringRevisionDecision(undefined, 0)).toEqual({ status: "accepted", current: 0, next: 1 })
    expect(scoringRevisionDecision(null, 0).status).toBe("accepted")
    expect(scoringRevisionDecision(undefined, 1).status).toBe("conflict")
  })
  it("accepts only the exact current revision and predicts one increment", () => {
    expect(scoringRevisionDecision(4, 4)).toEqual({ status: "accepted", current: 4, next: 5 })
    expect(scoringRevisionDecision(3, 4).status).toBe("conflict")
    expect(scoringRevisionDecision(5, 4).status).toBe("conflict")
  })
  it.each([-1, 0.5, NaN, Infinity, MAX_SCORING_REVISION, MAX_SCORING_REVISION + 1])(
    "refuses corrupt or exhausted stored revisions (%s)", revision => {
      expect(scoringRevisionDecision(revision, revision).status).toBe("conflict")
    })
  it.each([-1, 0.5, NaN, Infinity])("rejects malformed expected revisions (%s)", expected => {
    expect(scoringRevisionDecision(expected, 0).status).toBe("conflict")
  })
})
