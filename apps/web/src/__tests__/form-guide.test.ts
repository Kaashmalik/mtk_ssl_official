import { describe, expect, it } from "vitest"
import { computeFormGuide, FORM_GUIDE_DISCLOSURE, FORM_GUIDE_RULE_VERSION, FORM_GUIDE_WINDOW } from "@/lib/form-guide"

/**
 * FAN-03 (Batch 165): the form-guide fold. Pinned: only resulted/voided
 * official matches contribute letters; one appearance per team per match;
 * recency order with a deterministic tie-break; the window caps the shown
 * sequence but played/won/lost/noVerdict count the WHOLE counted set; the
 * streak is the trailing run of identical letters; a team without counted
 * matches is honestly absent; ties and voids are N - a no-verdict never
 * masquerades as a win or a loss.
 */

const T = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`
const TEAMS = new Map([
  [T(1), "Alpha CC"],
  [T(2), "Beta CC"],
  [T(3), "Gamma CC"],
  [T(4), "Delta CC"],
])

const m = (n: number, over: Partial<Parameters<typeof computeFormGuide>[0][number]> = {}): Parameters<typeof computeFormGuide>[0][number] => ({
  id: `m${n}`,
  status: "completed",
  scheduledDate: new Date(Date.UTC(2026, 0, n)),
  teamAId: T(1),
  teamBId: T(2),
  winnerId: T(1),
  resultText: "Alpha won",
  ...over,
})

describe("FAN-03 (B165): form letters come only from official results", () => {
  it("resolves W/L from the official winnerId, for each side exactly once", () => {
    const rows = computeFormGuide([m(1)], TEAMS)
    expect(rows).toHaveLength(2)
    const alpha = rows.find((r) => r.teamId === T(1))!
    const beta = rows.find((r) => r.teamId === T(2))!
    expect(alpha.sequence[0]).toMatchObject({ letter: "W", opponentName: "Beta CC", resultText: "Alpha won" })
    expect(beta.sequence[0]).toMatchObject({ letter: "L", opponentName: "Alpha CC" })
    expect(alpha.played).toBe(1)
    expect(beta.played).toBe(1)
    expect(beta.won).toBe(0)
    expect(beta.lost).toBe(1)
  })

  it("a completed match without a recorded winner is N for both sides - never a guessed L", () => {
    const rows = computeFormGuide([m(1, { winnerId: null, resultText: "Match tied" })], TEAMS)
    for (const row of rows) {
      expect(row.sequence[0].letter).toBe("N")
      expect(row.noVerdict).toBe(1)
    }
  })

  it("voided states count the match as N; upcoming/underway states contribute nothing", () => {
    const voided = computeFormGuide(
      [m(1, { status: "abandoned", winnerId: null, resultText: null }), m(2, { status: "cancelled" })],
      TEAMS,
    )
    expect(voided.find((r) => r.teamId === T(1))!.played).toBe(2)
    expect(voided.find((r) => r.teamId === T(1))!.noVerdict).toBe(2)

    const none = computeFormGuide(
      [m(1, { status: "scheduled" }), m(2, { status: "live" }), m(3, { status: "toss" })],
      TEAMS,
    )
    expect(none).toHaveLength(0)
  })
})

describe("FAN-03 (B165): window, ordering and streaks are deterministic", () => {
  it("orders most-recent-first, caps the sequence at the window, but counts everything", () => {
    const matches = [1, 2, 3, 4, 5, 6, 7].map((n) => m(n, { winnerId: n % 2 === 0 ? T(2) : T(1) }))
    const alpha = computeFormGuide(matches, TEAMS).find((r) => r.teamId === T(1))!
    expect(alpha.sequence).toHaveLength(FORM_GUIDE_WINDOW)
    expect(alpha.sequence[0].matchId).toBe("m7")
    expect(alpha.played).toBe(7)
    expect(alpha.won).toBe(4)
    expect(alpha.lost).toBe(3)
  })

  it("breaks exact recency ties by match id - never by array luck", () => {
    const rows = computeFormGuide(
      [m(1, { scheduledDate: null }), m(2, { scheduledDate: null })],
      TEAMS,
    )
    const alpha = rows.find((r) => r.teamId === T(1))!
    expect(alpha.sequence.map((e) => e.matchId)).toEqual(["m2", "m1"])
  })

  it("the streak is the trailing run of identical letters, and a void breaks it", () => {
    const winning = computeFormGuide([m(1), m(2, { winnerId: T(2) }), m(3)], TEAMS)
    const alpha = winning.find((r) => r.teamId === T(1))!
    expect(alpha.streak).toEqual({ letter: "W", length: 1 }) // W L W -> trailing W

    // The void is the MOST RECENT event: it ends the W run honestly.
    const endedByVoid = computeFormGuide([m(1), m(2), m(3, { status: "abandoned", winnerId: null })], TEAMS)
    const alphaVoid = endedByVoid.find((r) => r.teamId === T(1))!
    expect(alphaVoid.streak).toEqual({ letter: "N", length: 1 })

    const allWins = computeFormGuide([m(1), m(2), m(3)], TEAMS)
    expect(allWins.find((r) => r.teamId === T(1))!.streak).toEqual({ letter: "W", length: 3 })
  })

  it("a team with no counted matches is absent, and names come strictly from the provided map", () => {
    const rows = computeFormGuide([m(1, { teamAId: T(9), teamBId: T(2) })], TEAMS)
    expect(rows).toHaveLength(1)
    expect(rows[0].teamId).toBe(T(2))
    expect(rows[0].sequence[0].opponentName).toBe("Unknown team")
  })

  it("the disclosure stays attached to the package and carries the honesty rules", () => {
    expect(FORM_GUIDE_DISCLOSURE).toContain("official published results")
    expect(FORM_GUIDE_DISCLOSURE).toContain("no-verdict, never a guess")
    expect(FORM_GUIDE_RULE_VERSION).toBe(1)
  })
})
