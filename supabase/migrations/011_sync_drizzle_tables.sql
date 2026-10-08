-- ============================================================================
-- Migration 011: Synchronize Drizzle Schema with SQL Migrations
-- ============================================================================
-- This migration creates the tables and enums defined in the Drizzle schema
-- but missing from the initial SQL migrations:
-- - Enums: followable_type, registration_status, registration_payment_status, dismissal_type
-- - Tables: fan_follows, league_registrations, player_ids, player_season_stats,
--           batting_scorecards, bowling_scorecards, fielding_scorecards

-- ============================================================================
-- ENUMS
-- ============================================================================
CREATE TYPE public.followable_type AS ENUM ('team', 'player', 'tournament');
CREATE TYPE public.registration_status AS ENUM ('pending', 'approved', 'rejected', 'withdrawn', 'waitlisted');
CREATE TYPE public.registration_payment_status AS ENUM ('unpaid', 'paid', 'refunded', 'waived');
CREATE TYPE public.dismissal_type AS ENUM (
  'bowled', 'caught', 'caught_behind', 'caught_and_bowled', 'lbw', 'run_out', 
  'stumped', 'hit_wicket', 'retired', 'retired_hurt', 'obstructing_field', 
  'timed_out', 'handled_ball', 'not_out'
);

-- ============================================================================
-- TABLES
-- ============================================================================

-- 1. Fan Follows
CREATE TABLE IF NOT EXISTS public.fan_follows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  followable_type public.followable_type NOT NULL,
  followable_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (user_id, followable_type, followable_id)
);

CREATE INDEX idx_fan_follows_tenant ON public.fan_follows(tenant_id);
CREATE INDEX idx_fan_follows_user ON public.fan_follows(user_id);

-- 2. League Registrations
CREATE TABLE IF NOT EXISTS public.league_registrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  status public.registration_status NOT NULL DEFAULT 'pending',
  registered_by UUID NOT NULL REFERENCES public.users(id),
  approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  registration_fee DECIMAL(10, 2) DEFAULT 0,
  payment_status public.registration_payment_status NOT NULL DEFAULT 'unpaid',
  payment_transaction_id TEXT,
  squad_player_ids UUID[] DEFAULT ARRAY[]::UUID[],
  notes TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (team_id, tournament_id)
);

CREATE INDEX idx_league_registrations_tenant ON public.league_registrations(tenant_id);
CREATE INDEX idx_league_registrations_tournament ON public.league_registrations(tournament_id);
CREATE INDEX idx_league_registrations_team ON public.league_registrations(team_id);

-- 3. Player IDs
CREATE TABLE IF NOT EXISTS public.player_ids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  sequence_number INTEGER NOT NULL,
  formatted_id TEXT NOT NULL,
  issue_date TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expiry_date TIMESTAMPTZ,
  is_valid BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (player_id, tenant_id),
  UNIQUE (formatted_id)
);

CREATE INDEX idx_player_ids_tenant ON public.player_ids(tenant_id);
CREATE INDEX idx_player_ids_player ON public.player_ids(player_id);

-- 4. Player Season Stats
CREATE TABLE IF NOT EXISTS public.player_season_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  matches_played INTEGER DEFAULT 0 NOT NULL,
  runs_scored INTEGER DEFAULT 0 NOT NULL,
  balls_faced INTEGER DEFAULT 0 NOT NULL,
  innings_batted INTEGER DEFAULT 0 NOT NULL,
  not_outs INTEGER DEFAULT 0 NOT NULL,
  fours INTEGER DEFAULT 0 NOT NULL,
  sixes INTEGER DEFAULT 0 NOT NULL,
  highest_score INTEGER DEFAULT 0 NOT NULL,
  is_highest_score_not_out BOOLEAN DEFAULT false NOT NULL,
  fifties INTEGER DEFAULT 0 NOT NULL,
  hundreds INTEGER DEFAULT 0 NOT NULL,
  ducks INTEGER DEFAULT 0 NOT NULL,
  batting_average DECIMAL(8, 2) DEFAULT 0,
  strike_rate DECIMAL(8, 2) DEFAULT 0,
  wickets_taken INTEGER DEFAULT 0 NOT NULL,
  overs_bowled DECIMAL(8, 1) DEFAULT 0,
  balls_bowled INTEGER DEFAULT 0 NOT NULL,
  runs_conceded INTEGER DEFAULT 0 NOT NULL,
  innings_bowled INTEGER DEFAULT 0 NOT NULL,
  maidens INTEGER DEFAULT 0 NOT NULL,
  bowling_average DECIMAL(8, 2) DEFAULT 0,
  economy_rate DECIMAL(8, 2) DEFAULT 0,
  bowling_strike_rate DECIMAL(8, 2) DEFAULT 0,
  best_bowling_wickets INTEGER DEFAULT 0 NOT NULL,
  best_bowling_runs INTEGER DEFAULT 0 NOT NULL,
  four_wicket_hauls INTEGER DEFAULT 0 NOT NULL,
  five_wicket_hauls INTEGER DEFAULT 0 NOT NULL,
  catches INTEGER DEFAULT 0 NOT NULL,
  run_outs INTEGER DEFAULT 0 NOT NULL,
  stumpings INTEGER DEFAULT 0 NOT NULL,
  last_updated_match_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (player_id, tournament_id)
);

CREATE INDEX idx_player_season_stats_tenant ON public.player_season_stats(tenant_id);
CREATE INDEX idx_player_season_stats_player ON public.player_season_stats(player_id);
CREATE INDEX idx_player_season_stats_tournament ON public.player_season_stats(tournament_id);

-- 5. Batting Scorecards
CREATE TABLE IF NOT EXISTS public.batting_scorecards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  innings_id UUID NOT NULL REFERENCES public.match_innings(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  batting_position INTEGER NOT NULL,
  runs INTEGER DEFAULT 0 NOT NULL,
  balls_faced INTEGER DEFAULT 0 NOT NULL,
  fours INTEGER DEFAULT 0 NOT NULL,
  sixes INTEGER DEFAULT 0 NOT NULL,
  strike_rate DECIMAL(8, 2) DEFAULT 0,
  dismissal_type public.dismissal_type DEFAULT 'not_out',
  bowler_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  fielder_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  dismissal_text TEXT,
  minutes_batted INTEGER,
  dot_balls INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (player_id, innings_id)
);

CREATE INDEX idx_batting_scorecards_tenant ON public.batting_scorecards(tenant_id);
CREATE INDEX idx_batting_scorecards_match ON public.batting_scorecards(match_id);
CREATE INDEX idx_batting_scorecards_innings ON public.batting_scorecards(innings_id);
CREATE INDEX idx_batting_scorecards_player ON public.batting_scorecards(player_id);

-- 6. Bowling Scorecards
CREATE TABLE IF NOT EXISTS public.bowling_scorecards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  innings_id UUID NOT NULL REFERENCES public.match_innings(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  bowling_position INTEGER NOT NULL,
  overs DECIMAL(5, 1) DEFAULT 0 NOT NULL,
  balls_bowled INTEGER DEFAULT 0 NOT NULL,
  maidens INTEGER DEFAULT 0 NOT NULL,
  runs_conceded INTEGER DEFAULT 0 NOT NULL,
  wickets INTEGER DEFAULT 0 NOT NULL,
  economy_rate DECIMAL(6, 2) DEFAULT 0,
  dot_balls INTEGER DEFAULT 0,
  wides INTEGER DEFAULT 0 NOT NULL,
  no_balls INTEGER DEFAULT 0 NOT NULL,
  fours_conceded INTEGER DEFAULT 0 NOT NULL,
  sixes_conceded INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (player_id, innings_id)
);

CREATE INDEX idx_bowling_scorecards_tenant ON public.bowling_scorecards(tenant_id);
CREATE INDEX idx_bowling_scorecards_match ON public.bowling_scorecards(match_id);
CREATE INDEX idx_bowling_scorecards_innings ON public.bowling_scorecards(innings_id);
CREATE INDEX idx_bowling_scorecards_player ON public.bowling_scorecards(player_id);

-- 7. Fielding Scorecards
CREATE TABLE IF NOT EXISTS public.fielding_scorecards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  catches INTEGER DEFAULT 0 NOT NULL,
  run_outs INTEGER DEFAULT 0 NOT NULL,
  stumpings INTEGER DEFAULT 0 NOT NULL,
  direct_hits INTEGER DEFAULT 0 NOT NULL,
  dropped_catches INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (player_id, match_id)
);

CREATE INDEX idx_fielding_scorecards_tenant ON public.fielding_scorecards(tenant_id);
CREATE INDEX idx_fielding_scorecards_match ON public.fielding_scorecards(match_id);
CREATE INDEX idx_fielding_scorecards_player ON public.fielding_scorecards(player_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================
CREATE TRIGGER update_league_registrations_updated_at BEFORE UPDATE ON league_registrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_player_season_stats_updated_at BEFORE UPDATE ON player_season_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE public.fan_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_season_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batting_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bowling_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fielding_scorecards ENABLE ROW LEVEL SECURITY;

-- Helper check function matches policy definitions (current_tenant_id() is defined in 001)
CREATE POLICY tenant_isolation_fan_follows ON public.fan_follows
  FOR ALL USING (tenant_id = ANY(current_tenant_id()));

CREATE POLICY tenant_isolation_league_registrations ON public.league_registrations
  FOR ALL USING (tenant_id = ANY(current_tenant_id()));

CREATE POLICY tenant_isolation_player_ids ON public.player_ids
  FOR ALL USING (tenant_id = ANY(current_tenant_id()));

CREATE POLICY tenant_isolation_player_season_stats ON public.player_season_stats
  FOR ALL USING (tenant_id = ANY(current_tenant_id()));

CREATE POLICY tenant_isolation_batting_scorecards ON public.batting_scorecards
  FOR ALL USING (tenant_id = ANY(current_tenant_id()));

CREATE POLICY tenant_isolation_bowling_scorecards ON public.bowling_scorecards
  FOR ALL USING (tenant_id = ANY(current_tenant_id()));

CREATE POLICY tenant_isolation_fielding_scorecards ON public.fielding_scorecards
  FOR ALL USING (tenant_id = ANY(current_tenant_id()));
