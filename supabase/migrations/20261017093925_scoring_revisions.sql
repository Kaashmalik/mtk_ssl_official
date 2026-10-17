-- SCORE-11: durable optimistic concurrency, local-only until separately applied.
-- Independent of the handover migration; apply the complete reviewed chain
-- before deploying the coordinated web/scoring release. Never infer acceptance
-- from source tests. Existing matches start at revision zero, no history rewrite.
BEGIN;
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS scoring_revision integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_scoring_revision_nonnegative'
      AND conrelid = 'public.matches'::regclass) THEN
    ALTER TABLE public.matches ADD CONSTRAINT matches_scoring_revision_nonnegative
      CHECK (scoring_revision >= 0);
  END IF;
END $$;
COMMENT ON COLUMN public.matches.scoring_revision IS
  'Canonical scoring revision; incremented with each real mutation under the match lock. Retries/no-ops do not increment. Clients echo expectedRevision.';
COMMIT;
