-- Member-bound umpires (COMP-06): internal match officials as membership rows.
--
-- Umpires to date could only be recorded as free text (umpire_1, umpire_2,
-- third_umpire), which cannot reference a member, respect membership
-- effectiveness, or be assigned under the canonical lock/audit rules. This
-- migration adds two optional member-bound slots:
--   `umpire1_id`, `umpire2_id` uuid REFERENCES users(id) ON DELETE SET NULL,
--   one member may never hold both (enforced application-side with the
--   match row lock, mirroring the scorer slots; audited as
--   MATCH_UMPIRE_ASSIGN).
-- The free-text columns are untouched and remain the place for EXTERNAL
-- officials; the readiness advisory is satisfied by either form.
--
-- Additive and idempotent: safe to replay. RLS/grants on matches unchanged;
-- the new columns are covered by the table's existing policies. Applied
-- through the Supabase MCP (see supabase/MIGRATION_STATUS.md).
BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS umpire1_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS umpire2_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.matches.umpire1_id IS
  'Member-bound first umpire; the person must be an effective member of the owning league at assignment time. Free-text umpire_1 remains for external officials.';

COMMENT ON COLUMN public.matches.umpire2_id IS
  'Member-bound second umpire; must differ from umpire1_id. Free-text umpire_2 remains for external officials.';

COMMIT;
