import type { MobileFixtureV1 } from "@mtk/contracts";

/**
 * ENH-03-03: a fixture on the device is EXACTLY what the mobile BFF projects
 * (`MobileFixtureV1`): an explicit, allowlisted shape delivered with RESOLVED
 * team names and the FULL lifecycle vocabulary — including `postponed` and
 * `forfeited`, which the old hand-copied union silently dropped. The legacy
 * per-team score slots below are kept as OPTIONAL presentation fields the
 * projection never fabricates (list screens already render them only when
 * present, which against the BFF is never — innings evidence comes from the
 * scoring state layer, not the fixtures feed).
 */
export type Match = MobileFixtureV1 & {
  team1Score?: number;
  team2Score?: number;
  team1Wickets?: number;
  team2Wickets?: number;
  team1Overs?: number;
  team2Overs?: number;
};

/**
 * One row of the canonical standings table served by
 * `GET /api/mobile/standings` — computed by the SHARED rule v2 fold
 * (apps/web/src/lib/standings.ts is the source of truth: 2/1/0 points,
 * balls-based net run rate, only completed/no-result fixtures counted as
 * played). The device renders rows; it never re-derives standings.
 */
export interface StandingRowV1 {
  ruleVersion: number;
  teamId: string;
  name: string;
  shortName: string;
  played: number;
  won: number;
  lost: number;
  noResult: number;
  points: number;
  runsFor: number;
  ballsFor: number;
  runsAgainst: number;
  ballsAgainst: number;
  netRunRate: number;
  hasNetRunRate: boolean;
}

export interface Player {
  id: string;
  name: string;
  teamId?: string;
  teamName?: string;
  jerseyNumber?: number;
  role?: string;
  battingStyle?: string;
  bowlingStyle?: string;
}

export interface BallData {
  id: string;
  matchId: string;
  innings: number;
  over: number;
  ball: number;
  runs: number;
  isWicket: boolean;
  wicketType?: string;
  batsmanId?: string;
  bowlerId?: string;
  timestamp: number;
  synced: boolean;
}
