import { assessInningsClosure } from './cricket-rules';

/**
 * SCORE-10 (Batch 154): the SoT-side innings-closure adapter. The decision
 * is the policy's; these pins fix the SoT-specific derivations: the
 * overs default when a match has no explicit limit, the second-innings
 * target is ALWAYS first-innings total + 1, and floor division of legal
 * balls is the completed-overs count (extras that are wides or no-balls
 * never count toward it).
 */
describe('SCORE-10 (Batch 154): SoT innings-closure adapter', () => {
  const base = {
    inningsNumber: 1,
    totalRuns: 60,
    totalWickets: 4,
    legalBalls: 74,
    matchTotalOvers: 20,
    firstInningsTotalRuns: null,
  };

  it('keeps an open innings open', () => {
    expect(assessInningsClosure(base)).toEqual({ closed: false, reason: 'innings_open' });
  });

  it('defaults the over limit when the match row carries none', () => {
    // 21 completed overs with no stored limit = exhausted at the default 20.
    expect(assessInningsClosure({ ...base, legalBalls: 126, matchTotalOvers: null })).toEqual({
      closed: true,
      reason: 'overs_exhausted',
    });
  });

  it('derives the chase target strictly as first-innings total + 1', () => {
    expect(
      assessInningsClosure({ ...base, inningsNumber: 2, firstInningsTotalRuns: 120, totalRuns: 119 }),
    ).toEqual({ closed: false, reason: 'innings_open' });
    expect(
      assessInningsClosure({ ...base, inningsNumber: 2, firstInningsTotalRuns: 120, totalRuns: 121 }),
    ).toEqual({ closed: true, reason: 'target_reached', winnerReachedTarget: true });
  });

  it('never lets a first innings chase a target it does not have', () => {
    expect(
      assessInningsClosure({ ...base, firstInningsTotalRuns: 120, totalRuns: 200 }),
    ).toEqual({ closed: false, reason: 'innings_open' });
  });

  it('counts completed overs by floor of legal balls, all-out at ten for a full XI', () => {
    expect(assessInningsClosure({ ...base, legalBalls: 120 })).toEqual({ closed: true, reason: 'overs_exhausted' });
    expect(assessInningsClosure({ ...base, totalWickets: 10 })).toEqual({ closed: true, reason: 'all_out' });
    // 119 legal balls with no other closure condition stays open.
    expect(assessInningsClosure({ ...base, legalBalls: 119 })).toEqual({ closed: false, reason: 'innings_open' });
  });
});
