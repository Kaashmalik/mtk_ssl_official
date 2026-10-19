-- Batch 164 LOCAL ONLY (same discipline as the B159-B163 local migrations).
-- Apply before wiring threaded application replies in a deployment.
BEGIN;

CREATE TABLE IF NOT EXISTS public.tournament_application_replies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.tournament_applications(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author_side text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_reply_side CHECK (author_side IN ('member', 'owner')),
  CONSTRAINT application_reply_body_bounded CHECK (char_length(body) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS tournament_application_replies_thread_idx
  ON public.tournament_application_replies (application_id, created_at);

COMMENT ON TABLE public.tournament_application_replies IS
  'REG-03 (Batch 164): threaded replies under a tournament application, closing the needs_information conversation gap B147 documented. The thread is a RECORD: replies attach to a LIVE application only (terminal applications read as locked history), author_side is server-derived from verified authority (never client-asserted), and replies change nothing about the application state machine.';

ALTER TABLE public.tournament_application_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_application_replies FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.tournament_application_replies FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_application_replies TO ssl;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_application_replies TO service_role;

COMMIT;
