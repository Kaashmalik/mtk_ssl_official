/**
 * ENH-03-01: versioned scoring contract.
 *
 * `recordBallCommandSchema` is MOVED here verbatim from
 * `apps/web/src/lib/scoring-submission.ts` (which now imports it from this
 * module), so the web server action, the mobile intake API route and the
 * offline queue flush all validate submissions against ONE schema - the
 * first step toward ENH-03-02's "no silently stripped intent": a divergence
 * between surfaces becomes impossible by construction.
 *
 * The command is versioned so a future schema change negotiates explicitly
 * instead of surprising old clients (native queues carry the version).
 *
 * Pure+zod only: no Next, no DOM, no node, no database, no server secrets.
 */
import { z } from "zod"
import type { WicketType } from "./status"

/**
 * Batch 100: `wicketPlayerOutId`/`wicketFielderId` were added as OPTIONAL,
 * NULLABLE fields without a version bump - v1 queued commands (which omit
 * them) still validate unchanged, so an offline queue needs no migration
 * story and old clients are never refused.
 */
export const SCORING_COMMAND_VERSION = 1 as const

export const recordBallCommandSchema = z.object({
  matchId: z.string().uuid(),
  inningsId: z.string().uuid(),
  clientOpId: z.string().trim().min(1).max(200),
  queueAccountId: z.string().min(1).max(200).optional(),
  queueTenantId: z.string().uuid().optional(),
  overNumber: z.number().int().min(0),
  ballNumber: z.number().int().min(1).max(6),
  runs: z.number().int().min(0).max(7),
  batsmanId: z.string().uuid().optional().nullable(),
  bowlerId: z.string().uuid().optional().nullable(),
  isWicket: z.boolean().default(false),
  wicketType: z
    .enum([
      "bowled", "caught", "lbw", "run_out", "stumped", "hit_wicket", "retired", "retired_hurt",
    ])
    .optional()
    .nullable(),
  /**
   * Canonical wicket attribution (Batch 100). Which batter actually left, and
   * (fielding-side) who dismissed them. Optional so v1 queued commands remain
   * valid; when omitted, the canonical service's fold falls back to
   * rule-derived attribution (striker out) and corrects itself from
   * subsequent recorded deliveries. These are NOT stripped silently anymore -
   * the service persists exactly what the surface declared.
   */
  wicketPlayerOutId: z.string().uuid().optional().nullable(),
  wicketFielderId: z.string().uuid().optional().nullable(),
  isWide: z.boolean().default(false),
  isNoBall: z.boolean().default(false),
  isBye: z.boolean().default(false),
  isLegBye: z.boolean().default(false),
  isFour: z.boolean().default(false),
  isSix: z.boolean().default(false),
  // SCORE-11 writer fencing: the handover epoch the scoring session observed.
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
  .strict()

/**
 * The canonical delivery command a scorer submits from ANY surface.
 *
 * ENH-03-02: the schema is STRICT - unknown keys are refused, never
 * stripped. A nested `extras`/`wicket` object or a stray UI field can no
 * longer vanish between transport and validation (the offline flush used to
 * send exactly those nested shapes, silently turning queued wickets and
 * wides into invented legal runs). Deliveries must arrive in THIS shape;
 * adapters map richer client records onto it explicitly via
 * `queuedDeliveryToCommand`.
 */
export type DeliverySubmission = z.infer<typeof recordBallCommandSchema>

/**
 * The on-device queued delivery as the mobile offline store persists it
 * (structural subset - the store may carry extra bookkeeping fields).
 */
export type QueuedDeliveryInput = {
  /** Client operation id; one command identity per queued delivery. */
  id: string
  matchId: string
  inningsId?: string | null
  over: number
  ball: number
  runs: number
  batsmanId?: string | null
  bowlerId?: string | null
  isWicket?: boolean
  wicketType?: WicketType | string | null
  /** Batch 100: canonical wicket attribution - which batter left, and who
   *  dismissed them. Optional; older queues simply omit both. */
  wicketPlayerOutId?: string | null
  wicketFielderId?: string | null
  isWide?: boolean
  isNoBall?: boolean
  isBye?: boolean
  isLegBye?: boolean
  handoverEpoch?: number | null
  expectedRevision?: number | null
}

export type QueuedDeliveryCommandResult =
  | { ok: true; command: DeliverySubmission }
  | { ok: false; reason: string }

/**
 * THE queued-delivery → command adapter (ENH-03-02). One mapping,
 * everywhere: the offline flush previously re-derived a SERVICE-shaped body
 * (nested `extras`/`wicket` objects) that the intake schema silently
 * stripped, losing wicket and extras intent. The command here already
 * matches the intake schema exactly, so the caller validates it with the
 * same schema the route uses.
 *
 * Discriminated result instead of throwing, so a caller can mark the queue
 * entry un-syncable with its reason.
 */
export function queuedDeliveryToCommand(ball: QueuedDeliveryInput): QueuedDeliveryCommandResult {
  if (!ball.inningsId) return { ok: false, reason: "missing_innings_id" }
  if (!ball.batsmanId || !ball.bowlerId) return { ok: false, reason: "missing_participants" }
  if (ball.isWicket && !ball.wicketType) return { ok: false, reason: "wicket_requires_type" }
  const parsed = recordBallCommandSchema.safeParse({
    matchId: ball.matchId,
    inningsId: ball.inningsId,
    clientOpId: ball.id,
    overNumber: ball.over,
    ballNumber: ball.ball,
    runs: ball.runs,
    batsmanId: ball.batsmanId,
    bowlerId: ball.bowlerId,
    isWicket: !!ball.isWicket,
    wicketType: ball.wicketType ?? null,
    wicketPlayerOutId: ball.wicketPlayerOutId ?? null,
    wicketFielderId: ball.wicketFielderId ?? null,
    isWide: !!ball.isWide,
    isNoBall: !!ball.isNoBall,
    isBye: !!ball.isBye,
    isLegBye: !!ball.isLegBye,
    isFour: ball.runs === 4,
    isSix: ball.runs === 6,
    handoverEpoch: ball.handoverEpoch ?? undefined,
    expectedRevision: ball.expectedRevision ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      reason: `invalid_command: ${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`,
    }
  }
  return { ok: true, command: parsed.data }
}

/**
 * ENH-03-02 / ENH-09-02 (Batch 100): canonical active-participant state.
 *
 * This is the typed projection the scoring service owns. It is CALLED only
 * on the server - the scoring service folds the official delivery log inside
 * its own transaction (and again after an undo), and the web overlay reader
 * folds the same log from the same shared pure policy in `@mtk/database`.
 * Browsers and the OBS page never receive rotation rules or raw balls to
 * derive participants from; they receive this resolved projection or nothing.
 *
 * `confirmed === false` means the fold met an event it cannot interpret
 * consistently (an off-crease wicket attribution, a third batter entering
 * without a departure, competition-specific retired-hurt returns). Callers
 * must treat every id as best-effort then: display without claims and never
 * fire player-introduction celebrations from it.
 */
export const scoringParticipantsSchema = z.object({
  /** Batter confirmed to face the NEXT delivery, or null when unconfirmed
   *  (no recorded deliveries yet, or a dismissal whose replacement has not
   *  faced a ball). Rotation is policy-derived and every recorded delivery
   *  re-syncs it - the record always wins over the prediction. */
  strikerId: z.string().uuid().nullable(),
  /** The other confirmed crease occupant, or null when fewer than two
   *  occupants are confirmed. */
  nonStrikerId: z.string().uuid().nullable(),
  /** Bowler of the over IN PROGRESS. Deliberately null between overs: the
   *  next bowler is not server truth until they bowl a ball. */
  bowlerId: z.string().uuid().nullable(),
  /** Bowler of the over that JUST completed (null once a new over is in
   *  progress). Exists so consumers can confirm a bowler change at an over
   *  boundary without pretending the next bowler is already known. */
  previousOverBowlerId: z.string().uuid().nullable(),
  /** The newest crease occupant whose first recorded delivery this innings
   *  followed the most recent dismissal and who has faced exactly one
   *  delivery. Null for openers and once established. */
  incomingBatterId: z.string().uuid().nullable(),
  /** Every batter confirmed at the crease (max 2 when confirmed). Kept
   *  separate from the striker/non-striker ends so a post-dismissal innings
   *  with no confirmed next batter still surfaces the survivor. */
  creaseBatterIds: z.array(z.string().uuid()),
  confirmed: z.boolean(),
  lastBallSequence: z.number().int().nullable(),
})
export type ScoringParticipants = z.infer<typeof scoringParticipantsSchema>

/**
 * The canonical acknowledgement envelope. `scorecard` is intentionally
 * `unknown` at the contract level: the canonical scorecard belongs to the
 * scoring service (its shape arrives through the service client on each
 * surface). Surfaces narrow it locally; the envelope's identity fields
 * (ballId / scoringRevision / clientOpId / replayed) are the portable part.
 */
export type ScoringAcknowledgement = {
  success: true
  ballId: string
  scoringRevision: number
  clientOpId: string | null
  replayed?: boolean
  scorecard?: unknown
  /** Batch 100: the canonical striker/non-striker/bowler projection folded
   *  inside the recording transaction, present only where
   *  SCORING_PARTICIPANTS_READY is enabled. Surfaces may show it as
   *  service-confirmed state; it is never derived client-side. */
  participants?: ScoringParticipants | null
}
