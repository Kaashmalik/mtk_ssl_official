import type { matches } from '@mtk/database';

/**
 * Match-state shapes and cache decoding.
 *
 * Kept separate from `scoring.service.ts` so this module has no database, Redis,
 * or Kafka imports. That makes the cache decoder directly unit-testable — the
 * service itself cannot be imported in a test without booting all of its
 * infrastructure dependencies.
 *
 * The `@mtk/database` import is type-only, so nothing from the schema package is
 * required at runtime. That keeps this module importable from Jest, which does
 * not transform the workspace package's ESM build.
 */

/**
 * The `match_status` enum, derived from the Drizzle schema.
 *
 * Previously this was a hand-written four-value union
 * (`not_started | in_progress | completed | abandoned`) that matched no enum
 * member at all, with the call site hiding the mismatch behind an
 * `as MatchState['status']` cast. Any consumer comparing
 * `status === 'live'` was comparing against a value the type claimed was
 * impossible.
 */
export type MatchStatus = (typeof matches)['$inferSelect']['status'];

/**
 * Statuses accepted by the cache decoder, in enum order.
 *
 * Exhaustive by construction rather than by hope: `_Exhaustive` below fails the
 * build if `match_status` ever gains a member that is missing here. The original
 * hand-written union drifted silently — it was missing `cancelled` and
 * `no_result` — because nothing tied it to the enum.
 */
const VALID_MATCH_STATUSES = [
  'scheduled',
  'toss',
  'live',
  'innings_break',
  'completed',
  'abandoned',
  'cancelled',
  'no_result',
] as const satisfies readonly MatchStatus[];

/**
 * Compile-time exhaustiveness check.
 *
 * If a new status is added to the `match_status` enum, `StatusDrift` becomes a
 * non-`never` type and this assignment stops compiling — forcing the runtime
 * guard above to be updated in the same change.
 */
type StatusDrift = Exclude<MatchStatus, (typeof VALID_MATCH_STATUSES)[number]>;
const _exhaustive: StatusDrift extends never ? true : never = true;
void _exhaustive;

export interface Scorecard {
  matchId: string;
  innings: number;
  totalRuns: number;
  totalWickets: number;
  overs: number;
  balls: number;
  runRate: number;
}

export interface MatchState {
  matchId: string;
  status: MatchStatus;
  innings1?: Scorecard;
  innings2?: Scorecard;
  currentInnings: number;
}

/**
 * Runtime set built from the compile-time-checked tuple above.
 */
const VALID_MATCH_STATUS: ReadonlySet<string> = new Set<string>(VALID_MATCH_STATUSES);

function isScorecardShape(value: unknown): value is Scorecard {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.matchId === 'string' &&
    typeof s.innings === 'number' &&
    typeof s.totalRuns === 'number' &&
    typeof s.totalWickets === 'number' &&
    typeof s.overs === 'number' &&
    typeof s.balls === 'number' &&
    typeof s.runRate === 'number'
  );
}

/**
 * Runtime guard for values decoded from the Redis cache.
 *
 * `getMatchState` previously returned `JSON.parse(cached)` untyped straight out
 * of the method, so a stale, truncated, or tampered cache entry became the
 * authoritative match state and was broadcast to every WebSocket subscriber.
 *
 * Returns `null` for anything that does not conform; the caller then discards
 * the entry and recomputes from the database.
 */
export function parseCachedMatchState(raw: string): MatchState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const candidate = parsed as Record<string, unknown>;

  if (typeof candidate.matchId !== 'string') return null;
  if (
    typeof candidate.status !== 'string' ||
    !VALID_MATCH_STATUS.has(candidate.status)
  ) {
    return null;
  }
  if (typeof candidate.currentInnings !== 'number') return null;
  if (candidate.innings1 !== undefined && !isScorecardShape(candidate.innings1)) {
    return null;
  }
  if (candidate.innings2 !== undefined && !isScorecardShape(candidate.innings2)) {
    return null;
  }

  return {
    matchId: candidate.matchId,
    status: candidate.status as MatchStatus,
    currentInnings: candidate.currentInnings,
    ...(candidate.innings1 !== undefined
      ? { innings1: candidate.innings1 as Scorecard }
      : {}),
    ...(candidate.innings2 !== undefined
      ? { innings2: candidate.innings2 as Scorecard }
      : {}),
  };
}
