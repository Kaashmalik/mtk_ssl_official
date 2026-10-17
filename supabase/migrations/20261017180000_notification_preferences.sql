-- FAN-02 (first slice): per-member, per-league notification preferences.
--
-- notification_preferences stores each member's consent and quiet hours for
-- the exact league they are a member of (one row per (tenant_id, user_id)).
-- Absence of a row preserves the historical default: the in-app bell stays on
-- and external channels (email/push/sms) stay off - external channels are an
-- explicit opt-in.
--
-- Quiet hours are wall-clock minutes of day (0-1439) stored as a [start, end)
-- pair, interpreted in the member's IANA time zone (time_zone, null = UTC).
-- They gate INTERRUPTING channels only; the in-app inbox never enters a quiet
-- window because it interrupts nobody until opened.
--
-- Idempotent and additive. Applied through the reviewed flow only; no
-- acceptance is inferred from the file alone.

BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  in_app_enabled boolean NOT NULL DEFAULT true,
  -- Quiet window in minutes of day; both set or both null.
  quiet_start_minute smallint,
  quiet_end_minute smallint,
  -- IANA zone the quiet minutes are expressed in; null = UTC.
  time_zone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_quiet_pair_check
    CHECK ((quiet_start_minute IS NULL) = (quiet_end_minute IS NULL)),
  CONSTRAINT notification_preferences_quiet_range_check
    CHECK (
      (quiet_start_minute IS NULL AND quiet_end_minute IS NULL)
      OR (
        quiet_start_minute BETWEEN 0 AND 1439
        AND quiet_end_minute BETWEEN 0 AND 1439
        AND quiet_start_minute <> quiet_end_minute
      )
    ),
  CONSTRAINT notification_preferences_time_zone_check
    CHECK (time_zone IS NULL OR (length(time_zone) >= 1 AND length(time_zone) <= 64))
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_member_uidx
  ON public.notification_preferences (tenant_id, user_id);

COMMENT ON TABLE public.notification_preferences IS
  'FAN-02 per-member per-league notification consent and quiet hours: in-app opt-out by default on, external channels opt-in, quiet window [start, end) in the member IANA zone. Absence of a row = historical default (in-app on, everything else off).';

-- Fail-closed storage posture: the internal service role (and only it) may
-- touch preferences; anon/authenticated get nothing even if the API tier
-- regressed. All dispatch reads/writes go through the server-side writers.
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_preferences FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO ssl;
    CREATE POLICY notification_preferences_internal_ssl ON public.notification_preferences TO ssl
      USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO service_role;
    CREATE POLICY notification_preferences_internal_service_role ON public.notification_preferences TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;
-- No DELETE grant anywhere: a preference row is upserted from the settings
-- form, never deleted (absence of a row means "never chosen a preference").

COMMIT;
