import { describe, expect, it } from "vitest";
import {
  MOBILE_DELIVERY_RUNS,
  advanceDeliveryCoordinates,
  normalizeDeliveryCommand,
} from "../scoring-adapters";
import {
  EXTRA_TYPES,
  MATCH_STATUSES,
  parseRecordBallCommand,
  WICKET_TYPES,
} from "../scoring";

/**
 * ENH-03-02 (delivery semantics): ONE boundary vocabulary. The flat boolean
 * command is the only thing that crosses into the canonical write path; the
 * adapter converts the legacy nested mobile payload (extras/wicket objects,
 * over/ball aliases) LOSSLESSLY or refuses — it never mangles attribution or
 * invents runs.
 */

const UUID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UUID_B = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const UUID_C = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const UUID_D = "3f2504e0-4f89-41d3-9a0c-0305e82c3304";

function flatCommand(overrides: Record<string, unknown> = {}) {
  return {
    matchId: UUID_A,
    inningsId: UUID_B,
    clientOpId: "local-1",
    overNumber: 4,
    ballNumber: 3,
    runs: 4,
    batsmanId: UUID_C,
    bowlerId: UUID_D,
    isWicket: false,
    isWide: false,
    isNoBall: false,
    isBye: false,
    isLegBye: false,
    handoverEpoch: 2,
    expectedRevision: 41,
    ...overrides,
  };
}

describe("ENH-03-02: the mobile run grid stays inside the server ceiling", () => {
  it("offers exactly 0..7 — the server ceiling, never a smuggled 8", () => {
    expect(MOBILE_DELIVERY_RUNS).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("ENH-03-02: legacy nested mobile payload adapter", () => {
  it("still mirrors the frozen vocabulary", () => {
    expect(WICKET_TYPES).toHaveLength(8);
    expect(EXTRA_TYPES).toEqual(["wide", "noball", "bye", "legbye"]);
    expect(MATCH_STATUSES).toHaveLength(10);
  });

  it("adapts the real legacy retired-queue payload shape (extras + wicket objects)", () => {
    // What an older installed client could put on the wire: nested extras and
    // a nested wicket, `over`/`ball` aliases, runs=1 for a wide.
    const legacy = {
      clientOpId: "m-abc123",
      matchId: UUID_A,
      inningsId: UUID_B,
      over: 4,
      ball: 3,
      runs: 1,
      batsmanId: UUID_C,
      bowlerId: UUID_D,
      extras: { type: "wide", runs: 1 },
      handoverEpoch: 2,
      expectedRevision: 41,
    };
    const parsed = normalizeDeliveryCommand(legacy);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.isWide).toBe(true);
    expect(parsed.data.overNumber).toBe(4);
    expect(parsed.data.ballNumber).toBe(3);
    expect(parsed.data.runs).toBe(1);
  });

  it("adapts a wicket with explicit attribution (named batter + fielder)", () => {
    const legacy = {
      matchId: UUID_A,
      inningsId: UUID_B,
      clientOpId: "m-def456",
      overNumber: 7,
      ballNumber: 2,
      runs: 0,
      batsmanId: UUID_C,
      bowlerId: UUID_D,
      wicket: { type: "run_out", playerId: UUID_C, fielderId: UUID_D },
    };
    const parsed = normalizeDeliveryCommand(legacy);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.isWicket).toBe(true);
    expect(parsed.data.wicketType).toBe("run_out");
    expect(parsed.data.wicketPlayerId).toBe(UUID_C);
    expect(parsed.data.fielderId).toBe(UUID_D);
  });

  it("passes a flat boolean command through unchanged", () => {
    const parsed = normalizeDeliveryCommand(flatCommand({ isLegBye: true, runs: 2 }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.isLegBye).toBe(true);
    expect(parsed.data.runs).toBe(2);
  });

  it("byes and leg-byes keep their total as extras runs (batter never credited)", () => {
    const bye = normalizeDeliveryCommand({
      matchId: UUID_A, inningsId: UUID_B, clientOpId: "m-1", overNumber: 0, ballNumber: 1,
      runs: 0, batsmanId: UUID_C, bowlerId: UUID_D,
      extras: { type: "bye", runs: 2 },
    });
    expect(bye.success).toBe(true);
    if (!bye.success) return;
    expect(bye.data.isBye).toBe(true);
    expect(bye.data.runs).toBe(2);
  });

  it("translates a no-ball extra as one penalty run added to the batter's runs", () => {
    const noball = normalizeDeliveryCommand({
      matchId: UUID_A, inningsId: UUID_B, clientOpId: "m-2", overNumber: 0, ballNumber: 1,
      runs: 1, batsmanId: UUID_C, bowlerId: UUID_D,
      extras: { type: "noball", runs: 1 },
    });
    expect(noball.success).toBe(true);
    if (!noball.success) return;
    expect(noball.data.isNoBall).toBe(true);
    expect(noball.data.runs).toBe(2);
  });

  it("hard-refuses a rich no-ball extra split rather than mangling attribution", () => {
    const rich = normalizeDeliveryCommand({
      matchId: UUID_A, inningsId: UUID_B, clientOpId: "m-3", overNumber: 0, ballNumber: 1,
      runs: 1, batsmanId: UUID_C, bowlerId: UUID_D,
      extras: { type: "noball", runs: 2 },
    });
    expect(rich.success).toBe(false);
  });

  it("refuses a wide carrying batter runs it cannot explain", () => {
    const ambiguous = normalizeDeliveryCommand({
      matchId: UUID_A, inningsId: UUID_B, clientOpId: "m-4", overNumber: 0, ballNumber: 1,
      runs: 3, batsmanId: UUID_C, bowlerId: UUID_D,
      extras: { type: "wide", runs: 1 },
    });
    expect(ambiguous.success).toBe(false);
  });

  it("refuses a wicket without a dismissal type and an unknown extras type", () => {
    expect(normalizeDeliveryCommand({
      matchId: UUID_A, inningsId: UUID_B, clientOpId: "m-5", overNumber: 0, ballNumber: 1,
      runs: 0, batsmanId: UUID_C, bowlerId: UUID_D,
      wicket: { type: "mankaded", playerId: UUID_C },
    }).success).toBe(false);
    expect(normalizeDeliveryCommand({
      matchId: UUID_A, inningsId: UUID_B, clientOpId: "m-6", overNumber: 0, ballNumber: 1,
      runs: 1, batsmanId: UUID_C, bowlerId: UUID_D,
      extras: { type: "penalty", runs: 5 },
    }).success).toBe(false);
  });
});

describe("ENH-03-02: wicket attribution fields on the canonical command", () => {
  it("accepts explicit attribution on the flat boundary", () => {
    const parsed = parseRecordBallCommand(flatCommand({
      isWicket: true, wicketType: "run_out", wicketPlayerId: UUID_C, fielderId: UUID_D,
    }));
    expect(parsed.success).toBe(true);
  });

  it("refuses attribution fields that are not UUIDs", () => {
    expect(parseRecordBallCommand(flatCommand({ fielderId: "not-a-uuid" })).success).toBe(false);
  });
});

describe("ENH-03-02: offline queue coordinate advance (pure)", () => {
  it("re-bowls wides and no-balls on the same coordinates", () => {
    expect(advanceDeliveryCoordinates({ overNumber: 2, ballNumber: 4, isWide: true, isNoBall: false }))
      .toEqual({ overNumber: 2, ballNumber: 4 });
    expect(advanceDeliveryCoordinates({ overNumber: 2, ballNumber: 4, isWide: false, isNoBall: true }))
      .toEqual({ overNumber: 2, ballNumber: 4 });
  });

  it("advances legal deliveries and rolls the over at six", () => {
    expect(advanceDeliveryCoordinates({ overNumber: 2, ballNumber: 4, isWide: false, isNoBall: false }))
      .toEqual({ overNumber: 2, ballNumber: 5 });
    expect(advanceDeliveryCoordinates({ overNumber: 2, ballNumber: 6, isWide: false, isNoBall: false }))
      .toEqual({ overNumber: 3, ballNumber: 1 });
  });
});
