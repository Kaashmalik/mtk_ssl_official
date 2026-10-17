-- PUB-05 (corrections): supersede provenance for approved prize corrections.
--
-- An approved prize is frozen recorded truth and is never rewritten. A
-- correction instead inserts a corrected replacement row and marks the older
-- row superseded: superseded_at says WHEN it was replaced and
-- superseded_by_prize_id says WHICH row replaced it. A superseded row is
-- history: never publicly visible (the policy fails closed on it), never
-- editable, never superseded twice. Any previously recorded payout stays with
-- the superseded row untouched.
--
-- Idempotent and additive. Applied through the reviewed flow only; no
-- acceptance is inferred from the file alone.

BEGIN;

ALTER TABLE public.tournament_prizes
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_prize_id uuid
    REFERENCES public.tournament_prizes(id) ON DELETE SET NULL;

-- Supersede provenance is all-or-nothing: a row is either active (both null)
-- or fully superseded (both present).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournament_prizes_supersede_cohesion_check'
      AND conrelid = 'public.tournament_prizes'::regclass
  ) THEN
    ALTER TABLE public.tournament_prizes
      ADD CONSTRAINT tournament_prizes_supersede_cohesion_check
      CHECK ((superseded_at IS NULL) = (superseded_by_prize_id IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tournament_prizes_superseded_idx
  ON public.tournament_prizes (tournament_id, superseded_at);

COMMENT ON COLUMN public.tournament_prizes.superseded_at IS
  'When this approved prize was replaced by a corrected row; NULL = active prize.';
COMMENT ON COLUMN public.tournament_prizes.superseded_by_prize_id IS
  'The corrected replacement prize row that superseded this one; NULL = active prize.';

-- Table-level RLS (enabled + forced), the revoke from PUBLIC/anon/authenticated
-- and the internal ssl/service_role grants were established in migration
-- 20261017160000 and automatically cover the new columns. No new grants, no
-- DELETE path: superseding APPENDS history, it never removes it.

COMMIT;
