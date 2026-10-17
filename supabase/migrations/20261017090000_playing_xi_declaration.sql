-- Declared playing XIs (COMP-06 slice): match official approval gate.
--
-- A tournament match may now carry officially approved playing XIs:
--   `xi_required`
--       true once a current XI declaration write has armed the requirement
--       (legacy rows default to false and keep their readiness/eligibility
--       semantics; no backfill is needed).
--   `xi_approved_at`
--       the instant an official (the league owner or the assigned member
--       umpire) approved both sides' declared XIs. Cleared by every
--       subsequent XI declaration: approval binds to the exact declared
--       squads. Only an official may set it (enforced application-side with
--       a match row lock and a conditional update, audited as XI_APPROVE).
--
-- `match_playing_xis` stores the declared squads: one row per (match, team,
-- player) with a stable batting order. Rows are never mutated into someone
-- else; a re-declaration supersedes the previous active rows (audit trail for
-- later substitution/revision work, SCORE-10) and both composite FKs bind the
-- rows to the same-league match and team. Reuses the matches_id_tenant_key
-- composite unique index created for the Batch 63 scoring outbox and adds the
-- matching teams_id_tenant_key.
--
-- Additive and idempotent: safe to replay. match_playing_xis has row-level
-- security enabled and forced with privileges granted only to the internal
-- roles; there is no anon/authenticated policy and no delete grant.
-- Local and unapplied (see supabase/MIGRATION_STATUS.md).
BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS xi_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS xi_approved_at timestamptz;

COMMENT ON COLUMN public.matches.xi_required IS
  'True once an XI declaration write has armed the requirement; legacy matches stay false and keep legacy eligibility.';
COMMENT ON COLUMN public.matches.xi_approved_at IS
  'When an official (owner or assigned member umpire) approved both declared XIs. Cleared by any re-declaration.';

DO $$ BEGIN
  ALTER TABLE public.teams
    ADD CONSTRAINT teams_id_tenant_key UNIQUE (id, tenant_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.match_playing_xis (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  match_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  team_id uuid NOT NULL,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  batting_order smallint NOT NULL,
  declared_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  declared_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  CONSTRAINT match_playing_xis_match_tenant_fk FOREIGN KEY (match_id, tenant_id)
    REFERENCES public.matches(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT match_playing_xis_team_tenant_fk FOREIGN KEY (team_id, tenant_id)
    REFERENCES public.teams(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT match_playing_xis_order_check CHECK (batting_order >= 1 AND batting_order <= 11)
);

CREATE UNIQUE INDEX IF NOT EXISTS match_playing_xis_active_player_key
  ON public.match_playing_xis(match_id, team_id, player_id) WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS match_playing_xis_active_order_key
  ON public.match_playing_xis(match_id, team_id, batting_order) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS match_playing_xis_active_idx
  ON public.match_playing_xis(match_id, team_id) WHERE superseded_at IS NULL;

ALTER TABLE public.match_playing_xis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_playing_xis FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_playing_xis FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.match_playing_xis TO ssl;
    CREATE POLICY match_playing_xis_internal_ssl ON public.match_playing_xis TO ssl
      USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.match_playing_xis TO service_role;
  END IF;
END $$;
COMMENT ON TABLE public.match_playing_xis IS
  'Declared playing XIs per match/side. Re-declaration supersedes active rows; delivery requires XI membership while xi_required is armed. No public access.';

COMMIT;
