# Release Checklist — Shakir Super League

The companion to `DEPLOY.md` (the deploy runbook) and
`docs/ROLLBACK_RUNBOOK.md` (the recovery procedures). This checklist is
the go/no-go gate between "the code is merged" and "the code ships".
Items marked **CI** are enforced by the pipeline; items marked
**OPERATOR** are a human's judgment recorded in the release evidence
manifest (see `scripts/release-evidence.mjs`).

## 0. Scope and version discipline

- [ ] One release = one main-branch SHA. Nothing ships from a working
      tree; `git status` is clean and `main == origin/main`.
- [ ] Every batch since the last release has its battery recorded in
      `MASTER_PLAN_2026-10-10.md` (registers) and, where schema changed,
      its migration evidence in `supabase/MIGRATION_STATUS.md`.

## 1. Automated gates (must all be green)

- [ ] **CI:** `pnpm lint && pnpm type-check && pnpm test --coverage` on
      the release SHA (`.github/workflows/ci-cd.yaml`, "Unit Tests" job).
- [ ] **CI:** release-evidence checker + shell-syntax gate
      (`pnpm test:release`, `bash -n deploy-vps.sh`).
- [ ] **CI:** security scan (blocking).
- [ ] **OPERATOR:** the local full battery on the release SHA —
      web vitest, database vitest, scoring-service jest,
      `tsc --noEmit` ×4 (web/database/scoring/admin),
      `git diff --check`. The register records the counts; a release
      with fewer passing tests than the last register entry is a stop.

## 2. Schema and data gates

- [ ] **OPERATOR:** `node scripts/migration-inventory.cjs --manifest`
      reviewed — the migration list matches expectation, no unparseable
      filenames.
- [ ] **OPERATOR (on staging/production):**
      `DATABASE_URL=... node scripts/migration-inventory.cjs --db`
      — zero `missingInDb`, zero `untrackedInDb`. Drift stops the
      release (**BASE-04**).
- [ ] Migrations on this release are **additive** (new tables/columns/
      grants only). A migration that rewrites or drops needs an explicit
      data-migration plan and a `docs/ROLLBACK_RUNBOOK.md` entry.

## 3. Release evidence manifest

- [ ] **OPERATOR:** the manifest
      (`scripts/release-evidence.mjs --manifest ...`) carries evidence
      artifacts for every requirement in `RELEASE_REQUIREMENTS` that this
      release claims. Requirements NOT claimed stay explicitly absent —
      a missing artifact for an unclaimed requirement is correct; a
      fabricated one is corruption.
- [ ] CI enforces the manifest before any VPS access ("Validate release
      evidence before any VPS access" job).

## 4. Deploy (see DEPLOY.md for the full steps)

- [ ] `bash scripts/preflight.sh` → `READY - 0 blockers`.
- [ ] `bash deploy-vps.sh --phase all`; health checks pass
      (`/api/health` on api + gateway; container list all healthy).
- [ ] Post-deploy verification of DEPLOY.md Step 10 (Clerk origins,
      Stripe webhook, first admin, backups/PITR enabled).

## 5. Smoke and rollback readiness

- [ ] Public pages render (`/`, one tournament, one match) with correct
      locale fallback; dashboard auth round-trips (login → dashboard →
      sign out).
- [ ] The previous release SHA is recorded here before deploying, and
      `docs/ROLLBACK_RUNBOOK.md` scenario A is executable within 5
      minutes.

## 6. Owner approvals (OPERATOR, recorded in the manifest)

- [ ] Feature documentation is truthful: user-facing release notes name
      only what actually shipped (registers are the source). Estimates
      and AI-generated text never appear as official results (FAN-04
      discipline).
- [ ] An owner has approved THIS checklist as filled in for this SHA.
