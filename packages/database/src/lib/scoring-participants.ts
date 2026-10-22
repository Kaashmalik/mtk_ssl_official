/**
 * ENH-03-02 / ENH-09-02 (Batch 100): canonical active-participant fold.
 *
 * One deterministic fold from the OFFICIAL per-innings delivery log to the
 * server-confirmed striker/non-striker/bowler/incoming-batter projection
 * (`ScoringParticipants` from `@mtk/contracts`). Both the scoring service
 * (in its own transaction, before each response) and the web overlay reader
 * (server-side, over the same rows) call THIS implementation - rotation
 * rules never get re-derived per client, and the OBS browser page receives
 * a resolved projection or nothing.
 *
 * The fold is evidence-based and self-healing:
 *  - The striker of a recorded delivery IS the recorded `batsmanId` (the
 *    scorer's command is authoritative for that ball).
 *  - Between recorded balls, the tested strike policy (`rotateStrike`)
 *    predicts who faces next; the NEXT recorded delivery re-syncs the
 *    prediction. A drifted prediction is therefore corrected by the record,
 *    never argued with.
 *  - A dismissal removes its attributed batter (`wicketPlayerOutId`) or the
 *    rule-derived default (the striker, via `batterLeavingOnWicket`). If the
 *    default guess was wrong, the wrongly-removed batter re-enters as soon
 *    as they face another ball (the slot they vacate is exactly the one the
 *    truly-out batter left open) - so crease membership re-converges on the
 *    record without any code knowing "who was really out".
 *  - Anything the fold cannot interpret consistently (an off-crease wicket
 *    attribution, a third batter entering with no departure, competition-
 *    specific retiree returns with a full crease) degrades `confirmed` to
 *    false instead of inventing a story. Callers must not claim state, and
 *    the overlay must not fire player-introduction celebrations, when
 *    `confirmed` is false.
 *
 * Pure: no reads, no writes, no environment, no zod runtime dependency.
 */

import type { ScoringParticipants } from "@mtk/contracts"
import { batterLeavingOnWicket, rotateStrike } from "./cricket-rules-policy"

export type { ScoringParticipants } from "@mtk/contracts"

export type ParticipantBallInput = {
  ballSequence: number
  overNumber: number
  ballNumber: number
  batsmanId: string | null
  bowlerId: string | null
  /** match_balls.runs is the delivery TOTAL (penalties included). */
  runs: number
  isWide: boolean
  isNoBall: boolean
  isBye: boolean
  isLegBye: boolean
  isWicket: boolean
  wicketType: string | null
  wicketPlayerOutId: string | null
}

type Occupant = {
  id: string
  /** ballSequence of the delivery on which this batter first faced. */
  firstSeq: number
  /** Recorded deliveries faced (wides included - facing an illegal
   *  delivery still puts the batter at the crease). */
  ballsFaced: number
}

/** Wicket types whose victim is the STRIKER by rule (they faced the ball).
 *  Everything else (run_out, retired, retired_hurt) needs attribution or
 *  the recorded-balls evidence to say who left. */
const STRIKER_OUT_DEFAULT = new Set(["bowled", "caught", "lbw", "stumped", "hit_wicket"])

export function foldScoringParticipants(balls: readonly ParticipantBallInput[]): ScoringParticipants {
  const occupants: Occupant[] = []
  let openSlots = 0
  /** Pointer into `occupants`; null while unconfirmed (post-dismissal, or
   *  before the first delivery). The pointer is a prediction after the last
   *  recorded ball and truth only until the next record re-syncs it. */
  let strikerIndex: number | null = null
  let confirmed = true
  let lastDismissalSeq: number | null = null
  let bowlerInOver: string | null = null
  let previousOverBowlerId: string | null = null
  let overInProgress = false
  let lastSequence: number | null = null

  for (const ball of balls) {
    lastSequence = ball.ballSequence
    const faced = ball.batsmanId

    if (faced != null) {
      const existing = occupants.findIndex(occupant => occupant.id === faced)
      if (existing >= 0) {
        occupants[existing]!.ballsFaced += 1
        strikerIndex = existing
      } else if (openSlots > 0) {
        // A dismissal left a slot; the scorer's next delivery names who took it.
        openSlots -= 1
        occupants.push({ id: faced, firstSeq: ball.ballSequence, ballsFaced: 1 })
        strikerIndex = occupants.length - 1
      } else if (occupants.length === 0) {
        // First opener of the innings.
        occupants.push({ id: faced, firstSeq: ball.ballSequence, ballsFaced: 1 })
        strikerIndex = 0
      } else if (occupants.length === 1) {
        // Second opener (they have been at the non-striker end since the
        // first delivery; the rotation prediction below keeps re-syncing).
        occupants.push({ id: faced, firstSeq: ball.ballSequence, ballsFaced: 1 })
        strikerIndex = occupants.length - 1
      } else {
        // Two occupied crease slots, a new batter, no departure: this can
        // only be an unrecorded departure (e.g. a retirement the log does
        // not carry). The record still wins - the non-striker gives way -
        // but the fold stops claiming confirmation from here on.
        confirmed = false
        const retired = getNonStrikerIndex(occupants, strikerIndex)
        if (retired != null) occupants.splice(retired, 1)
        occupants.push({ id: faced, firstSeq: ball.ballSequence, ballsFaced: 1 })
        strikerIndex = occupants.length - 1
      }
    }

    const dismissalThisBall = ball.isWicket || ball.wicketType != null
    if (dismissalThisBall) {
      const strikerId = strikerIndex != null ? occupants[strikerIndex]!.id : null
      const nonStrikerId = getNonStrikerId(occupants, strikerIndex)
      const resolved = resolveWicketExit(ball, strikerId, nonStrikerId)
      if (resolved.needsReview) confirmed = false
      if (resolved.victimId != null) {
        const victimIndex = occupants.findIndex(occupant => occupant.id === resolved.victimId)
        if (victimIndex >= 0) {
          occupants.splice(victimIndex, 1)
          openSlots += 1
          if (strikerIndex === victimIndex) strikerIndex = null
          else if (strikerIndex != null && strikerIndex > victimIndex) strikerIndex -= 1
          else if (strikerIndex != null && !occupants[strikerIndex]) strikerIndex = occupants.length - 1
        } else {
          // Attribution named a batter the fold never saw at the crease.
          // Honour the record (a slot opens) and flag it.
          openSlots += 1
          confirmed = false
          strikerIndex = null
        }
      }
      lastDismissalSeq = ball.ballSequence
      // After a dismissal at the striker's end, who faces the NEXT ball (the
      // survivor or the incoming batter) is only confirmed by the next
      // recorded delivery - the pointer waits for the record.
      strikerIndex = resolved.victimWasNonStriker ? strikerIndex : null
      if (strikerIndex != null && !occupants[strikerIndex]) strikerIndex = null
      // An over-ending dismissal leaves the crossing ambiguous (the batters
      // may have swapped ends mid-pitch during the run), so the pointer waits
      // for the next record even when the NON-striker left.
      if (isLegalDeliveryFromFlags(ball) && ball.ballNumber === 6) strikerIndex = null
    } else if (occupants.length >= 2 && strikerIndex != null) {
      // Rotation only predicts; every later record re-syncs.
      const crossed = Math.max(0, ball.runs - (ball.isWide ? 1 : 0) - (ball.isNoBall ? 1 : 0))
      const endOfOver = isLegalDeliveryFromFlags(ball) && ball.ballNumber === 6
      const rotated = rotateStrike(
        { strikerId: occupants[strikerIndex]!.id, nonStrikerId: getNonStrikerId(occupants, strikerIndex)! },
        crossed,
        endOfOver,
      )
      if (rotated.rotated) {
        const nextStriker = occupants.findIndex(occupant => occupant.id === rotated.state.strikerId)
        if (nextStriker >= 0) strikerIndex = nextStriker
      }
    }

    // Bowler truth: the over in progress belongs to its most recent bowler.
    // A completed over (sixth legal delivery bowled, or a mid-over
    // interruption state the log ends on) has NO confirmed next bowler -
    // the completed over's bowler is kept separately as the boundary
    // anchor for bowler-introduction consumers.
    const overCompleted = isLegalDeliveryFromFlags(ball) && ball.ballNumber === 6
    if (ball.bowlerId != null) bowlerInOver = ball.bowlerId
    if (overCompleted) {
      previousOverBowlerId = bowlerInOver
    } else {
      previousOverBowlerId = null
    }
    overInProgress = !overCompleted
  }

  // An over that ended with an INCOMPLETE crease (fewer than two confirmed
  // occupants) cannot say who faced the other end: the over-end rotation has
  // no partner to swap with. Postpone the striker claim to the next record.
  if (strikerIndex != null && occupants.length < 2 && lastSequence != null && !overInProgress) {
    strikerIndex = null
  }

  const strikerId = strikerIndex != null ? occupants[strikerIndex]!.id : null
  const nonStrikerId = getNonStrikerId(occupants, strikerIndex)

  const incoming = lastDismissalSeq != null
    ? occupants
      .filter(occupant => occupant.firstSeq > lastDismissalSeq!
        && (lastSequence == null || occupant.firstSeq <= lastSequence))
      .filter(occupant => occupant.ballsFaced === 1)
      .map(occupant => occupant.id)
      .at(-1) ?? null
    : null

  return {
    strikerId,
    nonStrikerId,
    bowlerId: overInProgress ? bowlerInOver : null,
    previousOverBowlerId,
    incomingBatterId: incoming,
    creaseBatterIds: occupants.map(occupant => occupant.id),
    confirmed,
    lastBallSequence: lastSequence,
  }
}

function isLegalDeliveryFromFlags(ball: ParticipantBallInput): boolean {
  return !ball.isWide && !ball.isNoBall
}

function getNonStrikerIndex(occupants: readonly Occupant[], strikerIndex: number | null): number | null {
  if (occupants.length < 2) return null
  const index = occupants.findIndex((_, i) => i !== strikerIndex)
  return index >= 0 ? index : null
}

function getNonStrikerId(occupants: readonly Occupant[], strikerIndex: number | null): string | null {
  const index = getNonStrikerIndex(occupants, strikerIndex)
  return index != null ? occupants[index]!.id : null
}

type ResolvedWicketExit = {
  victimId: string | null
  victimWasNonStriker: boolean
  needsReview: boolean
}

/** Attribution precedence: the scorer's named out batter (already validated
 *  by the service's write access as a batting-team member, and for
 *  non-run-out types required to be the striker), then the rule default.
 *  An attribution naming a batter at neither end marks the fold unconfirmed
 *  instead of guessing why. */
function resolveWicketExit(
  ball: ParticipantBallInput,
  strikerId: string | null,
  nonStrikerId: string | null,
): ResolvedWicketExit {
  const wicketType = ball.wicketType
  if (ball.wicketPlayerOutId != null) {
    const named = ball.wicketPlayerOutId
    if (named === strikerId) return { victimId: named, victimWasNonStriker: false, needsReview: false }
    if (named === nonStrikerId) return { victimId: named, victimWasNonStriker: true, needsReview: false }
    return { victimId: named, victimWasNonStriker: false, needsReview: true }
  }
  if (wicketType != null && STRIKER_OUT_DEFAULT.has(wicketType) && strikerId != null) {
    return { victimId: strikerId, victimWasNonStriker: false, needsReview: false }
  }
  if (wicketType != null && strikerId != null && nonStrikerId != null) {
    // run_out / retired / retired_hurt without attribution: the policy
    // default is the striker, and the delivery-log self-healing corrects a
    // wrong default on the next recorded delivery.
    const exit = batterLeavingOnWicket(
      wicketType as Parameters<typeof batterLeavingOnWicket>[0],
      strikerId,
      nonStrikerId,
    )
    if ("outBatterId" in exit) {
      return { victimId: exit.outBatterId, victimWasNonStriker: exit.outBatterId === nonStrikerId, needsReview: false }
    }
    return { victimId: null, victimWasNonStriker: false, needsReview: true }
  }
  if (wicketType != null && strikerId != null) {
    return { victimId: strikerId, victimWasNonStriker: false, needsReview: false }
  }
  // A dismissal on a ball with no recorded batsman is not interpretable.
  return { victimId: null, victimWasNonStriker: false, needsReview: true }
}
