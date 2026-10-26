-- ENH-10-01: match chat retention.
--
-- 20261026130000_match_chat deliberately granted no DELETE ("a retention purge
-- needs its own reviewed migration and grant"). This is that migration. It
-- grants DELETE on exactly two tables to the internal server roles only:
--
--   match_chat_messages  purged by /api/cron/chat-retention: visible messages
--                        after 90 days, hidden (moderation evidence) after 365;
--                        a message with an OPEN report is never purged.
--                        match_chat_reports rows follow by ON DELETE CASCADE.
--   match_chat_mutes     lapsed mutes removed 30 days after they ended.
--
-- The purge itself stays OFF until MATCH_CHAT_RETENTION_READY=1 is set.
-- No other table gains DELETE; anon/authenticated still have nothing.
-- Additive and idempotent.

BEGIN;

-- Purge read paths: oldest-first scans by state and age.
CREATE INDEX IF NOT EXISTS idx_match_chat_messages_retention
  ON public.match_chat_messages (status, created_at);
CREATE INDEX IF NOT EXISTS idx_match_chat_mutes_retention
  ON public.match_chat_mutes (muted_until);

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['ssl', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT DELETE ON public.match_chat_messages TO %I', r);
      EXECUTE format('GRANT DELETE ON public.match_chat_mutes TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
