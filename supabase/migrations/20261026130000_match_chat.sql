-- ENH-10: moderated, tenant-scoped match chat.
--
-- Transport and ordering: docs/adr/003-match-chat-transport.md.
--
-- league_chat_settings  one row per league; chat is OFF until the owner enables
--                       it (ENH-10 phase gate: accountable moderation).
-- match_chat_messages   plain-text messages; `seq` orders delivery; the
--                       (author, client_key) unique key makes retried sends
--                       idempotent. Messages are hidden by moderators, never
--                       edited. (match_id, tenant_id) references the match's
--                       composite key, so a row can never point at another
--                       league's match.
-- match_chat_mutes      timed league-wide chat timeouts. Permanent bans reuse
--                       the existing league fan_blocks table.
-- match_chat_reports    fan reports on a single message, fixed reasons only.
--
-- Additive and idempotent. Applied through the reviewed flow only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.league_chat_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  slow_mode_seconds integer NOT NULL DEFAULT 10,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT league_chat_settings_slow_mode_check
    CHECK (slow_mode_seconds IN (0, 5, 10, 30, 60))
);

CREATE TABLE IF NOT EXISTS public.match_chat_messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  client_key uuid NOT NULL,
  reply_to_id uuid REFERENCES public.match_chat_messages(id) ON DELETE SET NULL,
  is_moderator boolean NOT NULL DEFAULT false,
  pinned boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'visible',
  moderated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  moderated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_chat_messages_match_fk
    FOREIGN KEY (match_id, tenant_id) REFERENCES public.matches(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT match_chat_messages_body_check
    CHECK (char_length(body) BETWEEN 1 AND 280),
  CONSTRAINT match_chat_messages_status_check
    CHECK (status IN ('visible', 'hidden')),
  CONSTRAINT match_chat_messages_moderation_check
    CHECK (status = 'visible' OR (moderated_by IS NOT NULL AND moderated_at IS NOT NULL)),
  CONSTRAINT match_chat_messages_pin_check
    CHECK (NOT pinned OR is_moderator)
);

CREATE UNIQUE INDEX IF NOT EXISTS match_chat_messages_seq_key
  ON public.match_chat_messages (seq);
-- A retried send after a lost response is a no-op, never a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS match_chat_messages_client_key
  ON public.match_chat_messages (author_user_id, client_key);
-- Poll / history read path.
CREATE INDEX IF NOT EXISTS idx_match_chat_messages_match_seq
  ON public.match_chat_messages (match_id, seq);
-- Slow-mode / flood floor read path (shared across replicas).
CREATE INDEX IF NOT EXISTS idx_match_chat_messages_author_recent
  ON public.match_chat_messages (tenant_id, author_user_id, created_at DESC);
-- At most one visible pinned announcement per match.
CREATE UNIQUE INDEX IF NOT EXISTS match_chat_messages_pinned_key
  ON public.match_chat_messages (match_id)
  WHERE pinned AND status = 'visible';

CREATE TABLE IF NOT EXISTS public.match_chat_mutes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  muted_until timestamptz NOT NULL,
  muted_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_chat_mutes_window_check CHECK (muted_until > created_at),
  CONSTRAINT match_chat_mutes_self_check CHECK (user_id <> muted_by)
);

CREATE INDEX IF NOT EXISTS idx_match_chat_mutes_active
  ON public.match_chat_mutes (tenant_id, user_id, muted_until DESC);

CREATE TABLE IF NOT EXISTS public.match_chat_reports (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.match_chat_messages(id) ON DELETE CASCADE,
  reporter_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_chat_reports_reason_check
    CHECK (reason IN ('abusive', 'spam', 'inappropriate', 'other')),
  CONSTRAINT match_chat_reports_status_check
    CHECK (status IN ('open', 'resolved')),
  CONSTRAINT match_chat_reports_resolution_check
    CHECK (status = 'open' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);

-- One open report per fan per message; re-reporting is an idempotent no-op.
CREATE UNIQUE INDEX IF NOT EXISTS match_chat_reports_open_key
  ON public.match_chat_reports (message_id, reporter_user_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_match_chat_reports_queue
  ON public.match_chat_reports (tenant_id, status, created_at DESC);

COMMENT ON TABLE public.match_chat_messages IS
  'ENH-10 moderated match chat. Plain text, tenant-scoped via the match composite key, hidden (never edited) by moderators. Engagement only - never an input to scoring or commentary.';

-- ─── Access control ───────────────────────────────────────────────────────────
-- Server-side writers only. No DELETE grant: messages are hidden, not removed,
-- so moderation keeps its evidence. A retention purge needs its own reviewed
-- migration and grant.
ALTER TABLE public.league_chat_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_chat_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.match_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_chat_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.match_chat_mutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_chat_mutes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.match_chat_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_chat_reports FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.league_chat_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.match_chat_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.match_chat_mutes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.match_chat_reports FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['ssl', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['league_chat_settings', 'match_chat_messages', 'match_chat_mutes', 'match_chat_reports'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO %I', t, r);
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_internal_' || r
        ) THEN
          EXECUTE format('CREATE POLICY %I ON public.%I TO %I USING (true) WITH CHECK (true)', t || '_internal_' || r, t, r);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

COMMIT;
