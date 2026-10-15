-- ============================================================================
-- Migration 001: Enable UUID v7 and Helper Functions
-- ============================================================================
-- This migration enables UUID v7 generation and creates helper functions
-- for multi-tenant data isolation and super admin checks.

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create UUID v7 function
-- UUID v7 is time-ordered and better for database indexes
-- This implementation follows the UUID v7 specification
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid AS $$
DECLARE
  uuid_hex text;
  uuid_bytes bytea;
BEGIN
  -- 48-bit big-endian millisecond timestamp (12 hex chars)
  uuid_hex :=
    lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0') ||
    lpad(to_hex((random() * 9223372036854775807)::bigint), 12, '0') ||
    lpad(to_hex((random() * 9223372036854775807)::bigint), 8, '0');

  uuid_bytes := decode(uuid_hex, 'hex');

  -- Set version (7) and RFC 4122 variant bits
  uuid_bytes := set_byte(uuid_bytes, 6,
    (get_byte(uuid_bytes, 6) & 15) | 112
  );
  uuid_bytes := set_byte(uuid_bytes, 8,
    (get_byte(uuid_bytes, 8) & 63) | 128
  );

  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql;

-- Helper function: Get current user's tenant IDs
-- This reads from the users table based on auth.uid() or email from JWT
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid[] AS $$
DECLARE
  user_tenants uuid[];
  user_email text;
  user_uuid uuid;
BEGIN
  -- Try to get user ID from auth.uid() first (Supabase standard)
  user_uuid := auth.uid();
  
  -- If auth.uid() is null, try to get email from JWT
  IF user_uuid IS NULL THEN
    user_email := (auth.jwt() ->> 'email')::text;
    
    -- If no email either, return empty array
    IF user_email IS NULL THEN
      RETURN ARRAY[]::uuid[];
    END IF;

    -- Get tenant IDs from users table by email
    SELECT COALESCE(tenant_ids, ARRAY[]::uuid[])
    INTO user_tenants
    FROM users
    WHERE email = user_email;
  ELSE
    -- Get tenant IDs from users table by ID
    -- Note: This assumes users.id matches auth.users.id
    -- If using Clerk, you may need to join on a different field
    SELECT COALESCE(tenant_ids, ARRAY[]::uuid[])
    INTO user_tenants
    FROM users
    WHERE id = user_uuid;
  END IF;

  RETURN COALESCE(user_tenants, ARRAY[]::uuid[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: Check if current user is super admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
DECLARE
  user_email text;
  user_uuid uuid;
  user_role text;
BEGIN
  -- Try to get user ID from auth.uid() first
  user_uuid := auth.uid();
  
  IF user_uuid IS NOT NULL THEN
    -- Check role in users table
    SELECT role INTO user_role
    FROM users
    WHERE id = user_uuid;
    
    IF user_role = 'super_admin' THEN
      RETURN true;
    END IF;
  END IF;
  
  -- Fallback: Get email from JWT
  user_email := (auth.jwt() ->> 'email')::text;
  
  IF user_email IS NULL THEN
    RETURN false;
  END IF;
  
  -- Check users table by email
  SELECT role INTO user_role
  FROM users
  WHERE email = user_email;
  
  RETURN COALESCE(user_role = 'super_admin', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: Get current user ID (from auth.users)
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS uuid AS $$
BEGIN
  RETURN (auth.uid())::uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: Check if user belongs to tenant
CREATE OR REPLACE FUNCTION user_belongs_to_tenant(tenant_uuid uuid)
RETURNS boolean AS $$
DECLARE
  user_tenants uuid[];
BEGIN
  -- Super admin can access all tenants
  IF is_super_admin() THEN
    RETURN true;
  END IF;

  -- Get user's tenant IDs
  user_tenants := current_tenant_id();
  
  -- Check if tenant is in user's tenant array
  RETURN tenant_uuid = ANY(user_tenants);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

