import { describe, expect, it } from "vitest";
import { foldScoringParticipants, type ParticipantBallInput } from "../lib/scoring-participants";

/**
 * Batch 100 (ENH-03-02 / ENH-09-02): the canonical participant fold.
 *
 * Every claim on the overlay ("striker X", "new batter Y") must be
 * reconstructible from the official delivery log through THIS fold. These
 * tests pin the evidence rules: the record always wins, rotation between
 * balls is policy prediction only, dismissals open slots the next recorded
 * batter fills, and anything un-interpretable degrades `confirmed` instead
 * of inventing.
 */

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const BOWLER = "00000000-0000-4000-8000-000000000101";
const BOWLER2 = "00000000-0000-4000-8000-000000000102";

let sequence = 0;

function ball(overrides: Partial<ParticipantBallInput> & { batsmanId: string | null }): ParticipantBallInput {
  sequence += 1;
  return {
    ballSequence: sequence,
    overNumber: 0,
    ballNumber: 1,
    bowlerId: BOWLER,
    runs: 0,
    isWide: false,
    isNoBall: false,
    isBye: false,
    isLegBye: false,
    isWicket: false,
    wicketType: null,
    wicketPlayerOutId: null,
    ...overrides,
  };
}

/** Six legal deliveries in one over, alternating A/B as the recorded
 *  batsman (A faces ball 1), `runsPerBall` runs on each. */
function six(bowlerId: string, runsPerBall: number): ParticipantBallInput[] {
  return Array.from({ length: 6 }, (_, index) =>
    ball({
      batsmanId: index % 2 === 0 ? A : B,
      ballNumber: index + 1,
      bowlerId,
      runs: runsPerBall,
    }));
}

describe("foldScoringParticipants", () => {
  it("returns an all-null confirmed projection before the first delivery", () => {
    sequence = 0;
    expect(foldScoringParticipants([])).toEqual({
      strikerId: null,
      nonStrikerId: null,
      bowlerId: null,
      previousOverBowlerId: null,
      incomingBatterId: null,
      creaseBatterIds: [],
      confirmed: true,
      lastBallSequence: null,
    });
  });

  it("confirms the opening pair from who actually faced the deliveries", () => {
    sequence = 0;
    const folded = foldScoringParticipants([
      ball({ batsmanId: A, ballNumber: 1, runs: 0 }),
      ball({ batsmanId: B, ballNumber: 2, runs: 0 }),
    ]);
    expect(folded.creaseBatterIds).toEqual([A, B]);
    // The recorded batsman of the newest delivery is the striker.
    expect(folded.strikerId).toBe(B);
    expect(folded.nonStrikerId).toBe(A);
    expect(folded.bowlerId).toBe(BOWLER);
    expect(folded.confirmed).toBe(true);
  });

  it("keeps the over-in-progress bowler and anchors the completed over's bowler without claiming the next", () => {
    sequence = 0;
    const overEnd = foldScoringParticipants([ball({ batsmanId: A, ballNumber: 5 }), ball({ batsmanId: A, ballNumber: 6 })]);
    // Sixth legal delivery: "who bowls next" is deliberately UNKNOWN while
    // the just-completed bowler stays as the boundary anchor.
    expect(overEnd.bowlerId).toBeNull();
    expect(overEnd.previousOverBowlerId).toBe(BOWLER);

    sequence = 0;
    const nextOver = foldScoringParticipants([
      ball({ batsmanId: A, ballNumber: 6, runs: 0 }),
      ball({ overNumber: 1, ballNumber: 1, bowlerId: BOWLER2, batsmanId: B, runs: 0 }),
    ]);
    expect(nextOver.bowlerId).toBe(BOWLER2);
    expect(nextOver.previousOverBowlerId).toBeNull();
  });

  it("rotates the strike at the over boundary (over-end swap on even crossings)", () => {
    sequence = 0;
    // B faced the sixth ball; the over completes → the other end faces next.
    const folded = foldScoringParticipants(six(BOWLER, 2));
    expect(folded.strikerId).toBe(A);
    expect(folded.nonStrikerId).toBe(B);
  });

  it("does not claim who faces next when the over ended with fewer than two confirmed batters", () => {
    sequence = 0;
    const folded = foldScoringParticipants([ball({ batsmanId: A, ballNumber: 6 })]);
    expect(folded.creaseBatterIds).toEqual([A]);
    expect(folded.strikerId).toBeNull();
    expect(folded.confirmed).toBe(true);
  });

  it("treats a wide penalty as NOT crossing and keeps striker claims evidence-based", () => {
    sequence = 0;
    // Two-run wide (penalty 1 + 1 crossed): belt-and-braces - with a single
    // confirmed batter rotation cannot swap, the record decides every ball.
    const folded = foldScoringParticipants([
      ball({ batsmanId: A, ballNumber: 1, runs: 2, isWide: true }),
      ball({ batsmanId: B, ballNumber: 2, runs: 1, isWide: true }),
      ball({ batsmanId: A, ballNumber: 3, runs: 0, isWide: true }),
    ]);
    expect(folded.strikerId).toBe(A);
    expect(folded.nonStrikerId).toBe(B);
  });

  it("swaps for odd crossings once both openers are confirmed", () => {
    sequence = 0;
    const folded = foldScoringParticipants([
      ball({ batsmanId: A, ballNumber: 1, runs: 0 }),
      ball({ batsmanId: B, ballNumber: 2, runs: 1 }),
    ]);
    // B's odd single crosses → A is predicted to face the next ball.
    expect(folded.strikerId).toBe(A);
    expect(folded.nonStrikerId).toBe(B);
  });

  it("a striker-out dismissal un-positions the crease until the next delivery names the new striker", () => {
    sequence = 0;
    const folded = foldScoringParticipants([
      ...six(BOWLER, 0),
      ball({ overNumber: 1, ballNumber: 1, bowlerId: BOWLER2, batsmanId: B, isWicket: true, wicketType: "bowled" }),
    ]);
    expect(folded.creaseBatterIds).toEqual([A]);
    expect(folded.strikerId).toBeNull();
    expect(folded.nonStrikerId).toBeNull();
    expect(folded.incomingBatterId).toBeNull();
    expect(folded.confirmed).toBe(true);
    // The dismissal happened in a still-incomplete over: its bowler remains.
    expect(folded.bowlerId).toBe(BOWLER2);
  });

  it("marks the new batter incoming once they face their first delivery", () => {
    sequence = 0;
    const folded = foldScoringParticipants([
      ...six(BOWLER, 0),
      ball({ overNumber: 1, ballNumber: 1, bowlerId: BOWLER2, batsmanId: B, isWicket: true, wicketType: "bowled" }),
      ball({ overNumber: 1, ballNumber: 2, bowlerId: BOWLER2, batsmanId: C, runs: 0 }),
    ]);
    expect(folded.strikerId).toBe(C);
    expect(folded.nonStrikerId).toBe(A);
    expect(folded.incomingBatterId).toBe(C);
    expect(folded.creaseBatterIds).toEqual([A, C]);
  });

  it("clears 'incoming' once the new batter is established", () => {
    sequence = 0;
    const folded = foldScoringParticipants([
      ...six(BOWLER, 0),
      ball({ overNumber: 1, ballNumber: 1, bowlerId: BOWLER2, batsmanId: B, isWicket: true, wicketType: "bowled" }),
      ball({ overNumber: 1, ballNumber: 2, bowlerId: BOWLER2, batsmanId: C, runs: 0 }),
      ball({ overNumber: 1, ballNumber: 3, bowlerId: BOWLER2, batsmanId: C, runs: 0 }),
    ]);
    expect(folded.incomingBatterId).toBeNull();
    expect(folded.strikerId).toBe(C);
  });

  it("honours an attributed off-strike run-out victim and keeps the striker on strike", () => {
    sequence = 0;
    const folded = foldScoringParticipants([
      ball({ batsmanId: A, ballNumber: 1, runs: 0 }),
      ball({ batsmanId: B, ballNumber: 2, runs: 0 }),
      ball({ batsmanId: A, ballNumber: 3, runs: 0, isWicket: true, wicketType: "run_out", wicketPlayerOutId: B }),
    ]);
    // The scorer named B (the non-striker). A stays on strike - naive
    // striker-out attribution would have swapped the crease.
    expect(folded.creaseBatterIds).toEqual([A]);
    expect(folded.strikerId).toBe(A);
    expect(folded.confirmed).toBe(true);
  });

  it("self-heals an un-attributed run-out whose striker default was wrong", () => {
    sequence = 0;
    // Ball 3 defaults the run-out victim to striker A, but A survives and
    // faces the next delivery: the slot machinery re-admits A and the crease
    // converges on the record without anyone encoding "who was really out".
    const folded = foldScoringParticipants([
      ball({ batsmanId: A, ballNumber: 1, runs: 0 }),
      ball({ batsmanId: B, ballNumber: 2, runs: 0 }),
      ball({ batsmanId: A, ballNumber: 3, runs: 0, isWicket: true, wicketType: "run_out" }),
      ball({ batsmanId: A, ballNumber: 4, runs: 0 }),
    ]);
    expect(folded.creaseBatterIds).toEqual(expect.arrayContaining([A, B]));
    expect(folded.creaseBatterIds).toHaveLength(2);
    expect(folded.strikerId).toBe(A);
    expect(folded.confirmed).toBe(true);
  });

  it("records a retired_hurt departure and its replacement without claiming a wicket", () => {
    sequence = 0;
    const folded = foldScoringParticipants([
      ball({ batsmanId: A, ballNumber: 1, runs: 0 }),
      ball({ batsmanId: A, ballNumber: 2, runs: 0, wicketType: "retired_hurt" }),
      ball({ batsmanId: C, ballNumber: 3, runs: 0 }),
    ]);
    expect(folded.creaseBatterIds).toEqual([C]);
    expect(folded.incomingBatterId).toBe(C);
    expect(folded.confirmed).toBe(true);
  });

  it("degrades confirmation when an attributed victim was never at the crease", () => {
    sequence = 0;
    const folded = foldScoringParticipants([
      ball({ batsmanId: A, ballNumber: 1, runs: 0 }),
      ball({ batsmanId: A, ballNumber: 2, runs: 0, isWicket: true, wicketType: "run_out", wicketPlayerOutId: C }),
    ]);
    expect(folded.confirmed).toBe(false);
  });

  it("degrades confirmation when a third batter enters with no recorded departure", () => {
    sequence = 0;
    const folded = foldScoringParticipants([
      ball({ batsmanId: A, ballNumber: 1, runs: 0 }),
      ball({ batsmanId: B, ballNumber: 2, runs: 0 }),
      ball({ batsmanId: C, ballNumber: 3, runs: 0 }),
    ]);
    expect(folded.confirmed).toBe(false);
  });

  it("is a pure fold: a shortened log reproduces the pre-delivery state", () => {
    sequence = 0;
    const full = foldScoringParticipants([
      ball({ batsmanId: A, ballNumber: 1, runs: 1 }),
      ball({ batsmanId: B, ballNumber: 2, runs: 0 }),
    ]);
    sequence = 0;
    const prefix = foldScoringParticipants([
      ball({ batsmanId: A, ballNumber: 1, runs: 1 }),
    ]);
    expect(full.strikerId).toBe(B);
    expect(full.lastBallSequence).toBe(2);
    expect(prefix.strikerId).toBe(A);
    expect(prefix.lastBallSequence).toBe(1);
  });
});
