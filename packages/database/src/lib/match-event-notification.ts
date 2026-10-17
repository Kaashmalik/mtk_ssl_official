import { isTournamentPublished } from "./publication-policy"

/**
 * FAN-02 match lifecycle fan-out policy (pure).
 *
 * When a FOLLOWED tournament's match changes state in a way a follower would
 * plausibly want to know about - started, rescheduled, cancelled - the writer
 * may fan out a notification. Everything decidable without I/O lives here so
 * the wiring cannot drift from the rules.
 *
 * Deliberately NOT fan-out triggers (recorded boundaries): fixture creation
 * (whole lists are generated at once - that is a flood, not a signal), toss
 * results alone (not follow-worthy), stream start/end (vanity state), match
 * completion (canonical completion belongs to scoring-service, out of the web
 * writer's transaction), and ball-level events.
 */

export const MATCH_FANOUT_KINDS = ["start", "reschedule", "cancel"] as const
export type MatchFanoutKind = (typeof MATCH_FANOUT_KINDS)[number]

export type MatchEventFanoutInput = {
  kind: MatchFanoutKind
  /** Friendly matches have no competition and therefore no follower surface. */
  tournamentId: string | null
  tournamentStatus: string | null
  statusBefore: string | null
  statusAfter: string
  /** ISO timestamps of the scheduled kickoff (null for untimed fixtures). */
  scheduledBefore: string | null
  scheduledAfter: string | null
}

export type MatchEventDecision =
  | { notify: true; kind: MatchFanoutKind }
  | {
      notify: false
      reason:
        | "not_a_fanout_command"
        | "no_competition"
        | "unpublished_tournament"
        | "no_state_change"
    }

export function matchEventDecision(input: MatchEventFanoutInput): MatchEventDecision {
  if (!MATCH_FANOUT_KINDS.includes(input.kind)) {
    return { notify: false, reason: "not_a_fanout_command" }
  }
  if (input.tournamentId === null) {
    return { notify: false, reason: "no_competition" }
  }
  if (!isTournamentPublished(input.tournamentStatus)) {
    return { notify: false, reason: "unpublished_tournament" }
  }
  const stateChanged =
    input.kind === "start"
      ? input.statusBefore !== null && input.statusBefore !== "live" && input.statusAfter === "live"
      : input.kind === "cancel"
        ? input.statusBefore !== "cancelled" && input.statusAfter === "cancelled"
        : input.scheduledBefore !== input.scheduledAfter
  if (!stateChanged) return { notify: false, reason: "no_state_change" }
  return { notify: true, kind: input.kind }
}

/**
 * Human copy for the fan-out. `whenText` is caller-built (the format is a
 * presentation concern) so this stays pure and testable verbatim.
 */
export type MatchEventCopy = { type: string; title: string; body: string }

export function matchEventCopy(
  kind: MatchFanoutKind,
  names: { homeName: string; awayName: string; whenText?: string },
): MatchEventCopy {
  const pairing = `${names.homeName} vs ${names.awayName}`
  if (kind === "start") {
    return { type: "match_started", title: "Match started", body: `${pairing} is now live` }
  }
  if (kind === "cancel") {
    return { type: "match_cancelled", title: "Match cancelled", body: `${pairing} has been cancelled` }
  }
  const when = names.whenText ? ` to ${names.whenText}` : ""
  return {
    type: "match_rescheduled",
    title: "Match rescheduled",
    body: `${pairing} has been rescheduled${when}`,
  }
}

/**
 * Dedup key for the 24h notification dedup. Reschedule keys CAN rewrite (a
 * second move to a different date is a different key and is delivered); a
 * literal replay of the same reschedule target is suppressed by design.
 */
export function matchEventDedupKey(
  kind: MatchFanoutKind,
  matchId: string,
  scheduledAfter: string | null,
): string {
  if (kind === "start") return `match:${matchId}:started`
  if (kind === "cancel") return `match:${matchId}:cancelled`
  return `match:${matchId}:rescheduled:${scheduledAfter ?? "unscheduled"}`
}
