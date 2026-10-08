-- ===========================================================================
-- SHAKIR SUPER LEAGUE - COMBINED DATABASE MIGRATIONS
-- Automatically generated on 2026-05-25T09:22:02.758Z
-- ===========================================================================

-- ===========================================================================
-- FILE: 001_enable_uuid_v7_and_helpers.sql
-- ===========================================================================

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
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  -- Get current timestamp in milliseconds
  unix_ts_ms := substring(
    lpad(to_hex(
      (extract(epoch from clock_timestamp()) * 1000)::bigint
    ), 16, '0') from 1 for 12
  );

  -- Generate random bytes for the rest
  uuid_bytes := decode(
    lpad(to_hex(
      (extract(epoch from clock_timestamp()) * 1000)::bigint
    ), 16, '0') ||
    lpad(to_hex((random() * 9223372036854775807)::bigint), 12, '0') ||
    lpad(to_hex((random() * 9223372036854775807)::bigint), 8, '0'),
    'hex'
  );

  -- Set version (7) and variant bits
  uuid_bytes := set_byte(uuid_bytes, 6, 
    (get_byte(uuid_bytes, 6) & x'0F')::int | x'70'::int
  );
  uuid_bytes := set_byte(uuid_bytes, 8,
    (get_byte(uuid_bytes, 8) & x'3F')::int | x'80'::int
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



-- ===========================================================================
-- FILE: 002_create_tables.sql
-- ===========================================================================

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



-- ===========================================================================
-- FILE: 003_create_rls_policies.sql
-- ===========================================================================

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



-- ===========================================================================
-- FILE: 004_microservices_schema.sql
-- ===========================================================================

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

-- Enhanced tournaments table
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS
  registration_start TIMESTAMPTZ,
  registration_end TIMESTAMPTZ,
  entry_fee DECIMAL(10,2) DEFAULT 0,
  prize_pool JSONB DEFAULT '{}',
  rules JSONB DEFAULT '{}',
  sponsors JSONB DEFAULT '[]',
  live_stream_url TEXT,
  is_featured BOOLEAN DEFAULT FALSE;

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


-- ===========================================================================
-- FILE: 005_seed_super_admin.sql
-- ===========================================================================

-- ============================================================================
-- Migration 004: Seed Super Admin (Muhammad Kashif)
-- ============================================================================
-- This migration creates the super admin user for Muhammad Kashif
-- Email: kashif@maliktech.pk

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
  'kashif@maliktech.pk',
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
WHERE u.email = 'kashif@maliktech.pk'
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
WHERE email = 'kashif@maliktech.pk';



-- ===========================================================================
-- FILE: 006_create_waitlist_table.sql
-- ===========================================================================

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



-- ===========================================================================
-- FILE: 007_create_admin_tables.sql
-- ===========================================================================

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



-- ===========================================================================
-- FILE: 008_white_label_enterprise.sql
-- ===========================================================================

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



-- ===========================================================================
-- FILE: 009_fantasy_cricket.sql
-- ===========================================================================

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


-- ===========================================================================
-- FILE: 010_event_store_cqrs.sql
-- ===========================================================================

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


-- ===========================================================================
-- FILE: 011_sync_drizzle_tables.sql
-- ===========================================================================

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


-- ===========================================================================
-- FILE: 012_fix_indexes_and_fks.sql
-- ===========================================================================

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


-- ===========================================================================
-- FILE: 013_fix_rls_gaps.sql
-- ===========================================================================

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


-- ===========================================================================
-- FILE: 014_unify_rls_strategy.sql
-- ===========================================================================

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


