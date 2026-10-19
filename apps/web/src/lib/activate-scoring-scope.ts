"use client"

import { useScoringStore } from "@/stores/scoring-store"
import { scoringQueueKey, type ScoringQueueScope } from "./scoring-queue-scope"

/** Retain the old view for manual recovery; never adopt another identity's unsynced state. */
export function activateScoringScope(scope: ScoringQueueScope): void {
  const key = scoringQueueKey(scope)
  const previous = useScoringStore.getState()
  if (previous.queueScopeKey === key) return
  if (previous.matchId) {
    // Failure to retain old local work MUST stop the switch, not discard it.
    window.localStorage.setItem(`scoring-view-quarantine/${previous.queueScopeKey ?? "legacy"}/${previous.matchId}`,
      JSON.stringify({ matchId: previous.matchId, innings1: previous.innings1, innings2: previous.innings2,
        superOver: previous.superOver, handoverEpoch: previous.handoverEpoch, scoringRevision: previous.scoringRevision }))
  }
  previous.setMatchId("")
  useScoringStore.setState({ queueScopeKey: key })
}
