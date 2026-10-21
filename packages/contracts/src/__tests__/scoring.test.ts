import { describe, expect, it } from "vitest";
import {
  describeScoringErrorCode,
  EXTRA_TYPES,
  MATCH_STATUSES,
  parseRecordBallCommand,
  parseDeliveryAcknowledgement,
  SCORING_COMMAND_SCHEMA_VERSION,
  SCORING_ERROR_CODES,
  WICKET_TYPES,
  type RecordBallCommandV1,
} from "../scoring";

/**
 * ENH-03-01: the scoring contract. Vocabulary mirrors the canonical database
 * enums field-for-field (a contract that disagrees with the SoT is a bug
 * factory). The schema validates REAL payloads from the existing submission
 * path, and documents the two hard edges the roadmap calls out: the server
 * run ceiling is 7 while a UI may try 8 (the intent must be split, never
 * invented), and a wicket must carry its dismissal type.
 */

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function baseCommand(overrides: Record<string, unknown> = {}) {
  return {
    matchId: UUID,
    inningsId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    clientOpId: "local-1",
    overNumber: 4,
    ballNumber: 3,
    runs: 4,
    batsmanId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
    bowlerId: "3f2504e0-4f89-41d3-9a0c-0305e82c3304",
    isWicket: false,
    isWide: false,
    isNoBall: false,
    isBye: false,
    isLegBye: false,
    isFour: true,
    isSix: false,
    handoverEpoch: 2,
    expectedRevision: 41,
    ...overrides,
  };
}

describe("ENH-03-01: scoring vocabulary", () => {
  it("is versioned", () => {
    expect(SCORING_COMMAND_SCHEMA_VERSION).toBe(1);
  });

  it("mirrors the database wicket enum exactly", () => {
    expect(WICKET_TYPES).toEqual([
      "bowled",
      "caught",
      "lbw",
      "run_out",
      "stumped",
      "hit_wicket",
      "retired",
      "retired_hurt",
    ]);
  });

  it("mirrors the complete database match status enum", () => {
    expect(MATCH_STATUSES).toEqual([
      "scheduled",
      "toss",
      "live",
      "innings_break",
      "completed",
      "abandoned",
      "cancelled",
      "no_result",
      "forfeited",
      "postponed",
    ]);
  });

  it("names exactly the four extras types", () => {
    expect(EXTRA_TYPES).toEqual(["wide", "noball", "bye", "legbye"]);
  });
});

describe("ENH-03-01: record-ball command validation", () => {
  it("accepts a real payload from the existing submission path", () => {
    const parsed = parseRecordBallCommand(baseCommand());
    expect(parsed.success).toBe(true);
    const command = (parsed as { data: RecordBallCommandV1 }).data;
    expect(command.runs).toBe(4);
    expect(command.expectedRevision).toBe(41);
  });

  it("refuses the invented 8th run: the intent must be split, not smuggled", () => {
    const parsed = parseRecordBallCommand(baseCommand({ runs: 8 }));
    expect(parsed.success).toBe(false);
  });

  it("keeps the server ceiling at 7", () => {
    expect(parseRecordBallCommand(baseCommand({ runs: 7 })).success).toBe(true);
  });

  it("refuses a wicket without its dismissal type", () => {
    const parsed = parseRecordBallCommand(baseCommand({ isWicket: true }));
    expect(parsed.success).toBe(false);
  });

  it("accepts a wicket with a vocabulary dismissal type", () => {
    const parsed = parseRecordBallCommand(baseCommand({ isWicket: true, wicketType: "caught" }));
    expect(parsed.success).toBe(true);
  });

  it("accepts at most one extras flag per delivery", () => {
    expect(parseRecordBallCommand(baseCommand({ isWide: true, isBye: true })).success).toBe(false);
    expect(parseRecordBallCommand(baseCommand({ isWide: true })).success).toBe(true);
  });

  it("refuses an unknown schema version on the versioned envelope", () => {
    const parsed = parseRecordBallCommand({ version: 99, payload: baseCommand() });
    // The versioned envelope validator must refuse foreign versions rather
    // than interpret them.
    expect(parsed.success).toBe(false);
  });

  it("parses a versioned envelope carrying the current payload", () => {
    const parsed = parseRecordBallCommand({ version: 1, payload: baseCommand() });
    expect(parsed.success).toBe(true);
  });
});

describe("ENH-03-01: acknowledgement validation", () => {
  const REAL_ACK = {
    success: true,
    ballId: "3f2504e0-4f89-41d3-9a0c-0305e82c3305",
    scoringRevision: 42,
    clientOpId: "local-1",
    replayed: false,
    scorecard: {
      matchId: UUID,
      innings: 1,
      totalRuns: 37,
      totalWickets: 2,
      overs: 5,
      balls: 29,
      runRate: 7.4,
    },
  };

  it("validates a real canonical-service acknowledgement", () => {
    const parsed = parseDeliveryAcknowledgement(REAL_ACK);
    expect(parsed.success).toBe(true);
  });

  it("refuses anything that is not a success acknowledgement", () => {
    expect(parseDeliveryAcknowledgement({ ...REAL_ACK, success: false }).success).toBe(false);
    expect(parseDeliveryAcknowledgement({ ...REAL_ACK, scoringRevision: -1 }).success).toBe(false);
  });

  it("keeps the replayed flag boolean and the op id echo checkable", () => {
    const parsed = parseDeliveryAcknowledgement({ ...REAL_ACK, replayed: true, clientOpId: null });
    expect(parsed.success).toBe(true);
  });
});

describe("ENH-03-01: scoring error codes", () => {
  it("covers the stale/forbidden/replay surface with member-facing sentences", () => {
    for (const code of SCORING_ERROR_CODES) {
      expect(describeScoringErrorCode(code).length).toBeGreaterThan(8);
    }
    expect(SCORING_ERROR_CODES).toContain("stale_revision");
    expect(SCORING_ERROR_CODES).toContain("handover_conflict");
    expect(SCORING_ERROR_CODES).toContain("replayed");
    expect(SCORING_ERROR_CODES).toContain("not_entitled");
  });
});
