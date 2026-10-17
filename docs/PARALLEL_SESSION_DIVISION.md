# Parallel session division of work

Written by **Session B** (parallel worktree, branch `reg01-league-application`) on
17 October 2026, against the Batch 85 state of `SAAS_MASTER_PLAN_2026-10-12.md`
and `DELIVERY_EXECUTION_GROUPS.md`. This changes *who works on what and where it
lands*, nothing else: scope, release gates and checklist meaning stay
authoritative in the master plan, and no checkbox is closed by this document.

## Why

Two model sessions work this repository concurrently. To finish the plan
without either session committing the same file for the same change, the seven
delivery groups are assigned to a single owner each, and the parallel session
commits on its own branch.

## Branches and merge protocol

| Session | Works in | Branch | Commit style |
| --- | --- | --- | --- |
| **A** — batch program | main repository | `main` | `feat(scope): … (Batch NN)` |
| **B** — parallel slices | git worktree | `reg01-league-application` | `feat(scope): …` (no batch number; this doc names the slice) |

- A stays the only writer of `main`. B never commits to `main` directly.
- B rebases onto `main` after every A push that touches a shared file
  (barrels, allowlists, nav, docs). Conflicts are resolved in B's worktree.
- Merging B into `main` happens between A's batches, on request; it replays at
  most a few additive hunks. B's commits are kept as their own history; they
  are never folded into a Batch commit.
- A's Batch numbers stay unambiguous: B's commits carry no Batch number.

## Group ownership

| Delivery group (`DELIVERY_EXECUTION_GROUPS.md`) | Owner |
| --- | --- |
| Release foundation and acceptance (BASE-04..06, REL-01..07) | A (external inputs required) |
| Isolation, membership and authentication (ISO-04..09, IAM-02..09) | A |
| Match-day scoring and mobile (SCORE-08..14) | A |
| Registration and competition (REG-01..07, COMP-03..07) | **B** |
| Public records, awards and prizes (PUB-02..06) | A (PUB-02 hub landed, Batch 86) |
| Role UX and fan engagement (UX-03..04, FAN-01..04) | A |
| White-label and commercial (PREM-01..06) | A |

If B ever needs something outside its group (a shared database helper, for
example), it does the change on its branch and marks the commit
`[cross-group]` with the reason, so the merge review can see it.

## Session B slice plan (registration and competition group)

1. **reg-01-slice-1 — this commit: reviewed league onboarding.**
   Platform league application → review → activation with
   duplicate-provisioning safeguards:
   - `packages/database/src/lib/league-application-policy.ts` — the single
     decision source (states, versioned transitions, approval gate).
   - `packages/database/src/schema/league-applications.ts` +
     `supabase/migrations/20261017130000_league_applications.sql` (**local
     only, unapplied**) — one active application per applicant (partial unique
     index), at most one tenant as provisioning receipt (unique
     `provisioned_tenant_id`).
   - Applicant server actions (row-locked, version-CAS, audited
     `LEAGUE_APPLICATION_*`) + apply page/form; setup page links to it.
   - Platform review route under the same lock order (user → application),
     re-verifying applicant active + ownerless, atomically provisioning tenant
     + free subscription + `league_owner` role; admin console page + nav.
   - Tests: 16 policy, 8 schema/migration contracts, 19 web actions, 5 page.
2. **reg-01-slice-2 (next): decision visibility** — applicant-facing result
   surfaces and notifications after approve / reject / request-information,
   plus acceptance-friendly status reads. Then the remaining REG/COMP open
   IDs, one coherent slice per commit.

## Shared files (both sessions will eventually touch these)

Keep edits additive — one entry/line per change — and resolve at B's rebase.

| File | A's use | B's use (this slice) |
| --- | --- | --- |
| `packages/database/src/index.ts` | new exports | +1 policy export, +1 schema export |
| `packages/database/src/schema/index.ts` | new exports | +1 export line |
| `apps/web/src/__tests__/no-unscoped-queries.test.ts` | allowlist changes | +1 allowlist entry (`league-applications.ts`, bootstrap-class like `tenants.ts`) |
| `apps/admin/src/components/layout/sidebar.tsx` | nav items | +1 nav item (League Applications) |
| `apps/web/src/app/dashboard/league/setup/page.tsx` | — | +1 link to the apply flow |
| `docs/SAAS_MASTER_PLAN_2026-10-12.md` | per-batch status rows | **deferred to merge** (one parallel-slice note on the REG-01 row) |
| `supabase/MIGRATION_STATUS.md` | per-migration rows | **deferred to merge** (one row: `20261017130000_league_applications.sql`, LOCAL ONLY, unapplied) |

Deferred rows are recorded so the merge cannot forget them. Migration files are
local-only and unapplied, so ordering is settled at merge simply by timestamp
(no renames expected: `20261017130000` sorts after all Batch ≤ 85 migrations).

## Rebase log (B onto A's `main`)

- 17 Oct 2026 — rebased onto `4ac65b6` (Batch 86, PUB-02 hub). **Zero files in
  common** with B's slice; no conflicts. Full suites re-verified on the new
  base: `@mtk/database` 282/282, `@mtk/web` 2722/2722, web + admin type-check
  clean, `@mtk/database` build clean.

## Environment note (Windows checkout)

On a fresh worktree this host checks out some committed LF files as CRLF
(`core.autocrlf=true`), which breaks contract tests that compare with `\n`
(e.g. the membership migration test). Fix the working copy, not the repo:

```powershell
Remove-Item <path>; git -c core.autocrlf=false checkout -- <path>
```

Stage files with legacy CRLF blobs (`packages/database/src/index.ts`) using
`git -c core.autocrlf=false add <path>` to avoid whole-file whitespace diffs.
