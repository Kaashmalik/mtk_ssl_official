-- ENH-06-03 LOCAL ONLY (same discipline as the B159-B164 local migrations).
-- Apply before wiring recipient-specific read state for league-wide
-- notifications in a deployment.
BEGIN;

-- A broadcast notification row (notifications.user_id IS NULL) is shared by
-- every member of the league. `notifications.read_at` cannot express "this
-- member read it": writing it there marks the broadcast read for everybody.
-- The per-recipient marker lives here instead; personal rows keep their own
-- read_at and never need a row in this table.
CREATE TABLE IF NOT EXISTS public.notification_reads (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_reads_notification_user_key
  ON public.notification_reads (notification_id, user_id);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user
  ON public.notification_reads (user_id);

COMMENT ON TABLE public.notification_reads IS
  'ENH-06-03: recipient-specific read state for league-wide notifications. One row per (notification, member) pair; the unique pair makes a repeated "mark read" an idempotent upsert. Reads and writes are scoped to the signed-in member by the application layer (server-side resolution of the active league membership), never by a client-supplied user id.';

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.notification_reads FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_reads TO ssl;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_reads TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    CREATE POLICY notification_reads_ssl ON public.notification_reads TO ssl
      USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE POLICY notification_reads_service ON public.notification_reads TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
