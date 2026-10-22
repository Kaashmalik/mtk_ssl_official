/**
 * ENH-09-02/03: pure celebration planning for the read-only OBS overlay.
 *
 * Events are derived from the OFFICIAL snapshot returned by the scoring read
 * path. A queued local/offline command or a typed edit never appears here:
 * only a snapshot that has already been persisted can move the aggregates or
 * append a delivery. Every event carries the canonical scoring revision and a
 * stable delivery id, so a replayed poll cannot repeat it and an undo can
 * cancel it.
 *
 * Batch 100: "new batter"/"new bowler" introductions ARE implemented - but
 * only from `current.participants`, the canonical striker/non-striker/
 * incoming-batter projection the server folds from the official delivery
 * log behind SCORING_PARTICIPANTS_READY, and only while that block is
 * `confirmed`. A snapshot without confirmed participants can still show
 * every other celebration, but it never claims who walked in: inventing an
 * introduction would be a false claim on stream.
 */

import type { BroadcastOverlaySnapshot } from "./broadcast-overlay"

export type BroadcastCelebrationKind =
  | "four"
  | "six"
  | "wicket"
  | "team_fifty"
  | "team_hundred"
  | "batter_fifty"
  | "batter_hundred"
  | "five_wickets"
  | "innings_break"
  | "result"
  /** Batch 100: only ever emitted from a `confirmed` participants block. */
  | "batter_entered"
  | "bowler_entered"

export type BroadcastCelebrationEvent = {
  /** Stable across polls; a duplicate id is never queued twice. */
  id: string
  kind: BroadcastCelebrationKind
  title: string
  detail: string | null
  /** Canonical scoring revision that produced this event. */
  revision: number
  /**
   * Delivery that caused the event. A milestone keeps the triggering delivery
   * so an undo removes the milestone with it. Innings/result events are not
   * tied to one delivery (`null`).
   */
  ballId: string | null
  /** Only meaningful for `wicket`; run-outs are not credited to the bowler. */
  bowlerCreditedWicket?: boolean
}

export type BroadcastCelebrationMode = "full" | "reduced" | "off"

export const BROADCAST_CELEBRATION_MAX_EVENTS = 4

const RESULT_STATUSES = new Set(["completed", "no_result", "forfeited", "abandoned"])

function resultTitle(status: string): string {
  if (status === "no_result") return "NO RESULT"
  if (status === "forfeited") return "FORFEIT"
  if (status === "abandoned") return "ABANDONED"
  return "RESULT"
}

function wicketDetail(wicketType: string | null, credited: boolean): string {
  const label = wicketType
    ? wicketType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : "Wicket"
  return credited ? label : `${label} · not credited to bowler`
}

function crossing(before: number, after: number, threshold: number): boolean {
  return before < threshold && after >= threshold
}

/**
 * Diff two official snapshots into a short, ordered celebration queue.
 *
 * - `previous === null` (the first render / a reconnect baseline) emits
 *   nothing: a viewer joining late fast-forwards to the current score instead
 *   of replaying the match's backlog.
 * - A lower revision (database reset/undo of the newest delivery) emits
 *   nothing new; `pruneBroadcastCelebrations` removes the cancelled events.
 * - Boundaries require the canonical `boundary` tone as well as the label, so
 *   byes/leg-byes and an overthrow four never masquerade as a bat boundary.
 */
export function planBroadcastCelebrations(input: {
  previous: BroadcastOverlaySnapshot | null
  next: BroadcastOverlaySnapshot
  mode?: BroadcastCelebrationMode
  maxEvents?: number
}): BroadcastCelebrationEvent[] {
  const mode = input.mode ?? "full"
  const maxEvents = Math.max(1, Math.min(12, input.maxEvents ?? BROADCAST_CELEBRATION_MAX_EVENTS))
  const { previous, next } = input
  if (mode === "off" || !previous) return []
  if (previous.matchId !== next.matchId) return []
  if (next.scoringRevision < previous.scoringRevision) return []

  const events: BroadcastCelebrationEvent[] = []
  const previousCurrent = previous.current
  const nextCurrent = next.current
  const sameInnings = Boolean(
    previousCurrent
    && nextCurrent
    && previousCurrent.inningsNumber === nextCurrent.inningsNumber,
  )

  // New official deliveries since the previous snapshot. Stable ball ids mean
  // a shifted array position is never mistaken for a new delivery.
  let latestNewBallId: string | null = null
  if (sameInnings && previousCurrent && nextCurrent) {
    const seen = new Set(previousCurrent.recentBalls.map(ball => ball.id))
    const newBalls = nextCurrent.recentBalls.filter(ball => !seen.has(ball.id))
    for (const ball of newBalls) {
      latestNewBallId = ball.id
      if (ball.tone === "wicket") {
        events.push({
          id: `ball:${ball.id}`,
          kind: "wicket",
          title: "WICKET",
          detail: wicketDetail(ball.wicketType, ball.bowlerCreditedWicket),
          revision: next.scoringRevision,
          ballId: ball.id,
          bowlerCreditedWicket: ball.bowlerCreditedWicket,
        })
      } else if (ball.tone === "boundary" && ball.label === "6") {
        events.push({
          id: `ball:${ball.id}`,
          kind: "six",
          title: "SIX",
          detail: null,
          revision: next.scoringRevision,
          ballId: ball.id,
        })
      } else if (ball.tone === "boundary" && ball.label === "4") {
        events.push({
          id: `ball:${ball.id}`,
          kind: "four",
          title: "FOUR",
          detail: null,
          revision: next.scoringRevision,
          ballId: ball.id,
        })
      }
    }
  }

  // Player introductions (Batch 100) - served ONLY from the confirmed
  // canonical participants block, never inferred from raw deliveries here.
  // The ids are stable per introduced player per innings (no revision), so
  // the poll-to-poll dedup below stays idempotent while the introduction is
  // live, and pruneBroadcastCelebrations retracts it through ballId when an
  // undo removes the delivery that revealed the player.
  if (sameInnings && previousCurrent && nextCurrent) {
    const nextParticipants = nextCurrent.participants
    const previousParticipants = previousCurrent.participants
    if (nextParticipants?.confirmed === true) {
      const incomingId = nextParticipants.incomingBatter?.id ?? null
      const previouslyPresent = previousParticipants != null
        && previousParticipants.confirmed === true
        && (
          previousParticipants.striker?.id === incomingId
          || previousParticipants.nonStriker?.id === incomingId
          || previousParticipants.incomingBatter?.id === incomingId
          || previousParticipants.crease.some(batter => batter.id === incomingId)
        )
      if (incomingId != null && !previouslyPresent) {
        events.push({
          id: `entrant:batter:${nextCurrent.inningsNumber}:${incomingId}`,
          kind: "batter_entered",
          title: "NEW BATTER",
          detail: nextParticipants.incomingBatter!.name,
          revision: next.scoringRevision,
          ballId: latestNewBallId,
        })
      }

      const bowlerId = nextParticipants.bowler?.id ?? null
      // Between overs the current bowler is deliberately unknown; the fold's
      // boundary anchor is the bowler of the over that just completed. An
      // introduction needs a DIFFERENT known prior bowler - this neither
      // fires for the innings' first bowler nor re-fires while a bowler is
      // mid-over.
      const priorBowlerId = previousParticipants?.confirmed === true
        ? (previousParticipants.bowler?.id ?? previousParticipants.previousBowlerId)
        : null
      if (bowlerId != null && priorBowlerId != null && bowlerId !== priorBowlerId) {
        events.push({
          id: `entrant:bowler:${nextCurrent.inningsNumber}:${bowlerId}`,
          kind: "bowler_entered",
          title: "NEW BOWLER",
          detail: `${nextParticipants.bowler!.name} bowling`,
          revision: next.scoringRevision,
          ballId: latestNewBallId,
        })
      }
    }
  }

  if (sameInnings && previousCurrent && nextCurrent) {
    const batterId = nextCurrent.lastBatter?.id ?? null
    if (
      batterId
      && previousCurrent.lastBatter?.id === batterId
      && nextCurrent.lastBatter
    ) {
      const before = previousCurrent.lastBatter.runs
      const after = nextCurrent.lastBatter.runs
      if (crossing(before, after, 100)) {
        events.push({
          id: `milestone:batter_hundred:${batterId}:${next.scoringRevision}`,
          kind: "batter_hundred",
          title: "CENTURY",
          detail: `${nextCurrent.lastBatter.name} ${after}`,
          revision: next.scoringRevision,
          ballId: latestNewBallId,
        })
      } else if (crossing(before, after, 50)) {
        events.push({
          id: `milestone:batter_fifty:${batterId}:${next.scoringRevision}`,
          kind: "batter_fifty",
          title: "FIFTY",
          detail: `${nextCurrent.lastBatter.name} ${after}`,
          revision: next.scoringRevision,
          ballId: latestNewBallId,
        })
      }
    }

    const bowlerId = nextCurrent.lastBowler?.id ?? null
    if (
      bowlerId
      && previousCurrent.lastBowler?.id === bowlerId
      && nextCurrent.lastBowler
      && crossing(previousCurrent.lastBowler.wickets, nextCurrent.lastBowler.wickets, 5)
    ) {
      events.push({
        id: `milestone:five_wickets:${bowlerId}:${next.scoringRevision}`,
        kind: "five_wickets",
        title: "FIVE WICKETS",
        detail: `${nextCurrent.lastBowler.name} ${nextCurrent.lastBowler.wickets}`,
        revision: next.scoringRevision,
        ballId: latestNewBallId,
      })
    }

    if (crossing(previousCurrent.runs, nextCurrent.runs, 100)) {
      events.push({
        id: `milestone:team_hundred:${nextCurrent.battingTeamId}:${next.scoringRevision}`,
        kind: "team_hundred",
        title: "TEAM 100",
        detail: `${nextCurrent.runs}/${nextCurrent.wickets}`,
        revision: next.scoringRevision,
        ballId: latestNewBallId,
      })
    } else if (crossing(previousCurrent.runs, nextCurrent.runs, 50)) {
      events.push({
        id: `milestone:team_fifty:${nextCurrent.battingTeamId}:${next.scoringRevision}`,
        kind: "team_fifty",
        title: "TEAM 50",
        detail: `${nextCurrent.runs}/${nextCurrent.wickets}`,
        revision: next.scoringRevision,
        ballId: latestNewBallId,
      })
    }
  }

  if (
    previousCurrent
    && nextCurrent
    && nextCurrent.inningsNumber > previousCurrent.inningsNumber
  ) {
    events.push({
      id: `innings_break:${nextCurrent.inningsNumber}:${next.scoringRevision}`,
      kind: "innings_break",
      title: "INNINGS BREAK",
      detail: `${nextCurrent.runs}/${nextCurrent.wickets}`,
      revision: next.scoringRevision,
      ballId: null,
    })
  }

  if (!RESULT_STATUSES.has(previous.status) && RESULT_STATUSES.has(next.status)) {
    events.push({
      id: `result:${next.status}:${next.updatedAt}`,
      kind: "result",
      title: resultTitle(next.status),
      detail: next.teams.teamA.name + " vs " + next.teams.teamB.name,
      revision: next.scoringRevision,
      ballId: null,
    })
  }

  return events.slice(-maxEvents)
}

/**
 * Drop queued events that the newest snapshot no longer supports.
 *
 * An undo removes the delivery row (and increments the revision), so a
 * celebration tied to that ball must disappear instead of showing an event the
 * official record has withdrawn. Milestones carry the triggering ball id for
 * the same reason. Innings/result events survive until played.
 */
export function pruneBroadcastCelebrations(
  events: BroadcastCelebrationEvent[],
  next: BroadcastOverlaySnapshot,
): BroadcastCelebrationEvent[] {
  const currentBalls = new Set(next.current?.recentBalls.map(ball => ball.id) ?? [])
  return events.filter(event => {
    if (event.revision > next.scoringRevision) return false
    // A result is only displayable while the official status is terminal. A
    // reopened match must retract a queued result instead of contradicting it.
    if (event.kind === "result" && !RESULT_STATUSES.has(next.status)) return false
    return event.ballId === null || currentBalls.has(event.ballId)
  })
}
