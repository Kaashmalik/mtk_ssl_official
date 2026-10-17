-- PUB-05 (first slice): league-declared tournament prizes with approval and
-- truthful payout records.
--
-- tournament_prizes records what a league DECLARES it will award for a
-- tournament: league-defined prize categories (free text - configurable, unlike
-- PUB-04's fixed award_category set), an optional placement label, an optional
-- amount + currency (null amount = a non-cash prize), and optional sponsor
-- attribution. Lifecycle: draft (league-editable) -> approved (one-way;
-- the approver's identity and timestamp are mandatory for approved rows).
-- recorded_payout_at is the league's own record that it paid the prize out -
-- the column name deliberately says "recorded", not "paid": the platform never
-- verifies fund transfer, and audit copy must not claim it does.
--
-- Idempotent and additive. Applied through the reviewed flow only; no
-- acceptance is inferred from the file alone.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tournament_prize_status') THEN
    CREATE TYPE public.tournament_prize_status AS ENUM ('draft', 'approved');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tournament_prizes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  -- League-defined prize category (configurable per league/tournament).
  category_name text NOT NULL,
  -- Optional placement label within the category (e.g. 'Winner').
  placement text,
  -- Null = a non-cash prize (trophy, title, opportunity).
  amount numeric(12, 2),
  currency text NOT NULL DEFAULT 'PKR',
  sponsor text,
  status public.tournament_prize_status NOT NULL DEFAULT 'draft',
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  -- The league's record that the prize was paid out - never a verified fact.
  recorded_payout_at timestamptz,
  payout_reference text,
  payout_note text,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- An approved prize must carry its approver's provenance.
  CONSTRAINT tournament_prizes_approval_provenance_check
    CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  -- Payout records exist only for approved prizes.
  CONSTRAINT tournament_prizes_payout_requires_approval_check
    CHECK (recorded_payout_at IS NULL OR status = 'approved'),
  -- Payout attribution fields accompany a recorded payout.
  CONSTRAINT tournament_prizes_payout_attribution_check
    CHECK ((payout_reference IS NULL AND payout_note IS NULL) OR recorded_payout_at IS NOT NULL),
  -- Amounts are never negative; magnitude bound matches numeric(12,2).
  CONSTRAINT tournament_prizes_amount_check
    CHECK (amount IS NULL OR (amount >= 0 AND amount <= 9999999999.99))
);

CREATE INDEX IF NOT EXISTS tournament_prizes_tenant_idx
  ON public.tournament_prizes (tenant_id);

CREATE INDEX IF NOT EXISTS tournament_prizes_tournament_idx
  ON public.tournament_prizes (tournament_id);

COMMENT ON TABLE public.tournament_prizes IS
  'PUB-05 league-declared tournament prizes: configurable categories, optional amount/currency/sponsor, draft->approved lifecycle, and payout records that are league-recorded facts, not platform-verified ones.';

-- Fail-closed storage posture: the internal service role (and only it) may
-- touch prizes; anon/authenticated get nothing even if the API tier regressed.
ALTER TABLE public.tournament_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_prizes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_prizes FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.tournament_prizes TO ssl;
    CREATE POLICY tournament_prizes_internal_ssl ON public.tournament_prizes TO ssl
      USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.tournament_prizes TO service_role;
    CREATE POLICY tournament_prizes_internal_service_role ON public.tournament_prizes TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;
-- No DELETE grant anywhere: prize history (including payout records) is never
-- rewritten away; the lifecycle is draft -> approved -> recorded payout.

COMMIT;
