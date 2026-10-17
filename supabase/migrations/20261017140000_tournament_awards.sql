-- PUB-04 (first slice): official tournament awards with correction provenance.
--
-- tournament_awards records OFFICIAL awards only: each row is declared by the
-- league (a user holding tournament:update), and corrections never rewrite
-- history - a new active row supersedes the previous one (superseded_at), so
-- the decision trail stays auditable. No fan-vote / fan-favorite data lives in
-- this table: fan engagement must never be mixed with, or counted as, an
-- official award (the public surface states this).
--
-- LOCAL-ONLY until separately applied with the reviewed migration chain.
-- Never run implicitly against production; no acceptance is inferred from it.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'award_category') THEN
    CREATE TYPE public.award_category AS ENUM (
      'player_of_the_tournament',
      'best_batsman',
      'best_bowler',
      'best_all_rounder',
      'best_fielder',
      'best_wicketkeeper',
      'emerging_player',
      'fair_play'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tournament_awards (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  category public.award_category NOT NULL,
  -- Exactly one of a player or a team wins the category (CHECK below).
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  -- Organizer's optional citation; corrections keep prior citations in history.
  citation text,
  declared_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  declared_at timestamptz NOT NULL DEFAULT now(),
  -- Correction provenance: active rows are the only publicly displayed ones.
  superseded_at timestamptz,
  CONSTRAINT tournament_awards_single_winner_check
    CHECK (((player_id IS NOT NULL)::int + (team_id IS NOT NULL)::int) = 1)
);

-- At most one ACTIVE award per (tournament, category); zero is allowed
-- (e.g. no award declared yet). Superseded rows are kept as correction history.
CREATE UNIQUE INDEX IF NOT EXISTS tournament_awards_active_key
  ON public.tournament_awards (tournament_id, category)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS tournament_awards_tenant_idx
  ON public.tournament_awards (tenant_id);

CREATE INDEX IF NOT EXISTS tournament_awards_active_tournament_idx
  ON public.tournament_awards (tournament_id)
  WHERE superseded_at IS NULL;

COMMENT ON TABLE public.tournament_awards IS
  'PUB-04 official awards per tournament, declared by the league. Corrections supersede rows instead of mutating them; no fan-vote data is stored here.';

-- Fail-closed storage posture: the internal service role (and only it) may
-- touch awards; anon/authenticated get nothing even if the API tier regressed.
ALTER TABLE public.tournament_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_awards FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_awards FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.tournament_awards TO ssl;
    CREATE POLICY tournament_awards_internal_ssl ON public.tournament_awards TO ssl
      USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.tournament_awards TO service_role;
    CREATE POLICY tournament_awards_internal_service_role ON public.tournament_awards TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;
-- No DELETE grant anywhere: correction provenance (supersede) is the only
-- sanctioned lifecycle; history rows are never removed.

COMMIT;
