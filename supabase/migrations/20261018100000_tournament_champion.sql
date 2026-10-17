-- FAN-03 (first slice): persisted tournament champions for the public
-- hall of fame. The champion is written EXACTLY ONCE by the knockout
-- completion claim (tournament-advancement) from the decided final's
-- winnerId - never derivable anew at read time, so the record stays stable
-- against future standings rule changes.
--
-- Legacy completed tournaments intentionally read champion-less (no
-- backfill): re-deriving "which fixture was the final" for manual or
-- round-robin histories would be a guess, and guesses are not records.
-- Legacy tournaments keep the live standings view unchanged.
--
-- Idempotent and additive. Applied through the reviewed flow only.

BEGIN;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS champion_team_id uuid
    REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tournaments_champion_idx
  ON public.tournaments (tenant_id)
  WHERE champion_team_id IS NOT NULL;

COMMENT ON COLUMN public.tournaments.champion_team_id IS
  'FAN-03 hall of fame: champion of a completed knockout competition, written exactly once by the TOURNAMENT_ADVANCE completion claim from the decided final winner. Never backfilled - legacy completed tournaments read champion-less. ON DELETE SET NULL: a deleted team erases the pointer, not the tournament.';

COMMIT;
