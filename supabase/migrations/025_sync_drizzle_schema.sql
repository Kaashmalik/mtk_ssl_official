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
