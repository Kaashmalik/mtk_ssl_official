-- PUB-04: award disputes — a registered member's formal challenge to an
-- official award, and the owner's recorded resolution.
--
-- The dispute is a RECORD, not a mutation: raising one never changes the
-- award, and even an UPHELD dispute does not auto-supersede the declaration —
-- the owner separately corrects the award through the existing supersede
-- path (Batch 88), keeping the dispute-review and award-declaration
-- authorities separated. Authorities stay separated even at the DB level.
--
-- House style, proven in Batches 116/117 (fan reports/blocks):
--  - CHECK-pinned reason set (nothing offensive is storable; no free text in
--    this first slice — a longer dispute brief is recorded future work),
--  - status set open|upheld|dismissed with a resolution-provenance CHECK
--    (open = no reviewer; decided = reviewer AND time required),
--  - a PARTIAL unique: one OPEN dispute per member per award (re-raising
--    while one is open is an idempotent no-op at the writer; decided
--    disputes do not block a fresh, differently-founded challenge),
--  - RLS enabled AND forced, grants ONLY to ssl/service_role, no DELETE.

BEGIN;

-- Fixed reason/status vocabularies: nothing offensive is storable, and the
-- CHECK pairs below keep resolution provenance honest.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'award_dispute_reason') THEN
    CREATE TYPE public.award_dispute_reason AS ENUM ('incorrect_winner', 'winner_ineligible', 'process_error', 'other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'award_dispute_status') THEN
    CREATE TYPE public.award_dispute_status AS ENUM ('open', 'upheld', 'dismissed');
  END IF;
END $$;

-- The same-league composite anchor (mirrors teams_id_tenant_key, Batch 80):
-- an idempotent add; duplicate_object means it already exists.
DO $$ BEGIN
  ALTER TABLE public.tournaments
    ADD CONSTRAINT tournaments_id_tenant_key UNIQUE (id, tenant_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.tournament_award_disputes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tournament_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  award_id uuid NOT NULL REFERENCES public.tournament_awards(id) ON DELETE CASCADE,
  raised_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason public.award_dispute_reason NOT NULL,
  status public.award_dispute_status NOT NULL DEFAULT 'open',
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT tournament_award_disputes_match_tenant_fk FOREIGN KEY (tournament_id, tenant_id)
    REFERENCES public.tournaments(id, tenant_id) ON DELETE CASCADE,
  -- Resolution provenance: an open row has NO reviewer; a decided row has
  -- BOTH a reviewer AND a resolution time. The state machine lives here, not
  -- just in the writer.
  CONSTRAINT tournament_award_disputes_resolution_check CHECK (
    (status = 'open' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status IN ('upheld', 'dismissed') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS tournament_award_disputes_open_award_idx
  ON public.tournament_award_disputes (award_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS tournament_award_disputes_tenant_open_idx
  ON public.tournament_award_disputes (tenant_id, raised_at) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS tournament_award_disputes_one_open_per_member_key
  ON public.tournament_award_disputes (award_id, raised_by) WHERE status = 'open';

ALTER TABLE public.tournament_award_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_award_disputes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_award_disputes FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.tournament_award_disputes TO ssl;
    CREATE POLICY tournament_award_disputes_internal_ssl ON public.tournament_award_disputes TO ssl
      USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.tournament_award_disputes TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.tournament_award_disputes IS
  'PUB-04 award disputes: a registered member''s formal challenge to an official award. Raising never mutates the award; even upheld, correction runs through the separate supersede authority. No public access.';

COMMIT;
