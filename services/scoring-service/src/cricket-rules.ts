import { inningsShouldClose, type InningsClosureResult } from '@mtk/database/lib/cricket-rules-policy';

/**
 * SCORE-10 (Batch 154): the cricket-rules fold, adapted for the canonical
 * scoring service. The SoT owns aggregate state, so the closure decision
 * lives here - computed from the JUST-UPDATED innings row inside the same
 * transaction, never from stale reads.
 *
 * Legacy, ungated matches assume a full XI when no declared count exists.
 * Armed matches pass the distinct active batting-side count from the SAME
 * locked participant validation that admitted the delivery. Strike
 * rotation was client-owned until Batch 100: canonical striker/non-striker
 * state is now folded by the service from the official delivery log
 * (`@mtk/database/lib/scoring-participants`) inside the recording
 * transaction, and exposed on every record/undo response behind
 * SCORING_PARTICIPANTS_READY. This module still does not advise the next
 * batter - the fold describes recorded participants; it never invents one.
 */

export type InningsAdviceInput = {
  inningsNumber: number;
  totalRuns: number;
  totalWickets: number;
  legalBalls: number;
  matchTotalOvers: number | null;
  firstInningsTotalRuns: number | null;
  battingXICount?: number | null;
};

export function assessInningsClosure(input: InningsAdviceInput): InningsClosureResult {
  const oversAllowed = input.matchTotalOvers ?? 20;
  const target =
    input.inningsNumber >= 2 && input.firstInningsTotalRuns != null
      ? input.firstInningsTotalRuns + 1
      : null;
  return inningsShouldClose({
    battingXICount: input.battingXICount && input.battingXICount > 0 ? input.battingXICount : 11,
    wicketsLost: input.totalWickets,
    oversAllowed,
    oversCompleted: Math.floor(input.legalBalls / 6),
    totalRuns: input.totalRuns,
    targetRuns: target,
  });
}
