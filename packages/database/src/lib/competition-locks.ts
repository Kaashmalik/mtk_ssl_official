/**
 * COMP-07 competition locks: an explicit league decision to freeze a
 * competition's fixtures.
 *
 * Engagement is EXPLICIT ONLY (`competition_locked_at` set by the audited
 * writer): completing or cancelling a competition never implicitly locks
 * it — other gates already cover ended fixtures, and recording a lock that
 * nobody placed would overclaim what the league decided.
 *
 * The lock is a league-administration decision (`settings:manage` ->
 * writer re-checks `league_owner`), deliberately ABOVE ordinary fixture
 * delegation: a match-level assignment can never freeze a competition.
 *
 * Decisions here are pure so every enforcement site derives the same
 * answer; the writer must still evaluate them under its own transaction.
 */

export type CompetitionLockState = {
  competitionLockedAt: Date | null
}

/** True only when the league explicitly locked the competition. */
export function competitionLocked(tournament: CompetitionLockState): boolean {
  return tournament.competitionLockedAt !== null
}

export const COMPETITION_LOCKED_MESSAGE =
  "Competition is locked: its fixtures are frozen by the league"

/** Fixture-management command kinds the lock blocks (mirrors the match
 * writer's command union). Broadcast controls (stream start/end) are NOT
 * competition edits and stay available on locked competitions. */
export type CompetitionCommandKind =
  | "create"
  | "update"
  | "cancel"
  | "reschedule"
  | "stream-start"
  | "stream-end"

export function competitionLockBlocks(kind: CompetitionCommandKind): boolean {
  return kind !== "stream-start" && kind !== "stream-end"
}

/** A fixture must never silently slide between a locked competition and
 * no competition (detach) while the lock stands. Enforcement sites pass
 * every tournament id the effective fixture state would touch. */
export function lockScopedTournamentIds(
  ids: (string | null | undefined)[],
): string[] {
  const out: string[] = []
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0 && !out.includes(id)) out.push(id)
  }
  return out
}
