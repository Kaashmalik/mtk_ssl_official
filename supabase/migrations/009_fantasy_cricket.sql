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
