import {
  canonicalActiveParticipants,
  inningsShouldClose,
  type InningsClosureResult,
} from '@mtk/database/lib/cricket-rules-policy';

export { canonicalActiveParticipants };

/**
 * SCORE-10 (Batch 154): the cricket-rules fold, adapted for the canonical
 * scoring service. The SoT owns aggregate state, so the closure decision
 * lives here - computed from the JUST-UPDATED innings row inside the same
 * transaction, never from stale reads.
 *
 * Legacy, ungated matches assume a full XI when no declared count exists.
 * Armed matches pass the distinct active batting-side count from the SAME
 * locked participant validation that admitted the delivery. Full automatic
 * strike rotation is still not adjudicated SoT-side (only the next
 * delivered ball names the incoming batter), but ENH-03-02 now publishes
 * the canonical LAST-recorded striker/bowler state through
 * `canonicalActiveParticipants` - derived only from the delivered record,
 * never from client promises.
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
