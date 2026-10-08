-- Defense in depth: user_invites.role reuses the platform user_role enum, which
-- includes privileged values (super_admin / league_owner). Invitations must only
-- ever grant team-scoped roles, so constrain at the storage layer as well as in
-- the application Zod schema.

ALTER TABLE public.user_invites
  DROP CONSTRAINT IF EXISTS user_invites_invitable_role_check;

ALTER TABLE public.user_invites
  ADD CONSTRAINT user_invites_invitable_role_check
  CHECK (role IN ('team_manager', 'coach', 'scorer'));