-- Harden the OTP verification_tokens table.
--
-- Tokens are secrets: app access goes through DATABASE_URL (service_role /
-- postgres), which bypasses RLS. PostgREST (anon/authenticated) must never be
-- able to read or write them — consistent with migrations 003/014/024.

ALTER TABLE IF EXISTS public.verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.verification_tokens FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.verification_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.verification_tokens FROM anon;
REVOKE ALL ON TABLE public.verification_tokens FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_tokens TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_tokens TO ssl;
  END IF;
END $$;

-- No permissive policies for anon/authenticated: with RLS forced and no policy,
-- every non-bypassing role is denied.