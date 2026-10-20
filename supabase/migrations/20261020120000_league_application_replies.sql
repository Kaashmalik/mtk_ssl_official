-- ENH-02-02 LOCAL ONLY (same discipline as the B159-B164 local migrations).
-- Apply before wiring persisted league-application applicant replies in a
-- deployment.
BEGIN;

CREATE TABLE IF NOT EXISTS public.league_application_replies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  application_id uuid NOT NULL REFERENCES public.league_applications(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author_side text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT league_application_reply_side CHECK (author_side IN ('applicant')),
  CONSTRAINT league_application_reply_body_bounded CHECK (char_length(body) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS league_application_replies_thread_idx
  ON public.league_application_replies (application_id, created_at);

COMMENT ON TABLE public.league_application_replies IS
  'ENH-02-02: persisted applicant replies under a league application information request. Deliberately separate from tournament_application_replies (REG-03): platform-level scope (no tenant), single author side (applicant), and the thread is open only while the application carries needs_information. Replies are additive records and never mutate the application state machine, version, or review reason.';

ALTER TABLE public.league_application_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_application_replies FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.league_application_replies FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_application_replies TO ssl;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_application_replies TO service_role;

COMMIT;
