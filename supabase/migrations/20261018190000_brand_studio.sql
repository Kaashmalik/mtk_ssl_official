-- Brand Studio draft/publish/rollback (PREM-02 slice, Batch 135).
--
-- Design recorded 2026-10-18: branding edits become a DRAFT, never an
-- immediate live change. Publishing copies the draft into `published`
-- (keeping the previous published snapshot for one-step rollback), and
-- readers get the ACTIVE snapshot via getTenantBranding - legacy rows with
-- no published snapshot keep rendering their column values unchanged.
-- Rollback is a swap with the same audit provenance; replay (no previous
-- snapshot) is an honest pure read. Nothing is deleted - history lives in
-- audit_logs plus the previous_published pointer.
--
-- jsonb (not columns) because the draft/published shapes are exactly the
-- application's BrandingValues record; the DB only guarantees cohesion.

ALTER TABLE tenant_branding
  ADD COLUMN draft jsonb,
  ADD COLUMN published jsonb,
  ADD COLUMN previous_published jsonb,
  ADD COLUMN published_at timestamptz;

ALTER TABLE tenant_branding
  ADD CONSTRAINT tenant_branding_snapshot_shape_check
  CHECK (
    (published IS NULL OR jsonb_typeof(published) = 'object')
    AND (previous_published IS NULL OR jsonb_typeof(previous_published) = 'object')
  );

ALTER TABLE tenant_branding
  ADD CONSTRAINT tenant_branding_draft_shape_check
  CHECK (draft IS NULL OR jsonb_typeof(draft) = 'object');

COMMENT ON COLUMN tenant_branding.draft IS
  'Brand Studio pending edits (PREM-02); publishing moves them into published';
COMMENT ON COLUMN tenant_branding.published IS
  'The active branding snapshot; NULL = legacy row renders its own columns';
COMMENT ON COLUMN tenant_branding.previous_published IS
  'The prior published snapshot for one-step rollback; NULL after the first publish';
COMMENT ON CONSTRAINT tenant_branding_snapshot_shape_check ON tenant_branding IS
  'Draft and snapshot columns, when present, are JSON objects';
