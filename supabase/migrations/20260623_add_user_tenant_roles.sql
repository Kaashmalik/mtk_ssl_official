-- Migration: Create user_tenant_roles junction table
-- Fixes BUG-3: Users can now have different roles per tenant
-- Previously, users had a single global "role" column, making it impossible
-- for a user to be league_owner in Tenant A and scorer in Tenant B.

-- 1. Create the junction table
CREATE TABLE IF NOT EXISTS user_tenant_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'fan',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Unique constraint: one role per user per tenant
  UNIQUE(user_id, tenant_id)
);

-- 2. Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_user_id ON user_tenant_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_tenant_id ON user_tenant_roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_user_tenant ON user_tenant_roles(user_id, tenant_id);

-- 3. Migrate existing data from users table to the junction table
-- For each user, create a role entry for each tenant they belong to
INSERT INTO user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT 
  u.id as user_id,
  unnest(u.tenant_ids) as tenant_id,
  u.role,
  true
FROM users u
WHERE u.tenant_ids IS NOT NULL AND array_length(u.tenant_ids, 1) > 0
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- 4. Also create entries for tenant owners who may not have tenant_ids set
INSERT INTO user_tenant_roles (user_id, tenant_id, role, is_primary)
SELECT 
  u.id as user_id,
  t.id as tenant_id,
  'league_owner'::user_role,
  true
FROM tenants t
JOIN users u ON u.clerk_id = t.owner_id::text
WHERE NOT EXISTS (
  SELECT 1 FROM user_tenant_roles utr 
  WHERE utr.user_id = u.id AND utr.tenant_id = t.id
)
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Note: The old users.role and users.tenant_ids columns are kept for backward
-- compatibility during migration. They should be removed in a future migration
-- after all code has been updated to use user_tenant_roles.
