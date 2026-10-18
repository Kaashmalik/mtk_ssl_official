-- Batch 114 (UX-03): per-user display timezone preference.
-- Additive schema only. Null = unset; every display formatter falls back
-- to an explicit UTC label and NEVER imputes the server's zone.
-- Idempotent (safe re-run; history row is ON CONFLICT DO NOTHING).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "time_zone" text;
