# Branch Protection & Required Status Checks

This document defines the required CI checks for the `main` branch.
Configure these in **GitHub → Settings → Branches → Branch protection rules**.

## Required Status Checks

These checks MUST pass before a PR can be merged to `main`:

| Check | Source job | Blocks merge? |
|---|---|---|
| `Lint & Type Check` | `.github/workflows/ci-cd.yaml` → `lint` | ✅ Required |
| `Unit Tests` | `.github/workflows/ci-cd.yaml` → `test` | ✅ Required |
| `Security Scan` | `.github/workflows/ci-cd.yaml` → `security` | ✅ Required |
| `Build` | `.github/workflows/ci-cd.yaml` → `build` | ✅ Required |

## Recommended Branch Protection Settings

- [x] **Require a pull request before merging**
  - Require approvals: **at least 1**
  - Dismiss stale pull request approvals when new commits are pushed
  - Require review from Code Owners (add `CODEOWNERS` file)
- [x] **Require status checks to pass** (list above)
  - Require branches to be up to date before merging
- [x] **Require conversation resolution** before merging
- [x] **Do not allow bypassing the above settings** (even for admins)
- [x] **Restrict who can push** to matching branches (admins only)

## Rationale

The `Security Scan` job runs three blocking checks:
1. **Gitleaks** — catches accidentally committed secrets (API keys, JWTs, service_role keys)
2. **`pnpm audit`** — fails on HIGH/CRITICAL dependency vulnerabilities
3. **Trivy** — fails on CRITICAL findings in the filesystem scan

Previously these ran with `exit-code: 0` / `continue-on-error: true`, making them
informational only. They are now **enforcing** — a critical secret leak or vuln
will block the merge.

## CODEOWNERS (suggested)

Create `.github/CODEOWNERS`:

```
# Default owner for everything
*                       @muhammad-kashif

# Security-sensitive paths require explicit review
/.github/workflows/     @muhammad-kashif
/supabase/migrations/   @muhammad-kashif
/apps/admin/src/app/api/impersonate/   @muhammad-kashif
/packages/database/src/auth/   @muhammad-kashif
/packages/database/src/repositories/   @muhammad-kashif
```
