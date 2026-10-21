import { z } from "zod";

/**
 * ENH-03-01: the portable scoring contract.
 *
 * Vocabulary mirrors the canonical database enums field-for-field and the
 * schema validates REAL payloads from the existing submission path, so web,
 * native and the scoring service can share ONE validated vocabulary instead
 * of three drifting ones. Two hard edges are documented in the schema itself:
 * the server run ceiling is 7 (a UI that wants to record 8 runs of intent
 * must split it, never smuggle it), and a wicket must carry its dismissal
 * type. The schema is additive: new optional fields may appear, existing
 * names never change meaning without a version bump.
 */

export const SCORING_COMMAND_SCHEMA_VERSION = 1;

/** Mirrors the database `wicket_type` enum exactly. */
export const WICKET_TYPES = [
  "bowled",
  "caught",
  "lbw",
  "run_out",
  "stumped",
  "hit_wicket",
  "retired",
  "retired_hurt",
] as const;
export type WicketType = (typeof WICKET_TYPES)[number];

/** Mirrors the complete database `match_status` enum. */
export const MATCH_STATUSES = [
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
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** The only extras types the canonical service accepts. */
export const EXTRA_TYPES = ["wide", "noball", "bye", "legbye"] as const;
export type ExtrasType = (typeof EXTRA_TYPES)[number];

export const recordBallCommandSchema = z
  .object({
    matchId: z.string().uuid(),
    inningsId: z.string().uuid(),
    clientOpId: z.string().trim().min(1).max(200),
    queueAccountId: z.string().min(1).max(200).optional(),
    queueTenantId: z.string().uuid().optional(),
    overNumber: z.number().int().min(0),
    ballNumber: z.number().int().min(1).max(6),
    // Server ceiling 7. An "8" from a UI is un-splitted intent and is
    // refused here rather than being invented into runs.
    runs: z.number().int().min(0).max(7),
    batsmanId: z.string().uuid().optional().nullable(),
    bowlerId: z.string().uuid().optional().nullable(),
    isWicket: z.boolean().default(false),
    wicketType: z.enum(WICKET_TYPES).optional().nullable(),
    isWide: z.boolean().default(false),
    isNoBall: z.boolean().default(false),
    isBye: z.boolean().default(false),
    isLegBye: z.boolean().default(false),
    isFour: z.boolean().default(false),
    isSix: z.boolean().default(false),
    /** Writer fencing: the handover epoch the scoring session observed. */
    handoverEpoch: z.number().int().min(0).optional(),
    expectedRevision: z.number().int().min(0).max(2147483647).optional(),
    review: z
      .object({
        reason: z.string().trim().min(10).max(1000),
        previousEpoch: z.number().int().min(0).optional(),
        previousRevision: z.number().int().min(0).optional(),
      })
      .optional(),
  })
  .superRefine((command, ctx) => {
    const extrasFlags = [command.isWide, command.isNoBall, command.isBye, command.isLegBye];
    if (extrasFlags.filter(Boolean).length > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose exactly one extras type per delivery" });
    }
    if (command.isWicket && !command.wicketType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A wicket must carry its dismissal type" });
    }
  });

export type RecordBallCommandV1 = z.infer<typeof recordBallCommandSchema>;

/**
 * The versioned envelope. Unknown/foreign versions are REFUSED, never
 * interpreted — a consumer that does not know a version must not guess.
 */
export const recordBallEnvelopeSchema = z.object({
  version: z.literal(SCORING_COMMAND_SCHEMA_VERSION),
  payload: recordBallCommandSchema,
});

export type RecordBallParseResult =
  | { success: true; data: RecordBallCommandV1 }
  | { success: false; error: z.ZodError };

/**
 * Validates a record-ball command in either the versioned envelope form or
 * the bare V1 payload form (today's wire shape). Real payloads from the
 * existing submission path validate unchanged.
 */
export function parseRecordBallCommand(input: unknown): RecordBallParseResult {
  if (typeof input === "object" && input !== null && "version" in input) {
    const envelope = recordBallEnvelopeSchema.safeParse(input);
    if (!envelope.success) return { success: false, error: envelope.error };
    return { success: true, data: envelope.data.payload };
  }
  const direct = recordBallCommandSchema.safeParse(input);
  if (!direct.success) return { success: false, error: direct.error };
  return { success: true, data: direct.data };
}

export const deliveryAcknowledgementSchema = z.object({
  success: z.literal(true),
  ballId: z.string().uuid(),
  scoringRevision: z.number().int().min(0).max(2147483647),
  clientOpId: z.string().trim().min(1).max(200).nullable(),
  replayed: z.boolean().default(false),
  scorecard: z.object({
    matchId: z.string().uuid(),
    innings: z.number().int().min(1),
    totalRuns: z.number().int().min(0),
    totalWickets: z.number().int().min(0),
    overs: z.number().int().min(0),
    balls: z.number().int().min(0),
    runRate: z.number(),
  }),
});

export type DeliveryAcknowledgementV1 = z.infer<typeof deliveryAcknowledgementSchema>;

export function parseDeliveryAcknowledgement(input: unknown): { success: boolean } {
  return deliveryAcknowledgementSchema.safeParse(input);
}

/**
 * Machine-readable refusal surface for a rejected command. Codes, not
 * sentences, cross the boundary; each code owns ONE member-facing sentence.
 */
export const SCORING_ERROR_CODES = [
  "invalid_command",
  "not_found",
  "not_entitled",
  "stale_revision",
  "handover_conflict",
  "replayed",
  "unavailable",
] as const;
export type ScoringErrorCode = (typeof SCORING_ERROR_CODES)[number];

const SCORING_ERROR_SENTENCES: Record<ScoringErrorCode, string> = {
  invalid_command: "This delivery could not be read — refresh the scoring screen and try again.",
  not_found: "This match or innings no longer exists.",
  not_entitled: "You no longer have scoring rights for this match.",
  stale_revision: "Someone else recorded a delivery first — refresh and reapply yours.",
  handover_conflict: "The innings was handed over while you were scoring — refresh to receive the new state.",
  replayed: "This delivery was already recorded; the matching state is shown.",
  unavailable: "Scoring is temporarily unavailable — your submission was not lost, retry shortly.",
};

export function describeScoringErrorCode(code: ScoringErrorCode): string {
  return SCORING_ERROR_SENTENCES[code] ?? SCORING_ERROR_SENTENCES.unavailable;
}
