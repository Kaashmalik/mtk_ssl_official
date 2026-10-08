-- ====================================================
-- FILE: 007_create_admin_tables.sql
-- ====================================================

-- ============================================================================
-- Migration 006: Create Admin Tables
-- ============================================================================
-- This migration creates tables for super admin dashboard features:
-- - Subscriptions & Payments (revenue tracking)
-- - Announcements (global broadcasts)
-- - Feature Flags
-- - System Health & Error Logs
-- - Commission Rates
-- - White-label Approval Queue

-- ============================================================================
-- SUBSCRIPTIONS
-- ============================================================================
CREATE TYPE subscription_status AS ENUM ('active', 'canceled', 'past_due', 'trialing', 'paused');

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('free', 'pro', 'enterprise')),
  status subscription_status NOT NULL DEFAULT 'active',
  monthly_amount decimal(10, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'PKR',
  payment_method payment_method,
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_plan ON subscriptions(plan);

-- ============================================================================
-- PAYMENTS RELATION
-- ============================================================================
-- payments table is already defined in 004_microservices_schema.sql.
-- We alter it to add the reference to subscriptions.
ALTER TABLE public.payments 
  ADD CONSTRAINT fk_payments_subscription_id 
  FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL;

CREATE INDEX idx_payments_subscription_id ON public.payments(subscription_id);
CREATE INDEX idx_payments_paid_at ON public.payments(paid_at);

-- ============================================================================
-- ANNOUNCEMENTS
-- ============================================================================
CREATE TYPE announcement_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE announcement_type AS ENUM ('info', 'warning', 'success', 'error', 'maintenance');

CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  title text NOT NULL,
  message text NOT NULL,
  type announcement_type NOT NULL DEFAULT 'info',
  priority announcement_priority NOT NULL DEFAULT 'medium',
  is_active boolean NOT NULL DEFAULT true,
  target_audience text, -- 'all', 'pro', 'enterprise', or JSON array of tenant IDs
  start_date timestamptz,
  end_date timestamptz,
  action_url text,
  action_text text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcements_is_active ON announcements(is_active);
CREATE INDEX idx_announcements_dates ON announcements(start_date, end_date);

-- ============================================================================
-- FEATURE FLAGS
-- ============================================================================
CREATE TABLE feature_flags (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_enabled boolean NOT NULL DEFAULT false,
  rollout_percentage text DEFAULT '0',
  target_tenants jsonb, -- JSON array of tenant IDs, null = all tenants
  metadata jsonb, -- Additional config
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_feature_flags_key ON feature_flags(key);
CREATE INDEX idx_feature_flags_is_enabled ON feature_flags(is_enabled);

-- ============================================================================
-- SYSTEM HEALTH
-- ============================================================================
CREATE TYPE error_severity AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TABLE system_health (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  service text NOT NULL,
  status text NOT NULL CHECK (status IN ('healthy', 'degraded', 'down')),
  response_time integer,
  uptime integer,
  cpu_usage integer,
  memory_usage integer,
  active_connections integer,
  error_rate integer,
  last_checked timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_system_health_service ON system_health(service);
CREATE INDEX idx_system_health_status ON system_health(status);
CREATE INDEX idx_system_health_last_checked ON system_health(last_checked);

-- ============================================================================
-- ERROR LOGS
-- ============================================================================
CREATE TABLE error_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  service text NOT NULL,
  severity error_severity NOT NULL DEFAULT 'medium',
  error_type text,
  message text NOT NULL,
  stack_trace text,
  user_id uuid,
  tenant_id uuid,
  metadata text, -- JSON string
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_error_logs_service ON error_logs(service);
CREATE INDEX idx_error_logs_severity ON error_logs(severity);
CREATE INDEX idx_error_logs_is_resolved ON error_logs(is_resolved);
CREATE INDEX idx_error_logs_created_at ON error_logs(created_at DESC);

-- ============================================================================
-- COMMISSION RATES
-- ============================================================================
CREATE TABLE commission_rates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  plan text NOT NULL UNIQUE CHECK (plan IN ('free', 'pro', 'enterprise')),
  rate decimal(5, 2) NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert default commission rates
INSERT INTO commission_rates (plan, rate, description) VALUES
  ('free', 0.00, 'Free plan - no commission'),
  ('pro', 15.00, 'Pro plan - 15% commission'),
  ('enterprise', 10.00, 'Enterprise plan - 10% commission')
ON CONFLICT (plan) DO NOTHING;

-- ============================================================================
-- WHITE-LABEL REQUESTS
-- ============================================================================
CREATE TYPE white_label_status AS ENUM ('pending', 'approved', 'rejected', 'revoked');

CREATE TABLE white_label_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  status white_label_status NOT NULL DEFAULT 'pending',
  custom_domain text,
  hide_branding boolean NOT NULL DEFAULT false,
  custom_app_name text,
  reason text,
  admin_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_white_label_requests_tenant_id ON white_label_requests(tenant_id);
CREATE INDEX idx_white_label_requests_status ON white_label_requests(status);
CREATE INDEX idx_white_label_requests_requested_by ON white_label_requests(requested_by);



-- ====================================================
-- FILE: 008_white_label_enterprise.sql
-- ====================================================

-- ============================================================================
-- Migration 007: White-Label Enterprise Features
-- ============================================================================
-- This migration extends the white-label system with:
-- - DNS verification for custom domains
-- - SSL certificate management (Let's Encrypt)
-- - Email domain verification (DKIM/SPF)
-- - Separate database instance option
-- - Enhanced branding settings

-- ============================================================================
-- DNS VERIFICATION
-- ============================================================================
CREATE TYPE dns_verification_status AS ENUM ('pending', 'verified', 'failed', 'expired');

CREATE TABLE dns_verifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain text NOT NULL,
  verification_token text NOT NULL,
  verification_type text NOT NULL CHECK (verification_type IN ('txt', 'cname', 'a')),
  expected_value text NOT NULL,
  status dns_verification_status NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, domain)
);

CREATE INDEX idx_dns_verifications_tenant_id ON dns_verifications(tenant_id);
CREATE INDEX idx_dns_verifications_domain ON dns_verifications(domain);
CREATE INDEX idx_dns_verifications_status ON dns_verifications(status);
CREATE INDEX idx_dns_verifications_expires_at ON dns_verifications(expires_at);

-- ============================================================================
-- SSL CERTIFICATES
-- ============================================================================
CREATE TYPE ssl_certificate_status AS ENUM ('pending', 'issued', 'active', 'expired', 'revoked', 'failed');

CREATE TABLE ssl_certificates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain text NOT NULL,
  certificate_url text,
  private_key_url text, -- Encrypted storage reference
  issuer text DEFAULT 'letsencrypt',
  status ssl_certificate_status NOT NULL DEFAULT 'pending',
  issued_at timestamptz,
  expires_at timestamptz,
  auto_renew boolean NOT NULL DEFAULT true,
  last_renewed_at timestamptz,
  renewal_attempts integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, domain)
);

CREATE INDEX idx_ssl_certificates_tenant_id ON ssl_certificates(tenant_id);
CREATE INDEX idx_ssl_certificates_domain ON ssl_certificates(domain);
CREATE INDEX idx_ssl_certificates_status ON ssl_certificates(status);
CREATE INDEX idx_ssl_certificates_expires_at ON ssl_certificates(expires_at);

-- ============================================================================
-- EMAIL DOMAIN VERIFICATION
-- ============================================================================
CREATE TYPE email_verification_status AS ENUM ('pending', 'verified', 'failed', 'expired');

CREATE TABLE email_domain_verifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain text NOT NULL,
  sender_email text NOT NULL, -- e.g., no-reply@myleague.com
  dkim_public_key text,
  dkim_selector text DEFAULT 'default',
  spf_record text,
  dmarc_record text,
  status email_verification_status NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  last_checked_at timestamptz,
  verification_errors jsonb, -- Array of error messages
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, domain)
);

CREATE INDEX idx_email_domain_verifications_tenant_id ON email_domain_verifications(tenant_id);
CREATE INDEX idx_email_domain_verifications_domain ON email_domain_verifications(domain);
CREATE INDEX idx_email_domain_verifications_status ON email_domain_verifications(status);

-- ============================================================================
-- ENHANCED TENANT BRANDING
-- ============================================================================
-- Add new columns to tenant_branding table
ALTER TABLE tenant_branding
  ADD COLUMN IF NOT EXISTS email_sender_name text,
  ADD COLUMN IF NOT EXISTS email_sender_address text,
  ADD COLUMN IF NOT EXISTS login_page_background_url text,
  ADD COLUMN IF NOT EXISTS login_page_custom_html text,
  ADD COLUMN IF NOT EXISTS mobile_app_icon_url text,
  ADD COLUMN IF NOT EXISTS mobile_app_splash_url text,
  ADD COLUMN IF NOT EXISTS mobile_app_bundle_id text,
  ADD COLUMN IF NOT EXISTS mobile_app_package_name text,
  ADD COLUMN IF NOT EXISTS separate_database boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS database_instance_url text;

-- ============================================================================
-- CUSTOM DOMAIN CONFIGURATION
-- ============================================================================
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS custom_domain_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_domain_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS ssl_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_domain_verified boolean NOT NULL DEFAULT false;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
CREATE TRIGGER update_dns_verifications_updated_at BEFORE UPDATE ON dns_verifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ssl_certificates_updated_at BEFORE UPDATE ON ssl_certificates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_domain_verifications_updated_at BEFORE UPDATE ON email_domain_verifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();



-- ====================================================
-- FILE: 009_fantasy_cricket.sql
-- ====================================================

-- Fantasy Cricket Migration
-- Adds support for fantasy league management

CREATE TYPE fantasy_status AS ENUM ('draft', 'active', 'completed', 'cancelled');

CREATE TABLE fantasy_leagues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  max_teams INTEGER NOT NULL DEFAULT 20,
  entry_fee DECIMAL(10,2) DEFAULT 0,
  prize_pool DECIMAL(12,2) DEFAULT 0,
  status fantasy_status NOT NULL DEFAULT 'draft',
  draft_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE fantasy_teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES fantasy_leagues(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  total_points INTEGER DEFAULT 0 NOT NULL,
  rank INTEGER,
  budget_remaining DECIMAL(10,2) DEFAULT 100000,
  is_paid BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE fantasy_team_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fantasy_team_id UUID NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('batsman', 'bowler', 'all-rounder', 'wicket-keeper')),
  is_captain BOOLEAN DEFAULT FALSE NOT NULL,
  is_vice_captain BOOLEAN DEFAULT FALSE NOT NULL,
  cost DECIMAL(10,2) NOT NULL,
  total_points INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (fantasy_team_id, player_id)
);

CREATE TABLE fantasy_points_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  points INTEGER NOT NULL,
  multiplier DECIMAL(3,1) DEFAULT 1.0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE fantasy_match_points (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL,
  fantasy_team_id UUID NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL,
  points INTEGER NOT NULL,
  breakdown TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_fantasy_leagues_tenant ON fantasy_leagues(tenant_id);
CREATE INDEX idx_fantasy_teams_league ON fantasy_teams(league_id);
CREATE INDEX idx_fantasy_team_players_team ON fantasy_team_players(fantasy_team_id);
CREATE INDEX idx_fantasy_match_points_team ON fantasy_match_points(fantasy_team_id);

-- Enable RLS
ALTER TABLE fantasy_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE fantasy_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE fantasy_team_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE fantasy_match_points ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY tenant_isolation_fantasy_leagues ON fantasy_leagues USING (tenant_id = current_setting('app.current_tenant')::UUID);
CREATE POLICY tenant_isolation_fantasy_teams ON fantasy_teams USING (tenant_id = current_setting('app.current_tenant')::UUID);
CREATE POLICY tenant_isolation_fantasy_players ON fantasy_team_players USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Default scoring rules
INSERT INTO fantasy_points_rules (tenant_id, event, points, multiplier, description) VALUES
  ('00000000-0000-0000-0000-000000000000', 'run', 1, 1.0, 'Every run scored'),
  ('00000000-0000-0000-0000-000000000000', 'four', 1, 1.0, 'Bonus for hitting a four'),
  ('00000000-0000-0000-0000-000000000000', 'six', 2, 1.0, 'Bonus for hitting a six'),
  ('00000000-0000-0000-0000-000000000000', 'wicket', 25, 1.0, 'Wicket taken (bowler)'),
  ('00000000-0000-0000-0000-000000000000', 'catch', 10, 1.0, 'Catch taken'),
  ('00000000-0000-0000-0000-000000000000', 'stumping', 15, 1.0, 'Stumping'),
  ('00000000-0000-0000-0000-000000000000', 'run_out', 10, 1.0, 'Direct run out'),
  ('00000000-0000-0000-0000-000000000000', 'duck', -5, 1.0, 'Out for zero'),
  ('00000000-0000-0000-0000-000000000000', 'maidens', 10, 1.0, 'Maiden over bowled'),
  ('00000000-0000-0000-0000-000000000000', 'fifty', 10, 1.0, 'Half century'),
  ('00000000-0000-0000-0000-000000000000', 'century', 25, 1.0, 'Century');


-- ====================================================
-- FILE: 010_event_store_cqrs.sql
-- ====================================================

-- CQRS Event Store Schema for Scoring
-- Immutable ball-by-ball log for audit trail and event sourcing

CREATE TYPE event_type AS ENUM (
  'ball_recorded',
  'ball_undone',
  'innings_started',
  'innings_completed',
  'match_started',
  'match_completed',
  'player_substituted',
  'penalty_awarded'
);

CREATE TABLE scoring_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  innings_id UUID,
  event_type event_type NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  aggregate_id UUID NOT NULL, -- match_id for match-level events, innings_id for innings
  sequence_number BIGINT NOT NULL, -- strict ordering within aggregate
  payload JSONB NOT NULL, -- immutable event data
  metadata JSONB, -- scorer info, device, timestamp precision
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (aggregate_id, sequence_number)
);

-- Partition by match for massive scale (10M+ events/month)
CREATE INDEX idx_scoring_events_match ON scoring_events(match_id, sequence_number);
CREATE INDEX idx_scoring_events_aggregate ON scoring_events(aggregate_id, sequence_number);
CREATE INDEX idx_scoring_events_type ON scoring_events(event_type, created_at);
CREATE INDEX idx_scoring_events_tenant ON scoring_events(tenant_id, created_at);

-- GIN index for JSONB payload queries (e.g., find all sixes)
CREATE INDEX idx_scoring_events_payload ON scoring_events USING GIN (payload jsonb_path_ops);

-- Projection / Read Model: materialized scorecard
CREATE TABLE scorecard_projections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  innings_id UUID NOT NULL,
  innings_number INTEGER NOT NULL,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  
  -- Aggregates (fast read model)
  total_runs INTEGER DEFAULT 0 NOT NULL,
  total_wickets INTEGER DEFAULT 0 NOT NULL,
  total_balls INTEGER DEFAULT 0 NOT NULL,
  total_extras INTEGER DEFAULT 0 NOT NULL,
  wides INTEGER DEFAULT 0 NOT NULL,
  no_balls INTEGER DEFAULT 0 NOT NULL,
  byes INTEGER DEFAULT 0 NOT NULL,
  leg_byes INTEGER DEFAULT 0 NOT NULL,
  
  -- Current state
  current_over INTEGER DEFAULT 0 NOT NULL,
  current_ball INTEGER DEFAULT 0 NOT NULL,
  
  -- Event store position (for consistency)
  last_event_sequence BIGINT NOT NULL DEFAULT 0,
  
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  UNIQUE (match_id, innings_id)
);

CREATE INDEX idx_scorecard_projections_match ON scorecard_projections(match_id);

-- Function: apply scoring event and update projection atomically
CREATE OR REPLACE FUNCTION apply_scoring_event()
RETURNS TRIGGER AS $$
DECLARE
  proj RECORD;
  ball_runs INTEGER;
  ball_wickets INTEGER;
  ball_balls INTEGER;
  ball_extras INTEGER;
BEGIN
  -- Skip if projection already at this sequence
  SELECT * INTO proj FROM scorecard_projections 
  WHERE innings_id = NEW.aggregate_id 
  FOR UPDATE SKIP LOCKED;
  
  IF proj IS NULL THEN
    RETURN NEW;
  END IF;
  
  IF NEW.sequence_number <= proj.last_event_sequence THEN
    RETURN NEW; -- already applied
  END IF;
  
  IF NEW.event_type = 'ball_recorded' THEN
    ball_runs := COALESCE((NEW.payload->>'runs')::INTEGER, 0);
    ball_wickets := CASE WHEN (NEW.payload->>'is_wicket')::BOOLEAN THEN 1 ELSE 0 END;
    ball_balls := CASE WHEN NOT COALESCE((NEW.payload->>'is_wide')::BOOLEAN, false) 
                        AND NOT COALESCE((NEW.payload->>'is_no_ball')::BOOLEAN, false) 
                       THEN 1 ELSE 0 END;
    ball_extras := ball_runs - COALESCE((NEW.payload->>'batsman_runs')::INTEGER, ball_runs);
    
    UPDATE scorecard_projections SET
      total_runs = total_runs + ball_runs,
      total_wickets = total_wickets + ball_wickets,
      total_balls = total_balls + ball_balls,
      total_extras = total_extras + GREATEST(ball_extras, 0),
      wides = wides + CASE WHEN (NEW.payload->>'is_wide')::BOOLEAN THEN 1 ELSE 0 END,
      no_balls = no_balls + CASE WHEN (NEW.payload->>'is_no_ball')::BOOLEAN THEN 1 ELSE 0 END,
      byes = byes + CASE WHEN (NEW.payload->>'is_bye')::BOOLEAN THEN ball_runs ELSE 0 END,
      leg_byes = leg_byes + CASE WHEN (NEW.payload->>'is_leg_bye')::BOOLEAN THEN ball_runs ELSE 0 END,
      current_over = (total_balls + ball_balls) / 6,
      current_ball = (total_balls + ball_balls) % 6,
      last_event_sequence = NEW.sequence_number,
      updated_at = NOW()
    WHERE innings_id = NEW.aggregate_id;
    
  ELSIF NEW.event_type = 'ball_undone' THEN
    ball_runs := COALESCE((NEW.payload->>'runs')::INTEGER, 0);
    ball_wickets := CASE WHEN (NEW.payload->>'is_wicket')::BOOLEAN THEN 1 ELSE 0 END;
    ball_balls := CASE WHEN NOT COALESCE((NEW.payload->>'is_wide')::BOOLEAN, false) 
                        AND NOT COALESCE((NEW.payload->>'is_no_ball')::BOOLEAN, false) 
                       THEN 1 ELSE 0 END;
    
    UPDATE scorecard_projections SET
      total_runs = GREATEST(0, total_runs - ball_runs),
      total_wickets = GREATEST(0, total_wickets - ball_wickets),
      total_balls = GREATEST(0, total_balls - ball_balls),
      last_event_sequence = NEW.sequence_number,
      updated_at = NOW()
    WHERE innings_id = NEW.aggregate_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_apply_scoring_event
  AFTER INSERT ON scoring_events
  FOR EACH ROW
  EXECUTE FUNCTION apply_scoring_event();

-- RLS
ALTER TABLE scoring_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_events ON scoring_events USING (tenant_id = current_setting('app.current_tenant')::UUID);


-- ====================================================
-- FILE: 011_sync_drizzle_tables.sql
-- ====================================================

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


-- ====================================================
-- FILE: 012_fix_indexes_and_fks.sql
-- ====================================================

-- ============================================================================
-- Migration 012: Add Missing Indexes and Foreign Keys
-- ============================================================================
-- This migration adds performance indexes and foreign key constraints that
-- were missing in the fantasy cricket and CQRS projections tables.

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Indexes on tenant_id for fantasy tables
CREATE INDEX IF NOT EXISTS idx_fantasy_team_players_tenant ON public.fantasy_team_players(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_points_rules_tenant ON public.fantasy_points_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_match_points_tenant ON public.fantasy_match_points(tenant_id);

-- Index on tenant_id for scorecard projections
CREATE INDEX IF NOT EXISTS idx_scorecard_projections_tenant ON public.scorecard_projections(tenant_id);

-- ============================================================================
-- FOREIGN KEY CONSTRAINTS
-- ============================================================================

-- Add FK on fantasy_team_players.player_id
ALTER TABLE public.fantasy_team_players
  ADD CONSTRAINT fk_fantasy_team_players_player_id
  FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

-- Add FK on fantasy_match_points.match_id
ALTER TABLE public.fantasy_match_points
  ADD CONSTRAINT fk_fantasy_match_points_match_id
  FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;

-- Add FK on fantasy_match_points.player_id
ALTER TABLE public.fantasy_match_points
  ADD CONSTRAINT fk_fantasy_match_points_player_id
  FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


-- ====================================================
-- FILE: 013_fix_rls_gaps.sql
-- ====================================================

-- ============================================================================
-- Migration 013: Enable RLS and Create Policies for Unprotected Tables
-- ============================================================================
-- This migration enables Row Level Security (RLS) on all remaining unprotected
-- tables (admin dashboard, white-label, fantasy, CQRS) and defines policies
-- for tenant data isolation and super-admin management.

-- ============================================================================
-- 1. ADMIN DASHBOARD TABLES
-- ============================================================================

-- Subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_subscriptions" ON public.subscriptions FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_subscriptions" ON public.subscriptions FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Payments (super admin override policy, tenant isolation is defined in 004/014)
CREATE POLICY "super_admin_all_payments" ON public.payments FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Announcements
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_announcements" ON public.announcements FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "public_read_announcements" ON public.announcements FOR SELECT USING (is_active = true);

-- Feature Flags
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_feature_flags" ON public.feature_flags FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "public_read_feature_flags" ON public.feature_flags FOR SELECT USING (is_enabled = true);

-- System Health
ALTER TABLE public.system_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_system_health" ON public.system_health FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Error Logs
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_error_logs" ON public.error_logs FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "anonymous_insert_error_logs" ON public.error_logs FOR INSERT WITH CHECK (true);

-- Commission Rates
ALTER TABLE public.commission_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_commission_rates" ON public.commission_rates FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "public_read_commission_rates" ON public.commission_rates FOR SELECT USING (is_active = true);

-- White-label Requests
ALTER TABLE public.white_label_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_white_label" ON public.white_label_requests FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_manage_white_label" ON public.white_label_requests FOR ALL USING (tenant_id = ANY(current_tenant_id())) WITH CHECK (tenant_id = ANY(current_tenant_id()));

-- ============================================================================
-- 2. WHITE-LABEL INFRASTRUCTURE TABLES
-- ============================================================================

-- DNS Verifications
ALTER TABLE public.dns_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_dns" ON public.dns_verifications FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_dns" ON public.dns_verifications FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- SSL Certificates
ALTER TABLE public.ssl_certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_ssl" ON public.ssl_certificates FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_ssl" ON public.ssl_certificates FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Email Domain Verifications
ALTER TABLE public.email_domain_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_email_domain" ON public.email_domain_verifications FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_email_domain" ON public.email_domain_verifications FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- ============================================================================
-- 3. FANTASY & CQRS TABLES
-- ============================================================================

-- Scorecard Projections
ALTER TABLE public.scorecard_projections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_projections" ON public.scorecard_projections FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_projections" ON public.scorecard_projections FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Fantasy Points Rules
ALTER TABLE public.fantasy_points_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_fantasy_rules" ON public.fantasy_points_rules FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "public_read_fantasy_rules" ON public.fantasy_points_rules FOR SELECT USING (true);

-- Fantasy Match Points (RLS enabled in 009, policy added here)
CREATE POLICY "super_admin_all_fantasy_match_points" ON public.fantasy_match_points FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_fantasy_match_points" ON public.fantasy_match_points FOR SELECT USING (tenant_id = ANY(current_tenant_id()));


-- ====================================================
-- FILE: 014_unify_rls_strategy.sql
-- ====================================================

-- ============================================================================
-- Migration 014: Unify RLS Tenant Isolation Strategy
-- ============================================================================
-- This migration standardizes the RLS tenant isolation policies by dropping
-- session-based policies (using current_setting('app.tenant_id') or 
-- current_setting('app.current_tenant')) and replacing them with policies
-- based on the secure current_tenant_id() JWT helper function.
--
-- It also adds missing policies for tables that had RLS enabled but no
-- policies defined.

-- ============================================================================
-- 1. DROP SESSION-BASED POLICIES
-- ============================================================================

-- Microservices tables (004)
DROP POLICY IF EXISTS tenant_isolation_standings ON public.tournament_standings;
DROP POLICY IF EXISTS tenant_isolation_ball_events ON public.ball_events;
DROP POLICY IF EXISTS tenant_isolation_scorecards ON public.live_scorecards;
DROP POLICY IF EXISTS tenant_isolation_payments ON public.payments;
DROP POLICY IF EXISTS user_notifications ON public.notifications;

-- Fantasy tables (009)
DROP POLICY IF EXISTS tenant_isolation_fantasy_leagues ON public.fantasy_leagues;
DROP POLICY IF EXISTS tenant_isolation_fantasy_teams ON public.fantasy_teams;
DROP POLICY IF EXISTS tenant_isolation_fantasy_players ON public.fantasy_team_players;

-- CQRS Event Store (010)
DROP POLICY IF EXISTS tenant_isolation_events ON public.scoring_events;

-- ============================================================================
-- 2. CREATE STANDARD TENANT-ISOLATION POLICIES (current_tenant_id())
-- ============================================================================

-- Tournament Standings
CREATE POLICY "super_admin_all_standings" ON public.tournament_standings FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_standings" ON public.tournament_standings FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Ball Events
CREATE POLICY "super_admin_all_ball_events" ON public.ball_events FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_ball_events" ON public.ball_events FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
-- Allow authorized scorers to insert/update ball events
CREATE POLICY "scorer_manage_ball_events" ON public.ball_events 
  FOR ALL USING (tenant_id = ANY(current_tenant_id())) 
  WITH CHECK (tenant_id = ANY(current_tenant_id()));

-- Live Scorecards
CREATE POLICY "super_admin_all_scorecards" ON public.live_scorecards FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_scorecards" ON public.live_scorecards FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
CREATE POLICY "scorer_manage_scorecards" ON public.live_scorecards 
  FOR ALL USING (tenant_id = ANY(current_tenant_id())) 
  WITH CHECK (tenant_id = ANY(current_tenant_id()));

-- Unified Payments
CREATE POLICY "tenant_isolation_payments" ON public.payments FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
-- Allow inserting payments for their own tenant
CREATE POLICY "tenant_insert_payments" ON public.payments FOR INSERT WITH CHECK (tenant_id = ANY(current_tenant_id()));

-- Notifications
CREATE POLICY "super_admin_all_notifications" ON public.notifications FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_notifications" ON public.notifications 
  FOR SELECT USING (user_id = auth.uid() OR tenant_id = ANY(current_tenant_id()));

-- Player Statistics
CREATE POLICY "super_admin_all_player_stats" ON public.player_statistics FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_player_stats" ON public.player_statistics FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Notification Preferences
CREATE POLICY "super_admin_all_notif_pref" ON public.notification_preferences FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "user_manage_notif_pref" ON public.notification_preferences 
  FOR ALL USING (user_id = auth.uid() AND tenant_id = ANY(current_tenant_id()))
  WITH CHECK (user_id = auth.uid() AND tenant_id = ANY(current_tenant_id()));

-- Push Tokens
CREATE POLICY "super_admin_all_push_tokens" ON public.push_tokens FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "user_manage_push_tokens" ON public.push_tokens 
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- AI Commentary
CREATE POLICY "super_admin_all_commentary" ON public.ai_commentary FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_commentary" ON public.ai_commentary FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Audit Logs
CREATE POLICY "super_admin_all_audit_logs" ON public.audit_logs FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_audit_logs" ON public.audit_logs FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Fantasy Leagues
CREATE POLICY "super_admin_all_fantasy_leagues" ON public.fantasy_leagues FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_fantasy_leagues" ON public.fantasy_leagues FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Fantasy Teams
CREATE POLICY "super_admin_all_fantasy_teams" ON public.fantasy_teams FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_fantasy_teams" ON public.fantasy_teams FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
CREATE POLICY "user_manage_fantasy_teams" ON public.fantasy_teams 
  FOR ALL USING (owner_id = auth.uid() AND tenant_id = ANY(current_tenant_id()))
  WITH CHECK (owner_id = auth.uid() AND tenant_id = ANY(current_tenant_id()));

-- Fantasy Team Players
CREATE POLICY "super_admin_all_fantasy_players" ON public.fantasy_team_players FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_fantasy_players" ON public.fantasy_team_players FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
-- Allow users to manage players in their own fantasy teams
CREATE POLICY "user_manage_fantasy_players" ON public.fantasy_team_players
  FOR ALL USING (
    tenant_id = ANY(current_tenant_id()) AND 
    fantasy_team_id IN (SELECT id FROM public.fantasy_teams WHERE owner_id = auth.uid())
  )
  WITH CHECK (
    tenant_id = ANY(current_tenant_id()) AND 
    fantasy_team_id IN (SELECT id FROM public.fantasy_teams WHERE owner_id = auth.uid())
  );

-- CQRS Event Store (scoring_events)
CREATE POLICY "super_admin_all_events" ON public.scoring_events FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_events" ON public.scoring_events FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
CREATE POLICY "scorer_insert_events" ON public.scoring_events FOR INSERT WITH CHECK (tenant_id = ANY(current_tenant_id()));


-- ====================================================
-- FILE: 015_create_commentary_events.sql
-- ====================================================

-- Create commentary_events table
CREATE TABLE IF NOT EXISTS public.commentary_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  over_number INT NOT NULL,
  ball_number INT NOT NULL,
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  tone VARCHAR(50) NOT NULL DEFAULT 'neutral',
  text TEXT NOT NULL,
  is_ai_generated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_commentary_events_match_id ON public.commentary_events(match_id);
CREATE INDEX IF NOT EXISTS idx_commentary_events_tenant_id ON public.commentary_events(tenant_id);

-- Enable RLS
ALTER TABLE public.commentary_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies using unified tenant isolation strategy
CREATE POLICY "super_admin_all_commentary_events" ON public.commentary_events
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY "tenant_isolation_commentary_events" ON public.commentary_events
  FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

CREATE POLICY "tenant_admin_write_commentary_events" ON public.commentary_events
  FOR ALL USING (tenant_id = ANY(current_tenant_id())) WITH CHECK (tenant_id = ANY(current_tenant_id()));


-- ====================================================
-- FILE: 016_fix_trigger_undo_balls.sql
-- ====================================================

-- Fix apply_scoring_event trigger function to update current_over and current_ball on ball_undone event type
CREATE OR REPLACE FUNCTION apply_scoring_event()
RETURNS TRIGGER AS $$
DECLARE
  proj RECORD;
  ball_runs INTEGER;
  ball_wickets INTEGER;
  ball_balls INTEGER;
  ball_extras INTEGER;
  new_total_balls INTEGER;
BEGIN
  -- Skip if projection already at this sequence
  SELECT * INTO proj FROM scorecard_projections 
  WHERE innings_id = NEW.aggregate_id 
  FOR UPDATE SKIP LOCKED;
  
  IF proj IS NULL THEN
    RETURN NEW;
  END IF;
  
  IF NEW.sequence_number <= proj.last_event_sequence THEN
    RETURN NEW; -- already applied
  END IF;
  
  IF NEW.event_type = 'ball_recorded' THEN
    ball_runs := COALESCE((NEW.payload->>'runs')::INTEGER, 0);
    ball_wickets := CASE WHEN (NEW.payload->>'is_wicket')::BOOLEAN THEN 1 ELSE 0 END;
    ball_balls := CASE WHEN NOT COALESCE((NEW.payload->>'is_wide')::BOOLEAN, false) 
                        AND NOT COALESCE((NEW.payload->>'is_no_ball')::BOOLEAN, false) 
                       THEN 1 ELSE 0 END;
    ball_extras := ball_runs - COALESCE((NEW.payload->>'batsman_runs')::INTEGER, ball_runs);
    
    UPDATE scorecard_projections SET
      total_runs = total_runs + ball_runs,
      total_wickets = total_wickets + ball_wickets,
      total_balls = total_balls + ball_balls,
      total_extras = total_extras + GREATEST(ball_extras, 0),
      wides = wides + CASE WHEN (NEW.payload->>'is_wide')::BOOLEAN THEN 1 ELSE 0 END,
      no_balls = no_balls + CASE WHEN (NEW.payload->>'is_no_ball')::BOOLEAN THEN 1 ELSE 0 END,
      byes = byes + CASE WHEN (NEW.payload->>'is_bye')::BOOLEAN THEN ball_runs ELSE 0 END,
      leg_byes = leg_byes + CASE WHEN (NEW.payload->>'is_leg_bye')::BOOLEAN THEN ball_runs ELSE 0 END,
      current_over = (total_balls + ball_balls) / 6,
      current_ball = (total_balls + ball_balls) % 6,
      last_event_sequence = NEW.sequence_number,
      updated_at = NOW()
    WHERE innings_id = NEW.aggregate_id;
    
  ELSIF NEW.event_type = 'ball_undone' THEN
    ball_runs := COALESCE((NEW.payload->>'runs')::INTEGER, 0);
    ball_wickets := CASE WHEN (NEW.payload->>'is_wicket')::BOOLEAN THEN 1 ELSE 0 END;
    ball_balls := CASE WHEN NOT COALESCE((NEW.payload->>'is_wide')::BOOLEAN, false) 
                        AND NOT COALESCE((NEW.payload->>'is_no_ball')::BOOLEAN, false) 
                       THEN 1 ELSE 0 END;
    
    new_total_balls := GREATEST(0, proj.total_balls - ball_balls);
    
    UPDATE scorecard_projections SET
      total_runs = GREATEST(0, total_runs - ball_runs),
      total_wickets = GREATEST(0, total_wickets - ball_wickets),
      total_balls = new_total_balls,
      current_over = new_total_balls / 6,
      current_ball = new_total_balls % 6,
      last_event_sequence = NEW.sequence_number,
      updated_at = NOW()
    WHERE innings_id = NEW.aggregate_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ====================================================
-- FILE: 017_create_materialized_views_and_performance_indexes.sql
-- ====================================================

-- Database Performance Optimization Migration
-- 1. Create optimized indexes for match_balls and match_innings
CREATE INDEX IF NOT EXISTS idx_match_balls_bowler_id ON match_balls(bowler_id);
CREATE INDEX IF NOT EXISTS idx_match_balls_batsman_id ON match_balls(batsman_id);
CREATE INDEX IF NOT EXISTS idx_match_balls_match_over ON match_balls(match_id, over_number);
CREATE INDEX IF NOT EXISTS idx_match_innings_match_id ON match_innings(match_id);

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


