"use client"

import { useScoringStore } from "@/stores/scoring-store"
import { scoringQueueKey, type ScoringQueueScope } from "./scoring-queue-scope"

/**
 * Raised when the previous scoring view cannot be retained in local
 * storage (full quota, private-mode restrictions). The switch is stopped
 * DELIBERATELY — never silently discarding the scorer's prior work, never
 * adopting another identity's unsynced state — and the message is written
 * for the scorer, not for the console: the page surfaces it as the load
 * error verbatim.
 */
export class ScopingQuarantineError extends Error {
  constructor(cause: unknown) {
    super(
      "This device could not set the previous scoring view aside (storage is full or restricted), so the switch was stopped to keep your work safe. Free up space or sign in on this device again, then reload.",
    )
    this.name = "ScopingQuarantineError"
    this.cause = cause
  }
}

/** Retain the old view for manual recovery; never adopt another identity's unsynced state. */
export function activateScoringScope(scope: ScoringQueueScope): void {
  const key = scoringQueueKey(scope)
  const previous = useScoringStore.getState()
  if (previous.queueScopeKey === key) return
  if (previous.matchId) {
    // Failure to retain old local work MUST stop the switch, not discard
    // it (Batch 143: that stop is now deliberate and spoken, not an
    // accidental QuotaExceededError escaping into a generic load failure).
    try {
      localStorage.setItem(`scoring-view-quarantine/${previous.queueScopeKey ?? "legacy"}/${previous.matchId}`,
        JSON.stringify({ matchId: previous.matchId, innings1: previous.innings1, innings2: previous.innings2,
          superOver: previous.superOver, handoverEpoch: previous.handoverEpoch, scoringRevision: previous.scoringRevision }))
    } catch (err) {
      throw new ScopingQuarantineError(err)
    }
  }
  previous.setMatchId("")
  useScoringStore.setState({ queueScopeKey: key })
}
