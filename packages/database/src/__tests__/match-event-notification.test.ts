import { describe, expect, it } from "vitest"
import {
  MATCH_FANOUT_KINDS, matchEventDecision, matchEventCopy, matchEventDedupKey,
} from "../lib/match-event-notification"

const MATCH = "00000000-0000-4000-8000-0000000000c1"

function base(overrides: Partial<Parameters<typeof matchEventDecision>[0]> = {}) {
  return {
    kind: "reschedule" as const,
    tournamentId: "00000000-0000-4000-8000-0000000000d1",
    tournamentStatus: "live",
    statusBefore: "scheduled",
    statusAfter: "scheduled",
    scheduledBefore: "2026-10-20T14:00:00.000Z",
    scheduledAfter: "2026-10-21T14:00:00.000Z",
    ...overrides,
  }
}

describe("Match lifecycle fan-out policy (FAN-02)", () => {
  it("fans out a real reschedule, start and cancel under a published competition", () => {
    expect(matchEventDecision(base())).toEqual({ notify: true, kind: "reschedule" })
    expect(matchEventDecision(base({
      kind: "start", statusBefore: "toss", statusAfter: "live",
      scheduledBefore: null, scheduledAfter: null,
    }))).toEqual({ notify: true, kind: "start" })
    expect(matchEventDecision(base({
      kind: "cancel", statusBefore: "scheduled", statusAfter: "cancelled",
    }))).toEqual({ notify: true, kind: "cancel" })
  })

  it("filters replays and no-ops to no_state_change", () => {
    // Toss-only write: status never changed.
    expect(matchEventDecision(base({
      kind: "start", statusBefore: "live", statusAfter: "live",
      scheduledBefore: null, scheduledAfter: null,
    }))).toEqual({ notify: false, reason: "no_state_change" })
    // Same-date reschedule replay.
    expect(matchEventDecision(base({
      scheduledBefore: "2026-10-20T14:00:00.000Z", scheduledAfter: "2026-10-20T14:00:00.000Z",
    }))).toEqual({ notify: false, reason: "no_state_change" })
    // Cancel replay.
    expect(matchEventDecision(base({
      kind: "cancel", statusBefore: "cancelled", statusAfter: "cancelled",
    }))).toEqual({ notify: false, reason: "no_state_change" })
  })

  it("refuses friendlies (no competition), unpublished competitions and non-fanout commands", () => {
    expect(matchEventDecision(base({ tournamentId: null })))
      .toEqual({ notify: false, reason: "no_competition" })
    expect(matchEventDecision(base({ tournamentStatus: "draft" })))
      .toEqual({ notify: false, reason: "unpublished_tournament" })
    expect(matchEventDecision(base({ kind: "start" as never })))
      .toEqual({ notify: false, reason: "no_state_change" })
    // Truly unknown kinds fail closed on the command itself.
    expect(matchEventDecision(base({ kind: "stream-start" as never })))
      .toEqual({ notify: false, reason: "not_a_fanout_command" })
    expect(MATCH_FANOUT_KINDS).not.toContain("stream-start")
  })

  it("carries verbatim copy and date-scoped dedup keys", () => {
    expect(matchEventCopy("start", { homeName: "Lions", awayName: "Falcons" }))
      .toEqual({ type: "match_started", title: "Match started", body: "Lions vs Falcons is now live" })
    expect(matchEventCopy("cancel", { homeName: "Lions", awayName: "Falcons" }))
      .toEqual({ type: "match_cancelled", title: "Match cancelled", body: "Lions vs Falcons has been cancelled" })
    const reschedule = matchEventCopy("reschedule", {
      homeName: "Lions", awayName: "Falcons", whenText: "21 Oct 2026, 14:00 UTC",
    })
    expect(reschedule.type).toBe("match_rescheduled")
    expect(reschedule.body).toBe("Lions vs Falcons has been rescheduled to 21 Oct 2026, 14:00 UTC")

    expect(matchEventDedupKey("start", MATCH, null)).toBe(`match:${MATCH}:started`)
    expect(matchEventDedupKey("cancel", MATCH, null)).toBe(`match:${MATCH}:cancelled`)
    expect(matchEventDedupKey("reschedule", MATCH, "2026-10-21T14:00:00.000Z"))
      .toBe(`match:${MATCH}:rescheduled:2026-10-21T14:00:00.000Z`)
    // A second move to a DIFFERENT date is a different key and is delivered.
    expect(matchEventDedupKey("reschedule", MATCH, "2026-10-22T09:00:00.000Z"))
      .not.toBe(matchEventDedupKey("reschedule", MATCH, "2026-10-21T14:00:00.000Z"))
  })
})
