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

/** Bump only with an explicit migration story for queued offline commands. */
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

/** The canonical delivery command a scorer submits from ANY surface. */
export type DeliverySubmission = z.infer<typeof recordBallCommandSchema>

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
}
