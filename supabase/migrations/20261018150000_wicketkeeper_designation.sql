-- PUB-03: authoritative wicketkeeper designation on the declared playing XI.
--
-- The wicketkeeping board was deliberately NOT invented (Batch 87): no
-- authoritative keeper marker existed, and fabricating one would corrupt
-- records. The declared playing XI (Batch 80's match_playing_xis) is the
-- authority that already exists for "who fields where at the start" - the
-- keeper belongs there. One designated keeper per side per match, expressed
-- as a per-row flag with a partial unique (at most one ACTIVE keeper per
-- side): re-declaration supersedes (never mutates) history, a keeper
-- substitution hands the designation to the incoming player as the same
-- slot, and the DB - not writer convention - enforces the one-keeper rule.
--
-- Legacy rows read wicketkeeper = false: matches declared before this
-- migration have NO designated keeper, and nothing is backfilled - honesty
-- over fabrication, exactly as Batch 87 recorded.

BEGIN;

ALTER TABLE public.match_playing_xis
  ADD COLUMN IF NOT EXISTS wicketkeeper boolean NOT NULL DEFAULT false;

-- At most one designated keeper per side among ACTIVE rows (supersede-then-
-- insert makes handovers and re-declarations safe: the outgoing rows are
-- already history before the replacement lands).
CREATE UNIQUE INDEX IF NOT EXISTS match_playing_xis_active_keeper_key
  ON public.match_playing_xis (match_id, team_id)
  WHERE wicketkeeper AND superseded_at IS NULL;

COMMENT ON COLUMN public.match_playing_xis.wicketkeeper IS
  'PUB-03/COMP-06: this declared XI slot is the designated wicketkeeper. At most one per active side (partial unique). Legacy pre-migration rows read false - no keeper is invented for history.';

-- Table-level RLS (enabled + forced, grants ssl/service_role only) is
-- unchanged by an additive column; kept explicit for the record:
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.match_playing_xis ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.match_playing_xis FORCE ROW LEVEL SECURITY';
END $$;

COMMIT;
