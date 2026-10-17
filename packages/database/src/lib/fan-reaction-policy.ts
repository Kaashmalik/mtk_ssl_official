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
