-- Database Performance Optimization Migration
-- 1. Create optimized indexes for match_balls and match_innings
CREATE INDEX IF NOT EXISTS idx_match_balls_bowler_id ON match_balls(bowler_id);
CREATE INDEX IF NOT EXISTS idx_match_balls_batsman_id ON match_balls(batsman_id);
CREATE INDEX IF NOT EXISTS idx_match_balls_match_over ON match_balls(match_id, over_number);
CREATE INDEX IF NOT EXISTS idx_match_innings_match_id ON match_innings(match_id);

-- Fix player_season_stats schema mismatch (missing balls_bowled from Drizzle schema sync)
ALTER TABLE public.player_season_stats ADD COLUMN IF NOT EXISTS balls_bowled INTEGER DEFAULT 0 NOT NULL;

-- 2. Create All-Time Player Statistics Materialized View
CREATE MATERIALIZED VIEW IF NOT EXISTS player_all_time_stats AS
SELECT 
    tenant_id,
    player_id,
    sum(matches_played) as total_matches,
    sum(runs_scored) as total_runs,
    sum(balls_faced) as total_balls_faced,
    sum(fours) as total_fours,
    sum(sixes) as total_sixes,
    max(highest_score) as highest_score,
    sum(fifties) as total_fifties,
    sum(hundreds) as total_hundreds,
    sum(wickets_taken) as total_wickets,
    sum(balls_bowled) as total_balls_bowled,
    sum(runs_conceded) as total_runs_conceded,
    sum(catches) as total_catches,
    sum(run_outs) as total_run_outs,
    sum(stumpings) as total_stumpings,
    CASE 
        WHEN sum(balls_faced) > 0 THEN ROUND((sum(runs_scored)::decimal / sum(balls_faced)) * 100, 2)
        ELSE 0 
    END as career_strike_rate
FROM player_season_stats
GROUP BY tenant_id, player_id;

-- Create unique index required for CONCURRENT refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_all_time_stats_unique ON player_all_time_stats(player_id);

-- 3. Automate Materialized View Refreshes via statement trigger
CREATE OR REPLACE FUNCTION refresh_player_all_time_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Refresh the view in the background concurrently to avoid query locking
    REFRESH MATERIALIZED VIEW CONCURRENTLY player_all_time_stats;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_refresh_player_all_time_stats ON player_season_stats;

CREATE TRIGGER trigger_refresh_player_all_time_stats
AFTER INSERT OR UPDATE OR DELETE ON player_season_stats
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_player_all_time_stats();
