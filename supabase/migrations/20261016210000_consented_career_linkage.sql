-- PUB-03: consented career linkage + verified player records.
--
-- users.public_career_consent_at is the PERSON's affirmative consent to
-- cross-league career linkage (PUB-02 hub). Null = never granted. It gates
-- only cross-league merges; each league's own publication predicates remain
-- the authority for that league's public numbers. Verified player records
-- are DERIVED (players.user_id linked to an active users row) - no new
-- verification state is stored.

ALTER TABLE public.users
  ADD COLUMN public_career_consent_at timestamptz;

COMMENT ON COLUMN public.users.public_career_consent_at IS
  'PUB-03 consented career linkage: the person granted (and has not revoked) cross-league public career linkage. Gates only cross-league merges; per-league publication predicates are unchanged.';
