import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, ClickHouseClient } from '@clickhouse/client';

export interface BallAnalytics {
  match_id: string;
  tenant_id: string;
  innings: number;
  over: number;
  ball: number;
  runs: number;
  is_wicket: boolean;
  is_four: boolean;
  is_six: boolean;
  is_wide: boolean;
  is_no_ball: boolean;
  batsman_id: string;
  bowler_id: string;
  shot_direction?: string;
  shot_type?: string;
  timestamp: string;
}

export interface PlayerAnalytics {
  player_id: string;
  tenant_id: string;
  match_id: string;
  innings: number;
  runs_scored: number;
  balls_faced: number;
  fours: number;
  sixes: number;
  wickets_taken: number;
  overs_bowled: number;
  runs_conceded: number;
  maidens: number;
  catches: number;
  stumpings: number;
  run_outs: number;
  timestamp: string;
}

@Injectable()
export class ClickhouseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClickhouseService.name);
  private client: ClickHouseClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const url = this.configService.get<string>('CLICKHOUSE_URL', 'http://localhost:8123');
    const username = this.configService.get<string>('CLICKHOUSE_USER', 'default');
    const password = this.configService.get<string>('CLICKHOUSE_PASSWORD', '');

    this.client = createClient({
      url,
      username,
      password,
      request_timeout: 30000,
    });

    this.logger.log(`ClickHouse client initialized: ${url}`);
    await this.createTables();
  }

  async onModuleDestroy() {
    await this.client?.close();
  }

  private async createTables() {
    if (!this.client) return;

    // Ball-by-ball events (primary analytics table)
    await this.client.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ball_events (
          match_id UUID,
          tenant_id UUID,
          innings UInt8,
          over UInt8,
          ball UInt8,
          runs UInt8,
          is_wicket Bool,
          is_four Bool,
          is_six Bool,
          is_wide Bool,
          is_no_ball Bool,
          batsman_id UUID,
          bowler_id UUID,
          shot_direction LowCardinality(String),
          shot_type LowCardinality(String),
          timestamp DateTime64(3)
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (tenant_id, match_id, timestamp)
        TTL timestamp + INTERVAL 2 YEAR
      `,
    });

    // Player performance per match
    await this.client.exec({
      query: `
        CREATE TABLE IF NOT EXISTS player_match_stats (
          player_id UUID,
          tenant_id UUID,
          match_id UUID,
          innings UInt8,
          runs_scored UInt16,
          balls_faced UInt16,
          fours UInt8,
          sixes UInt8,
          wickets_taken UInt8,
          overs_bowled Decimal(4,1),
          runs_conceded UInt16,
          maidens UInt8,
          catches UInt8,
          stumpings UInt8,
          run_outs UInt8,
          timestamp DateTime64(3)
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (tenant_id, player_id, timestamp)
        TTL timestamp + INTERVAL 2 YEAR
      `,
    });

    // Match summary aggregates
    await this.client.exec({
      query: `
        CREATE TABLE IF NOT EXISTS match_summaries (
          match_id UUID,
          tenant_id UUID,
          team_a_id UUID,
          team_b_id UUID,
          team_a_runs UInt16,
          team_a_wickets UInt8,
          team_a_overs Decimal(4,1),
          team_b_runs UInt16,
          team_b_wickets UInt8,
          team_b_overs Decimal(4,1),
          total_fours UInt8,
          total_sixes UInt8,
          total_extras UInt8,
          win_margin_runs UInt16,
          win_margin_wickets UInt8,
          match_duration_minutes UInt16,
          timestamp DateTime64(3)
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (tenant_id, timestamp, match_id)
        TTL timestamp + INTERVAL 3 YEAR
      `,
    });

    // Materialized view: batting averages by player
    await this.client.exec({
      query: `
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_player_batting
        ENGINE = SummingMergeTree()
        ORDER BY (tenant_id, player_id, toYYYYMM(timestamp))
        AS SELECT
          tenant_id,
          player_id,
          toYYYYMM(timestamp) as month,
          sum(runs_scored) as total_runs,
          sum(balls_faced) as total_balls,
          sum(fours) as total_fours,
          sum(sixes) as total_sixes,
          count() as innings_played
        FROM player_match_stats
        GROUP BY tenant_id, player_id, toYYYYMM(timestamp)
      `,
    });

    // Materialized view: bowler economy
    await this.client.exec({
      query: `
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_player_bowling
        ENGINE = SummingMergeTree()
        ORDER BY (tenant_id, player_id, toYYYYMM(timestamp))
        AS SELECT
          tenant_id,
          player_id,
          toYYYYMM(timestamp) as month,
          sum(wickets_taken) as total_wickets,
          sum(runs_conceded) as total_runs_conceded,
          sum(overs_bowled) as total_overs,
          sum(maidens) as total_maidens,
          count() as innings_bowled
        FROM player_match_stats
        GROUP BY tenant_id, player_id, toYYYYMM(timestamp)
      `,
    });

    this.logger.log('ClickHouse analytics tables initialized');
  }

  async insertBallEvents(events: BallAnalytics[]) {
    if (!this.client || events.length === 0) return;
    await this.client.insert({
      table: 'ball_events',
      values: events,
      format: 'JSONEachRow',
    });
  }

  async insertPlayerStats(stats: PlayerAnalytics[]) {
    if (!this.client || stats.length === 0) return;
    await this.client.insert({
      table: 'player_match_stats',
      values: stats,
      format: 'JSONEachRow',
    });
  }

  async queryTopRunScorers(tenantId: string, limit = 10) {
    if (!this.client) return [];
    const result = await this.client.query({
      query: `
        SELECT player_id, sum(total_runs) as career_runs, sum(total_balls) as career_balls,
               round(career_runs / greatest(career_balls, 1) * 100, 2) as strike_rate,
               sum(innings_played) as innings
        FROM mv_player_batting
        WHERE tenant_id = {tenantId:UUID}
        GROUP BY player_id
        ORDER BY career_runs DESC
        LIMIT {limit:UInt8}
      `,
      query_params: { tenantId, limit },
      format: 'JSONEachRow',
    });
    return await result.json();
  }

  async queryTopWicketTakers(tenantId: string, limit = 10) {
    if (!this.client) return [];
    const result = await this.client.query({
      query: `
        SELECT player_id, sum(total_wickets) as career_wickets,
               round(sum(total_runs_conceded) / greatest(sum(total_overs), 1), 2) as economy,
               sum(innings_bowled) as innings
        FROM mv_player_bowling
        WHERE tenant_id = {tenantId:UUID}
        GROUP BY player_id
        ORDER BY career_wickets DESC
        LIMIT {limit:UInt8}
      `,
      query_params: { tenantId, limit },
      format: 'JSONEachRow',
    });
    return await result.json();
  }

  async queryMatchRunRate(matchId: string) {
    if (!this.client) return [];
    const result = await this.client.query({
      query: `
        SELECT over, sum(runs) as runs_per_over,
               sum(is_wicket) as wickets_per_over,
               groupArray(runs) as ball_distribution
        FROM ball_events
        WHERE match_id = {matchId:UUID}
        GROUP BY over
        ORDER BY over
      `,
      query_params: { matchId },
      format: 'JSONEachRow',
    });
    return await result.json();
  }
}
