# Production release evidence contract

**Status: gate implementation only; actual release acceptance remains blocked.**
The authoritative scope is [the SaaS plan](SAAS_MASTER_PLAN_2026-10-12.md), REL-01
through REL-07. Unit tests, health endpoints and historical rebuild notes do not
complete these gates. Keep `LEAGUE_MEMBERSHIP_CONTROLS_READY` unset/false.

## Collect evidence outside production

1. Explicitly identify the disposable/staging database and deployment. Do not infer
   a project from its display name or use production for destructive/concurrency drills.
2. Test the exact full Git commit intended for production. Retain reports for all
   18 checks in `scripts/release-evidence.mjs` (the example JSON enumerates them).
   Cover the detailed acceptance matrix, not just the category name: real role/RLS/
   grant/constraint/service-role reads and writes across leagues, two-session races,
   transaction rollback, OTP/CRUD/device/offline recovery, publication withdrawal,
   fan-out/load/quotas, outbox recovery, storage/exports, privacy/abuse/retention,
   restore/rollback/rotation/recovery, provider sandboxes and coordinated rollout.
3. Migration-chain evidence must compare the canonical `supabase/migrations` files,
   deployed history, schema, constraints, grants and policies for this candidate.
   A successful `drizzle-kit migrate` is not proof of that SQL chain. Production
   deployment no longer applies migrations automatically; perform an explicitly
   authorized, reviewed schema rollout separately, then reverify acceptance.
4. Keep sanitized reports in a private retained evidence directory. Remove tokens,
   connection strings, OTPs, personal data and provider secrets before hashing them.
   Never commit raw operational logs. Reports must be nonempty, at most 50 MB each.

## Manifest

Copy `release-evidence.example.json` to `<private-evidence-directory>/manifest.json`.
The example is deliberately **blocked** and cannot authorize deployment.

- `schemaVersion`: `1`.
- `commit`: exact lowercase 40-character SHA; `target`: explicit non-secret production
  identifier such as `cricket-production`; `stagingEnvironment`: a different environment
  identifier tied to the actual acceptance resources in the reports.
- `recordedAt`: UTC ISO timestamp, no later than now and no older than seven days.
- Every check needs its listed `id`, exact `method`, `status: "passed"`, `commit`,
  `environment` equal to `stagingEnvironment`, `completedAt`, `operator`, `summary`
  and nonempty `artifacts: [{"file":"reports/isolation.txt","sha256":"<64-hex>"}]`.
  Completion must precede manifest recording and remain within seven days. Blocked,
  skipped, waived, duplicate, unknown, mock-only and missing checks fail closed.
- `ownerApproval`: `{ "decision": "approved", "reviewer": "<owner identifier>",
  "commit": "<same SHA>", "target": "<same target>", "approvedAt": "<UTC timestamp>" }`.
  Approval must follow recording and not be future/stale. Do not fabricate approval.
- Files must stay under the manifest directory, including after symlink resolution.
  URLs, absolute paths and parent traversal are not evidence files. Hashes bind file
  contents; missing/changed/empty files block the gate. Reports are never executed.

Run locally (Node.js 22+ recommended; no dependencies or database access):

```text
corepack pnpm test:release
corepack pnpm release:check --manifest <private-dir>/manifest.json --commit <full-SHA> --target <production-id>
```

Exit 1 means blocked. Exit 0 validates integrity and declared attestations **only**:
it cannot prove the report's claims, identify the reviewer, or cryptographically sign
owner consent. Review retained results and enforce access to the production environment.
A commit change requires fresh candidate-bound evidence; do not put a self-referential
commit-bound manifest in that same commit.

## Repository VPS job

The existing production environment and default-off flag remain mandatory. Before
configuring SSH, the job requires:

- Protected environment variable `RELEASE_EVIDENCE_RUN_ID`: a successful manually
  dispatched `main` Actions run from this repository with the exact candidate SHA.
- A reviewed artifact named `release-evidence-<full-SHA>` from that run, containing
  `manifest.json` at its root plus all referenced reports. The job has read-only
  contents/actions permissions and does not accept pull-request/fork run evidence.
- Protected `RELEASE_TARGET` matching the manifest and the intended VPS deployment.

The actual acceptance runner/uploader is **not implemented or certified by this
checker**; configure it only after the required staging resources and scenarios exist.
No evidence run currently exists from this work. Never substitute the checker's
synthetic test fixtures. Restrict who may dispatch acceptance workflows, upload
evidence and change production variables; require production environment reviewers.

The job deploys the reviewed SHA in detached HEAD mode, refusing a dirty checkout
instead of discarding VPS work or advancing to a newer `origin/main`. It transfers
the private evidence bundle into a generated VPS temporary directory and the script
revalidates it before Docker access. Node.js must exist on the VPS. Apply an operator
retention/purge policy to those private temporary bundles. Preflight and deployment
are serialized for this repository job. Operators must not run manual deployment
concurrently; cross-host/operator fencing remains an acceptance concern. External
hosting integrations and alternate deploy scripts are not controlled
by this job and need separate review.

For authorized manual production deployment, supply `LEAGUE_MEMBERSHIP_CONTROLS_READY=true`,
`RELEASE_EVIDENCE_MANIFEST` (absolute retained manifest path), `RELEASE_COMMIT` and
`RELEASE_TARGET` in the process environment, after owner review. The script requires
a clean checkout at that SHA. Supplying these variables is an operator attestation,
not a replacement for authentication or protected-environment approval. Staging setup
uses its separately reviewed workflow, not a bypass flag on this production script.
