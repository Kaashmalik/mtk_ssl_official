import {
  EXTRA_TYPES,
  WICKET_TYPES,
  parseRecordBallCommand,
  type ExtrasType,
  type RecordBallCommandV1,
  type WicketType,
} from "./scoring";
import { z } from "zod";

/**
 * ENH-03-02 (normalize delivery semantics): migration-compatible adapters.
 *
 * The canonical boundary vocabulary is the FLAT boolean command
 * (isWide/isNoBall/isBye/isLegBye + runs as the batter-or-total split the
 * SoT policy defines). Older installed clients serialized a nested payload
 * (extras: {type, runs}, wicket: {type, playerId, fielderId?}, over/ball
 * aliases). These adapters convert that legacy shape into the flat command
 * LOSSLESSLY — or refuse loudly. They never invent runs and never mangle
 * wicket attribution:
 * - wide/bye/legbye: the extras run count IS the delivery total; a nested
 *   payload whose body runs disagree with its own extras is refused as
 *   ambiguous rather than guessed.
 * - no-ball: the boundary supports exactly the policy split (one penalty
 *   run on top of the batter's runs). A richer nested split is refused —
 *   it must go through the nested service contract, not be flattened.
 * - wicket: the type and the explicitly named out player and fielder are
 *   carried through; the canonical service enforces the on-field rules.
 */

/** The run values a scoring UI may offer: exactly the server ceiling 0..7. */
export const MOBILE_DELIVERY_RUNS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

const legacyNestedDeliverySchema = z.object({
  matchId: z.string().uuid(),
  inningsId: z.string().uuid(),
  clientOpId: z.string().trim().min(1).max(200),
  overNumber: z.number().int().min(0).optional(),
  ballNumber: z.number().int().min(1).max(6).optional(),
  over: z.number().int().min(0).optional(),
  ball: z.number().int().min(1).max(6).optional(),
  runs: z.number().int().min(0).max(7),
  batsmanId: z.string().uuid().optional().nullable(),
  bowlerId: z.string().uuid().optional().nullable(),
  extras: z
    .object({
      type: z.enum(EXTRA_TYPES),
      runs: z.number().int().min(0).max(7),
    })
    .optional(),
  wicket: z
    .object({
      type: z.enum(WICKET_TYPES),
      playerId: z.string().uuid(),
      fielderId: z.string().uuid().optional(),
    })
    .optional(),
  handoverEpoch: z.number().int().min(0).optional(),
  expectedRevision: z.number().int().min(0).max(2147483647).optional(),
  queueAccountId: z.string().min(1).max(200).optional(),
  queueTenantId: z.string().uuid().optional(),
});

type LegacyNestedDelivery = z.infer<typeof legacyNestedDeliverySchema>;

export type DeliveryCommandParseResult =
  | { success: true; data: RecordBallCommandV1 }
  | { success: false; error: string };

function refuse(error: string): DeliveryCommandParseResult {
  return { success: false, error };
}

function flattenLegacy(legacy: LegacyNestedDelivery): DeliveryCommandParseResult {
  let runs = legacy.runs;
  const flat: Record<string, unknown> = {
    matchId: legacy.matchId,
    inningsId: legacy.inningsId,
    clientOpId: legacy.clientOpId,
    runs,
    batsmanId: legacy.batsmanId,
    bowlerId: legacy.bowlerId,
    handoverEpoch: legacy.handoverEpoch,
    expectedRevision: legacy.expectedRevision,
  };
  const overNumber = legacy.overNumber ?? legacy.over;
  if (overNumber !== undefined) flat.overNumber = overNumber;
  const ballNumber = legacy.ballNumber ?? legacy.ball;
  if (ballNumber !== undefined) flat.ballNumber = ballNumber;

  const extras = legacy.extras;
  if (extras) {
    const type: ExtrasType = extras.type;
    if (type === "wide" || type === "bye" || type === "legbye") {
      // The extras run count is the whole delivery; the batter gets nothing.
      // A body runs value that contradicts its own extras is ambiguous
      // intent — refused, never averaged or guessed.
      const total = extras.runs > 0 ? extras.runs : runs;
      if (runs > 0 && runs !== total && !(extras.runs === runs && total === runs)) {
        return refuse(
          "The delivery states different runs in its body and its extras; this cannot be reconciled safely.",
        );
      }
      flat.runs = total;
      flat[type === "wide" ? "isWide" : type === "bye" ? "isBye" : "isLegBye"] = true;
    } else if (type === "noball") {
      if (extras.runs !== 1) {
        // The flat vocabulary carries one no-ball penalty; anything richer
        // would change who is credited and must not be silently flattened.
        return refuse(
          "No-ball extras must be exactly one penalty run at this boundary; richer splits are refused.",
        );
      }
      flat.runs = runs + 1;
      flat.isNoBall = true;
    }
  }

  const wicket = legacy.wicket;
  if (wicket) {
    const type: WicketType = wicket.type;
    flat.isWicket = true;
    flat.wicketType = type;
    flat.wicketPlayerId = wicket.playerId;
    if (wicket.fielderId) flat.fielderId = wicket.fielderId;
  }

  const parsed = parseRecordBallCommand(flat);
  if (!parsed.success) return refuse("The delivery fields are invalid or incomplete");
  return parsed;
}

/**
 * Validates a delivery command in either form: the flat boolean command
 * (today's canonical wire shape) or the legacy nested mobile payload.
 * The result is always the flat, fully validated command.
 */
export function normalizeDeliveryCommand(input: unknown): DeliveryCommandParseResult {
  if (typeof input !== "object" || input === null) return refuse("A delivery command must be an object");
  if ("extras" in input || "wicket" in input) {
    const legacy = legacyNestedDeliverySchema.safeParse(input);
    if (!legacy.success) return refuse("The delivery fields are invalid or incomplete");
    return flattenLegacy(legacy.data);
  }
  const parsed = parseRecordBallCommand(input);
  if (!parsed.success) return refuse("The delivery fields are invalid or incomplete");
  return parsed;
}

export type DeliveryCoordinate = {
  overNumber: number;
  ballNumber: number;
};

export type LastDeliveryShape = DeliveryCoordinate & {
  isWide: boolean;
  isNoBall: boolean;
};

/**
 * Pure coordinate advance for an offline queue: a wide or a no-ball is
 * re-bowled (coordinates stay), a legal delivery advances and rolls the
 * over at six. Mirrors `nextDisplayPosition` in the shared rules policy.
 */
export function advanceDeliveryCoordinates(last: LastDeliveryShape): DeliveryCoordinate {
  if (last.isWide || last.isNoBall) {
    return { overNumber: last.overNumber, ballNumber: last.ballNumber };
  }
  if (last.ballNumber >= 6) {
    return { overNumber: last.overNumber + 1, ballNumber: 1 };
  }
  return { overNumber: last.overNumber, ballNumber: last.ballNumber + 1 };
}
