import { inningsShouldClose, type InningsClosureResult } from '@mtk/database/lib/cricket-rules-policy';

/**
 * SCORE-10 (Batch 154): the cricket-rules fold, adapted for the canonical
 * scoring service. The SoT owns aggregate state, so the closure decision
 * lives here - computed from the JUST-UPDATED innings row inside the same
 * transaction, never from stale reads.
 *
 * HONESTY (recorded, not faked): all-out assumes a full XI when no
 * declared-XI count is supplied (battingXICount null); short-declared-XI
 * closure follows the XI-declaration wiring (playing-xi policy exists;
 * wiring the count into this call is the recorded follow-up). Strike
 * rotation is client-owned today - batters are not tracked SoT-side, so
 * this module deliberately does NOT pretend to advise the next batter.
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
