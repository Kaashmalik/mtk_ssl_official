-- ============================================================================
-- Migration 022: Add "starter" to tenant_plan enum + create subscription_requests table
-- ============================================================================
-- This migration:
--   1. Adds "starter" to the existing tenant_plan enum (free, starter, pro, enterprise)
--   2. Creates subscription_request_status enum
--   3. Creates subscription_requests table (manual payment approval queue)
--   4. Adds RLS policies for the new table
--   5. Seeds commission rates for the new "starter" plan
-- ============================================================================

-- ─── 1. Add "starter" to tenant_plan enum ──────────────────────────────────
-- PostgreSQL enums are immutable — we must drop constraints, recreate the type,
-- and re-add constraints. In Supabase, we can use ALTER TYPE ADD VALUE (which
-- appends) because it doesn't require rewriting existing data.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'tenant_plan' AND e.enumlabel = 'starter'
  ) THEN
    ALTER TYPE tenant_plan ADD VALUE IF NOT EXISTS 'starter';
  END IF;
END $$;

-- ─── 2. Create subscription_request_status enum ───────────────────────────
CREATE TYPE subscription_request_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- ─── 3. Create subscription_requests table ───────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_plan TEXT NOT NULL,
  current_plan TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method TEXT NOT NULL,
  payment_proof_url TEXT NOT NULL,
  transaction_reference TEXT NOT NULL,
  status subscription_request_status NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. Indexes for query performance ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_subscription_requests_tenant_id ON subscription_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_status ON subscription_requests(status);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_expires_at ON subscription_requests(expires_at);

-- ─── 5. RLS Policies ──────────────────────────────────────────────────────
ALTER TABLE subscription_requests ENABLE ROW LEVEL SECURITY;

-- Tenant owners can read their own requests
CREATE POLICY "tenant_read_own_subscription_requests"
  ON subscription_requests
  FOR SELECT
  USING (
    tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
  );

-- Tenant owners can insert requests for their own tenant
CREATE POLICY "tenant_insert_subscription_requests"
  ON subscription_requests
  FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
  );

-- Super admins can read all subscription requests
CREATE POLICY "super_admin_read_all_subscription_requests"
  ON subscription_requests
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid() AND role = 'super_admin')
  );

-- Super admins can update subscription requests (approve/reject)
CREATE POLICY "super_admin_update_subscription_requests"
  ON subscription_requests
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid() AND role = 'super_admin')
  );

-- ─── 6. Auto-expire pending requests after 7 days ────────────────────────
CREATE OR REPLACE FUNCTION expire_old_subscription_requests()
RETURNS void AS $$
BEGIN
  UPDATE subscription_requests
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'pending' AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ─── 7. Update commission_rates plan check constraint ───────────────────
-- The original CHECK only allowed ('free', 'pro', 'enterprise'). Add 'starter'.
ALTER TABLE commission_rates DROP CONSTRAINT IF EXISTS commission_rates_plan_check;
ALTER TABLE commission_rates ADD CONSTRAINT commission_rates_plan_check
  CHECK ((plan = ANY (ARRAY['free'::text, 'starter'::text, 'pro'::text, 'enterprise'::text])));

-- ─── 8. Seed commission rate for starter plan ───────────────────────────
INSERT INTO commission_rates (id, plan, rate, description, is_active, created_at, updated_at)
VALUES (uuid_generate_v7(), 'starter', 10.00, 'Standard commission for Starter plan', true, NOW(), NOW())
ON CONFLICT (plan) DO NOTHING;

-- ─── 9. Grant permissions ─────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.subscription_requests TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE ON public.subscription_requests TO ssl;
  END IF;
END $$;
