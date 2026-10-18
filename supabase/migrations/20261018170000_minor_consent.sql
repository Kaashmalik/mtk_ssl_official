-- Minor consent (PUB-06 + REG-06 slice) - Batch 132
--
-- Design recorded 2026-10-18 (product default, user-directed batch cadence):
-- consent-on-publication. A player with a recorded date_of_birth under 18
-- years is a MINOR; a minor's public records (leaderboards, career hub,
-- public career profile) are visible ONLY while a guardian consent is
-- recorded. The consent is a league-RECORDED fact (guardian name + instant
-- + who recorded it), never a platform-verified identity - same truthfulness
-- line as prize payout records.
--
-- Fail-closed in the readers: no date_of_birth means the league cannot prove
-- the player is a minor, so the row keeps existing public behavior - the
-- readers never guess a minor from missing data, and the register discloses
-- that DOB discipline is the gate's foundation.
--
-- Withdrawal clears all three columns together (nothing is deleted; audit
-- logs record the withdrawal method and actor). No new grants: the players
-- table's existing forced RLS covers the new columns (service-role-only
-- writes through the app, no anon/authenticated grants).

ALTER TABLE players
  ADD COLUMN guardian_name text,
  ADD COLUMN guardian_consent_at timestamptz,
  ADD COLUMN guardian_consent_recorded_by text;

ALTER TABLE players
  ADD CONSTRAINT players_guardian_consent_cohesion_check
  CHECK (
    (guardian_consent_at IS NULL AND guardian_name IS NULL)
    OR (guardian_consent_at IS NOT NULL AND guardian_name IS NOT NULL)
  );

COMMENT ON COLUMN players.guardian_name IS
  'League-recorded guardian fact for minor consent (PUB-06): never platform-verified identity';
COMMENT ON COLUMN players.guardian_consent_at IS
  'When the league recorded guardian consent for a minor''s public visibility; NULL = no consent or withdrawn';
COMMENT ON COLUMN players.guardian_consent_recorded_by IS
  'Actor id that recorded the guardian consent (provenance, like players.created_by)';
COMMENT ON CONSTRAINT players_guardian_consent_cohesion_check ON players IS
  'Guardian consent is either fully recorded or fully absent - never a half state';
