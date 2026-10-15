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
