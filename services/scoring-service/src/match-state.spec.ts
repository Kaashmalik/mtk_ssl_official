/**
 * Cache-decode contract for the scoring SoT's match state.
 *
 * `getMatchState` reads from Redis and, on a hit, returns the decoded value
 * directly — and that value is then broadcast over the WebSocket gateway to
 * every subscriber of `match:<id>`. A truncated, stale, or tampered cache entry
 * would therefore become the authoritative match state for all viewers.
 *
 * These tests pin the fail-closed behaviour of `parseCachedMatchState`.
 */

import { parseCachedMatchState } from './match-state';

/**
 * Written out independently of the implementation on purpose. If the spec read
 * the same constant the guard uses, adding a status to both would keep the test
 * green even if the guard itself were wrong. The full list is enforced against
 * the real enum at compile time by `_exhaustive` in `match-state.ts`.
 */
const EXPECTED_STATUSES = [
  'scheduled',
  'toss',
  'live',
  'innings_break',
  'completed',
  'abandoned',
  'cancelled',
  'no_result',
] as const;

function validScorecard(innings: number) {
  return {
    matchId: 'match-1',
    innings,
    totalRuns: 120,
    totalWickets: 3,
    overs: 18,
    balls: 2,
    runRate: 6.6,
  };
}

describe('parseCachedMatchState', () => {
  it('accepts a well-formed minimal state', () => {
    const raw = JSON.stringify({ matchId: 'match-1', status: 'live', currentInnings: 1 });
    expect(parseCachedMatchState(raw)).toEqual({
      matchId: 'match-1',
      status: 'live',
      currentInnings: 1,
    });
  });

  it('accepts every status the enum actually defines', () => {
    // Guards against the enum growing without the guard being updated. The old
    // hand-written union was missing `cancelled` and `no_result` entirely.
    for (const status of EXPECTED_STATUSES) {
      const raw = JSON.stringify({ matchId: 'm', status, currentInnings: 1 });
      expect(parseCachedMatchState(raw)).not.toBeNull();
    }
  });

  it('accepts optional innings scorecards', () => {
    const raw = JSON.stringify({
      matchId: 'match-1',
      status: 'innings_break',
      currentInnings: 2,
      innings1: validScorecard(1),
      innings2: validScorecard(2),
    });
    const parsed = parseCachedMatchState(raw);
    expect(parsed?.innings1?.totalRuns).toBe(120);
    expect(parsed?.innings2?.innings).toBe(2);
  });

  it('rejects malformed JSON', () => {
    expect(parseCachedMatchState('{not json')).toBeNull();
  });

  it('rejects non-object payloads', () => {
    expect(parseCachedMatchState('null')).toBeNull();
    expect(parseCachedMatchState('42')).toBeNull();
    expect(parseCachedMatchState('"a string"')).toBeNull();
    expect(parseCachedMatchState('[]')).toBeNull();
  });

  it('rejects a missing or non-string matchId', () => {
    expect(parseCachedMatchState(JSON.stringify({ status: 'live', currentInnings: 1 }))).toBeNull();
    expect(
      parseCachedMatchState(JSON.stringify({ matchId: 7, status: 'live', currentInnings: 1 })),
    ).toBeNull();
  });

  it('rejects a status outside the enum', () => {
    // The exact value the old, incorrect `MatchState.status` union asserted.
    expect(
      parseCachedMatchState(JSON.stringify({ matchId: 'm', status: 'not_started', currentInnings: 1 })),
    ).toBeNull();
    expect(
      parseCachedMatchState(JSON.stringify({ matchId: 'm', status: 'in_progress', currentInnings: 1 })),
    ).toBeNull();
  });

  it('rejects a non-numeric currentInnings', () => {
    expect(
      parseCachedMatchState(JSON.stringify({ matchId: 'm', status: 'live', currentInnings: '1' })),
    ).toBeNull();
  });

  it('rejects a partially-shaped innings scorecard', () => {
    const partial = { ...validScorecard(1), runRate: undefined };
    const raw = JSON.stringify({
      matchId: 'm',
      status: 'live',
      currentInnings: 1,
      innings1: partial,
    });
    expect(parseCachedMatchState(raw)).toBeNull();
  });

  it('does not let extra unknown fields through', () => {
    // Extra keys are dropped rather than forwarded, so a poisoned payload
    // cannot smuggle additional properties into the broadcast state.
    const raw = JSON.stringify({
      matchId: 'm',
      status: 'live',
      currentInnings: 1,
      adminOverride: true,
    });
    const parsed = parseCachedMatchState(raw);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('adminOverride');
  });
});
