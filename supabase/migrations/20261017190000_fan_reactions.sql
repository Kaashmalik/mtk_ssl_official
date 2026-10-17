-- FAN-01 (first slice): moderated fan reactions on published matches.
--
-- fan_reactions lets fans react to a published match from a fixed,
-- platform-chosen set (DB CHECK - no free text exists, so nothing offensive
-- can be stored). One active reaction of each type per fan per match (unique
-- index; toggling removes). Reactions are engagement signals ONLY and never
-- feed scoring, standings or awards. Anti-abuse lives in the shared pure
-- policy + writer (rate floor), not in this file.
--
-- Idempotent and additive. Applied through the reviewed flow only; no
-- acceptance is inferred from the file alone.

BEGIN;

CREATE TABLE IF NOT EXISTS public.fan_reactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Fixed platform-chosen set; the writer + policy enforce the same list.
  reaction text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fan_reactions_type_check
    CHECK (reaction IN ('four', 'six', 'wicket', 'clap', 'fire'))
);

CREATE UNIQUE INDEX IF NOT EXISTS fan_reactions_member_uidx
  ON public.fan_reactions (user_id, match_id, reaction);
CREATE INDEX IF NOT EXISTS fan_reactions_match_idx
  ON public.fan_reactions (match_id);

COMMENT ON TABLE public.fan_reactions IS
  'FAN-01 moderated fan reactions on published matches: fixed non-official reaction set, one per type per fan per match, tenant-scoped. Engagement only - never an input to scoring, standings or awards.';

-- Fail-closed storage posture: the internal service role (and only it) may
-- touch reactions; anon/authenticated get nothing even if the API tier
-- regressed. All reads/writes flow through the server-side writers.
ALTER TABLE public.fan_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fan_reactions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.fan_reactions FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, DELETE ON public.fan_reactions TO ssl;
    CREATE POLICY fan_reactions_internal_ssl ON public.fan_reactions TO ssl
      USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, DELETE ON public.fan_reactions TO service_role;
    CREATE POLICY fan_reactions_internal_service_role ON public.fan_reactions TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;
-- DELETE is granted (unlike prizes/preferences): toggling OFF removes the
-- fan's own row, so reactions stay user-deletable engagement, not records.

COMMIT;
