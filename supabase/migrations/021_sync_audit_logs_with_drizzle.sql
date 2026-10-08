-- ============================================================================
-- Migration 021: Sync audit_logs with Drizzle schema + add tournaments columns
-- ============================================================================
-- PROBLEM: The live `audit_logs` table was created by migration 004
-- (microservices schema) with columns: user_id, action, entity_type,
-- entity_id, old_values, new_values, ip_address (inet).
--
-- But the Drizzle schema (packages/database/src/schema/audit-logs.ts) and the
-- NestJS AuditLogInterceptor expect: request_id, actor_id, actor_role, method,
-- path, ip (text), user_agent, payload (jsonb), status_code.
--
-- This mismatch caused every audit-log INSERT from the API to silently fail.
--
-- FIX: Recreate audit_logs to match the Drizzle schema (the source of truth
-- for application code). The table is empty so no data loss.
-- Also add the extra tournaments columns from migration 004 to the schema.

-- ============================================================================
-- 1. RECREATE audit_logs to match Drizzle schema
-- ============================================================================
DROP POLICY IF EXISTS "super_admin_all_audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "tenant_isolation_audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "tenant_audit_logs" ON public.audit_logs;

DROP TABLE IF EXISTS public.audit_logs;

CREATE TABLE public.audit_logs (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  request_id  text        NOT NULL,
  tenant_id   uuid,
  actor_id    uuid,
  actor_role  text,
  method      text        NOT NULL,
  path        text        NOT NULL,
  ip          text,
  user_agent  text,
  payload     jsonb,
  status_code text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON public.audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON public.audit_logs(request_id);

-- RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all_audit_logs"
  ON public.audit_logs FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "tenant_isolation_audit_logs"
  ON public.audit_logs FOR SELECT
  USING (tenant_id = ANY(current_tenant_id()));

-- Allow service role to insert. Supabase hosted only has postgres/service_role/
-- authenticated/anon; self-hosted deployments may also define an `ssl` app role.
GRANT SELECT, INSERT, UPDATE ON public.audit_logs TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.audit_logs TO ssl;
  END IF;
END $$;

COMMENT ON TABLE public.audit_logs IS
  'HTTP request audit trail written by the NestJS AuditLogInterceptor.';

-- ============================================================================
-- 2. Verify tournaments extra columns exist (added by migration 004).
--    These are referenced by the admin app for tournament management.
--    Add them if missing (idempotent).
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='registration_start') THEN
    ALTER TABLE public.tournaments ADD COLUMN registration_start timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='registration_end') THEN
    ALTER TABLE public.tournaments ADD COLUMN registration_end timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='entry_fee') THEN
    ALTER TABLE public.tournaments ADD COLUMN entry_fee numeric(10,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='prize_pool') THEN
    ALTER TABLE public.tournaments ADD COLUMN prize_pool jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='rules') THEN
    ALTER TABLE public.tournaments ADD COLUMN rules jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='sponsors') THEN
    ALTER TABLE public.tournaments ADD COLUMN sponsors jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='live_stream_url') THEN
    ALTER TABLE public.tournaments ADD COLUMN live_stream_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='is_featured') THEN
    ALTER TABLE public.tournaments ADD COLUMN is_featured boolean NOT NULL DEFAULT false;
  END IF;
END $$;
