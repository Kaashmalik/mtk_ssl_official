import type { matches } from '@mtk/database';
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
