import { parseCachedMatchState } from './match-state';

const MATCH = '00000000-0000-4000-8000-000000000001';
function innings(number = 1) {
  return {
    matchId: MATCH, innings: number,
    inningsId: '00000000-0000-4000-8000-000000000002',
    teamId: '00000000-0000-4000-8000-000000000003', status: 'in_progress',
    totalRuns: 120, totalWickets: 3, totalBalls: 110, overs: 18, balls: 2, runRate: 6.6,
    extras: 10, wides: 3, noBalls: 1, byes: 4, legByes: 2,
    updatedAt: '2026-10-12T12:00:00.000Z',
  };
}
function state() {
  return { version: 2, matchId: MATCH, status: 'live', currentInnings: 1,
    updatedAt: '2026-10-12T12:00:00.000Z', innings1: innings() };
}

describe('parseCachedMatchState v2', () => {
  it('accepts complete innings metadata and extras needed for fresh viewers', () => {
    expect(parseCachedMatchState(JSON.stringify(state()))).toEqual(state());
  });

  it.each(['scheduled', 'toss', 'live', 'innings_break', 'completed', 'abandoned', 'cancelled', 'no_result'])(
    'accepts database status %s', (status) => {
      expect(parseCachedMatchState(JSON.stringify({ ...state(), status }))).not.toBeNull();
    },
  );

  it('accepts a super-over snapshot', () => {
    expect(parseCachedMatchState(JSON.stringify({ ...state(), currentInnings: 3, superOver: innings(3) }))?.superOver?.innings).toBe(3);
  });

  it.each(['{not json', 'null', '42', '[]', '"text"'])('rejects invalid input %s', (raw) => {
    expect(parseCachedMatchState(raw)).toBeNull();
  });

  it('rejects the old numeric-only cache contract instead of forwarding an incomplete state', () => {
    expect(parseCachedMatchState(JSON.stringify({ matchId: MATCH, status: 'live', currentInnings: 1 }))).toBeNull();
  });

  it.each([
    { totalRuns: -1 }, { totalRuns: 1.5 }, { balls: 6 }, { runRate: null },
    { totalBalls: 109 }, { inningsId: undefined }, { extras: 121 }, { status: 'unknown' },
    { matchId: '00000000-0000-4000-8000-000000000099' }, { innings: 2 },
  ])('rejects corrupt or mismatched innings %s', (change) => {
    expect(parseCachedMatchState(JSON.stringify({ ...state(), innings1: { ...innings(), ...change } }))).toBeNull();
  });

  it('rejects a bad current innings or match status', () => {
    expect(parseCachedMatchState(JSON.stringify({ ...state(), currentInnings: 4 }))).toBeNull();
    expect(parseCachedMatchState(JSON.stringify({ ...state(), status: 'in_progress' }))).toBeNull();
  });

  it('drops unknown properties at both match and innings level', () => {
    const parsed = parseCachedMatchState(JSON.stringify({ ...state(), secret: 'private', innings1: { ...innings(), secret: 'private' } }));
    expect(parsed).not.toHaveProperty('secret');
    expect(parsed?.innings1).not.toHaveProperty('secret');
  });
});
