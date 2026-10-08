-- ============================================================================
-- Migration 018: Impersonation Sessions (single-use, audited, revocable)
-- ============================================================================
-- Tracks privileged "impersonate user" sessions issued by super admins.
-- A session is created in `issued` state, transitions to `active` once
-- consumed (single-use), and finally `revoked`/`expired` when the admin ends
-- the session or the TTL elapses.
--
-- Design notes:
--  * `jti` (JWT ID) is the single-use nonce — it must match the signed token
--    and be marked consumed exactly once (uniqueness enforced by the
--    `active_jti_uniq` partial unique index).
--  * All impersonation activity is also mirrored into audit_logs for
--    defense-in-depth reporting.

CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  jti           text        NOT NULL,
  admin_user_id text        NOT NULL,                 -- Clerk admin id (actor)
  admin_email   text        NOT NULL,
  target_user_id uuid       NOT NULL,                 -- users.id (subject)
  target_email  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'issued'
                            CHECK (status IN ('issued','active','revoked','expired')),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  consumed_at   timestamptz,
  revoked_at    timestamptz,
  expires_at    timestamptz NOT NULL,                 -- hard expiry (<= 5 min)
  issued_from_ip text,
  user_agent    text,
  reason        text                                 -- admin-supplied justification
);

-- A given jti may only be consumed once. Partial index: only one row per jti
-- can ever be in 'active' state.
CREATE UNIQUE INDEX IF NOT EXISTS impersonation_active_jti_uniq
  ON public.impersonation_sessions (jti)
  WHERE status = 'active';

-- Fast lookups by admin (audit dashboard) and by target (victim-side audit).
CREATE INDEX IF NOT EXISTS idx_impersonation_admin
  ON public.impersonation_sessions (admin_user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_target
  ON public.impersonation_sessions (target_user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_expires
  ON public.impersonation_sessions (expires_at)
  WHERE status IN ('issued','active');

-- Grant to the ssl app role. RLS is intentionally NOT enabled here: this
-- table is only ever written by super-admin server code (service-role path)
-- and read by the admin app. Exposing it to tenant-scoped queries would be a
-- data-leak vector.
GRANT SELECT, INSERT, UPDATE ON public.impersonation_sessions TO ssl;

COMMENT ON TABLE public.impersonation_sessions IS
  'Single-use, audited, revocable super-admin impersonation sessions.';
