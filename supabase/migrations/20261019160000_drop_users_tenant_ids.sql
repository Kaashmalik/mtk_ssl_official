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
BEGIN;
ALTER TABLE public.users
  DROP COLUMN IF EXISTS tenant_ids;
COMMIT;
