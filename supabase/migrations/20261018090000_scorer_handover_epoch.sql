-- Scorer handover epoch (SCORE-11 slice): server-enforced writer fencing.
--
--   `scorer_handover_epoch`
--       a monotonic counter on the match row, bumped (+1) by the locked,
--       audited scorer-assignment writer on every real primary/backup slot
--       change (set, swap or clear). Canonical scoring-service writes must
--       echo the epoch their scoring session last observed; the service
--       compares it against this column under the match row lock.
--
-- Legacy-safe: existing rows default to 0 and commands that carry no token
-- keep working UNTIL the first handover occurs; from the first handover on,
-- every authoritative write must echo the current epoch, so a stale device of
-- a re-occupied scorer (or any device that missed the handover) fails closed
-- instead of silently writing. A TTL alone was never sufficient; plan
-- acceptance for SCORE-11 names writer fencing explicitly. Assignments are
-- audited as MATCH_SCORER_ASSIGN with the epoch before/after; enforcement
-- lives application-side in the canonical scoring boundary
-- (requireScoringWriteAccess).
--
-- Additive and idempotent; no backfill, no data migration.

BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS scorer_handover_epoch integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.matches.scorer_handover_epoch IS
  'SCORE-11 writer fencing: bumped on every scorer slot change; scoring writes must echo the observed epoch once it exceeds 0.';

COMMIT;
