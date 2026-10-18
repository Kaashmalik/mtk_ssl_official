-- FAN-01 (anti-abuse slice): league-scoped fan interaction blocks.
--
-- Reports closed the loop from fan to organizer; blocks close the loop from
-- organizer back to the abuser. A block is LEAGUE-SCOPED (tenant + fan): the
-- league owner may stop one fan from reacting to or reporting on ANY match
-- of THEIR league - it never reaches another league, and it is never
-- feed-permanent (the only states are active and lifted, the lift carrying
-- provenance). One ACTIVE block per fan per league (partial unique index;
-- a re-block while active is an idempotent no-op). A lifted block's history
-- stays: provenance both ways is the record.
--
-- Enforcement lives in the engagement writers (reactions + reports),
-- fail-closed; follows are NOT gated by this table in this slice - that
-- boundary is recorded, not silently assumed.
--
-- Idempotent and additive. Applied through the reviewed flow only; no
-- acceptance is inferred from the file alone.

BEGIN;

CREATE TABLE IF NOT EXISTS public.fan_blocks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Fixed platform-chosen reasons; the writer + policy enforce the same set.
  reason text NOT NULL DEFAULT 'report_abuse',
  status text NOT NULL DEFAULT 'active',
  lifted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  lifted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fan_blocks_reason_check
    CHECK (reason IN ('report_abuse', 'reaction_abuse', 'other')),
  CONSTRAINT fan_blocks_status_check
    CHECK (status IN ('active', 'lifted')),
  -- Provenance: an active block has no lift; a lifted block cannot exist
  -- without its reviewer.
  CONSTRAINT fan_blocks_lift_provenance_check
    CHECK (
      (status = 'active' AND lifted_by IS NULL AND lifted_at IS NULL) OR
      (status = 'lifted' AND lifted_by IS NOT NULL AND lifted_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS fan_blocks_active_uidx
  ON public.fan_blocks (tenant_id, blocked_user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS fan_blocks_history_idx
  ON public.fan_blocks (tenant_id, created_at);

COMMENT ON TABLE public.fan_blocks IS
  'FAN-01 league-scoped fan interaction blocks: the league owner stops one fan from reacting to or reporting on any match of THEIR league. One active block per fan per league (partial unique); a lift carries reviewer provenance. Blocks are anti-abuse signals only - never an input to scoring, standings or awards.';

-- Fail-closed storage posture, mirroring fan_reaction_reports: the internal
-- service roles (and only they) may touch blocks; anon/authenticated get
-- nothing even if the API tier regressed.
ALTER TABLE public.fan_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fan_blocks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.fan_blocks FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.fan_blocks TO ssl;
    CREATE POLICY fan_blocks_internal_ssl ON public.fan_blocks TO ssl
      USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.fan_blocks TO service_role;
    CREATE POLICY fan_blocks_internal_service ON public.fan_blocks TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
