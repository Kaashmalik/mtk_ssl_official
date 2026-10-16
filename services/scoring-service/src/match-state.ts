import type { matches, matchInnings } from '@mtk/database';
import { decodeLiveMatchState, type LiveMatchState } from '@mtk/database/lib/live-scoring-state';

export type MatchStatus = (typeof matches)['$inferSelect']['status'];

/** Lightweight delivery result; full viewer hydration uses MatchState. */
export interface Scorecard {
  matchId: string;
  innings: number;
  totalRuns: number;
  totalWickets: number;
  overs: number;
  balls: number;
  runRate: number;
}

export type MatchState = LiveMatchState;

/** Explicit public numeric/state allowlist; no actor, contact or audit fields. */
export function buildMatchState(match: Pick<typeof matches.$inferSelect, 'id' | 'status' | 'updatedAt'>, innings: (typeof matchInnings.$inferSelect)[]): MatchState {
  const state: MatchState = { version: 2, matchId: match.id, status: match.status, currentInnings: 1, updatedAt: match.updatedAt.toISOString() };
  for (const inn of innings) {
    const scorecard = { matchId: match.id, innings: inn.inningsNumber, inningsId: inn.id, teamId: inn.teamId, status: inn.status,
      extras: inn.extras, wides: inn.wides, noBalls: inn.noBalls, byes: inn.byes, legByes: inn.legByes,
      totalBalls: inn.totalBalls, updatedAt: inn.updatedAt.toISOString(), totalRuns: inn.totalRuns, totalWickets: inn.totalWickets,
      overs: Math.floor(inn.totalBalls / 6), balls: inn.totalBalls % 6,
      runRate: inn.totalBalls > 0 ? (inn.totalRuns / (inn.totalBalls / 6)) : 0 };
    if (inn.inningsNumber === 1) state.innings1 = scorecard;
    else if (inn.inningsNumber === 2) state.innings2 = scorecard;
    else if (inn.inningsNumber === 3) state.superOver = scorecard;
    state.currentInnings = inn.inningsNumber;
  }
  return state;
}
type StatusDrift = Exclude<MatchStatus, MatchState['status']>;
const exhaustive: StatusDrift extends never ? true : never = true;
void exhaustive;

export function parseCachedMatchState(raw: string): MatchState | null {
  try {
    return decodeLiveMatchState(JSON.parse(raw));
  } catch {
    return null;
  }
}
