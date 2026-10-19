-- Batch 165 LOCAL ONLY (ISO-06 retirement). STRICT DEPLOY ORDER: this migration
-- must be applied ONLY AFTER the deployment that ships the platform console
-- reads ALL user rows through explicit projections (no full-row users.select,
-- no tenantIds field - Batch 165 admin routes). An app enumerating the column
-- after the drop would fail every users query.
-- Safety: the column was write-disabled in B138, carries no authorization
-- reader since (pinned by source wellness tests), and its data is fully
-- superseded by user_tenant_roles. The drop is destructive and irreversible;
-- take a backup before a staged apply if row history matters.
-- users.role is NOT touched: it is the PLATFORM role column (super_admin|fan,
-- enforced by the users_role_platform_only CHECK); league roles live
-- exclusively in user_tenant_roles.
-- Batch 171c fix (DEPLOY BLOCKER, found on apply): 003's policy
-- "Users can view users in their tenants" (SELECT ... tenant_ids &&
-- current_tenant_id()) still depends on the column - this migration failed
-- BOTH on the deployed database AND on any virgin rebuild of this folder
-- (no later migration ever dropped that policy; virgin rebuilds before this
-- fix predate the migration's existence). The policy is dead logic under
-- ISO-06: anon/authenticated lost all users grants (migration 024), the app
-- reads users only service-side with explicit projections, and its
-- authorization model moved to user_tenant_roles. Drop it WITH the column.
-- Applied pre-adoption by Batch 171c (kaash0542-6365 / mtk-ssl.vercel.app
-- deployment); office ownership: Batch 165.
BEGIN;
DROP POLICY IF EXISTS "Users can view users in their tenants" ON public.users;
ALTER TABLE public.users
  DROP COLUMN IF EXISTS tenant_ids;
COMMIT;
