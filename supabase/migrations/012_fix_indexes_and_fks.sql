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
