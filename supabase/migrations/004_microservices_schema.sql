-- SSL Microservices Database Schema
-- Phase 3: Database Migration and Optimization

-- ============================================
-- Extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- Full-text search
CREATE EXTENSION IF NOT EXISTS "btree_gin";    -- Index optimization

-- ============================================
-- Tournament Service Tables
-- ============================================

ALTER TABLE public.tournaments 
  ADD COLUMN IF NOT EXISTS registration_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entry_fee DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prize_pool JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rules JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sponsors JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS live_stream_url TEXT,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;

-- Tournament standings (materialized for performance)
CREATE TABLE IF NOT EXISTS public.tournament_standings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  played INTEGER DEFAULT 0,
  won INTEGER DEFAULT 0,
  lost INTEGER DEFAULT 0,
  tied INTEGER DEFAULT 0,
  no_result INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  net_run_rate DECIMAL(6,3) DEFAULT 0,
  runs_scored INTEGER DEFAULT 0,
  overs_faced DECIMAL(5,1) DEFAULT 0,
  runs_conceded INTEGER DEFAULT 0,
  overs_bowled DECIMAL(5,1) DEFAULT 0,
  position INTEGER,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, team_id)
);

CREATE INDEX idx_standings_tournament ON public.tournament_standings(tournament_id);
CREATE INDEX idx_standings_position ON public.tournament_standings(tournament_id, position);

-- ============================================
-- Scoring Service Tables
-- ============================================

-- Enhanced ball events for real-time scoring
CREATE TABLE IF NOT EXISTS public.ball_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  inning INTEGER NOT NULL CHECK (inning IN (1, 2, 3, 4)),
  over_number INTEGER NOT NULL CHECK (over_number >= 0),
  ball_number INTEGER NOT NULL CHECK (ball_number BETWEEN 1 AND 10),
  batsman_id UUID NOT NULL REFERENCES public.players(id),
  non_striker_id UUID REFERENCES public.players(id),
  bowler_id UUID NOT NULL REFERENCES public.players(id),
  runs INTEGER DEFAULT 0 CHECK (runs >= 0 AND runs <= 7),
  extras_type TEXT CHECK (extras_type IN ('wide', 'no_ball', 'bye', 'leg_bye', 'penalty')),
  extras_runs INTEGER DEFAULT 0,
  is_wicket BOOLEAN DEFAULT FALSE,
  wicket_type TEXT CHECK (wicket_type IN (
    'bowled', 'caught', 'lbw', 'run_out', 'stumped', 
    'hit_wicket', 'handled_ball', 'obstructing_field', 
    'timed_out', 'retired_hurt', 'retired_out'
  )),
  wicket_player_id UUID REFERENCES public.players(id),
  fielder_id UUID REFERENCES public.players(id),
  shot_type TEXT,
  shot_region TEXT,
  is_boundary BOOLEAN DEFAULT FALSE,
  is_six BOOLEAN DEFAULT FALSE,
  ball_speed DECIMAL(5,2),
  commentary TEXT,
  video_timestamp INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id)
);

-- Indexes for real-time queries
CREATE INDEX idx_ball_events_match ON public.ball_events(match_id, inning, over_number, ball_number);
CREATE INDEX idx_ball_events_batsman ON public.ball_events(batsman_id);
CREATE INDEX idx_ball_events_bowler ON public.ball_events(bowler_id);
CREATE INDEX idx_ball_events_tenant ON public.ball_events(tenant_id);

-- Live scorecard (updated in real-time)
CREATE TABLE IF NOT EXISTS public.live_scorecards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE UNIQUE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  current_inning INTEGER DEFAULT 1,
  batting_team_id UUID REFERENCES public.teams(id),
  bowling_team_id UUID REFERENCES public.teams(id),
  
  -- Current score
  total_runs INTEGER DEFAULT 0,
  total_wickets INTEGER DEFAULT 0,
  total_overs DECIMAL(4,1) DEFAULT 0,
  run_rate DECIMAL(5,2) DEFAULT 0,
  
  -- Target info (for 2nd innings)
  target INTEGER,
  required_runs INTEGER,
  required_rate DECIMAL(5,2),
  
  -- Current batsmen
  striker_id UUID REFERENCES public.players(id),
  striker_runs INTEGER DEFAULT 0,
  striker_balls INTEGER DEFAULT 0,
  non_striker_id UUID REFERENCES public.players(id),
  non_striker_runs INTEGER DEFAULT 0,
  non_striker_balls INTEGER DEFAULT 0,
  
  -- Current bowler
  current_bowler_id UUID REFERENCES public.players(id),
  current_bowler_overs DECIMAL(3,1) DEFAULT 0,
  current_bowler_runs INTEGER DEFAULT 0,
  current_bowler_wickets INTEGER DEFAULT 0,
  
  -- Partnership
  partnership_runs INTEGER DEFAULT 0,
  partnership_balls INTEGER DEFAULT 0,
  
  -- Last ball info
  last_ball_runs INTEGER,
  last_ball_extras TEXT,
  last_ball_wicket BOOLEAN DEFAULT FALSE,
  
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_live_scorecard_tenant ON public.live_scorecards(tenant_id);

-- ============================================
-- Analytics Tables
-- ============================================

-- Player statistics (aggregated)
CREATE TABLE IF NOT EXISTS public.player_statistics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  season TEXT,
  format TEXT DEFAULT 'all',
  
  -- Batting stats
  matches_played INTEGER DEFAULT 0,
  innings_batted INTEGER DEFAULT 0,
  runs_scored INTEGER DEFAULT 0,
  balls_faced INTEGER DEFAULT 0,
  highest_score INTEGER DEFAULT 0,
  not_outs INTEGER DEFAULT 0,
  fours INTEGER DEFAULT 0,
  sixes INTEGER DEFAULT 0,
  fifties INTEGER DEFAULT 0,
  hundreds INTEGER DEFAULT 0,
  batting_average DECIMAL(6,2),
  strike_rate DECIMAL(6,2),
  
  -- Bowling stats
  innings_bowled INTEGER DEFAULT 0,
  overs_bowled DECIMAL(6,1) DEFAULT 0,
  runs_conceded INTEGER DEFAULT 0,
  wickets_taken INTEGER DEFAULT 0,
  best_bowling_wickets INTEGER DEFAULT 0,
  best_bowling_runs INTEGER DEFAULT 0,
  economy_rate DECIMAL(5,2),
  bowling_average DECIMAL(6,2),
  bowling_strike_rate DECIMAL(6,2),
  four_wicket_hauls INTEGER DEFAULT 0,
  five_wicket_hauls INTEGER DEFAULT 0,
  maidens INTEGER DEFAULT 0,
  
  -- Fielding stats
  catches INTEGER DEFAULT 0,
  stumpings INTEGER DEFAULT 0,
  run_outs INTEGER DEFAULT 0,
  
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, tenant_id, season, format)
);

CREATE INDEX idx_player_stats_player ON public.player_statistics(player_id);
CREATE INDEX idx_player_stats_tenant ON public.player_statistics(tenant_id);
CREATE INDEX idx_player_stats_runs ON public.player_statistics(runs_scored DESC);
CREATE INDEX idx_player_stats_wickets ON public.player_statistics(wickets_taken DESC);

-- ============================================
-- Payment Service Tables (Unified)
-- ============================================

CREATE TYPE public.payment_method AS ENUM ('jazzcash', 'easypaisa', 'stripe', 'bank_transfer');

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  subscription_id UUID, -- Will reference subscriptions(id) later in 007
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id),
  amount DECIMAL(12,2) NOT NULL,
  currency TEXT DEFAULT 'PKR',
  payment_method public.payment_method NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled')),
  transaction_id TEXT,
  external_payment_id TEXT,
  provider_response JSONB,
  commission_amount DECIMAL(10, 2),
  paid_at TIMESTAMPTZ,
  
  -- Payment context
  payment_type TEXT CHECK (payment_type IN ('tournament_registration', 'subscription', 'sponsorship', 'donation', 'other')),
  reference_id UUID,
  reference_type TEXT,
  
  description TEXT,
  metadata JSONB DEFAULT '{}',
  
  -- Refund info
  refunded_amount DECIMAL(12,2) DEFAULT 0,
  refund_reason TEXT,
  refunded_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_payments_tenant ON public.payments(tenant_id);
CREATE INDEX idx_payments_user ON public.payments(user_id);
CREATE INDEX idx_payments_status ON public.payments(status);
CREATE INDEX idx_payments_payment_method ON public.payments(payment_method);

-- ============================================
-- Notification Service Tables
-- ============================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id),
  
  type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('push', 'email', 'sms', 'in_app')),
  
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'read')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON public.notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_tenant ON public.notifications(tenant_id);
CREATE INDEX idx_notifications_status ON public.notifications(status);

-- User notification preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  
  push_enabled BOOLEAN DEFAULT TRUE,
  email_enabled BOOLEAN DEFAULT TRUE,
  sms_enabled BOOLEAN DEFAULT FALSE,
  
  match_updates BOOLEAN DEFAULT TRUE,
  score_alerts BOOLEAN DEFAULT TRUE,
  tournament_updates BOOLEAN DEFAULT TRUE,
  team_updates BOOLEAN DEFAULT TRUE,
  promotional BOOLEAN DEFAULT FALSE,
  
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tenant_id)
);

-- Push tokens
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT CHECK (platform IN ('ios', 'android', 'web')),
  device_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token)
);

CREATE INDEX idx_push_tokens_user ON public.push_tokens(user_id);

-- ============================================
-- AI Commentary Tables
-- ============================================

CREATE TABLE IF NOT EXISTS public.ai_commentary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  ball_event_id UUID REFERENCES public.ball_events(id),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  
  over_ball TEXT NOT NULL,
  commentary_en TEXT,
  commentary_ur TEXT,
  
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  model_version TEXT DEFAULT 'gpt-4o'
);

CREATE INDEX idx_ai_commentary_match ON public.ai_commentary(match_id);

-- ============================================
-- Audit Log
-- ============================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES public.tenants(id),
  user_id UUID REFERENCES public.users(id),
  
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  
  old_values JSONB,
  new_values JSONB,
  
  ip_address INET,
  user_agent TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant ON public.audit_logs(tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user ON public.audit_logs(user_id);

-- ============================================
-- Row Level Security
-- ============================================

ALTER TABLE public.tournament_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ball_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_commentary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies (example for tenant isolation)
CREATE POLICY tenant_isolation_standings ON public.tournament_standings
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_ball_events ON public.ball_events
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_scorecards ON public.live_scorecards
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_payments ON public.payments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY user_notifications ON public.notifications
  FOR SELECT USING (user_id = auth.uid() OR tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================
-- Functions for Real-time Updates
-- ============================================

-- Function to update live scorecard
CREATE OR REPLACE FUNCTION update_live_scorecard()
RETURNS TRIGGER AS $$
BEGIN
  -- Update runs, wickets, overs based on new ball event
  UPDATE public.live_scorecards
  SET 
    total_runs = total_runs + NEW.runs + COALESCE(NEW.extras_runs, 0),
    total_wickets = total_wickets + CASE WHEN NEW.is_wicket THEN 1 ELSE 0 END,
    total_overs = CASE 
      WHEN NEW.extras_type IN ('wide', 'no_ball') THEN total_overs
      ELSE NEW.over_number + (NEW.ball_number::decimal / 10)
    END,
    last_ball_runs = NEW.runs,
    last_ball_extras = NEW.extras_type,
    last_ball_wicket = NEW.is_wicket,
    updated_at = NOW()
  WHERE match_id = NEW.match_id AND current_inning = NEW.inning;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_scorecard
AFTER INSERT ON public.ball_events
FOR EACH ROW EXECUTE FUNCTION update_live_scorecard();

-- Function to calculate player statistics
CREATE OR REPLACE FUNCTION calculate_player_stats(p_player_id UUID, p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO public.player_statistics (player_id, tenant_id, season, format)
  VALUES (p_player_id, p_tenant_id, EXTRACT(YEAR FROM NOW())::TEXT, 'all')
  ON CONFLICT (player_id, tenant_id, season, format) 
  DO UPDATE SET
    runs_scored = (
      SELECT COALESCE(SUM(runs), 0) 
      FROM public.ball_events 
      WHERE batsman_id = p_player_id AND tenant_id = p_tenant_id
    ),
    balls_faced = (
      SELECT COUNT(*) 
      FROM public.ball_events 
      WHERE batsman_id = p_player_id AND tenant_id = p_tenant_id
        AND extras_type IS DISTINCT FROM 'wide'
    ),
    wickets_taken = (
      SELECT COUNT(*) 
      FROM public.ball_events 
      WHERE bowler_id = p_player_id AND tenant_id = p_tenant_id AND is_wicket = TRUE
    ),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Indexes for Performance
-- ============================================

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_matches_tenant_status ON public.matches(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tournaments_tenant_status ON public.tournaments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_players_tenant_team ON public.players(tenant_id, team_id);
