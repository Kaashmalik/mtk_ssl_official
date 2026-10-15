-- ============================================================================
-- MIGRATION: 001_enable_uuid_v7_and_helpers.sql
-- ============================================================================

-- ============================================================================
-- Migration 001: Enable UUID v7 and Helper Functions
-- ============================================================================
-- This migration enables UUID v7 generation and creates helper functions
-- for multi-tenant data isolation and super admin checks.

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create UUID v7 function
-- UUID v7 is time-ordered and better for database indexes
-- This implementation follows the UUID v7 specification
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid AS $$
DECLARE
  uuid_hex text;
  uuid_bytes bytea;
BEGIN
  -- 48-bit big-endian millisecond timestamp (12 hex chars)
  uuid_hex :=
    lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0') ||
    lpad(to_hex((random() * 9223372036854775807)::bigint), 12, '0') ||
    lpad(to_hex((random() * 9223372036854775807)::bigint), 8, '0');

  uuid_bytes := decode(uuid_hex, 'hex');

  -- Set version (7) and RFC 4122 variant bits
  uuid_bytes := set_byte(uuid_bytes, 6,
    (get_byte(uuid_bytes, 6) & 15) | 112
  );
  uuid_bytes := set_byte(uuid_bytes, 8,
    (get_byte(uuid_bytes, 8) & 63) | 128
  );

  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql;

-- Helper function: Get current user's tenant IDs
-- This reads from the users table based on auth.uid() or email from JWT
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid[] AS $$
DECLARE
  user_tenants uuid[];
  user_email text;
  user_uuid uuid;
BEGIN
  -- Try to get user ID from auth.uid() first (Supabase standard)
  user_uuid := auth.uid();

  -- If auth.uid() is null, try to get email from JWT
  IF user_uuid IS NULL THEN
    user_email := (auth.jwt() ->> 'email')::text;

    -- If no email either, return empty array
    IF user_email IS NULL THEN
      RETURN ARRAY[]::uuid[];
    END IF;

    -- Get tenant IDs from users table by email
    SELECT COALESCE(tenant_ids, ARRAY[]::uuid[])
    INTO user_tenants
    FROM users
    WHERE email = user_email;
  ELSE
    -- Get tenant IDs from users table by ID
    -- Note: This assumes users.id matches auth.users.id
    -- If using Clerk, you may need to join on a different field
    SELECT COALESCE(tenant_ids, ARRAY[]::uuid[])
    INTO user_tenants
    FROM users
    WHERE id = user_uuid;
  END IF;

  RETURN COALESCE(user_tenants, ARRAY[]::uuid[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: Check if current user is super admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
DECLARE
  user_email text;
  user_uuid uuid;
  user_role text;
BEGIN
  -- Try to get user ID from auth.uid() first
  user_uuid := auth.uid();

  IF user_uuid IS NOT NULL THEN
    -- Check role in users table
    SELECT role INTO user_role
    FROM users
    WHERE id = user_uuid;

    IF user_role = 'super_admin' THEN
      RETURN true;
    END IF;
  END IF;

  -- Fallback: Get email from JWT
  user_email := (auth.jwt() ->> 'email')::text;

  IF user_email IS NULL THEN
    RETURN false;
  END IF;

  -- Check users table by email
  SELECT role INTO user_role
  FROM users
  WHERE email = user_email;

  RETURN COALESCE(user_role = 'super_admin', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: Get current user ID (from auth.users)
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS uuid AS $$
BEGIN
  RETURN (auth.uid())::uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: Check if user belongs to tenant
CREATE OR REPLACE FUNCTION user_belongs_to_tenant(tenant_uuid uuid)
RETURNS boolean AS $$
DECLARE
  user_tenants uuid[];
BEGIN
  -- Super admin can access all tenants
  IF is_super_admin() THEN
    RETURN true;
  END IF;

  -- Get user's tenant IDs
  user_tenants := current_tenant_id();

  -- Check if tenant is in user's tenant array
  RETURN tenant_uuid = ANY(user_tenants);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- MIGRATION: 002_create_tables.sql
-- ============================================================================

-- ============================================================================
-- Migration 002: Create All Tables
-- ============================================================================
-- This migration creates all tables for the multi-tenant SSL platform
-- with proper foreign keys and indexes.

-- ============================================================================
-- TENANTS (Leagues)
-- ============================================================================
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  custom_domain text UNIQUE,
  owner_id uuid NOT NULL, -- References auth.users
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_custom_domain ON tenants(custom_domain) WHERE custom_domain IS NOT NULL;
CREATE INDEX idx_tenants_owner_id ON tenants(owner_id);

-- ============================================================================
-- TENANT BRANDING (White-label configuration)
-- ============================================================================
CREATE TABLE tenant_branding (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url text,
  favicon_url text,
  primary_color text,
  secondary_color text,
  accent_color text,
  font_family text,
  app_name text, -- Custom app name for white-label
  hide_ssl_branding boolean NOT NULL DEFAULT false,
  custom_css text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- USERS (Multi-tenant users with tenant_id array)
-- ============================================================================
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email text NOT NULL UNIQUE,
  tenant_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[], -- Array of tenant IDs user belongs to
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_tenant_ids ON users USING GIN(tenant_ids);

-- ============================================================================
-- PROFILES (Public user information)
-- ============================================================================
CREATE TABLE profiles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name text,
  last_name text,
  display_name text,
  avatar_url text,
  phone text,
  bio text,
  date_of_birth date,
  nationality text,
  city text,
  state text,
  country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, tenant_id) -- One profile per user per tenant
);

CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_profiles_tenant_id ON profiles(tenant_id);
CREATE INDEX idx_profiles_display_name ON profiles(display_name);

-- ============================================================================
-- TOURNAMENTS
-- ============================================================================
CREATE TABLE tournaments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  format text NOT NULL CHECK (format IN ('knockout', 'league', 'hybrid', 'round_robin')),
  start_date date,
  end_date date,
  registration_open boolean NOT NULL DEFAULT false,
  registration_deadline date,
  max_teams integer,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'registration', 'live', 'completed', 'cancelled')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_tournaments_tenant_id ON tournaments(tenant_id);
CREATE INDEX idx_tournaments_slug ON tournaments(tenant_id, slug);
CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_tournaments_created_by ON tournaments(created_by);

-- ============================================================================
-- TEAMS
-- ============================================================================
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tournament_id uuid REFERENCES tournaments(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text NOT NULL,
  logo_url text,
  captain_id uuid REFERENCES users(id) ON DELETE SET NULL,
  manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  jersey_color text,
  home_ground text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_teams_tenant_id ON teams(tenant_id);
CREATE INDEX idx_teams_tournament_id ON teams(tournament_id);
CREATE INDEX idx_teams_slug ON teams(tenant_id, slug);
CREATE INDEX idx_teams_captain_id ON teams(captain_id);

-- ============================================================================
-- PLAYERS
-- ============================================================================
CREATE TYPE public.player_role AS ENUM ('batsman', 'bowler', 'all_rounder', 'wicket_keeper', 'wicket_keeper_batsman');
CREATE TYPE public.batting_style AS ENUM ('right', 'left');
CREATE TYPE public.bowling_style AS ENUM (
  'right_arm_fast', 'right_arm_medium', 'right_arm_spin',
  'left_arm_fast', 'left_arm_medium', 'left_arm_spin'
);
CREATE TYPE public.player_status AS ENUM ('active', 'injured', 'retired', 'suspended', 'inactive');

CREATE TABLE players (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,

  -- Personal Information
  name text NOT NULL,
  photo_url text,
  date_of_birth date,
  phone text,
  email text,
  nationality text,
  city text,

  -- Physical Stats
  height_cm integer,
  weight_kg integer,

  -- Cricket Details
  jersey_number integer,
  role public.player_role,
  batting_style public.batting_style,
  bowling_style public.bowling_style,
  biography text,

  -- Status
  status public.player_status NOT NULL DEFAULT 'active',
  is_active boolean NOT NULL DEFAULT true,
  joined_at date,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_players_tenant_id ON players(tenant_id);
CREATE INDEX idx_players_team_id ON players(team_id);
CREATE INDEX idx_players_user_id ON players(user_id);
CREATE INDEX idx_players_profile_id ON players(profile_id);

-- ============================================================================
-- VENUES
-- ============================================================================
CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  city text,
  state text,
  country text,
  capacity integer,
  ground_type text CHECK (ground_type IN ('grass', 'synthetic', 'concrete', 'matting')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_venues_tenant_id ON venues(tenant_id);
CREATE INDEX idx_venues_name ON venues(tenant_id, name);

-- ============================================================================
-- MATCHES
-- ============================================================================
CREATE TABLE matches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tournament_id uuid REFERENCES tournaments(id) ON DELETE SET NULL,
  team_a_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team_b_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  match_number integer,
  match_type text NOT NULL CHECK (match_type IN ('group', 'knockout', 'final', 'semi_final', 'quarter_final')),
  scheduled_date timestamptz,
  start_date timestamptz,
  end_date timestamptz,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'completed', 'abandoned', 'cancelled')),
  toss_winner_id uuid REFERENCES teams(id),
  toss_decision text CHECK (toss_decision IN ('bat', 'bowl')),
  winner_id uuid REFERENCES teams(id),
  result text, -- e.g., "Team A won by 5 wickets"
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (team_a_id != team_b_id)
);

CREATE INDEX idx_matches_tenant_id ON matches(tenant_id);
CREATE INDEX idx_matches_tournament_id ON matches(tournament_id);
CREATE INDEX idx_matches_team_a_id ON matches(team_a_id);
CREATE INDEX idx_matches_team_b_id ON matches(team_b_id);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_scheduled_date ON matches(scheduled_date);

-- ============================================================================
-- MATCH INNINGS
-- ============================================================================
CREATE TABLE match_innings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  innings_number integer NOT NULL CHECK (innings_number IN (1, 2)),
  total_runs integer NOT NULL DEFAULT 0,
  total_wickets integer NOT NULL DEFAULT 0,
  total_balls integer NOT NULL DEFAULT 0,
  extras integer NOT NULL DEFAULT 0,
  byes integer NOT NULL DEFAULT 0,
  leg_byes integer NOT NULL DEFAULT 0,
  wides integer NOT NULL DEFAULT 0,
  no_balls integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id, innings_number)
);

CREATE INDEX idx_match_innings_tenant_id ON match_innings(tenant_id);
CREATE INDEX idx_match_innings_match_id ON match_innings(match_id);
CREATE INDEX idx_match_innings_team_id ON match_innings(team_id);

-- ============================================================================
-- MATCH BALLS (Ball-by-ball data)
-- ============================================================================
CREATE TABLE match_balls (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  innings_id uuid NOT NULL REFERENCES match_innings(id) ON DELETE CASCADE,
  over_number integer NOT NULL,
  ball_number integer NOT NULL CHECK (ball_number BETWEEN 1 AND 6),
  bowler_id uuid REFERENCES players(id) ON DELETE SET NULL,
  batsman_id uuid REFERENCES players(id) ON DELETE SET NULL,
  runs integer NOT NULL DEFAULT 0,
  is_wicket boolean NOT NULL DEFAULT false,
  wicket_type text CHECK (wicket_type IN ('bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'retired', 'retired_hurt')),
  is_four boolean NOT NULL DEFAULT false,
  is_six boolean NOT NULL DEFAULT false,
  is_wide boolean NOT NULL DEFAULT false,
  is_no_ball boolean NOT NULL DEFAULT false,
  is_bye boolean NOT NULL DEFAULT false,
  is_leg_bye boolean NOT NULL DEFAULT false,
  shot_direction text, -- For wagon wheel
  shot_type text, -- e.g., 'drive', 'cut', 'pull'
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id, innings_id, over_number, ball_number)
);

CREATE INDEX idx_match_balls_tenant_id ON match_balls(tenant_id);
CREATE INDEX idx_match_balls_match_id ON match_balls(match_id);
CREATE INDEX idx_match_balls_innings_id ON match_balls(innings_id);
CREATE INDEX idx_match_balls_bowler_id ON match_balls(bowler_id);
CREATE INDEX idx_match_balls_batsman_id ON match_balls(batsman_id);
CREATE INDEX idx_match_balls_over ON match_balls(match_id, innings_id, over_number, ball_number);

-- ============================================================================
-- DOCUMENTS
-- ============================================================================
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  file_url text NOT NULL,
  file_type text,
  file_size bigint,
  category text, -- e.g., 'rules', 'registration_form', 'fixture', 'result'
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX idx_documents_category ON documents(category);
CREATE INDEX idx_documents_uploaded_by ON documents(uploaded_by);

-- ============================================================================
-- MEDIA
-- ============================================================================
CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  file_url text NOT NULL,
  file_type text NOT NULL, -- 'image', 'video', 'audio'
  mime_type text,
  file_size bigint,
  width integer,
  height integer,
  duration integer, -- For video/audio in seconds
  thumbnail_url text,
  category text, -- e.g., 'highlight', 'photo', 'video', 'logo'
  related_match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
  related_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  related_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_tenant_id ON media(tenant_id);
CREATE INDEX idx_media_file_type ON media(file_type);
CREATE INDEX idx_media_category ON media(category);
CREATE INDEX idx_media_related_match_id ON media(related_match_id);
CREATE INDEX idx_media_related_team_id ON media(related_team_id);
CREATE INDEX idx_media_related_player_id ON media(related_player_id);
CREATE INDEX idx_media_uploaded_by ON media(uploaded_by);

-- ============================================================================
-- TRIGGERS: Update updated_at timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all tables with updated_at column
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenant_branding_updated_at BEFORE UPDATE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tournaments_updated_at BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_matches_updated_at BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_match_innings_updated_at BEFORE UPDATE ON match_innings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_venues_updated_at BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_media_updated_at BEFORE UPDATE ON media
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- MIGRATION: 003_create_rls_policies.sql
-- ============================================================================

-- ============================================================================
-- Migration 003: Row Level Security (RLS) Policies
-- ============================================================================
-- This migration enables RLS on all tables and creates policies for
-- complete data isolation per tenant with super admin override.

-- ============================================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_innings ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_balls ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TENANTS POLICIES
-- ============================================================================
-- Super admin can do everything
CREATE POLICY "Super admin can manage all tenants"
  ON tenants FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Users can view tenants they belong to
CREATE POLICY "Users can view their tenants"
  ON tenants FOR SELECT
  USING (
    is_super_admin() OR
    id = ANY(current_tenant_id())
  );

-- Users can update tenants they own
CREATE POLICY "Users can update their owned tenants"
  ON tenants FOR UPDATE
  USING (
    is_super_admin() OR
    (id = ANY(current_tenant_id()) AND owner_id = current_user_id())
  )
  WITH CHECK (
    is_super_admin() OR
    (id = ANY(current_tenant_id()) AND owner_id = current_user_id())
  );

-- ============================================================================
-- TENANT BRANDING POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all branding"
  ON tenant_branding FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Users can view branding of their tenants"
  ON tenant_branding FOR SELECT
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

CREATE POLICY "Users can update branding of their tenants"
  ON tenant_branding FOR UPDATE
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  )
  WITH CHECK (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

CREATE POLICY "Users can insert branding for their tenants"
  ON tenant_branding FOR INSERT
  WITH CHECK (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

-- ============================================================================
-- USERS POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all users"
  ON users FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Users can view themselves
CREATE POLICY "Users can view themselves"
  ON users FOR SELECT
  USING (
    is_super_admin() OR
    email = (auth.jwt() ->> 'email')
  );

-- Users can update themselves
CREATE POLICY "Users can update themselves"
  ON users FOR UPDATE
  USING (
    is_super_admin() OR
    email = (auth.jwt() ->> 'email')
  )
  WITH CHECK (
    is_super_admin() OR
    email = (auth.jwt() ->> 'email')
  );

-- Users can view other users in their tenants
CREATE POLICY "Users can view users in their tenants"
  ON users FOR SELECT
  USING (
    is_super_admin() OR
    tenant_ids && current_tenant_id() -- Array overlap check
  );

-- ============================================================================
-- PROFILES POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all profiles"
  ON profiles FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Users can view profiles in their tenants"
  ON profiles FOR SELECT
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

CREATE POLICY "Users can manage their own profiles"
  ON profiles FOR ALL
  USING (
    is_super_admin() OR
    (tenant_id = ANY(current_tenant_id()) AND user_id = current_user_id())
  )
  WITH CHECK (
    is_super_admin() OR
    (tenant_id = ANY(current_tenant_id()) AND user_id = current_user_id())
  );

-- ============================================================================
-- TOURNAMENTS POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all tournaments"
  ON tournaments FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Users can view tournaments in their tenants"
  ON tournaments FOR SELECT
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

CREATE POLICY "Users can manage tournaments in their tenants"
  ON tournaments FOR ALL
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  )
  WITH CHECK (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

-- ============================================================================
-- TEAMS POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all teams"
  ON teams FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Users can view teams in their tenants"
  ON teams FOR SELECT
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

CREATE POLICY "Users can manage teams in their tenants"
  ON teams FOR ALL
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  )
  WITH CHECK (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

-- ============================================================================
-- PLAYERS POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all players"
  ON players FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Users can view players in their tenants"
  ON players FOR SELECT
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

CREATE POLICY "Users can manage players in their tenants"
  ON players FOR ALL
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  )
  WITH CHECK (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

-- ============================================================================
-- MATCHES POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all matches"
  ON matches FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Users can view matches in their tenants"
  ON matches FOR SELECT
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

CREATE POLICY "Users can manage matches in their tenants"
  ON matches FOR ALL
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  )
  WITH CHECK (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

-- ============================================================================
-- MATCH INNINGS POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all match innings"
  ON match_innings FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Users can view match innings in their tenants"
  ON match_innings FOR SELECT
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

CREATE POLICY "Users can manage match innings in their tenants"
  ON match_innings FOR ALL
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  )
  WITH CHECK (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

-- ============================================================================
-- MATCH BALLS POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all match balls"
  ON match_balls FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Users can view match balls in their tenants"
  ON match_balls FOR SELECT
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

CREATE POLICY "Users can manage match balls in their tenants"
  ON match_balls FOR ALL
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  )
  WITH CHECK (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

-- ============================================================================
-- VENUES POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all venues"
  ON venues FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Users can view venues in their tenants"
  ON venues FOR SELECT
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

CREATE POLICY "Users can manage venues in their tenants"
  ON venues FOR ALL
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  )
  WITH CHECK (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

-- ============================================================================
-- DOCUMENTS POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all documents"
  ON documents FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Users can view public documents or documents in their tenants"
  ON documents FOR SELECT
  USING (
    is_super_admin() OR
    (is_public = true) OR
    (tenant_id = ANY(current_tenant_id()))
  );

CREATE POLICY "Users can manage documents in their tenants"
  ON documents FOR ALL
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  )
  WITH CHECK (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );

-- ============================================================================
-- MEDIA POLICIES
-- ============================================================================
CREATE POLICY "Super admin can manage all media"
  ON media FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Users can view public media or media in their tenants"
  ON media FOR SELECT
  USING (
    is_super_admin() OR
    (is_public = true) OR
    (tenant_id = ANY(current_tenant_id()))
  );

CREATE POLICY "Users can manage media in their tenants"
  ON media FOR ALL
  USING (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  )
  WITH CHECK (
    is_super_admin() OR
    tenant_id = ANY(current_tenant_id())
  );


-- ============================================================================
-- MIGRATION: 004_microservices_schema.sql
-- ============================================================================

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

-- ============================================================================
-- MIGRATION: 005_seed_super_admin.sql
-- ============================================================================

-- ============================================================================
-- Migration 004: Seed Super Admin (Muhammad Kashif)
-- ============================================================================
-- This migration creates the super admin user for Muhammad Kashif
-- Email: kaash0542@gmail.com

-- Insert super admin user
-- Note: In production, this user should be created through your auth system (Clerk)
-- and then linked here. This is a seed for development/testing.
INSERT INTO users (
  id,
  email,
  tenant_ids,
  role,
  is_active,
  created_at,
  updated_at
) VALUES (
  uuid_generate_v7(),
  'kaash0542@gmail.com',
  ARRAY[]::uuid[], -- Super admin doesn't need tenant_ids, they can access all
  'super_admin',
  true,
  now(),
  now()
)
ON CONFLICT (email) DO UPDATE
SET
  role = 'super_admin',
  is_active = true,
  updated_at = now();

-- Create a default tenant for SSL (Shakir Super League)
-- This is the main platform tenant
INSERT INTO tenants (
  id,
  name,
  slug,
  custom_domain,
  owner_id,
  plan,
  is_active,
  created_at,
  updated_at
)
SELECT
  uuid_generate_v7(),
  'Shakir Super League',
  'ssl',
  'ssl.cricket',
  u.id,
  'enterprise',
  true,
  now(),
  now()
FROM users u
WHERE u.email = 'kaash0542@gmail.com'
ON CONFLICT (slug) DO NOTHING;

-- Create branding for SSL tenant
INSERT INTO tenant_branding (
  tenant_id,
  logo_url,
  favicon_url,
  primary_color,
  secondary_color,
  accent_color,
  app_name,
  hide_ssl_branding,
  created_at,
  updated_at
)
SELECT
  t.id,
  'https://ssl.cricket/logo.png',
  'https://ssl.cricket/favicon.ico',
  '#1a1a1a',
  '#ffffff',
  '#00d4ff',
  'Shakir Super League',
  false, -- Don't hide branding for main tenant
  now(),
  now()
FROM tenants t
WHERE t.slug = 'ssl'
ON CONFLICT (tenant_id) DO NOTHING;

-- Add the SSL tenant to Muhammad Kashif's tenant_ids array
UPDATE users
SET
  tenant_ids = ARRAY(
    SELECT t.id FROM tenants t WHERE t.slug = 'ssl'
  )::uuid[],
  updated_at = now()
WHERE email = 'kaash0542@gmail.com';


-- ============================================================================
-- MIGRATION: 006_create_waitlist_table.sql
-- ============================================================================

-- Create waitlist table for marketing site
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at DESC);

-- Enable RLS
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anyone to insert (for waitlist signups)
CREATE POLICY "Allow public waitlist inserts"
  ON waitlist
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Policy: Only service role can read (for admin purposes)
CREATE POLICY "Service role can read waitlist"
  ON waitlist
  FOR SELECT
  TO service_role
  USING (true);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_waitlist_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_waitlist_updated_at
  BEFORE UPDATE ON waitlist
  FOR EACH ROW
  EXECUTE FUNCTION update_waitlist_updated_at();


-- ============================================================================
-- MIGRATION: 007_create_admin_tables.sql
-- ============================================================================

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
  payment_method public.payment_method,
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


-- ============================================================================
-- MIGRATION: 008_white_label_enterprise.sql
-- ============================================================================

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


-- ============================================================================
-- MIGRATION: 009_fantasy_cricket.sql
-- ============================================================================

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
-- These defaults belong to a legacy system tenant that no longer exists on a
-- fresh install. Seed them only when that tenant is present so a fresh
-- database does not violate fantasy_points_rules_tenant_id_fkey. The
-- application never reads this table today; per-tenant defaults live in code.
INSERT INTO fantasy_points_rules (tenant_id, event, points, multiplier, description)
SELECT v.tenant_id, v.event, v.points, v.multiplier, v.description
FROM (VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'run', 1, 1.0::numeric, 'Every run scored'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'four', 1, 1.0::numeric, 'Bonus for hitting a four'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'six', 2, 1.0::numeric, 'Bonus for hitting a six'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'wicket', 25, 1.0::numeric, 'Wicket taken (bowler)'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'catch', 10, 1.0::numeric, 'Catch taken'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'stumping', 15, 1.0::numeric, 'Stumping'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'run_out', 10, 1.0::numeric, 'Direct run out'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'duck', -5, 1.0::numeric, 'Out for zero'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'maidens', 10, 1.0::numeric, 'Maiden over bowled'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'fifty', 10, 1.0::numeric, 'Half century'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'century', 25, 1.0::numeric, 'Century')
) AS v(tenant_id, event, points, multiplier, description)
WHERE EXISTS (
  SELECT 1 FROM tenants WHERE id = '00000000-0000-0000-0000-000000000000'::uuid
);

-- ============================================================================
-- MIGRATION: 010_event_store_cqrs.sql
-- ============================================================================

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

-- ============================================================================
-- MIGRATION: 011_sync_drizzle_tables.sql
-- ============================================================================

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

-- ============================================================================
-- MIGRATION: 012_fix_indexes_and_fks.sql
-- ============================================================================

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

-- ============================================================================
-- MIGRATION: 013_fix_rls_gaps.sql
-- ============================================================================

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

-- ============================================================================
-- MIGRATION: 014_unify_rls_strategy.sql
-- ============================================================================

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

-- ============================================================================
-- MIGRATION: 015_create_commentary_events.sql
-- ============================================================================

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

-- ============================================================================
-- MIGRATION: 016_fix_trigger_undo_balls.sql
-- ============================================================================

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

-- ============================================================================
-- MIGRATION: 017_create_materialized_views_and_performance_indexes.sql
-- ============================================================================

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

-- ============================================================================
-- MIGRATION: 018_create_impersonation_sessions.sql
-- ============================================================================

-- ============================================================================
-- Migration 018: Impersonation Sessions (single-use, audited, revocable)
-- ============================================================================
-- Tracks privileged "impersonate user" sessions issued by super admins.
-- A session is created in `issued` state, transitions to `active` once
-- consumed (single-use), and finally `revoked`/`expired` when the admin ends
-- the session or the TTL elapses.
--
-- Design notes:
--  * `jti` (JWT ID) is the single-use nonce — it must match the signed token
--    and be marked consumed exactly once (uniqueness enforced by the
--    `active_jti_uniq` partial unique index).
--  * All impersonation activity is also mirrored into audit_logs for
--    defense-in-depth reporting.

-- Environment role used by later GRANT/REVOKE statements. It does not exist on
-- every Supabase project, so create it (NOLOGIN, no privileges) if missing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    CREATE ROLE ssl NOLOGIN;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  jti           text        NOT NULL,
  admin_user_id text        NOT NULL,                 -- Clerk admin id (actor)
  admin_email   text        NOT NULL,
  target_user_id uuid       NOT NULL,                 -- users.id (subject)
  target_email  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'issued'
                            CHECK (status IN ('issued','active','revoked','expired')),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  consumed_at   timestamptz,
  revoked_at    timestamptz,
  expires_at    timestamptz NOT NULL,                 -- hard expiry (<= 5 min)
  issued_from_ip text,
  user_agent    text,
  reason        text                                 -- admin-supplied justification
);

-- A given jti may only be consumed once. Partial index: only one row per jti
-- can ever be in 'active' state.
CREATE UNIQUE INDEX IF NOT EXISTS impersonation_active_jti_uniq
  ON public.impersonation_sessions (jti)
  WHERE status = 'active';

-- Fast lookups by admin (audit dashboard) and by target (victim-side audit).
CREATE INDEX IF NOT EXISTS idx_impersonation_admin
  ON public.impersonation_sessions (admin_user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_target
  ON public.impersonation_sessions (target_user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_expires
  ON public.impersonation_sessions (expires_at)
  WHERE status IN ('issued','active');

-- Grant to the ssl app role. RLS is intentionally NOT enabled here: this
-- table is only ever written by super-admin server code (service-role path)
-- and read by the admin app. Exposing it to tenant-scoped queries would be a
-- data-leak vector.
GRANT SELECT, INSERT, UPDATE ON public.impersonation_sessions TO ssl;

COMMENT ON TABLE public.impersonation_sessions IS
  'Single-use, audited, revocable super-admin impersonation sessions.';

-- ============================================================================
-- MIGRATION: 019_add_dkim_private_key.sql
-- ============================================================================

-- Migration: Add DKIM private key column to email_domain_verifications
--
-- The DKIM signing flow previously generated an RSA keypair but discarded
-- the private key, making the generated DKIM record useless for actually
-- signing outbound email. This adds the column needed to persist the
-- private key so the mail-sending service can sign messages.
--
-- SECURITY NOTE: the private key is stored as PEM text. For production,
-- wrap this in envelope encryption (KMS/Vault) before writing, or store
-- only an opaque reference (like ssl_certificates.private_key_url) and
-- keep the actual key in a secrets manager. The column is added as plain
-- text now to unblock the signing flow; hardening is tracked separately.

ALTER TABLE email_domain_verifications
  ADD COLUMN IF NOT EXISTS dkim_private_key text;

COMMENT ON COLUMN email_domain_verifications.dkim_private_key IS
  'PEM-encoded RSA private key used to DKIM-sign outbound mail for this domain.';

-- ============================================================================
-- MIGRATION: 020_restore_missing_tables.sql
-- ============================================================================

-- ============================================================================
-- Migration 020: Restore Missing Tables (documents, media, impersonation_sessions)
-- ============================================================================
-- These tables were defined in migrations 002 and 018 but are missing from the
-- live database (likely lost during project pause/restore).

-- ============================================================================
-- DOCUMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  file_url text NOT NULL,
  file_type text,
  file_size bigint,
  category text,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);

-- ============================================================================
-- MEDIA
-- ============================================================================
CREATE TABLE IF NOT EXISTS media (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  file_url text NOT NULL,
  file_type text NOT NULL,
  mime_type text,
  file_size bigint,
  width integer,
  height integer,
  duration integer,
  thumbnail_url text,
  category text,
  related_match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
  related_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  related_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_tenant_id ON media(tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_file_type ON media(file_type);
CREATE INDEX IF NOT EXISTS idx_media_category ON media(category);
CREATE INDEX IF NOT EXISTS idx_media_related_match_id ON media(related_match_id);
CREATE INDEX IF NOT EXISTS idx_media_related_team_id ON media(related_team_id);
CREATE INDEX IF NOT EXISTS idx_media_related_player_id ON media(related_player_id);
CREATE INDEX IF NOT EXISTS idx_media_uploaded_by ON media(uploaded_by);

-- ============================================================================
-- IMPERSONATION SESSIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  jti           text        NOT NULL,
  admin_user_id text        NOT NULL,
  admin_email   text        NOT NULL,
  target_user_id uuid       NOT NULL,
  target_email  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'issued'
                  CHECK (status IN ('issued','active','revoked','expired')),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  consumed_at   timestamptz,
  revoked_at    timestamptz,
  expires_at    timestamptz NOT NULL,
  issued_from_ip text,
  user_agent    text,
  reason        text
);

CREATE UNIQUE INDEX IF NOT EXISTS impersonation_active_jti_uniq
  ON impersonation_sessions (jti)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_impersonation_admin
  ON impersonation_sessions (admin_user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_target
  ON impersonation_sessions (target_user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_expires
  ON impersonation_sessions (expires_at)
  WHERE status IN ('issued','active');

-- ============================================================================
-- TRIGGERS for updated_at on restored tables
-- ============================================================================
DO $$
BEGIN
  -- documents trigger
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_documents_updated_at') THEN
    CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  -- media trigger
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_media_updated_at') THEN
    CREATE TRIGGER update_media_updated_at BEFORE UPDATE ON media
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ============================================================================
-- MIGRATION: 021_sync_audit_logs_with_drizzle.sql
-- ============================================================================

-- ============================================================================
-- Migration 021: Sync audit_logs with Drizzle schema + add tournaments columns
-- ============================================================================
-- PROBLEM: The live `audit_logs` table was created by migration 004
-- (microservices schema) with columns: user_id, action, entity_type,
-- entity_id, old_values, new_values, ip_address (inet).
--
-- But the Drizzle schema (packages/database/src/schema/audit-logs.ts) and the
-- NestJS AuditLogInterceptor expect: request_id, actor_id, actor_role, method,
-- path, ip (text), user_agent, payload (jsonb), status_code.
--
-- This mismatch caused every audit-log INSERT from the API to silently fail.
--
-- FIX: Recreate audit_logs to match the Drizzle schema (the source of truth
-- for application code). The table is empty so no data loss.
-- Also add the extra tournaments columns from migration 004 to the schema.

-- ============================================================================
-- 1. RECREATE audit_logs to match Drizzle schema
-- ============================================================================
DROP POLICY IF EXISTS "super_admin_all_audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "tenant_isolation_audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "tenant_audit_logs" ON public.audit_logs;

DROP TABLE IF EXISTS public.audit_logs;

CREATE TABLE public.audit_logs (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  request_id  text        NOT NULL,
  tenant_id   uuid,
  actor_id    uuid,
  actor_role  text,
  method      text        NOT NULL,
  path        text        NOT NULL,
  ip          text,
  user_agent  text,
  payload     jsonb,
  status_code text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON public.audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON public.audit_logs(request_id);

-- RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all_audit_logs"
  ON public.audit_logs FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "tenant_isolation_audit_logs"
  ON public.audit_logs FOR SELECT
  USING (tenant_id = ANY(current_tenant_id()));

-- Allow service role to insert. Supabase hosted only has postgres/service_role/
-- authenticated/anon; self-hosted deployments may also define an `ssl` app role.
GRANT SELECT, INSERT, UPDATE ON public.audit_logs TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.audit_logs TO ssl;
  END IF;
END $$;

COMMENT ON TABLE public.audit_logs IS
  'HTTP request audit trail written by the NestJS AuditLogInterceptor.';

-- ============================================================================
-- 2. Verify tournaments extra columns exist (added by migration 004).
--    These are referenced by the admin app for tournament management.
--    Add them if missing (idempotent).
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='registration_start') THEN
    ALTER TABLE public.tournaments ADD COLUMN registration_start timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='registration_end') THEN
    ALTER TABLE public.tournaments ADD COLUMN registration_end timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='entry_fee') THEN
    ALTER TABLE public.tournaments ADD COLUMN entry_fee numeric(10,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='prize_pool') THEN
    ALTER TABLE public.tournaments ADD COLUMN prize_pool jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='rules') THEN
    ALTER TABLE public.tournaments ADD COLUMN rules jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='sponsors') THEN
    ALTER TABLE public.tournaments ADD COLUMN sponsors jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='live_stream_url') THEN
    ALTER TABLE public.tournaments ADD COLUMN live_stream_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='is_featured') THEN
    ALTER TABLE public.tournaments ADD COLUMN is_featured boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ============================================================================
-- MIGRATION: 022_add_starter_plan_and_payment_tables.sql
-- ============================================================================

-- ============================================================================
-- Migration 022: Add "starter" to tenant_plan enum + create subscription_requests table
-- ============================================================================
-- This migration:
--   1. Adds "starter" to the existing tenant_plan enum (free, starter, pro, enterprise)
--   2. Creates subscription_request_status enum
--   3. Creates subscription_requests table (manual payment approval queue)
--   4. Adds RLS policies for the new table
--   5. Seeds commission rates for the new "starter" plan
-- ============================================================================

-- ─── 1. Add "starter" to tenant_plan enum ──────────────────────────────────
-- PostgreSQL enums are immutable — we must drop constraints, recreate the type,
-- and re-add constraints. In Supabase, we can use ALTER TYPE ADD VALUE (which
-- appends) because it doesn't require rewriting existing data.

DO $$
BEGIN
  -- The tenant_plan enum is a legacy artifact; fresh installs type plan as
  -- text in the application schema. Only extend it where it exists.
  IF EXISTS (
    SELECT 1 FROM pg_type t
    WHERE t.typname = 'tenant_plan' AND t.typtype = 'e'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'tenant_plan' AND e.enumlabel = 'starter'
  ) THEN
    ALTER TYPE tenant_plan ADD VALUE IF NOT EXISTS 'starter';
  END IF;
END $$;

-- ─── 2. Create subscription_request_status enum ───────────────────────────
CREATE TYPE subscription_request_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- ─── 3. Create subscription_requests table ───────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_plan TEXT NOT NULL,
  current_plan TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method TEXT NOT NULL,
  payment_proof_url TEXT NOT NULL,
  transaction_reference TEXT NOT NULL,
  status subscription_request_status NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. Indexes for query performance ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_subscription_requests_tenant_id ON subscription_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_status ON subscription_requests(status);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_expires_at ON subscription_requests(expires_at);

-- ─── 5. RLS Policies ──────────────────────────────────────────────────────
ALTER TABLE subscription_requests ENABLE ROW LEVEL SECURITY;

-- Tenant owners can read their own requests
CREATE POLICY "tenant_read_own_subscription_requests"
  ON subscription_requests
  FOR SELECT
  USING (
    tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
  );

-- Tenant owners can insert requests for their own tenant
CREATE POLICY "tenant_insert_subscription_requests"
  ON subscription_requests
  FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
  );

-- Super admins can read all subscription requests
CREATE POLICY "super_admin_read_all_subscription_requests"
  ON subscription_requests
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super_admin')
  );

-- Super admins can update subscription requests (approve/reject)
CREATE POLICY "super_admin_update_subscription_requests"
  ON subscription_requests
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ─── 6. Auto-expire pending requests after 7 days ────────────────────────
CREATE OR REPLACE FUNCTION expire_old_subscription_requests()
RETURNS void AS $$
BEGIN
  UPDATE subscription_requests
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'pending' AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ─── 7. Update commission_rates plan check constraint ───────────────────
-- The original CHECK only allowed ('free', 'pro', 'enterprise'). Add 'starter'.
ALTER TABLE commission_rates DROP CONSTRAINT IF EXISTS commission_rates_plan_check;
ALTER TABLE commission_rates ADD CONSTRAINT commission_rates_plan_check
  CHECK ((plan = ANY (ARRAY['free'::text, 'starter'::text, 'pro'::text, 'enterprise'::text])));

-- ─── 8. Seed commission rate for starter plan ───────────────────────────
INSERT INTO commission_rates (id, plan, rate, description, is_active, created_at, updated_at)
VALUES (uuid_generate_v7(), 'starter', 10.00, 'Standard commission for Starter plan', true, NOW(), NOW())
ON CONFLICT (plan) DO NOTHING;

-- ─── 9. Grant permissions ─────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.subscription_requests TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.subscription_requests TO ssl;
  END IF;
END $$;

-- ============================================================================
-- MIGRATION: 023_offline_sync_ball_sequence.sql
-- ============================================================================

-- =============================================================================
-- 023: Offline sync support on match_balls
--
--   * ball_sequence : monotonic per-(match_id, innings_id) delivery ordinal.
--     Assigned server-side, independent of (over_number, ball_number)
--     coordinates. Replaces (over_number, ball_number) as the uniqueness key so
--     wide/no-ball extras can no longer collide with the next legal delivery.
--   * client_op_id  : client-supplied op id for idempotent bulk replay. The
--     partial unique index is the actual dedupe enforcement point (insert then
--     catch the unique violation), NOT a check-then-insert guard.
--
-- SAFETY GATE: the old UNIQUE(match_id, innings_id, over_number, ball_number)
-- is dropped ONLY after the backfill is proven consistent (no NULLs, no
-- duplicates within an innings, contiguous 1..n). If any existing ball_sequence
-- data is present it is validated, never silently re-numbered; any
-- inconsistency aborts the whole migration via RAISE EXCEPTION.
--
-- Transactionality: destructive/data-changing steps (backfill, gate, constraint
-- drop) live inside a single atomic DO statement, so a RAISE aborts them in ANY
-- runner. The installed Supabase CLI (v2.58.5) additionally wraps each
-- migration file in a transaction (verified on scratch: an aborted migration
-- leaves no column residue), so the entire file is atomic under `supabase db
-- push` / `supabase db reset`.
-- =============================================================================

-- 0) Global sequence used ONLY as a transition safety net so legacy writers
--    that do not yet send ball_sequence get a value instead of a collision at
--    NULL. The scoring engine always overrides it with real contiguous
--    per-innings values (MAX+1). setval() below parks the sequence past the
--    backfilled range.
CREATE SEQUENCE IF NOT EXISTS match_balls_ball_sequence_seq;

-- 1) Columns ---------------------------------------------------------------
-- Ball_sequence is added NULLABLE on purpose: a NOT NULL DEFAULT nextval() at
-- ADD COLUMN time would immediately stamp every existing row with a global
-- sequence number and defeat the "has this table been sequenced already?"
-- detection on a non-empty table. The default + NOT NULL are applied only
-- AFTER the gated backfill has proven the key consistent.
ALTER TABLE match_balls
  ADD COLUMN IF NOT EXISTS ball_sequence integer,
  ADD COLUMN IF NOT EXISTS client_op_id text;

-- 2) Backfill / validate gated on existing data ----------------------------
DO $migration$
DECLARE
  any_existing  boolean;
  inconsistent  bigint := 0;
  cname         text;
BEGIN
  -- (a) Has anything been written with a real sequence before this migration?
  --     NULL = untouched pre-migration rows (or an empty table). After 023 has
  --     run once, ball_sequence is NOT NULL, so a re-run takes the
  --     validate-never-renumber path below.
  SELECT EXISTS (
    SELECT 1 FROM match_balls WHERE ball_sequence IS NOT NULL
  ) INTO any_existing;

  IF NOT any_existing THEN
    -- Fresh authoritative backfill: contiguous 1..n per (match_id, innings_id),
    -- deterministic ordering: delivery order = created_at, then (over_number,
    -- ball_number) to disambiguate same-millisecond ties (id is a UUID v7 and
    -- is only the final tie-breaker). Only NULL rows are touched.
    UPDATE match_balls m
       SET ball_sequence = x.rn
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY match_id, innings_id
                 ORDER BY created_at ASC, over_number ASC, ball_number ASC, id ASC
               ) AS rn
          FROM match_balls
      ) x
     WHERE m.id = x.id
       AND m.ball_sequence IS NULL;
  END IF;

  -- (b) HARD GATE. Prove the key is safe BEFORE touching the old unique
  --     constraint. Any NULL, duplicate, not-1-based, or gapped partition
  --     aborts with the count; nothing is dropped, nothing is re-numbered.
  WITH agg AS (
    SELECT match_id, innings_id,
           COUNT(*)                      AS cnt,
           COUNT(ball_sequence)          AS not_null_ct,
           COUNT(DISTINCT ball_sequence) AS distinct_ct,
           MIN(ball_sequence)            AS mn,
           MAX(ball_sequence)            AS mx
      FROM match_balls
     GROUP BY match_id, innings_id
  )
  SELECT COUNT(*) INTO inconsistent
    FROM agg
   WHERE cnt <> not_null_ct      -- NULLs left behind
      OR cnt <> distinct_ct      -- duplicate sequence in one innings
      OR mx  <> cnt              -- gap at the top
      OR mn  <> 1;               -- not 1-based / gap at the bottom

  IF inconsistent > 0 THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: match_balls.ball_sequence inconsistent in % innings (NULL, duplicate, or non-contiguous 1..n per innings). Inspect, fix manually, then re-run; existing data was NOT modified.',
      inconsistent;
  END IF;

  -- (c) Park the transition sequence past the backfilled range so a legacy
  --     writer cannot draw a value that collides with backfilled rows.
  PERFORM setval(
    'match_balls_ball_sequence_seq',
    GREATEST((SELECT COALESCE(MAX(ball_sequence), 0) FROM match_balls), 0) + 1,
    false
  );

  -- (d) Drop the deprecated unique constraint regardless of its generated
  --     name (it was created as an anonymous inline constraint in 002).
  --     Set-equality on the resolved attnums (@> and <@ are order-independent
  --     array-contains on real pg_attribute attnums), so the exact 4-column
  --     constraint is matched no matter how the columns are ordered in the
  --     constraint definition.
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'match_balls'::regclass
     AND contype   = 'u'
     AND conkey    @> ARRAY(
           SELECT attnum FROM pg_attribute
             WHERE attrelid = 'match_balls'::regclass
               AND attname IN ('match_id', 'innings_id', 'over_number', 'ball_number')
         )::smallint[]
     AND conkey    <@ ARRAY(
           SELECT attnum FROM pg_attribute
             WHERE attrelid = 'match_balls'::regclass
               AND attname IN ('match_id', 'innings_id', 'over_number', 'ball_number')
         )::smallint[];

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE match_balls DROP CONSTRAINT %I', cname);
  END IF;
END
$migration$;

-- 3) Finalise the column (safe to run even in a non-transactional runner: the
--    gate already proved there are no NULLs, so SET NOT NULL succeeds; on an
--    aborted gate it fails loudly instead of silently corrupting).
ALTER TABLE match_balls
  ALTER COLUMN ball_sequence SET DEFAULT nextval('match_balls_ball_sequence_seq'),
  ALTER COLUMN ball_sequence SET NOT NULL;

-- 4) New uniqueness + dedupe enforcement ----------------------------------
-- Unique indexes (not named constraints) so the whole migration is idempotent:
-- re-running after the first apply is a no-op. Unique indexes enforce the same
-- integrity and are valid targets for ON CONFLICT inference.
CREATE UNIQUE INDEX IF NOT EXISTS uqx_match_balls_innings_sequence
  ON match_balls (match_id, innings_id, ball_sequence);

-- Partial unique index is THE idempotency enforcement mechanism: the engine
-- inserts, catches the unique violation, and fetches the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS uqx_match_balls_client_op
  ON match_balls (match_id, client_op_id)
  WHERE client_op_id IS NOT NULL;

-- 5) Read-path index on the (now non-unique) coordinate columns. Already
--    exists as idx_match_balls_over since 002 — kept untouched on purpose for
--    scorecard / wagon-wheel / timeline reads that filter by over+ball.
--    (No DDL here; nothing to change.)

-- ============================================================================
-- MIGRATION: 024_revoke_sensitive_table_grants.sql
-- ============================================================================

-- =============================================================================
-- 024: Harden PostgREST exposure for role / impersonation tables
--
-- Live grant check (Wave C): applied on SSL project `anxstufkbqnjkxgksfkn`
-- (mtkshakirsuperleague). Cursor MCP was previously pointed at an unrelated
-- dairy project — configure `--project-ref anxstufkbqnjkxgksfkn` for SSL.
--
-- Goal: even if anon/authenticated somehow hold default PUBLIC grants,
-- PostgREST cannot read role membership or impersonation sessions.
-- App access continues via DATABASE_URL (ssl / service_role) + app-layer
-- tenant isolation (Drizzle bypasses RLS).
-- =============================================================================

-- 1) user_tenant_roles --------------------------------------------------------
ALTER TABLE IF EXISTS public.user_tenant_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_tenant_roles FORCE ROW LEVEL SECURITY;

-- This chain creates user_tenant_roles in 20260623_add_user_tenant_roles.sql,
-- AFTER this file runs. Keep 024 order-safe by hardening the table only when
-- it already exists (guarded block below).

DO $$
BEGIN
  IF to_regclass('public.user_tenant_roles') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.user_tenant_roles FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON TABLE public.user_tenant_roles FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.user_tenant_roles FROM authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_tenant_roles TO service_role';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_tenant_roles TO ssl';
    END IF;
  END IF;
END $$;

-- No permissive policies for anon/authenticated. service_role bypasses RLS.
-- Optional policy keeps super-admin JWT paths usable if ever wired through PostgREST.
-- DROP POLICY IF EXISTS still requires the table to exist, so guard both drops.
DO $$
BEGIN
  IF to_regclass('public.user_tenant_roles') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "deny_all_user_tenant_roles" ON public.user_tenant_roles';
    EXECUTE 'DROP POLICY IF EXISTS "super_admin_all_user_tenant_roles" ON public.user_tenant_roles';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_super_admin'
  ) AND to_regclass('public.user_tenant_roles') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "super_admin_all_user_tenant_roles"
        ON public.user_tenant_roles
        FOR ALL
        USING (is_super_admin())
        WITH CHECK (is_super_admin())
    $pol$;
  ELSE
    -- Deny-by-default when helper is missing: empty policy set + FORCE RLS.
    NULL;
  END IF;
END $$;

-- 2) impersonation_sessions ---------------------------------------------------
ALTER TABLE IF EXISTS public.impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.impersonation_sessions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.impersonation_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.impersonation_sessions FROM anon;
REVOKE ALL ON TABLE public.impersonation_sessions FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.impersonation_sessions TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE public.impersonation_sessions TO ssl;
  END IF;
END $$;

DROP POLICY IF EXISTS "super_admin_all_impersonation_sessions" ON public.impersonation_sessions;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_super_admin'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "super_admin_all_impersonation_sessions"
        ON public.impersonation_sessions
        FOR ALL
        USING (is_super_admin())
        WITH CHECK (is_super_admin())
    $pol$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.user_tenant_roles') IS NOT NULL THEN
    EXECUTE 'COMMENT ON TABLE public.user_tenant_roles IS ''Per-tenant roles. PostgREST anon/authenticated have no grants; RLS forced.''';
  END IF;
END $$;

COMMENT ON TABLE public.impersonation_sessions IS
  'Super-admin impersonation sessions. PostgREST anon/authenticated have no grants; RLS forced.';

-- ============================================================================
-- MIGRATION: 025_sync_drizzle_schema.sql
-- ============================================================================

-- ============================================================================
-- Migration 025: Reconcile public tables with the Drizzle application schema
-- ============================================================================
-- The 001-024 chain pre-dates several columns the application expects
-- (packages/database/src/schema). This migration adds every application column
-- that no earlier migration creates, guarded so replay is safe.
--
-- Covered elsewhere (do NOT add here, they have their own migrations):
--   match_balls.ball_sequence / client_op_id ... 023_offline_sync_ball_sequence
--   matches.live_stream_url / stream_* / scorer_id ... 20261004090000
--   matches.backup_scorer_id ... 20261013120000
-- ============================================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS clerk_id text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Drizzle declares clerk_id UNIQUE. Multiple NULLs are allowed in Postgres
-- unique indexes, so a plain unique index matches the application contract.
CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_id_key ON public.users (clerk_id);

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS short_name text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS banner_url text,
  ADD COLUMN IF NOT EXISTS primary_color text,
  ADD COLUMN IF NOT EXISTS secondary_color text,
  ADD COLUMN IF NOT EXISTS founded_year integer,
  ADD COLUMN IF NOT EXISTS max_squad_size integer DEFAULT 15,
  ADD COLUMN IF NOT EXISTS created_by text;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS total_overs integer DEFAULT 20,
  ADD COLUMN IF NOT EXISTS man_of_match_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS umpire_1 text,
  ADD COLUMN IF NOT EXISTS umpire_2 text,
  ADD COLUMN IF NOT EXISTS third_umpire text,
  ADD COLUMN IF NOT EXISTS match_referee text,
  ADD COLUMN IF NOT EXISTS created_by text;

COMMIT;

-- ============================================================================
-- MIGRATION: 026_align_app_types.sql
-- ============================================================================

-- ============================================================================
-- Migration 026: Align enum types with the Drizzle application schema
-- ============================================================================
-- The application schema (packages/database/src/schema) declares these enums
-- and types several columns with them. The 001-024 chain never created the
-- enums, and legacy columns were left as text with equally legacy text CHECK
-- constraints (some of which no longer match the application domain at all,
-- e.g. users_role_check permitted only user/admin/super_admin — not fan).
--
-- This migration:
--   1. Creates every missing application enum (guarded, replay-safe).
--   2. Drops the legacy text CHECK constraints — the enum type now owns the
--      allowed-value domain, exactly as the application schema declares it.
--   3. Converts the corresponding live columns to the enum types.
--
-- Tables are empty at migration time, so the USING casts are trivially safe.
-- Defaults are dropped before conversion and re-applied afterwards because
-- Postgres cannot coerce a text default expression to an enum type.
--
-- stream_source / stream_status are intentionally NOT created here; they are
-- owned by 20261004090000_add_match_live_stream_and_scorer.sql, which runs
-- later in this chain.
-- ============================================================================

BEGIN;

-- ─── 1. Create missing enums ───────────────────────────────────────────────
DO $$
BEGIN
  IF to_regtype('public.user_role') IS NULL THEN
    EXECUTE 'CREATE TYPE public.user_role AS ENUM (''super_admin'', ''league_owner'', ''team_manager'', ''coach'', ''scorer'', ''player'', ''fan'')';
  END IF;

  IF to_regtype('public.tenant_plan') IS NULL THEN
    EXECUTE 'CREATE TYPE public.tenant_plan AS ENUM (''free'', ''starter'', ''pro'', ''enterprise'')';
  END IF;

  IF to_regtype('public.match_format') IS NULL THEN
    EXECUTE 'CREATE TYPE public.match_format AS ENUM (''t20'', ''odi'', ''test'', ''t10'', ''custom'')';
  END IF;

  IF to_regtype('public.match_type') IS NULL THEN
    EXECUTE 'CREATE TYPE public.match_type AS ENUM (''group'', ''knockout'', ''final'', ''semi_final'', ''quarter_final'', ''friendly'', ''practice'')';
  END IF;

  IF to_regtype('public.match_status') IS NULL THEN
    EXECUTE 'CREATE TYPE public.match_status AS ENUM (''scheduled'', ''toss'', ''live'', ''innings_break'', ''completed'', ''abandoned'', ''cancelled'', ''no_result'')';
  END IF;

  IF to_regtype('public.toss_decision') IS NULL THEN
    EXECUTE 'CREATE TYPE public.toss_decision AS ENUM (''bat'', ''bowl'')';
  END IF;

  IF to_regtype('public.wicket_type') IS NULL THEN
    EXECUTE 'CREATE TYPE public.wicket_type AS ENUM (''bowled'', ''caught'', ''lbw'', ''run_out'', ''stumped'', ''hit_wicket'', ''retired'', ''retired_hurt'')';
  END IF;

  IF to_regtype('public.innings_status') IS NULL THEN
    EXECUTE 'CREATE TYPE public.innings_status AS ENUM (''not_started'', ''in_progress'', ''completed'')';
  END IF;

  IF to_regtype('public.tournament_format') IS NULL THEN
    EXECUTE 'CREATE TYPE public.tournament_format AS ENUM (''knockout'', ''league'', ''hybrid'', ''round_robin'')';
  END IF;

  IF to_regtype('public.tournament_status') IS NULL THEN
    EXECUTE 'CREATE TYPE public.tournament_status AS ENUM (''draft'', ''registration'', ''live'', ''completed'', ''cancelled'')';
  END IF;

  IF to_regtype('public.ground_type') IS NULL THEN
    EXECUTE 'CREATE TYPE public.ground_type AS ENUM (''grass'', ''synthetic'', ''concrete'', ''matting'')';
  END IF;
END $$;

-- ─── 2. Drop legacy text CHECK constraints (enum owns the domain now) ──────
ALTER TABLE public.users         DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.tenants       DROP CONSTRAINT IF EXISTS tenants_plan_check;
ALTER TABLE public.matches       DROP CONSTRAINT IF EXISTS matches_match_type_check;
ALTER TABLE public.matches       DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE public.matches       DROP CONSTRAINT IF EXISTS matches_toss_decision_check;
ALTER TABLE public.match_innings DROP CONSTRAINT IF EXISTS match_innings_status_check;
ALTER TABLE public.match_balls   DROP CONSTRAINT IF EXISTS match_balls_wicket_type_check;
ALTER TABLE public.tournaments   DROP CONSTRAINT IF EXISTS tournaments_format_check;
ALTER TABLE public.tournaments   DROP CONSTRAINT IF EXISTS tournaments_status_check;
ALTER TABLE public.venues        DROP CONSTRAINT IF EXISTS venues_ground_type_check;

-- ─── 3. Convert legacy text columns to the enum types ─────────────────────

-- users.role is referenced by RLS policies; Postgres refuses to alter a
-- column used in a policy definition. The two subscription_requests policies
-- are the only dependents at this point in the chain, so they are dropped and
-- recreated verbatim (same definition as 022) around the conversion.
DROP POLICY IF EXISTS "super_admin_read_all_subscription_requests" ON public.subscription_requests;
DROP POLICY IF EXISTS "super_admin_update_subscription_requests" ON public.subscription_requests;

ALTER TABLE public.users
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE user_role USING role::text::user_role,
  ALTER COLUMN role SET DEFAULT 'fan';

CREATE POLICY "super_admin_read_all_subscription_requests"
  ON subscription_requests
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY "super_admin_update_subscription_requests"
  ON subscription_requests
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super_admin')
  );

ALTER TABLE public.tenants
  ALTER COLUMN plan DROP DEFAULT,
  ALTER COLUMN plan TYPE tenant_plan USING plan::text::tenant_plan,
  ALTER COLUMN plan SET DEFAULT 'free';

-- matches.match_format does not exist yet; create it typed.
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS match_format public.match_format NOT NULL DEFAULT 't20';

ALTER TABLE public.matches
  ALTER COLUMN match_type DROP DEFAULT,
  ALTER COLUMN match_type TYPE public.match_type USING match_type::text::match_type,
  ALTER COLUMN match_type SET DEFAULT 'group';

ALTER TABLE public.matches
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.match_status USING status::text::match_status,
  ALTER COLUMN status SET DEFAULT 'scheduled';

ALTER TABLE public.matches
  ALTER COLUMN toss_decision TYPE public.toss_decision USING toss_decision::text::toss_decision;

ALTER TABLE public.match_innings
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.innings_status USING status::text::innings_status,
  ALTER COLUMN status SET DEFAULT 'not_started';

ALTER TABLE public.match_balls
  ALTER COLUMN wicket_type TYPE public.wicket_type USING wicket_type::text::wicket_type;

ALTER TABLE public.tournaments
  ALTER COLUMN format TYPE public.tournament_format USING format::text::tournament_format;

ALTER TABLE public.tournaments
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.tournament_status USING status::text::tournament_status,
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE public.venues
  ALTER COLUMN ground_type TYPE public.ground_type USING ground_type::text::ground_type;

COMMIT;

-- ============================================================================
-- MIGRATION: 20260623_add_user_tenant_roles.sql
-- ============================================================================

-- Migration: Create user_tenant_roles junction table
-- Fixes BUG-3: Users can now have different roles per tenant
-- Previously, users had a single global "role" column, making it impossible
-- for a user to be league_owner in Tenant A and scorer in Tenant B.

-- 1. Create the junction table
CREATE TABLE IF NOT EXISTS user_tenant_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'fan',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Unique constraint: one role per user per tenant
  UNIQUE(user_id, tenant_id)
);

-- 2. Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_user_id ON user_tenant_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_tenant_id ON user_tenant_roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_user_tenant ON user_tenant_roles(user_id, tenant_id);

-- 3. Migrate existing data from users table to the junction table
-- For each user, create a role entry for each tenant they belong to
INSERT INTO user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT
  u.id as user_id,
  unnest(u.tenant_ids) as tenant_id,
  u.role,
  true
FROM users u
WHERE u.tenant_ids IS NOT NULL AND array_length(u.tenant_ids, 1) > 0
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- 4. Also create entries for tenant owners who may not have tenant_ids set
INSERT INTO user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT
  u.id as user_id,
  t.id as tenant_id,
  'league_owner'::user_role,
  true
FROM tenants t
JOIN users u ON u.id = t.owner_id
WHERE NOT EXISTS (
  SELECT 1 FROM user_tenant_roles utr
  WHERE utr.user_id = u.id AND utr.tenant_id = t.id
)
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Note: The old users.role and users.tenant_ids columns are kept for backward
-- compatibility during migration. They should be removed in a future migration
-- after all code has been updated to use user_tenant_roles.

-- ============================================================================
-- MIGRATION: 20261004090000_add_match_live_stream_and_scorer.sql
-- ============================================================================

-- Live streaming + scorer assignment for matches
-- Additive only: adds columns, enum types, and indexes. Safe to re-run.

DO $$ BEGIN
  CREATE TYPE stream_source AS ENUM ('facebook', 'youtube', 'rtmp', 'webrtc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE stream_status AS ENUM ('idle', 'live', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS live_stream_url text,
  ADD COLUMN IF NOT EXISTS stream_source text,
  ADD COLUMN IF NOT EXISTS stream_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS scorer_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Convert the text columns onto the enum types (no-op if already converted).
-- The default must be dropped first: a text default cannot be cast implicitly.
ALTER TABLE matches
  ALTER COLUMN stream_status DROP DEFAULT;

ALTER TABLE matches
  ALTER COLUMN stream_source TYPE stream_source USING NULLIF(stream_source, '')::stream_source;

ALTER TABLE matches
  ALTER COLUMN stream_status TYPE stream_status USING stream_status::stream_status;

ALTER TABLE matches
  ALTER COLUMN stream_status SET DEFAULT 'idle'::stream_status;

CREATE INDEX IF NOT EXISTS idx_matches_scorer_id ON matches(scorer_id);
CREATE INDEX IF NOT EXISTS idx_matches_stream_status ON matches(stream_status) WHERE stream_status = 'live';

-- ============================================================================
-- MIGRATION: 20261004090100_create_verification_tokens.sql
-- ============================================================================

-- Verification tokens for multi-channel OTP (registration, password reset, renewal, admin 2FA)
-- Codes are stored as HMAC-SHA256 hashes, never plaintext.

CREATE TABLE IF NOT EXISTS verification_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  identifier text NOT NULL,
  token_hash text NOT NULL,
  channel text NOT NULL,
  purpose text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_tokens_identifier
  ON verification_tokens(identifier, purpose);

-- Opportunistic cleanup of expired/verified rows (called by the renewal cron).
CREATE OR REPLACE FUNCTION cleanup_verification_tokens()
RETURNS integer AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM verification_tokens
  WHERE expires_at < now() - interval '1 day'
     OR (verified_at IS NOT NULL AND verified_at < now() - interval '1 day');
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MIGRATION: 20261004090200_harden_verification_tokens.sql
-- ============================================================================

-- Harden the OTP verification_tokens table.
--
-- Tokens are secrets: app access goes through DATABASE_URL (service_role /
-- postgres), which bypasses RLS. PostgREST (anon/authenticated) must never be
-- able to read or write them — consistent with migrations 003/014/024.

ALTER TABLE IF EXISTS public.verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.verification_tokens FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.verification_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.verification_tokens FROM anon;
REVOKE ALL ON TABLE public.verification_tokens FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_tokens TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_tokens TO ssl;
  END IF;
END $$;

-- No permissive policies for anon/authenticated: with RLS forced and no policy,
-- every non-bypassing role is denied.

-- ============================================================================
-- MIGRATION: 20261004100000_create_user_invites.sql
-- ============================================================================

-- Team-scoped role invitations (team manager / coach / scorer).
-- Tokens are stored as SHA-256 hashes; the plaintext is emailed once.

CREATE TABLE IF NOT EXISTS user_invites (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role user_role NOT NULL DEFAULT 'team_manager',
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_invites_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_user_invites_tenant ON user_invites(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_user_invites_email ON user_invites(email);

-- Only the platform (service_role) needs this table; PostgREST clients must not
-- read or write invite tokens.
ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_invites FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_invites FROM PUBLIC;
REVOKE ALL ON TABLE public.user_invites FROM anon;
REVOKE ALL ON TABLE public.user_invites FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_invites TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_invites TO ssl;
  END IF;
END $$;

-- ============================================================================
-- MIGRATION: 20261004100100_constrain_user_invites_role.sql
-- ============================================================================

-- Defense in depth: user_invites.role reuses the platform user_role enum, which
-- includes privileged values (super_admin / league_owner). Invitations must only
-- ever grant team-scoped roles, so constrain at the storage layer as well as in
-- the application Zod schema.

ALTER TABLE public.user_invites
  DROP CONSTRAINT IF EXISTS user_invites_invitable_role_check;

ALTER TABLE public.user_invites
  ADD CONSTRAINT user_invites_invitable_role_check
  CHECK (role IN ('team_manager', 'coach', 'scorer'));

-- ============================================================================
-- MIGRATION: 20261004110000_create_invoices.sql
-- ============================================================================

-- Tax invoices / receipts for settled subscription payments.

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  invoice_number text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  subscription_id uuid,
  status text NOT NULL DEFAULT 'issued',
  currency text NOT NULL DEFAULT 'PKR',
  subtotal numeric(12,2) NOT NULL,
  tax_rate numeric(5,2) DEFAULT 0,
  tax_amount numeric(12,2) DEFAULT 0,
  total numeric(12,2) NOT NULL,
  amount_paid numeric(12,2) DEFAULT 0,
  description text,
  plan text,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'issued', 'paid', 'void'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id, created_at);

-- Sequential, race-safe invoice numbering.
-- ssl_invoice_counter(year) holds the last sequence used for that year.
CREATE TABLE IF NOT EXISTS ssl_invoice_counter (
  year integer PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_invoice_number(p_year integer)
RETURNS text AS $$
DECLARE
  next_val integer;
BEGIN
  INSERT INTO ssl_invoice_counter (year, last_value)
  VALUES (p_year, 1)
  ON CONFLICT (year)
  DO UPDATE SET last_value = ssl_invoice_counter.last_value + 1
  RETURNING last_value INTO next_val;

  RETURN 'SSL-INV-' || p_year::text || '-' || lpad(next_val::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Platform-only access: invoices are financial records.
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.invoices FROM PUBLIC;
REVOKE ALL ON TABLE public.invoices FROM anon;
REVOKE ALL ON TABLE public.invoices FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoices TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoices TO ssl;
  END IF;
END $$;

-- ============================================================================
-- MIGRATION: 20261004110100_fix_invoice_numbering_concurrency.sql
-- ============================================================================

-- Replace the table-backed invoice counter with a sequence.
--
-- Why: ssl_invoice_number() used INSERT ... ON CONFLICT DO UPDATE, which takes a
-- row-level lock for the rest of the transaction. Behind PgBouncer in
-- transaction pooling mode (DATABASE_URL port 6543) two concurrent calls for the
-- same year deadlocked each other, hanging the admin approval request.
--
-- A sequence is non-blocking and inherently race-free, which is what invoice
-- numbering actually requires. The year stays in the number for readability and
-- the padded counter stays globally unique via the UNIQUE index.

DROP FUNCTION IF EXISTS public.next_invoice_number(integer);

DROP TABLE IF EXISTS public.ssl_invoice_counter;

CREATE SEQUENCE IF NOT EXISTS public.ssl_invoice_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text AS $$
BEGIN
  RETURN 'SSL-INV-'
    || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-'
    || lpad(nextval('public.ssl_invoice_seq')::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.next_invoice_number() IS
  'Returns the next invoice number (SSL-INV-YYYY-NNNNNN). Non-blocking; safe under concurrency.';

-- Backwards-compatible overload for the previous (year) signature.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_year integer)
RETURNS text AS $$
BEGIN
  RETURN 'SSL-INV-'
    || p_year::text || '-'
    || lpad(nextval('public.ssl_invoice_seq')::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MIGRATION: 20261004200000_harden_public_surface_privileges.sql
-- ============================================================================

-- Harden public-surface database exposure.
--
-- Findings came from `supabase_get_advisors` against the live project
-- (security advisor) plus direct inspection of pg_proc / pg_class. Only the
-- issues that are actually exploitable from an unauthenticated or
-- authenticated-but-untrusted PostgREST client are addressed here; see the
-- notes on each item for the ones deliberately left alone.
--
-- Context: this application never reads these tables through PostgREST. All
-- access is server-side via the service_role connection string, which bypasses
-- RLS and holds full table grants. So revoking anon/authenticated privileges
-- breaks nothing, and leaving them granted only widens the public API surface.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Materialized view readable by anon — CROSS-TENANT LEAK
--
-- `player_all_time_stats` is a materialized view. Postgres cannot apply RLS to
-- a materialized view, so the only possible control is table-level privileges.
-- The advisor reported it as selectable by anon and authenticated; inspection
-- confirmed 0 policies (meaningless for a matview) and that the definition
-- projects `tenant_id` alongside per-player aggregates:
--
--     SELECT tenant_id, player_id, sum(runs_scored), ... FROM player_season_stats
--     GROUP BY tenant_id, player_id;
--
-- Effect before this change: `GET /rest/v1/player_all_time_stats` with no
-- credentials returns every tenant's player_id -> statistics mapping. That is a
-- direct violation of the tenant-isolation model the rest of the codebase
-- enforces, and it enumerates both other tenants and their player rosters.
--
-- Fix: revoke from anon and authenticated; keep service_role (which the Nest
-- services use) fully privileged. The public leaderboards UI reads through a
-- server component, not PostgREST, so it is unaffected.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.player_all_time_stats FROM anon;
REVOKE ALL ON public.player_all_time_stats FROM authenticated;
GRANT  ALL ON public.player_all_time_stats TO service_role;

-- Belt-and-braces: an explicit deny view is NOT used here because revoking the
-- privilege is the correct fix. A `security_invoker` view over the matview is
-- also not possible — RLS does not apply to the underlying matview either.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `next_invoice_number()` callable by anon — SEQUENCE BURN
--
-- `EXECUTE` is granted to PUBLIC by default in Postgres, which is why the
-- advisor/inspection show anon_exec = true. Both overloads return
-- `nextval('public.ssl_invoice_seq')`, so ANY unauthenticated caller can
-- advance the shared invoice sequence by invoking the function repeatedly
-- through `/rest/v1/rpc/next_invoice_number`. Consequences: invoice numbers are
-- no longer gapless, a tenant can be pushed to a very large invoice number, and
-- the sequence burns toward exhaustion without any real invoice.
--
-- Fix: revoke EXECUTE from PUBLIC (and therefore from anon/authenticated).
-- The service calls this as service_role, so it keeps working.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.next_invoice_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_invoice_number(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. `SECURITY DEFINER` helpers reachable over PostgREST RPC — NOT CHANGED
--
-- The advisor recommends revoking EXECUTE on `current_tenant_id()`,
-- `current_user_id()`, `is_super_admin()` and `user_belongs_to_tenant(uuid)`
-- from `authenticated`. DO NOT DO THAT: it would break tenant isolation
-- project-wide.
--
-- RLS policy expressions are evaluated with the privileges of the role running
-- the query, and function EXECUTE is checked against that same role.
-- SECURITY DEFINER changes what the function *body* runs as, not who must be
-- granted EXECUTE. Revoking EXECUTE from `authenticated` therefore makes every
-- policy calling these helpers raise "permission denied for function".
--
-- Verified affected policies (queried from pg_policies):
--   tenants.tenants_access, tournaments.tournaments_tenant, teams.teams_tenant,
--   subscriptions.super_admin_all_subscriptions,
--   subscriptions.tenant_read_subscriptions, payments.super_admin_all_payments,
--   announcements.*, feature_flags.*, system_health.*, error_logs.*,
--   players.players_tenant, venues.venues_tenant, ...
--
-- That would be a total RLS outage for every authenticated read.
--
-- The exposure the advisor describes is also mostly not real:
--   * `anon_exec` is already false for all four — unauthenticated callers
--     cannot reach them at all.
--   * The three zero-argument helpers only echo the caller's own JWT claims,
--     which they already hold.
--   * `user_belongs_to_tenant(uuid)` is a genuine membership-enumeration
--     oracle, but it is deliberately reachable: the tenant switcher relies on it
--     to decide which tenants to offer a signed-in user. Removing it removes a
--     product feature.
--
-- Mitigation that does NOT break policies: keep EXECUTE for `authenticated` and
-- rely on these functions only ever returning data about the *caller*. If the
-- enumeration oracle is later judged unacceptable, fix it server-side (the Nest
-- layer already has `resolveActiveTenantId` / `requireTenantContext`) rather
-- than revoking a privilege RLS depends on.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. `apply_scoring_event()` reported as "callable by anon" — NOT EXPLOITABLE
--
-- It is a TRIGGER function (`RETURNS trigger`). PostgREST's rpc endpoint cannot
-- invoke trigger functions, so anon_exec = true is inert. No trigger or policy
-- references it. No privilege change is warranted; the search_path pin in
-- section 5 is still worthwhile hardening.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Mutable `search_path` on nine functions
--
-- All nine were reported by the advisor and confirmed to have `proconfig = NULL`.
--
-- IMPORTANT correction to the advisory's framing: every one of these is
-- SECURITY INVOKER (`prosecdef = false`), not SECURITY DEFINER. Pinning
-- search_path is therefore defence-in-depth against object shadowing rather
-- than a fix for an active privilege-escalation path — these functions run with
-- the caller's own privileges. It is still worth doing: an unpinned
-- search_path lets anyone who can create objects in a schema on the path
-- substitute a different table or function.
--
-- Signatures are taken from the catalog via `oid::regprocedure` rather than
-- hand-written. Two of these functions are overloaded, and
-- `calculate_player_stats` takes (p_player_id uuid, p_tenant_id uuid) — a
-- hardcoded zero-arg ALTER FUNCTION would have errored and aborted the entire
-- migration. Selecting `oid::regprocedure` also skips anything already pinned.
--
-- The four functions discussed in section 3 were also reported by the advisor
-- but already pin `search_path = public, pg_catalog, auth`. Not touched — that
-- advisory hit was a false positive for them.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    -- Schema-qualified because `oid::regprocedure` renders an UNQUALIFIED name
    -- when the function happens to be visible on the current search_path. Relying
    -- on that would make the ALTER fail under a different search_path.
    SELECT format('%I.%s', n.nspname, p.oid::regprocedure) AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proconfig IS NULL
      AND p.proname IN (
        'update_live_scorecard',
        'calculate_player_stats',
        'update_waitlist_updated_at',
        'apply_scoring_event',
        'refresh_player_all_time_stats',
        'expire_old_subscription_requests',
        'cleanup_verification_tokens',
        'next_invoice_number'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', r.sig);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Deliberately NOT changed
-- ─────────────────────────────────────────────────────────────────────────────
-- * `apply_scoring_event()` reported as "callable by anon": it is a TRIGGER
--   function (`RETURNS trigger`). PostgREST cannot invoke trigger functions via
--   rpc, so this is not exploitable and no privilege change is warranted.
--   Its search_path is still pinned above, which is worthwhile hardening.
--
-- * `invoices`, `user_invites`, `verification_tokens` reported as "RLS enabled,
--   no policies" (INFO): this is the correct fail-closed state for tables only
--   ever accessed as service_role. Adding permissive policies would make these
--   directly reachable from a browser and would be a regression, not a fix.
--
-- * `pg_trgm` and `btree_gin` installed in `public` (advisor WARN): moving an
--   extension between schemas can break dependent operators/classes and is not
--   an isolation risk. Worth doing as separate maintenance, not in a hardening
--   migration.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Verification (run after applying):
--
--   -- 1. expect false for both: matview is no longer public
--   select has_table_privilege('anon','public.player_all_time_stats','SELECT') as anon_matview;
--   select has_table_privilege('authenticated','public.player_all_time_stats','SELECT') as authed_matview;
--
--   -- 2. expect false: anon can no longer burn the invoice sequence
--   select has_function_privilege('anon','public.next_invoice_number()','EXECUTE') as anon_inv;
--
--   -- 3. expect 0 rows: every listed function now pins its search_path
--   select p.proname, p.proconfig from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proconfig is null
--     and p.proname in ('update_live_scorecard','calculate_player_stats',
--       'update_waitlist_updated_at','apply_scoring_event',
--       'refresh_player_all_time_stats','expire_old_subscription_requests',
--       'cleanup_verification_tokens','next_invoice_number');
--
--   -- 4. expect UNCHANGED count vs. before applying. Section 3 deliberately
--   --    makes no change here; if this number moves, something else did.
--   select count(*) from pg_policies where schemaname = 'public';
--
--   -- 5. smoke test the paths that DO depend on these functions:
--   --    authenticated reads through PostgREST, and invoice creation as
--   --    service_role. Both must still work.
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- MIGRATION: 20261004210000_create_user_tenant_roles.sql
-- ============================================================================

-- Create the missing `user_tenant_roles` junction table.
--
-- WHY THIS IS REQUIRED
-- --------------------
-- `packages/database/src/schema/user-tenant-roles.ts` defines this table and
-- exports it, and two production code paths depend on it:
--
--   * apps/web/src/lib/rbac-server.ts:49-58  — the junction-first tenant role
--     lookup used by `hasPermissionServer` / `requirePermissionServer`.
--   * apps/web/src/app/actions/users-invites.ts:221-237 — reads and writes it in
--     `acceptInvite`.
--
-- Inspection of the live project showed `to_regclass('public.user_tenant_roles')`
-- = NULL: the table was defined in the Drizzle schema but never created in the
-- database.
--
-- Observed impact:
--   * `acceptInvite` has NO error handling around this query, so redeeming a team
--     manager / coach / scorer invite fails outright with
--     "relation public.user_tenant_roles does not exist". Invite flow is broken.
--   * `getUserRoleForTenant` wraps the query in try/catch and falls back to the
--     legacy `users.role` + `users.tenant_ids` columns. This fails *silently*,
--     which is worse in one respect: a user who is `league_owner` in tenant A and
--     `scorer` in tenant B receives their legacy single role everywhere, so
--     per-tenant permissions are wrong without any error surfacing.
--
-- Column types are matched exactly to the Drizzle schema and to the live
-- `users` table (uuid PK). `uuid_generate_v7()` and the `user_role` enum were
-- both verified to already exist in this database.

CREATE TABLE IF NOT EXISTS public.user_tenant_roles (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role        user_role NOT NULL DEFAULT 'fan',
  -- True if this is the user's primary/default tenant.
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- One role per (user, tenant). The Drizzle schema omits this, but the lookup
  -- in rbac-server.ts does `.limit(1)` on (user_id, tenant_id) and then reads a
  -- single `role`, so duplicates would make the effective permission
  -- non-deterministic. Kept here so future `db:generate` does not drift; the
  -- matching `unique()` has been added to the Drizzle schema as well.
  CONSTRAINT user_tenant_roles_user_tenant_key UNIQUE (user_id, tenant_id)
);

COMMENT ON TABLE public.user_tenant_roles IS
  'User-tenant role junction: one row per (user, tenant). Replaces the single users.role + users.tenant_ids design.';

-- Tenant-wide lookups (admin UIs listing everyone in a league) filter on
-- tenant_id alone, which the UNIQUE index above does not cover.
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_tenant_id
  ON public.user_tenant_roles (tenant_id);

-- Reuse the project's shared updated_at trigger function (18 other tables use it).
DROP TRIGGER IF EXISTS user_tenant_roles_updated_at ON public.user_tenant_roles;
CREATE TRIGGER user_tenant_roles_updated_at
  BEFORE UPDATE ON public.user_tenant_roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
--
-- Idiom copied from the existing policies in this database:
--   tenant isolation -> tenant_id = ANY (current_tenant_id())
--   super admin      -> is_super_admin()
--   own row          -> user_id = current_user_id()   (current_user_id() = auth.uid())
--
-- Scoped `TO authenticated` so anon receives nothing at all.
--
-- IMPORTANT — known limitation, deliberately not "fixed" here:
-- `current_tenant_id()` resolves tenants from the LEGACY `users.tenant_ids`
-- array only. It does not consult this table. So tenant isolation for THIS table
-- is enforced against the legacy array until `current_tenant_id()` is widened to
-- union both sources. Widening it is a separate, riskier change: ~88 existing
-- policies depend on its current behaviour, and `users.tenant_ids` is still the
-- source of truth for existing rows. Do not change it in the same migration.
--
-- Application writes (acceptInvite) run as service_role, which bypasses RLS, so
-- these policies govern direct PostgREST access only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_tenant_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tenant_roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_tenant_roles_read ON public.user_tenant_roles;
CREATE POLICY user_tenant_roles_read ON public.user_tenant_roles
  FOR SELECT TO authenticated
  USING (
    user_id = current_user_id()
    OR tenant_id = ANY (current_tenant_id())
  );

DROP POLICY IF EXISTS user_tenant_roles_super_admin_all ON public.user_tenant_roles;
CREATE POLICY user_tenant_roles_super_admin_all ON public.user_tenant_roles
  FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill so per-tenant RBAC has a source of truth immediately.
--
-- The legacy design allowed exactly one role per user across all of their
-- tenants, so the projection is lossless with respect to existing behaviour:
-- every legacy membership becomes one junction row carrying the same role, and
-- the first tenant is marked primary. This is also what makes the junction-first
-- lookup return the same answer the legacy fallback did, so enabling this
-- migration does not change anyone's effective permissions.
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running is safe.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT
  u.id,
  tid,
  u.role,
  (
    tid = (
      SELECT a.x
      FROM unnest(COALESCE(u.tenant_ids, ARRAY[]::uuid[])) WITH ORDINALITY AS a(x, n)
      ORDER BY a.n
      LIMIT 1
    )
  )
FROM public.users u
CROSS JOIN LATERAL unnest(COALESCE(u.tenant_ids, ARRAY[]::uuid[])) AS tid
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification (run after applying):
--
--   -- 1. table exists, RLS on and forced, 2 policies
--   select relname, relrowsecurity, relforcerowsecurity
--   from pg_class where oid = 'public.user_tenant_roles'::regclass;
--   select count(*) from pg_policies where schemaname='public'
--    and tablename='user_tenant_roles';                                  -- expect 2
--
--   -- 2. backfill landed: one row per legacy membership
--   select count(*) from public.user_tenant_roles;
--   select count(*) from public.users
--    where cardinality(COALESCE(tenant_ids, ARRAY[]::uuid[])) > 0;      -- expect equal
--
--   -- 3. exactly one primary per user that has any row
--   select user_id, count(*) filter (where is_primary) as primaries
--   from public.user_tenant_roles group by user_id having primaries > 1;  -- expect 0 rows
--
--   -- 4. existing RLS policies unchanged (88 before, 88 after — this migration
--   --    adds policies only on the new table)
--   select count(*) from pg_policies where schemaname='public';
--
--   -- 5. invite flow: accept a team_manager invite, then confirm
--   --    getUserRoleForTenant resolves without falling back to the legacy path.
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- MIGRATION: 20261004220000_revoke_invoice_fn_from_anon.sql
-- ============================================================================

-- Corrective follow-up to 20261004200000_harden_public_surface_privileges.sql.
--
-- That migration revoked EXECUTE on `next_invoice_number` from PUBLIC and the
-- revoke appeared to succeed. Verification then showed
-- `has_function_privilege('anon', ..., 'EXECUTE')` was STILL true.
--
-- Cause: EXECUTE was not being inherited from PUBLIC. This database has
-- explicit per-role grants, visible in pg_proc.proacl as:
--
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- `REVOKE ... FROM PUBLIC` removes only the PUBLIC grant. Any role named
-- directly in the ACL keeps its own grant, so the anon/authenticated entries
-- survived untouched.
--
-- Fix: revoke from the named roles explicitly. service_role is retained because
-- the Nest invoice flow calls this function server-side.
--
-- Verified after applying:
--   select has_function_privilege('anon','public.next_invoice_number()','EXECUTE');
--   select has_function_privilege('service_role','public.next_invoice_number()','EXECUTE');
--   -- expect false, true
--
-- Lesson applied to the audit: for Supabase-provisioned projects, never assume
-- a privilege comes from PUBLIC. Inspect pg_proc.proacl / pg_class.relacl
-- before and after, because a REVOKE from PUBLIC can be a silent no-op.

REVOKE ALL ON FUNCTION public.next_invoice_number() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.next_invoice_number(integer) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(integer) TO service_role;

-- Belt and braces: the same explicit-grant trap could apply to the matview.
-- Confirm rather than assume.
REVOKE ALL ON public.player_all_time_stats FROM anon, authenticated;
GRANT  ALL ON public.player_all_time_stats TO service_role;

-- ============================================================================
-- MIGRATION: 20261004230000_authoritative_tenant_roles_remove_superadmin_backdoor.sql
-- ============================================================================

-- Decision 1: remove the hardcoded super-admin email backdoor.
-- Decision 2: make `current_tenant_roles` the authoritative source of tenant
--             membership, with the legacy `users.tenant_ids` array as fallback.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 0. PREREQUISITE — break an RLS recursion cycle (must land with decision 2)
-- ─────────────────────────────────────────────────────────────────────────────
-- `user_tenant_roles` was created with FORCE ROW LEVEL SECURITY. Its read policy
-- references `current_tenant_id()`. Decision 2 makes `current_tenant_id()` read
-- `user_tenant_roles`. With RLS forced, even the table owner is subject to
-- policies, and the SECURITY DEFINER `current_tenant_id()` (owner = postgres) is
-- therefore subject to that policy too:
--
--     current_tenant_id() -> user_tenant_roles -> policy -> current_tenant_id()
--
-- Postgres raises "infinite recursion detected in policy" for that, which would
-- break every authenticated read in the application.
--
-- Two changes break the cycle:
--   (a) NO FORCE — the owner (and SECURITY DEFINER functions it owns) can read
--       the table. anon/authenticated remain fully restricted by the policies.
--   (b) the read policy no longer calls `current_tenant_id()`.
--
-- Impact on the app: none. Every application path reads via service_role, which
-- bypasses RLS. These policies govern direct PostgREST access only, where
-- returning just the caller's own role rows is the correct, tighter behaviour.
ALTER TABLE public.user_tenant_roles NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_tenant_roles_read ON public.user_tenant_roles;
CREATE POLICY user_tenant_roles_read ON public.user_tenant_roles
  FOR SELECT TO authenticated
  USING (user_id = current_user_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Remove the hardcoded super-admin email
-- ─────────────────────────────────────────────────────────────────────────────
-- `is_super_admin()` contained:
--
--     IF user_email = 'kaash0542@gmail.com' THEN RETURN true; END IF;
--
-- Anyone able to register with that address became super-admin regardless of any
-- `users.role` value — a credential equivalent living in the database, and one
-- that survives password resets, 2FA, and key rotation.
--
-- The function already resolves super-admin from data in both branches
-- (`users.role` by auth uid, then by JWT email), so removing the hardcoded line
-- removes only the bypass. Added an explicit NULL guard for the email branch,
-- which previously ran a lookup with a NULL value.
--
-- LOCKOUT SAFETY: the only supported way to hold super-admin is now
-- `users.role = 'super_admin'`. Grant it with:
--
--   UPDATE public.users SET role = 'super_admin' WHERE email = '<your email>';
--
-- Run that BEFORE deploying this function if your account is not already a
-- super_admin row. The verification block at the end of this file includes a
-- pre-flight query for exactly this.
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'auth'
AS $function$
DECLARE
  user_email text;
  user_uuid uuid;
  user_role text;
BEGIN
  user_uuid := auth.uid();

  IF user_uuid IS NOT NULL THEN
    SELECT u.role INTO user_role FROM public.users u WHERE u.id = user_uuid;
    IF user_role = 'super_admin' THEN
      RETURN true;
    END IF;
  END IF;

  user_email := (auth.jwt() ->> 'email')::text;
  IF user_email IS NULL OR user_email = '' THEN
    RETURN false;
  END IF;

  SELECT u.role INTO user_role FROM public.users u WHERE u.email = user_email;
  RETURN COALESCE(user_role = 'super_admin', false);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tenant resolution: junction table authoritative, legacy array as fallback
-- ─────────────────────────────────────────────────────────────────────────────
-- ~90 RLS policies call `current_tenant_id()`, so this function is the backbone
-- of tenant isolation. Previously it read only the legacy `users.tenant_ids`
-- array, which can express exactly one membership list and is not per-tenant
-- role aware.
--
-- Design choice — "junction wins, legacy only as fallback" rather than a UNION
-- of both sources:
--
--   * UNION would WIDEN access. If the junction table ever held a stale tenant
--     membership, `tenant_id = ANY(current_tenant_id())` would match more rows
--     than before. Widening an isolation function is the wrong direction to err.
--   * Junction-authoritative means the new, role-aware data wins once present,
--     so a user removed from a tenant is correctly excluded even while the
--     legacy array still lists them.
--   * The fallback keeps every user provisioned before this change working.
--     Migration 20261004210000 backfilled the junction from `tenant_ids`, so
--     junction ⊇ legacy for pre-existing rows, and the backfill is idempotent.
--
-- `acceptInvite` writes both the junction row and the legacy array, so the two
-- stay in sync going forward.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'auth'
AS $function$
DECLARE
  legacy_tenants  uuid[];
  junction_tenants uuid[];
  user_pk         uuid;
  user_uuid       uuid;
  user_email      text;
BEGIN
  user_uuid := auth.uid();
  user_email := (auth.jwt() ->> 'email')::text;

  IF user_uuid IS NULL AND user_email IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  -- Resolve the internal users.id from either the auth uid or the JWT email,
  -- matching the lookup paths the previous implementation used.
  IF user_uuid IS NOT NULL THEN
    SELECT u.id INTO user_pk FROM public.users u WHERE u.id = user_uuid;
  END IF;
  IF user_pk IS NULL AND user_email IS NOT NULL AND user_email <> '' THEN
    SELECT u.id INTO user_pk FROM public.users u WHERE u.email = user_email;
  END IF;
  IF user_pk IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  -- Authoritative source: the junction table.
  SELECT COALESCE(array_agg(DISTINCT utr.tenant_id), ARRAY[]::uuid[])
    INTO junction_tenants
  FROM public.user_tenant_roles utr
  WHERE utr.user_id = user_pk;

  IF cardinality(junction_tenants) > 0 THEN
    RETURN junction_tenants;
  END IF;

  -- Fallback for users provisioned before the junction table existed.
  SELECT COALESCE(u.tenant_ids, ARRAY[]::uuid[])
    INTO legacy_tenants
  FROM public.users u
  WHERE u.id = user_pk;

  RETURN COALESCE(legacy_tenants, ARRAY[]::uuid[]);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────────────────────
-- PRE-FLIGHT (run this BEFORE relying on super-admin):
--   select email, role from public.users order by email;
--   -- ensure your row reads role = 'super_admin', or apply the UPDATE above
--
-- 1. No FORCE, 2 policies, and none of them call current_tenant_id()
--   select relforcerowsecurity from pg_class
--    where oid = 'public.user_tenant_roles'::regclass;                  -- false
--   select policyname, qual from pg_policies
--    where schemaname='public' and tablename='user_tenant_roles';        -- 2 rows
--
-- 2. The hardcoded address must no longer appear anywhere:
--   select prosrc from pg_proc
--    where proname='is_super_admin' and prosrc ilike '%kaash0542%';     -- 0 rows
--
-- 3. No policy anywhere may reference a function that reads its own table:
--   -- expect 0 rows (the recursion guard)
--   select tablename, policyname from pg_policies
--   where schemaname='public'
--     and policyname = 'user_tenant_roles_read'
--     and qual ilike '%current_tenant_id%';
--
-- 4. Policy count unchanged at 90 (this migration only replaces policies on one
--    table; it adds none):
--   select count(*) from pg_policies where schemaname='public';         -- 90
--
-- 5. RUNTIME SMOKE TESTS — these require a signed-in user and are the only way
--    to prove decision 2 did not change effective permissions:
--      a. sign in, load /dashboard, confirm no permission-denied errors
--      b. a user who is league_owner in tenant A but scorer in tenant B must
--         see A's admin UI and be denied B's — this is the behaviour decision 2
--         was supposed to enable, and it is what the legacy path got wrong
--      c. create and accept a team_manager invite (exercises acceptInvite,
--         which was broken by the missing table)
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- MIGRATION: 20261004240000_ensure_tenant_owner_has_role.sql
-- ============================================================================

-- ============================================================================
-- Ensure every tenant owner actually holds a role in their own tenant.
--
-- THE BUG THIS FIXES
-- `tenants.owner_id` and `user_tenant_roles` are two independent sources of
-- truth, and nothing tied them together. `current_tenant_id()` reads the
-- junction table, so a tenant whose `owner_id` has no corresponding
-- `user_tenant_roles` row produces a tenant owner who is locked out of their
-- own league: every RLS policy evaluates `current_tenant_id()` to NULL and denies.
--
-- Confirmed live in this project before the fix:
--
--   tenant `ssl` (Shakir Super League, enterprise)
--     owner_id -> kashif@maliktech.pk
--     users.role = 'fan', users.tenant_ids = '{}', user_tenant_roles = 0 rows
--     => owner cannot read or write anything in the league they own
--
-- The previous pass reported the database as empty and so could not observe this.
-- It was not empty.
--
-- THE FIX
-- 1. Backfill any tenant whose owner has no membership row (idempotent).
-- 2. Install a trigger so the invariant holds for future tenants and for any
--    future `owner_id` change, instead of relying on every code path to remember
--    to insert the role row.
--
-- DELIBERATE NON-DESTRUCTIVE BEHAVIOUR
-- This only ever ADDS a missing row (`ON CONFLICT DO NOTHING`). It never
-- overwrites or removes an existing role, so it cannot silently promote or demote
-- anyone. In particular a user who is deliberately a `scorer` in a tenant they
-- do not own keeps that role.
--
-- Note this can leave an owner holding, say, `scorer` in their own tenant if such
-- a row already exists. Narrowing an existing owner role is a data decision and
-- is deliberately out of scope here.
--
-- Sentinel owners (`system-default` uses the all-zero UUID) are skipped: they do
-- not exist in `users`, and `user_tenant_roles.user_id` is a real FK, so the
-- insert would fail.
-- ============================================================================

BEGIN;

-- ─── 1. Backfill the gaps ───────────────────────────────────────────────────

INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT
  t.owner_id,
  t.id,
  'league_owner',
  -- Mark primary only if this user has no other primary membership.
  NOT EXISTS (
    SELECT 1 FROM public.user_tenant_roles x
    WHERE x.user_id = t.owner_id AND x.is_primary
  )
FROM public.tenants t
-- Inner join: drops placeholder/sentinel owners that are not real users.
JOIN public.users u ON u.id = t.owner_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_tenant_roles utr
  WHERE utr.user_id = t.owner_id AND utr.tenant_id = t.id
)
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- ─── 2. Maintain the invariant going forward ────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_tenant_owner_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- On UPDATE only act when owner_id genuinely changed, so unrelated tenant
  -- edits do not churn this table.
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
    RETURN NEW;
  END IF;

  -- Placeholder owners (e.g. the all-zero sentinel) have no `users` row and the
  -- FK below would reject the insert. Skip rather than fail the tenant write.
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.owner_id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, is_primary)
  VALUES (
    NEW.owner_id,
    NEW.id,
    'league_owner',
    NOT EXISTS (
      SELECT 1 FROM public.user_tenant_roles x
      WHERE x.user_id = NEW.owner_id AND x.is_primary
    )
  )
  ON CONFLICT (user_id, tenant_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_tenant_owner_role() IS
  'Maintains the invariant that a tenant owner holds a role in their own tenant. Adds only; never modifies an existing role.';

DROP TRIGGER IF EXISTS trg_ensure_tenant_owner_role ON public.tenants;

CREATE TRIGGER trg_ensure_tenant_owner_role
AFTER INSERT OR UPDATE OF owner_id ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.ensure_tenant_owner_role();

-- The function is SECURITY DEFINER, so lock down execution: only the trigger
-- needs to run it. Leaving this callable by `authenticated` would be an
-- unauthenticated-ish write primitive.
REVOKE ALL ON FUNCTION public.ensure_tenant_owner_role() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ============================================================================
-- MIGRATION: 20261004250000_fix_matview_trigger_definer.sql
-- ============================================================================

-- ============================================================================
-- Fix: refresh_player_all_time_stats() breaks `authenticated` writes.
--
-- THE BUG
-- `player_season_stats` carries a normal tenant-isolation policy
-- (`tenant_isolation_player_season_stats`, FOR ALL, TO authenticated), so an
-- authenticated user is *supposed* to be able to write their own tenant's rows.
-- They cannot. Every INSERT/UPDATE/DELETE on that table fires
--
--   trigger_refresh_player_all_time_stats  (AFTER INSERT OR DELETE OR UPDATE,
--                                           FOR EACH STATEMENT)
--
-- which calls refresh_player_all_time_stats(). That function is a plain
-- invoker-rights trigger, so it runs as `authenticated`, and
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires ownership of the
-- materialized view. The write therefore aborts:
--
--   ERROR: permission denied for materialized view player_all_time_stats
--
-- Reproduced directly (single-tenant user, own tenant, ROLLBACK):
--   DELETE FROM players WHERE name = 'Lahore Player 01';
--   -> ERROR: permission denied for materialized view player_all_time_stats
--
-- So the RLS policy advertises a write capability that is silently broken by a
-- trigger. The bug is currently latent rather than live: no application code
-- writes `player_season_stats` (it is read-only in `apps/web` and the mobile
-- app, via Drizzle on a privileged connection). The first person to implement
-- season-stat writes will hit it.
--
-- THE FIX
-- Make the function SECURITY DEFINER so the REFRESH runs with the privileges of
-- the function owner rather than the caller. `search_path` stays pinned.
--
-- Also revoke direct EXECUTE from anon/authenticated. PostgreSQL does not check
-- EXECUTE when a trigger *fires* (only when it is created), so this blocks
-- calling the function directly without disabling the trigger. Verified by
-- re-running the refresh afterwards.
--
-- ⚠️ KNOWN TRADEOFF — deliberately NOT resolved here
-- Refreshing a materialized view synchronously on the write path is a
-- well-known anti-pattern. It costs a full rebuild per writing *statement*, so
-- a loop of single-row inserts means one full rebuild per row. With the function
-- now SECURITY DEFINER, an authenticated user with write access to
-- `player_season_stats` can therefore amplify writes into repeated matview
-- rebuilds.
--
-- The correct fix is to move the refresh off the write path entirely — schedule
-- it (`pg_cron` is available on this project but not yet installed) or refresh
-- on read. That is NOT done here because it changes freshness semantics from
-- "immediately consistent" to "eventually consistent", which is a product
-- decision.
--
-- Worth weighing: `player_all_time_stats` is the only matview on the project and
-- is referenced by no application code at all — only by migration 017 and the
-- docs. If it is genuinely not needed, dropping the matview and its trigger
-- removes the problem rather than managing it.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_player_all_time_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- Refresh concurrently to avoid blocking readers. See the migration header:
    -- this still costs a full rebuild per statement and is the reason the
    -- function is SECURITY DEFINER (so the REFRESH can succeed) rather than a
    -- fix for the underlying performance characteristic.
    REFRESH MATERIALIZED VIEW CONCURRENTLY player_all_time_stats;
    RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.refresh_player_all_time_stats() IS
  'Trigger-maintained refresh of player_all_time_stats. SECURITY DEFINER so the REFRESH succeeds for non-owner writers; synchronous refresh on the write path is a known anti-pattern (see migration 20261004250000).';

-- Direct invocation is unnecessary; triggers do not check EXECUTE at fire time.
REVOKE ALL ON FUNCTION public.refresh_player_all_time_stats() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ============================================================================
-- MIGRATION: 20261012100136_league_membership_controls.sql
-- ============================================================================

-- Expand existing membership rows; do not change global accounts or assignments.
-- Apply only after reconciling the existing migration history (MIGRATION_STATUS.md).
BEGIN;

ALTER TABLE public.user_tenant_roles
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT user_tenant_roles_status_check CHECK (status IN ('active', 'suspended')),
  ADD CONSTRAINT user_tenant_roles_version_check CHECK (version >= 0);

-- Preserve explicit roles. Backfill only absent rows with valid league references.
-- A global platform role is never copied into league authority. Legacy owner
-- privilege is recognized only for the actual owner of that league.
INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT u.id, t.id,
  CASE
    WHEN t.owner_id = u.id THEN 'league_owner'::public.user_role
    WHEN u.role IN ('super_admin', 'league_owner') THEN 'fan'::public.user_role
    ELSE u.role
  END,
  false
FROM public.users u
CROSS JOIN LATERAL unnest(u.tenant_ids) AS legacy(tenant_id)
JOIN public.tenants t ON t.id = legacy.tenant_id
ON CONFLICT (user_id, tenant_id) DO NOTHING;

INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT u.id, t.id, 'league_owner'::public.user_role, false
FROM public.tenants t JOIN public.users u ON u.id = t.owner_id
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Shared versioning catches updates from any trusted writer, not just this UI.
CREATE FUNCTION public.bump_league_membership_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_tenant_roles_version
  BEFORE UPDATE ON public.user_tenant_roles
  FOR EACH ROW EXECUTE FUNCTION public.bump_league_membership_version();

-- Membership changes must use the authenticated, audited server command path.
-- Existing owner policies based on legacy role/arrays cannot bypass these checks.
REVOKE INSERT, UPDATE, DELETE ON public.user_tenant_roles FROM anon, authenticated;

-- Direct account writes must not change role/is_active/tenant_ids through the
-- legacy self-update policy. Profile changes continue through trusted app APIs.
REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated;

-- Keep the existing UUID/email identity bridge for this release (Clerk subject
-- mapping requires the separate identity migration). Narrow tenant authority to
-- active accounts, active explicit memberships and active leagues; no array
-- fallback after removal/suspension. Function ownership must remain a trusted
-- RLS-bypassing migration owner, as in 20261004230000, to avoid RLS recursion.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  user_pk uuid;
  user_uuid uuid;
  user_email text;
  result uuid[];
BEGIN
  user_uuid := auth.uid();
  user_email := auth.jwt() ->> 'email';
  IF user_uuid IS NOT NULL THEN
    SELECT u.id INTO user_pk FROM public.users u WHERE u.id = user_uuid;
  END IF;
  IF user_pk IS NULL AND user_email IS NOT NULL AND user_email <> '' THEN
    SELECT u.id INTO user_pk FROM public.users u WHERE u.email = user_email;
  END IF;
  IF user_pk IS NULL THEN RETURN ARRAY[]::uuid[]; END IF;
  SELECT COALESCE(array_agg(DISTINCT m.tenant_id), ARRAY[]::uuid[]) INTO result
  FROM public.user_tenant_roles m
  JOIN public.users u ON u.id = m.user_id
  JOIN public.tenants t ON t.id = m.tenant_id
  WHERE m.user_id = user_pk AND m.status = 'active'
    AND m.role <> 'super_admin' AND u.is_active = true AND t.is_active = true;
  RETURN result;
END;
$$;

-- Platform access is still distinct, but inactive global accounts must not
-- bypass membership through the database's existing platform-admin policies.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  user_uuid uuid;
  user_email text;
  result boolean;
BEGIN
  user_uuid := auth.uid();
  IF user_uuid IS NOT NULL THEN
    SELECT u.role = 'super_admin' AND u.is_active = true INTO result
      FROM public.users u WHERE u.id = user_uuid;
    IF FOUND THEN RETURN result; END IF;
  END IF;
  user_email := auth.jwt() ->> 'email';
  IF user_email IS NULL OR user_email = '' THEN RETURN false; END IF;
  SELECT u.role = 'super_admin' AND u.is_active = true INTO result
    FROM public.users u WHERE u.email = user_email;
  RETURN COALESCE(result, false);
END;
$$;

COMMENT ON COLUMN public.user_tenant_roles.status IS
  'League-only active/suspended status. Global account state remains users.is_active.';
COMMENT ON COLUMN public.user_tenant_roles.version IS
  'Database-incremented optimistic concurrency version for membership changes.';

COMMIT;

-- ============================================================================
-- MIGRATION: 20261013090000_invitation_delivery_state.sql
-- ============================================================================

-- Invitation dispatch tracking (IAM-04).
--
-- Records the LAST dispatch outcome and attempt count for an invitation so the
-- UI can show a truthful provider state and enforce a resend cooldown. Provider
-- acceptance is deliberately NOT stored as delivery: the column only ever holds
-- unconfigured | provider_accepted | failed | unknown.
--
-- Additive and idempotent: safe to replay. Apply only after reconciling the
-- existing migration history (see supabase/MIGRATION_STATUS.md). This file is
-- local and unapplied until the Batch 8 rollout gates are cleared.
BEGIN;

ALTER TABLE public.user_invites
  ADD COLUMN IF NOT EXISTS email_state text,
  ADD COLUMN IF NOT EXISTS email_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_attempt_count integer NOT NULL DEFAULT 0;

-- Constrain the recorded outcome so an unknown value cannot be persisted.
ALTER TABLE public.user_invites
  DROP CONSTRAINT IF EXISTS user_invites_email_state_check;
ALTER TABLE public.user_invites
  ADD CONSTRAINT user_invites_email_state_check
  CHECK (email_state IS NULL OR email_state IN ('unconfigured', 'provider_accepted', 'failed', 'unknown'));

COMMENT ON COLUMN public.user_invites.email_state IS
  'Last recorded dispatch outcome. provider_accepted is not delivery confirmation.';
COMMENT ON COLUMN public.user_invites.email_attempted_at IS
  'Instant of the last dispatch attempt; used for the resend cooldown.';
COMMENT ON COLUMN public.user_invites.email_attempt_count IS
  'Number of dispatch attempts (initial create plus resends).';

COMMIT;

-- ============================================================================
-- MIGRATION: 20261013120000_match_backup_scorer.sql
-- ============================================================================

-- Backup scorer assignment (IAM-06).
--
-- Adds an optional second scorer per match. Both the primary (`scorer_id`) and
-- the backup (`backup_scorer_id`) may record for the match; the application
-- validates each as an active scorer-role member of the match's league and
-- refuses to place the same person in both slots.
--
-- Additive and idempotent: safe to replay. Apply only after reconciling the
-- existing migration history (see supabase/MIGRATION_STATUS.md). Local and
-- unapplied until the Batch 10 rollout gates are cleared.
BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS backup_scorer_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Both slots must differ when both are set (a single person cannot be their own backup).
ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_backup_scorer_distinct_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_backup_scorer_distinct_check
  CHECK (backup_scorer_id IS NULL OR scorer_id IS NULL OR backup_scorer_id <> scorer_id);

CREATE INDEX IF NOT EXISTS idx_matches_backup_scorer_id ON public.matches(backup_scorer_id);

COMMENT ON COLUMN public.matches.backup_scorer_id IS
  'Optional backup scorer; must be an active scorer-role member of the match league and differ from scorer_id.';

COMMIT;

-- ============================================================================
-- MIGRATION: 20261013150000_invitation_delivery_events.sql
-- ============================================================================

-- Invitation delivery events (IAM-04).
--
-- Extends the recorded dispatch outcome to include provider-reported delivery
-- events so a bounce or complaint is visible instead of being reported as a
-- successful send. Values are only ever written from a signature-verified
-- provider webhook (or the synchronous send attempt).
--
-- Additive and idempotent: safe to replay. Apply only after reconciling the
-- existing migration history (see supabase/MIGRATION_STATUS.md). Local and
-- unapplied until the Batch 11 rollout gates are cleared.
BEGIN;

ALTER TABLE public.user_invites
  DROP CONSTRAINT IF EXISTS user_invites_email_state_check;
ALTER TABLE public.user_invites
  ADD CONSTRAINT user_invites_email_state_check
  CHECK (email_state IS NULL OR email_state IN (
    'unconfigured', 'provider_accepted', 'delivered', 'bounced', 'complained', 'failed', 'unknown'
  ));

COMMENT ON COLUMN public.user_invites.email_state IS
  'Last recorded dispatch/delivery outcome. provider_accepted is not delivery; delivered/bounced/complained come from a verified provider webhook.';

COMMIT;

-- ============================================================================
-- MIGRATION: 20261013180000_ownership_transfers.sql
-- ============================================================================

-- Two-party league ownership transfer (IAM-07).
--
-- Ownership of a league (`tenants.owner_id`) may only move through an explicit,
-- mutually-consented handover: the recorded owner initiates a transfer to an
-- active member of the same league, and that member must accept it. Nothing
-- changes until the recipient consents, so an abandoned or mistaken request
-- cannot strand a league.
--
-- Acceptance is atomic and never leaves the league ownerless: the recipient is
-- promoted to `league_owner` in the same transaction that rewrites
-- `tenants.owner_id` and demotes the previous owner to `demoted_role`.
--
-- Additive and idempotent: safe to replay. Apply only after reconciling the
-- existing migration history (see supabase/MIGRATION_STATUS.md). Local and
-- unapplied until the Batch 12 rollout gates are cleared.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ownership_transfers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  demoted_role public.user_role NOT NULL DEFAULT 'team_manager',
  status text NOT NULL DEFAULT 'pending',
  version integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Constraints (declared explicitly, not trusted to the enum type alone) ────

ALTER TABLE public.ownership_transfers
  DROP CONSTRAINT IF EXISTS ownership_transfers_status_check;
ALTER TABLE public.ownership_transfers
  ADD CONSTRAINT ownership_transfers_status_check
  CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired'));

ALTER TABLE public.ownership_transfers
  DROP CONSTRAINT IF EXISTS ownership_transfers_distinct_check;
ALTER TABLE public.ownership_transfers
  ADD CONSTRAINT ownership_transfers_distinct_check
  CHECK (from_user_id <> to_user_id);

ALTER TABLE public.ownership_transfers
  DROP CONSTRAINT IF EXISTS ownership_transfers_version_check;
ALTER TABLE public.ownership_transfers
  ADD CONSTRAINT ownership_transfers_version_check
  CHECK (version >= 0);

-- The outgoing owner may never retain owner/platform authority by demotion.
ALTER TABLE public.ownership_transfers
  DROP CONSTRAINT IF EXISTS ownership_transfers_demoted_role_check;
ALTER TABLE public.ownership_transfers
  ADD CONSTRAINT ownership_transfers_demoted_role_check
  CHECK (demoted_role NOT IN ('league_owner', 'super_admin'));

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- At most one open request per league; historical rows are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS ownership_transfers_pending_key
  ON public.ownership_transfers(tenant_id)
  WHERE status = 'pending';

-- Recipient inbox lookup ("do I have a pending transfer to accept?").
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_recipient
  ON public.ownership_transfers(to_user_id, status);

COMMENT ON TABLE public.ownership_transfers IS
  'Two-party league ownership handovers; the recipient must accept before tenants.owner_id moves.';

-- ─── Access control ───────────────────────────────────────────────────────────
-- Only the platform (service_role) needs this table; the application writes it
-- through server actions. PostgREST clients must not read or write it.
ALTER TABLE public.ownership_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ownership_transfers FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ownership_transfers FROM PUBLIC;
REVOKE ALL ON TABLE public.ownership_transfers FROM anon;
REVOKE ALL ON TABLE public.ownership_transfers FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ownership_transfers TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ownership_transfers TO ssl;
  END IF;
END $$;

COMMIT;

