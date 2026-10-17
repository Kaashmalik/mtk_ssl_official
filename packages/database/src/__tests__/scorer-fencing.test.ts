import { describe, expect, it } from "vitest"
import { FENCE_RESYNC_MESSAGE, scorerFencingDecision } from "../lib/scorer-fencing"

describe("scorerFencingDecision (SCORE-11)", () => {
  it("accepts tokenless commands only while no handover has ever occurred", () => {
    expect(scorerFencingDecision({ commandEpoch: null, matchEpoch: 0 })).toEqual({ status: "accepted" })
    expect(scorerFencingDecision({ commandEpoch: null, matchEpoch: null })).toEqual({ status: "accepted" })
    expect(scorerFencingDecision({ commandEpoch: undefined, matchEpoch: undefined })).toEqual({ status: "accepted" })
    expect(scorerFencingDecision({ commandEpoch: null, matchEpoch: 1 })).toEqual({ status: "rejected", reason: FENCE_RESYNC_MESSAGE })
  })

  it("accepts a command whose echoed epoch matches the locked match row", () => {
    expect(scorerFencingDecision({ commandEpoch: 3, matchEpoch: 3 })).toEqual({ status: "accepted" })
  })

  it("fences a stale device of a re-occupied scorer, token or not", () => {
    // The scenario the slot pointer alone cannot catch: the scorer was
    // replaced and later re-assigned, so their old device still sees its role.
    expect(scorerFencingDecision({ commandEpoch: 4, matchEpoch: 5 })).toEqual({ status: "rejected", reason: FENCE_RESYNC_MESSAGE })
    expect(scorerFencingDecision({ commandEpoch: 6, matchEpoch: 5 }).status).toBe("rejected")
  })

  it("fails closed on a corrupt epoch on either side", () => {
    expect(scorerFencingDecision({ commandEpoch: 1.5, matchEpoch: 1 }).status).toBe("rejected")
    expect(scorerFencingDecision({ commandEpoch: -1, matchEpoch: 1 }).status).toBe("rejected")
    expect(scorerFencingDecision({ commandEpoch: 1, matchEpoch: 2.5 }).status).toBe("rejected")
    expect(scorerFencingDecision({ commandEpoch: 0, matchEpoch: Number.NaN }).status).toBe("rejected")
  })
})
