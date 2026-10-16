-- ISO-06: retire the legacy users.role / users.tenant_ids authorization fallback.
--
-- League roles are authoritative ONLY in user_tenant_roles (role, status,
-- expiry under SCORE-09). users.role is hereby a PLATFORM-role carrier
-- (super_admin | fan); this constraint blocks any legacy writer from
-- reintroducing league roles here. users.tenant_ids is write-disabled data:
-- no consumer reads it for authorization any more (createTenant stopped
-- writing it and the admin console counts membership rows instead).

ALTER TABLE public.users
  ADD CONSTRAINT users_role_platform_only
  CHECK (role IN ('super_admin', 'fan'));

COMMENT ON COLUMN public.users.role IS
  'Platform role only (super_admin or fan), enforced by users_role_platform_only. League roles are authoritative in user_tenant_roles and are never read from this column (ISO-06).';
COMMENT ON COLUMN public.users.tenant_ids IS
  'DEPRECATED (ISO-06): legacy write-disabled fallback. Authoritative league membership is user_tenant_roles; do not read or write this column for authorization.';
