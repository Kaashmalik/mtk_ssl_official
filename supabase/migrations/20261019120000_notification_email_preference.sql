-- Batch 161 LOCAL ONLY (mirrors the B159 local-migration discipline). Apply
-- before wiring the notification email channel in a deployment
-- (NOTIFICATION_EMAIL_READY=true + RESEND_API_KEY remain the runtime gates;
-- the column alone changes nothing: the policy reports email as unwired).
-- Consent stays fail-closed: existing rows keep email off.
BEGIN;
ALTER TABLE public.notification_preferences
  ADD COLUMN email_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.notification_preferences.email_enabled IS
  'FAN-02 email-channel consent; absent/false is the fail-closed default. Dispatch still requires the channel to be WIRED server-side and passes the shared quiet-hours gate.';
COMMIT;
