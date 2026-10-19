-- Batch 159 LOCAL ONLY. Apply before setting ACCOUNT_LOCALE_PREFERENCES_READY=true.
BEGIN;
CREATE TABLE public.account_locale_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  locale text NOT NULL CHECK (locale IN ('en','bn','ar')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_locale_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_locale_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_locale_preferences FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.account_locale_preferences TO ssl;
    CREATE POLICY account_locale_preferences_ssl ON public.account_locale_preferences TO ssl USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.account_locale_preferences TO service_role;
    CREATE POLICY account_locale_preferences_service ON public.account_locale_preferences TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
COMMIT;
