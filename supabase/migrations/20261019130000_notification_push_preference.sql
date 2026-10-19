-- Batch 162 LOCAL ONLY (same discipline as the B159/B161 local migrations).
-- Apply before wiring the notification push channel in a deployment
-- (NOTIFICATION_PUSH_READY=true + EXPO_ACCESS_TOKEN remain the runtime gates;
-- the column alone changes nothing: the policy reports push as unwired).
-- Consent stays fail-closed: existing rows keep push off.
BEGIN;
ALTER TABLE public.notification_preferences
  ADD COLUMN push_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.notification_preferences.push_enabled IS
  'FAN-02 push-channel consent; absent/false is the fail-closed default. Dispatch still requires the channel to be WIRED server-side and passes the shared quiet-hours gate.';
COMMIT;
