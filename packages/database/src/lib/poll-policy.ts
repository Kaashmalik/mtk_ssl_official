/**
 * FAN-01 moderated poll policy (pure).
 *
 * A poll's QUESTION and OPTIONS are owner-authored - moderated at the source
 * (only `tournament:update` members create or open polls), so fan votes are
 * the ONLY fan-generated surface and they are anonymous options, never text.
 * Votes are engagement signals ONLY: they feed no scoring, standings, or
 * award, and no official decision can read them. One active vote per fan per
 * poll; switching updates the vote in place while the poll is open.
 */

/** 2-10 options; each a non-empty, bounded, single-line string. */
export const POLL_MIN_OPTIONS = 2
export const POLL_MAX_OPTIONS = 10
export const POLL_MAX_QUESTION_LENGTH = 200
export const POLL_MAX_OPTION_LENGTH = 120

export type PollOptionsResult =
  | { ok: true; options: string[] }
  | { ok: false; reason: "too_few" | "too_many" | "empty_option" | "too_long" | "multiline" | "not_strings" }

export function normalizePollOptions(input: unknown): PollOptionsResult {
  if (!Array.isArray(input) || input.some(option => typeof option !== "string")) {
    return { ok: false, reason: "not_strings" }
  }
  const options = (input as string[]).map(option => option.trim())
  if (options.length < POLL_MIN_OPTIONS) return { ok: false, reason: "too_few" }
  if (options.length > POLL_MAX_OPTIONS) return { ok: false, reason: "too_many" }
  for (const option of options) {
    if (option.length === 0) return { ok: false, reason: "empty_option" }
    if (option.length > POLL_MAX_OPTION_LENGTH) return { ok: false, reason: "too_long" }
    if (/[\r\n]/.test(option)) return { ok: false, reason: "multiline" }
  }
  return { ok: true, options }
}

export function normalizePollQuestion(input: unknown): string | null {
  if (typeof input !== "string") return null
  const question = input.trim()
  if (question.length === 0 || question.length > POLL_MAX_QUESTION_LENGTH) return null
  if (/[\r\n]/.test(question)) return null
  return question
}

export type PollVoteDecision =
  | { allowed: true; optionIndex: number }
  | { allowed: false; reason: "not_a_poll" | "not_open" | "unknown_option" }

/**
 * A vote lands only on an OPEN poll at a real option index. Switching is
 * allowed: the index may differ from the fan's current vote (the writer
 * updates in place) - changing one's mind is not abuse.
 */
export function pollVoteDecision(
  poll: { status: string; optionsCount: number } | null,
  optionIndexInput: unknown,
): PollVoteDecision {
  if (!poll) return { allowed: false, reason: "not_a_poll" }
  if (poll.status !== "open") return { allowed: false, reason: "not_open" }
  if (typeof optionIndexInput !== "number"
    || !Number.isInteger(optionIndexInput)
    || optionIndexInput < 0
    || optionIndexInput >= poll.optionsCount) {
    return { allowed: false, reason: "unknown_option" }
  }
  return { allowed: true, optionIndex: optionIndexInput }
}

/**
 * Lifecycle transitions: draft -> open -> closed, and a draft may be closed
 * without ever opening (withdrawn). Closed is terminal; reopening is refused
 * (votes would resume on different visibility).
 */
export type PollTransitionDecision =
  | { allowed: true; next: "open" | "closed" }
  | { allowed: false; reason: "unknown_transition" | "terminal_closed" }

export function pollTransitionDecision(current: string, next: unknown): PollTransitionDecision {
  if (next !== "open" && next !== "closed") return { allowed: false, reason: "unknown_transition" }
  if (current === "closed") return { allowed: false, reason: "terminal_closed" }
  if (current === next) return { allowed: false, reason: "unknown_transition" }
  return { allowed: true, next }
}
