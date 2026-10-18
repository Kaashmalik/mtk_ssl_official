-- REG-05 slice (Batch 134): captain invitations.
--
-- Captains are real people in the league's authority model: teams already
-- carry a captainId pointer (ISO-05 team-scoped grants), but the user_role
-- enum never had a captain value, so invitations could not carry a captain
-- journey. Add the role value (additive; existing rows and grants untouched)
-- so a team-scoped captain invitation can be issued, redeemed into a captain
-- membership, and assigned to the team's captainId pointer by the locked
-- redemption writer.
--
-- Role defaults in code rank captain below team_manager and above coach in
-- the RBAC matrix recording, not in the enum order. No grants change here:
-- the matrix lives in the app RBAC module and is unit-tested there.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'captain' AFTER 'team_manager';

COMMENT ON TYPE user_role IS
  'League authorities; captain added 2026-10-18 (REG-05) - team-scoped, redeemed invitations assign teams.captain_id';
