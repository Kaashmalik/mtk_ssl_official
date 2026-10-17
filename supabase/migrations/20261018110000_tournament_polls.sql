-- FAN-01 (second slice): moderated tournament polls.
--
-- tournament_polls / tournament_poll_votes let a league's OWNERS pose
-- tournament questions to fans. The question and options are OWNER-authored
-- (moderated at the source: nothing a fan writes is ever stored), so free
-- text exists only on the organizer side; fans contribute VOTES only -
-- anonymous option indexes, one active vote per fan per poll (unique index;
-- switching updates the vote in place while the poll is open). Votes are
-- engagement signals ONLY and never feed scoring, standings or awards.
--
-- Honesty note: option-level shape (2-10 non-empty single-line strings with
-- a length ceiling) cannot be a single CHECK constraint (set-returning
-- functions are not allowed in CHECK) - the array type/arity IS pinned here
-- and the element shape is enforced by the pure policy + writer
-- (@mtk/database/lib/poll-policy). option_index's upper bound is per-poll
-- dynamic, so only >= 0 is pinned; the writer validates it against the
-- poll's actual options.
--
-- Idempotent and additive. Applied through the reviewed flow only.

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.tournament_poll_status AS ENUM ('draft', 'open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.tournament_polls (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  -- Owner-authored question - moderated at the source (only owners create polls).
  question text NOT NULL,
  -- Owner-authored options as a JSON string array; order IS the option identity.
  options jsonb NOT NULL,
  status public.tournament_poll_status NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_polls_options_shape_check
    CHECK (jsonb_typeof(options) = 'array'
      AND jsonb_array_length(options) >= 2
      AND jsonb_array_length(options) <= 10)
);

CREATE TABLE IF NOT EXISTS public.tournament_poll_votes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  poll_id uuid NOT NULL REFERENCES public.tournament_polls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Index into the poll's options array (0-based); upper bound is per-poll
  -- dynamic and writer-enforced.
  option_index integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_poll_votes_option_range_check CHECK (option_index >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS tournament_poll_votes_poll_fan_uidx
  ON public.tournament_poll_votes (poll_id, user_id);
CREATE INDEX IF NOT EXISTS tournament_poll_votes_poll_idx
  ON public.tournament_poll_votes (poll_id);
CREATE INDEX IF NOT EXISTS tournament_polls_tournament_idx
  ON public.tournament_polls (tournament_id);

COMMENT ON TABLE public.tournament_polls IS
  'FAN-01 moderated polls: owner-authored questions/options (moderated at the source - fans never write text), draft/open/closed lifecycle, tenant-scoped. A vote is the only fan contribution. Engagement only - never an input to scoring, standings, awards or any official decision; closed is terminal (no reopening on different visibility).';
COMMENT ON TABLE public.tournament_poll_votes IS
  'FAN-01 poll votes: one active vote per fan per poll (unique index), switching updates in place while open. Anonymous option indexes only - no free text exists on the fan side. Engagement only, never an official input.';

-- Fail-closed storage posture: the internal service role (and only it) may
-- touch polls; anon/authenticated get nothing even if the API tier
-- regressed. All reads/writes flow through the server-side writers.
ALTER TABLE public.tournament_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_polls FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_polls FROM PUBLIC, anon, authenticated;
ALTER TABLE public.tournament_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_poll_votes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_poll_votes FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.tournament_polls TO ssl;
    GRANT SELECT, INSERT, UPDATE ON public.tournament_poll_votes TO ssl;
    CREATE POLICY tournament_polls_internal_ssl ON public.tournament_polls TO ssl
      USING (true) WITH CHECK (true);
    CREATE POLICY tournament_poll_votes_internal_ssl ON public.tournament_poll_votes TO ssl
      USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.tournament_polls TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.tournament_poll_votes TO service_role;
    CREATE POLICY tournament_polls_internal_service_role ON public.tournament_polls TO service_role
      USING (true) WITH CHECK (true);
    CREATE POLICY tournament_poll_votes_internal_service_role ON public.tournament_poll_votes TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;
-- No DELETE anywhere: poll questions/options are owner records and votes are
-- retained engagement history; closing a poll preserves its final state.
-- UPDATE is needed only for the lifecycle transition (polls) and in-place
-- vote switching (votes).

COMMIT;
