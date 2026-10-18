-- FAN-01 (reports slice): fan-facing reports on a match's reaction feed.
--
-- The public reaction bar shows aggregate counts only, so a fan cannot
-- reference one specific reaction row - a report is therefore per MATCH
-- feed, not per reaction row. One OPEN report per fan per match (partial
-- unique index; re-reporting while open is an idempotent no-op; a new report
-- after a decision is allowed). The organizer decision (dismissed|actioned)
-- is append-provenance: reviewer identity + time REQUIRED, terminal states
-- are final. The actual removal of a specific reaction stays in the existing
-- audited removeModeratedReaction flow - this table records the report and
-- its review provenance, nothing else.
--
-- Idempotent and additive. Applied through the reviewed flow only; no
-- acceptance is inferred from the file alone.

BEGIN;

CREATE TABLE IF NOT EXISTS public.fan_reaction_reports (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Fixed platform-chosen reasons; the writer + policy enforce the same list.
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fan_reaction_reports_reason_check
    CHECK (reason IN ('abusive', 'spam', 'inappropriate', 'other')),
  CONSTRAINT fan_reaction_reports_status_check
    CHECK (status IN ('open', 'dismissed', 'actioned')),
  -- Review provenance: an open report has no reviewer; a decided report
  -- cannot exist without one.
  CONSTRAINT fan_reaction_reports_review_provenance_check
    CHECK (
      (status = 'open' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
      (status IN ('dismissed', 'actioned') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS fan_reaction_reports_open_uidx
  ON public.fan_reaction_reports (match_id, reported_by) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS fan_reaction_reports_open_queue_idx
  ON public.fan_reaction_reports (tenant_id, status, created_at);

COMMENT ON TABLE public.fan_reaction_reports IS
  'FAN-01 fan reports on a match reaction feed: one open report per fan per match, organizer decision (dismissed|actioned) with required reviewer provenance. Reports are moderation signals only - never an input to scoring, standings or awards.';

-- Fail-closed storage posture: the internal service roles (and only they)
-- may touch reports; anon/authenticated get nothing even if the API tier
-- regressed. All reads/writes flow through the server-side writers.
ALTER TABLE public.fan_reaction_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fan_reaction_reports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.fan_reaction_reports FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.fan_reaction_reports TO ssl;
    CREATE POLICY fan_reaction_reports_internal_ssl ON public.fan_reaction_reports TO ssl
      USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.fan_reaction_reports TO service_role;
    CREATE POLICY fan_reaction_reports_internal_service ON public.fan_reaction_reports TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
