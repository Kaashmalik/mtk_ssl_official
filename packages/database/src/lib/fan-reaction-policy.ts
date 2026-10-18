/**
 * FAN-01 fan reaction policy (pure).
 *
 * Fans react to a published match from a FIXED platform-chosen set - no free
 * text surface exists, so nothing offensive can be stored and moderation is
 * about BEHAVIOR (floods), not content. Reactions are engagement signals only:
 * they never feed scoring, standings, or awards, and no official decision can
 * read them.
 */

export const FAN_REACTION_TYPES = ["four", "six", "wicket", "clap", "fire"] as const
export type FanReactionType = (typeof FAN_REACTION_TYPES)[number]

export function isFanReactionType(value: unknown): value is FanReactionType {
  return typeof value === "string" && (FAN_REACTION_TYPES as readonly string[]).includes(value)
}

/** Human-facing labels for the public reaction bar. */
export const FAN_REACTION_LABELS: Record<FanReactionType, string> = {
  four: "Four",
  six: "Six",
  wicket: "Wicket",
  clap: "Clap",
  fire: "On fire",
}

/**
 * Anti-abuse floor: a fan may add at most FAN_REACTION_MAX_PER_WINDOW new
 * reactions inside FAN_REACTION_WINDOW_MS. Toggles count adds only (a removal
 * is not rate-limited - deleting is never abuse). This is a flood guard, not
 * an authentication boundary; identity remains the writer's gate.
 */
export const FAN_REACTION_WINDOW_MS = 60_000
export const FAN_REACTION_MAX_PER_WINDOW = 20

export type ReactionRateDecision =
  | { allowed: true; reason: "ok" }
  | { allowed: false; reason: "rate_limited" }

export function reactionRateDecision(recentAddCount: number): ReactionRateDecision {
  return recentAddCount >= FAN_REACTION_MAX_PER_WINDOW
    ? { allowed: false, reason: "rate_limited" }
    : { allowed: true, reason: "ok" }
}

/**
 * A reaction target must be a PUBLISHED match - exactly the house publication
 * gate the public page applies (`scheduled/toss/live/innings_break/completed/
 * abandoned/no_result` under a published tournament). A cancelled fixture is
 * already outside that set, so it refuses here too, and a foreign-league id
 * reads as unpublished rather than widening anything.
 */
export type ReactionTargetInput = {
  matchStatus: string
  tournamentStatus: string
}

export type ReactionTargetDecision =
  | { allowed: true; reason: "ok" }
  | { allowed: false; reason: "target_unpublished" }

export function reactionTargetDecision(input: ReactionTargetInput): ReactionTargetDecision {
  const tournamentPublished = input.tournamentStatus === "registration"
    || input.tournamentStatus === "live"
    || input.tournamentStatus === "completed"
  if (!tournamentPublished) return { allowed: false, reason: "target_unpublished" }
  const matchSet = new Set(["scheduled", "toss", "live", "innings_break", "completed", "abandoned", "no_result"])
  if (!matchSet.has(input.matchStatus)) return { allowed: false, reason: "target_unpublished" }
  return { allowed: true, reason: "ok" }
}

/**
 * FAN-01 reports slice: fan-facing reports on a match's reaction FEED. The
 * public bar shows aggregates only, so a report is per match feed, never per
 * reaction row. Reasons are a FIXED platform-chosen set (no free text, so
 * nothing offensive is stored); one OPEN report per fan per match is
 * enforced DB-side (partial unique) and re-reporting must degrade to an
 * idempotent no-op, never an error.
 */
export const REACTION_REPORT_REASONS = ["abusive", "spam", "inappropriate", "other"] as const
export type ReactionReportReason = (typeof REACTION_REPORT_REASONS)[number]

export function isReactionReportReason(value: unknown): value is ReactionReportReason {
  return typeof value === "string" && (REACTION_REPORT_REASONS as readonly string[]).includes(value)
}

export const REACTION_REPORT_REASON_LABELS: Record<ReactionReportReason, string> = {
  abusive: "Abusive content",
  spam: "Spam or flooding",
  inappropriate: "Inappropriate",
  other: "Something else",
}

export type ReactionReportStatus = "open" | "dismissed" | "actioned"

/**
 * Decision state machine: only an OPEN report can be decided, the two
 * decided states are terminal (a replay reports that honestly instead of
 * re-deciding or re-opening), and only these two transitions exist. The
 * reviewer identity + time are required at the write tier - provenance is
 * enforced there AND by the DB review_provenance CHECK.
 */
export type ReportDecisionInput = { currentStatus: ReactionReportStatus; decision: "dismissed" | "actioned" }
export type ReportDecision =
  | { allowed: true; reason: "ok" }
  | { allowed: false; reason: "not_found" | "already_decided" | "invalid_decision" }

export function reactionReportDecision(input: ReportDecisionInput): ReportDecision {
  if (input.decision !== "dismissed" && input.decision !== "actioned") {
    return { allowed: false, reason: "invalid_decision" }
  }
  if (input.currentStatus === "open") return { allowed: true, reason: "ok" }
  // A vanished row reads as not_found at the reader tier; a decided one is
  // final here.
  return input.currentStatus === "dismissed" || input.currentStatus === "actioned"
    ? { allowed: false, reason: "already_decided" }
    : { allowed: false, reason: "not_found" }
}

/** Floor on report submissions: same spirit as the reaction flood guard. */
export const FAN_REPORT_WINDOW_MS = 60_000
export const FAN_REPORT_MAX_PER_WINDOW = 5

export type FanReportRateDecision =
  | { allowed: true; reason: "ok" }
  | { allowed: false; reason: "report_rate_limited" }

export function fanReportRateDecision(recentReportCount: number): FanReportRateDecision {
  return recentReportCount >= FAN_REPORT_MAX_PER_WINDOW
    ? { allowed: false, reason: "report_rate_limited" }
    : { allowed: true, reason: "ok" }
}

/**
 * FAN-01 anti-abuse slice: LEAGUE-SCOPED interaction blocks. The league
 * owner stops one fan from reacting to or reporting on any match of THEIR
 * league - never another league's, and never feed-permanent (only active and
 * lifted exist; a lift carries reviewer provenance, enforced here AND by the
 * DB lift_provenance CHECK). Reasons are a fixed platform-chosen set; no
 * free text is stored.
 */
export const FAN_BLOCK_REASONS = ["report_abuse", "reaction_abuse", "other"] as const
export type FanBlockReason = (typeof FAN_BLOCK_REASONS)[number]

export function isFanBlockReason(value: unknown): value is FanBlockReason {
  return typeof value === "string" && (FAN_BLOCK_REASONS as readonly string[]).includes(value)
}

export const FAN_BLOCK_REASON_LABELS: Record<FanBlockReason, string> = {
  report_abuse: "Abusive reports",
  reaction_abuse: "Abusive reactions",
  other: "Other disruption",
}

export type FanBlockStatus = "active" | "lifted"

/**
 * Block state machine: a block starts active; only an ACTIVE block can be
 * lifted; lifted is terminal on that row (a fresh block after a lift is a
 * NEW active row - history is kept, provenance both ways).
 */
export type BlockLiftInput = { currentStatus: FanBlockStatus }
export type BlockLiftDecision =
  | { allowed: true; reason: "ok" }
  | { allowed: false; reason: "not_found" | "already_lifted" }

export function fanBlockLiftDecision(input: BlockLiftInput): BlockLiftDecision {
  if (input.currentStatus === "active") return { allowed: true, reason: "ok" }
  return input.currentStatus === "lifted"
    ? { allowed: false, reason: "already_lifted" }
    : { allowed: false, reason: "not_found" }
}

/**
 * Enforcement decision at the engagement writers: an ACTIVE block refuses
 * the fan's reaction/report contribution fail-closed. Lifted or absent never
 * refuses - a lift is a real, immediate return of participation.
 */
export type FanBlockEnforcement =
  | { blocked: false }
  | { blocked: true }

export function fanBlockEnforcement(activeBlockExists: boolean): FanBlockEnforcement {
  return activeBlockExists ? { blocked: true } : { blocked: false }
}
