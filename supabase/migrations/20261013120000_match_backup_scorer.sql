-- Backup scorer assignment (IAM-06).
--
-- Adds an optional second scorer per match. Both the primary (`scorer_id`) and
-- the backup (`backup_scorer_id`) may record for the match; the application
-- validates each as an active scorer-role member of the match's league and
-- refuses to place the same person in both slots.
--
-- Additive and idempotent: safe to replay. Apply only after reconciling the
-- existing migration history (see supabase/MIGRATION_STATUS.md). Local and
-- unapplied until the Batch 10 rollout gates are cleared.
BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS backup_scorer_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Both slots must differ when both are set (a single person cannot be their own backup).
ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_backup_scorer_distinct_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_backup_scorer_distinct_check
  CHECK (backup_scorer_id IS NULL OR scorer_id IS NULL OR backup_scorer_id <> scorer_id);

CREATE INDEX IF NOT EXISTS idx_matches_backup_scorer_id ON public.matches(backup_scorer_id);

COMMENT ON COLUMN public.matches.backup_scorer_id IS
  'Optional backup scorer; must be an active scorer-role member of the match league and differ from scorer_id.';

COMMIT;
