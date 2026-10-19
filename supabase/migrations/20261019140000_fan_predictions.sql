-- Batch 164 LOCAL ONLY (same discipline as the B159/B161/B162/B163 local
-- migrations). Apply before wiring fan predictions in a deployment.
-- Nothing changes at runtime until the web writers ship; a deployment
-- without this migration keeps the API failing closed via the missing table.
BEGIN;

CREATE TABLE IF NOT EXISTS public.fan_predictions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  prediction text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fan_prediction_pick CHECK (prediction IN ('home', 'away')),
  CONSTRAINT fan_predictions_unique_per_user UNIQUE (match_id, user_id)
);

CREATE INDEX IF NOT EXISTS fan_predictions_tenant_match_idx
  ON public.fan_predictions (tenant_id, match_id);

COMMENT ON TABLE public.fan_predictions IS
  'FAN-04 member outcome picks (Batch 164). A private, no-stakes pick per fan per match: one row per (match, user), editable IN PLACE while the prediction window is open (match still scheduled and kickoff not passed). Correctness is never stored - it is DERIVED at read time from matches.winnerId/language state so a recorded score can never be altered or contradicted by a pick.';

ALTER TABLE public.fan_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fan_predictions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.fan_predictions FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fan_predictions TO ssl;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fan_predictions TO service_role;

COMMIT;
