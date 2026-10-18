# Rollback Runbook — Shakir Super League

Companion to `DEPLOY.md` (deploy) and `RELEASE_CHECKLIST.md` (gate).
The first rule of rollback: **it is rehearsed, not improvised**. Scenario
A is written so it can be executed in under five minutes; everything
else has a defined data-safety position before any command is typed.

Standing truths that shape every scenario:

- Migrations are **additive** (tables/columns/grants only). This is what
  makes forward-fixing usually cheaper than rolling schema back.
- Supabase is the system of record; point-in-time recovery (PITR) is the
  data-safety net. Nothing in these procedures edits raw data by hand.
- The release SHA and the previous-good SHA are recorded in the release
  checklist BEFORE deploying (step 5).

---

## Scenario A — Bad application deploy (code only, no schema change)

Symptoms: new build is broken (5xx, wrong behavior), but the release
contained no database migration, or its migration is additive and
harmless to keep.

```bash
cd /opt/mtk-ssl
git log --oneline -5            # confirm the previous-good SHA
git reset --hard <previous-good-sha>
bash scripts/preflight.sh       # READY - 0 blockers
bash deploy-vps.sh --phase all  # rebuild + health-check
```

Then on Vercel (web/admin/marketing): redeploy the previous production
deployment (Deployments → previous → Promote) — Vercel rollbacks are
instant and independent of the VPS.

Verification: DEPLOY.md Step 8 health checks + the section-5 smoke list
of `RELEASE_CHECKLIST.md`. Record the rollback in the release evidence
notes (what failed, what SHA restored service).

## Scenario B — Failing or drifting migration

Symptoms: the deploy fails during migrations, or
`migration-inventory.cjs --db` reports drift AFTER a deploy.

1. **Stop.** Do not re-run migrations blindly and do not hand-edit the
   schema. Each migration runs once and is recorded in
   `supabase_migrations.schema_migrations`; a half-applied migration is
   an incident, not a retry.
2. Identify the direction of drift from the report:
   - `missingInDb`: the migration never applied → fix the cause (syntax,
     permissions, lock timeout), apply ONCE with the proven splitter
     path, verify objects in the same session, then append the evidence
     row to `supabase/MIGRATION_STATUS.md`.
   - `untrackedInDb`: the database has a migration the folder does not.
     **Never normalize by deleting.** Identify the object, document it in
     MIGRATION_STATUS as an inventory finding, and reconcile the folder
     with a proper migration (additive) if it must change.

The rule: folder and database converge only through migrations, never
through manual edits on either side.

## Scenario C — Data corruption or bad data from a deploy

Symptoms: the deploy succeeded, but data written under the new code is
wrong.

1. Freeze the write path where the corruption originates (disable the
   affected feature flag/endpoint; the scoring locks already stop
   writes on fencing failures).
2. Decide the recovery point WITH the owner: PITR restore to the minute
   before the bad deploy (Supabase dashboard → Database → Backups), or
   forward-fix via an additive migration + audited correction paths if
   the corruption is narrow.
3. PITR restore is a NEW environment restore: export/restore follows
   Supabase's guided flow; expect reconfiguration of `.env.prod`
   DATABASE_URL and a full redeploy afterwards (Scenario A mechanics).
4. After any restore: run
   `DATABASE_URL=... node scripts/migration-inventory.cjs --db` and
   record the result as the new Baseline in MIGRATION_STATUS.

## Scenario D — Service crash-loop after deploy

Symptoms: one container restarts repeatedly (see DEPLOY.md
Troubleshooting).

1. `docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail=100 <service>`
2. Missing/invalid secret → fix `.env.prod` →
   `docker compose ... up -d --force-recreate <service>` (envs bake at
   start time; a bare `restart` does not reload them).
3. If the crash source is the new code itself → Scenario A.
4. nginx/TLS failures are NOT service rollbacks — see DEPLOY.md Step 4.

## Scenario E — Rollback after a schema-advancing release

The case additive migrations were designed for: the release's migrations
stay (they are backward-compatible by construction — additive only), and
the CODE rolls back per Scenario A. The new columns/tables remain as
unused capacity. Removing them is a FUTURE migration, planned with the
same evidence discipline as any other (never a rollback DROP).

Exception: if the migration itself caused Scenario B/C, its full
recovery is defined there — including PITR — and the code rollback
follows after data safety is re-established.

---

## Drill requirements (REL-05 / REL-07)

Scenarios A and B are exercised as **operator drills** before the first
production release claim (tracked in
`scripts/release-evidence.mjs` `RELEASE_REQUIREMENTS` under
`REL-07/deploy-rollback` and `REL-05/migration-rollback`); Scenario C's
backup/PITR restore is the `REL-05/backup-restore` drill. Until a drill
has actually run against the real infrastructure, the corresponding
evidence artifact does not exist and MUST NOT be claimed.
