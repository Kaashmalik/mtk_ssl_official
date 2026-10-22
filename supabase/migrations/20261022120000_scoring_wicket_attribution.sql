-- Batch 100 (ENH-03-02 / ENH-09-02) LOCAL ONLY - additive wicket attribution.
-- Apply in staging first; enable `SCORING_PARTICIPANTS_READY=true` on the
-- scoring service and the web app only after this migration has been applied
-- in that environment. The migration is intentionally independent of the
-- application change: until it is applied AND the flag is on, every surface
-- behaves exactly as before (the scoring service keeps deriving rule-default
-- wicket attribution, the overlay keeps aggregate-only batter/bowler figures,
-- and no player-introduction celebration is ever claimed).
--
-- THE DEFECT THIS REPAIRS: the canonical scoring command has always carried
-- full wicket attribution (which batter left - `wicket.playerId` - and the
-- dismissing fielder - `wicket.fielderId`), and the scoring service validates
-- it on every write (`services/scoring-service/src/scoring-write-access.ts`:
-- for every dismissal except run_out the out batter MUST be the recorded
-- striker; the named fielder MUST be on the bowling side). But the fold
-- persisted only `wicket_type`, so the off-strike run-out victim - the one
-- case where attribution is genuinely undeducible - was silently dropped,
-- and canonical striker/non-striker state could not be confirmed from the
-- delivery log. These columns persist exactly what the scorer declared.
--
-- No rows are rewritten. Historical deliveries keep NULL here and are
-- re-derived by the shared fold policy
-- (`packages/database/src/lib/scoring-participants.ts`), which self-corrects
-- an un-attributed run-out from the following recorded deliveries.
BEGIN;

ALTER TABLE public.match_balls
  ADD COLUMN IF NOT EXISTS wicket_player_out_id uuid
    REFERENCES public.players (id) ON DELETE SET NULL;
ALTER TABLE public.match_balls
  ADD COLUMN IF NOT EXISTS wicket_fielder_id uuid
    REFERENCES public.players (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.match_balls.wicket_player_out_id IS
  'Batch 100: the batter who actually left the crease on this wicket, as named by the scoring surface (optional; rule-derived attribution applies when NULL). Never copied from platform authority - the scoring service validates every attribution against the batting XI before insert.';
COMMENT ON COLUMN public.match_balls.wicket_fielder_id IS
  'Batch 100: bowling-side player credited with the dismissal (caught/run-out), when the scoring surface names one.';

COMMIT;
