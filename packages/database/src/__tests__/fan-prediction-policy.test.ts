import { describe, expect, it } from "vitest"
import {
  PREDICTION_DISCLOSURE,
  describePredictionVerdict,
  describePredictionWindow,
  isPredictionPick,
  predictionWindow,
  settlePrediction,
} from "../lib/fan-prediction-policy"

const TEAM_A = "00000000-0000-4000-8000-00000000000a"
const TEAM_B = "00000000-0000-4000-8000-00000000000b"
const NOW = new Date("2026-10-19T12:00:00.000Z")

describe("FAN-04 (B164): prediction window", () => {
  it("is open only while scheduled and kickoff has not passed", () => {
    const future = new Date(NOW.getTime() + 86_400_000)
    expect(predictionWindow({ status: "scheduled", scheduledDate: future }, NOW)).toEqual({ open: true })
    // No recorded kickoff: the status alone governs (open until it changes).
    expect(predictionWindow({ status: "scheduled", scheduledDate: null }, NOW)).toEqual({ open: true })
  })

  it("closes the moment the match is no longer scheduled - no outcome-peeking", () => {
    expect(predictionWindow({ status: "toss", scheduledDate: null }, NOW)).toMatchObject({ open: false, reason: "match_underway" })
    expect(predictionWindow({ status: "live", scheduledDate: null }, NOW)).toMatchObject({ open: false, reason: "match_underway" })
    expect(predictionWindow({ status: "completed", scheduledDate: null }, NOW)).toMatchObject({ open: false, reason: "match_terminal" })
  })

  it("closes when the scheduled start time has passed even while still `scheduled`", () => {
    const past = new Date(NOW.getTime() - 86_400_000)
    expect(predictionWindow({ status: "scheduled", scheduledDate: past }, NOW)).toMatchObject({ open: false, reason: "kickoff_passed" })
  })

  it("every closed state carries a member-facing sentence", () => {
    expect(describePredictionWindow({ open: true })).toContain("open")
    expect(describePredictionWindow({ open: false, reason: "match_underway" })).toContain("underway")
    expect(describePredictionWindow({ open: false, reason: "kickoff_passed" })).toContain("passed")
    expect(describePredictionWindow({ open: false, reason: "match_terminal" })).toContain("final")
  })
})

describe("FAN-04 (B164): derived settlement (never stored, never written)", () => {
  it("resolves a completed match by the official winnerId against the pick", () => {
    const match = { status: "completed", winnerId: TEAM_A, teamAId: TEAM_A, teamBId: TEAM_B }
    expect(settlePrediction("home", match)).toEqual({ verdict: "correct", winner: "home" })
    expect(settlePrediction("away", match)).toEqual({ verdict: "incorrect", winner: "home" })
  })

  it("void statuses are honest no-verdicts, never guessed wrongness", () => {
    for (const status of ["abandoned", "cancelled", "no_result", "forfeited", "postponed"]) {
      expect(settlePrediction("home", { status, winnerId: null, teamAId: TEAM_A, teamBId: TEAM_B })).toEqual({
        verdict: "void",
        reason: `match_${status}`,
      })
    }
  })

  it("a completed match without a recorded winner is void - never computed from prose", () => {
    expect(settlePrediction("home", { status: "completed", winnerId: null, teamAId: TEAM_A, teamBId: TEAM_B })).toEqual({
      verdict: "void",
      reason: "no_recorded_winner",
    })
  })

  it("an unsettleable in-progress state stays null - the honest no-verdict", () => {
    expect(settlePrediction("home", { status: "live", winnerId: null, teamAId: TEAM_A, teamBId: TEAM_B })).toBeNull()
  })

  it("verdict sentences name the official winner and never a fabricated margin", () => {
    const text = describePredictionVerdict({ verdict: "correct", winner: "home" }, "Team A", "Team B")
    expect(text).toContain("Team A")
    expect(text).not.toContain("wickets")
  })
})

describe("FAN-04 (B164): pick vocabulary and disclosure", () => {
  it("accepts exactly home/away", () => {
    expect(isPredictionPick("home")).toBe(true)
    expect(isPredictionPick("away")).toBe(true)
    expect(isPredictionPick("draw")).toBe(false)
    expect(isPredictionPick("")).toBe(false)
  })

  it("the disclosure line carries the no-stakes honesty", () => {
    expect(PREDICTION_DISCLOSURE).toContain("No stakes")
    expect(PREDICTION_DISCLOSURE).toContain("never changes an official result")
  })
})
