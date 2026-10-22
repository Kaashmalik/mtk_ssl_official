# Pending migrations — apply guide (2026-10-22)

Four additive migrations are committed on `feat/enh-p04-p11` but are **not
applied** to any environment by this repository work. They back the notification,
media and broadcast slices. This guide is the operator checklist for reviewing
and applying them in order.

> Nothing in this guide was executed against a remote or production database.
> Local unit/integration tests use mocks and are **not** migration or provider
> acceptance evidence.

## 1. Scope and order

Apply in filename order during one reviewed maintenance window:

| # | Migration | Backs | Key objects |
|---|---|---|---|
| 1 | `20261021120000_notification_reads.sql` | ENH-06-03 recipient read state | `notification_reads` |
| 2 | `20261021130000_notification_jobs.sql` | ENH-06-04 durable notification outbox | `notification_jobs` |
| 3 | `20261021140000_media_assets.sql` | ENH-07-01/02/03 media assets and cleanup | `media_assets`, `media_quotas`, `media_upload_sessions`, `media_bindings`, `media_consents`, `media_processing_events`, `media_cleanup_jobs` |
| 4 | `20261021150000_broadcast_provider.sql` | ENH-08-01/02/03/04 broadcast plane | `broadcast_connections`, `broadcast_destinations`, `broadcast_sessions`, `broadcast_jobs`, `broadcast_archives` |

All four are additive, wrap their work in `BEGIN`/`COMMIT`, and use
`CREATE TABLE/INDEX IF NOT EXISTS` plus guarded policy creation. They do not
alter or rewrite legacy tables (`notifications`, `media`,
`matches.live_stream_url`, `matches.stream_source`, `matches.stream_status` stay
readable). A replay on an environment that already has the objects is intended
to be a no-op, but verify that claim in staging before relying on it.

Each file must run as **one transaction**. If your SQL runner splits statements,
a mid-file failure can leave partial state; prefer the Supabase CLI migration
runner or `psql -v ON_ERROR_STOP=1 -f <file>`.

## 2. Pre-flight checks (read-only)

Run these against the target **staging** database first.

1. Confirm the pre-existing objects these migrations depend on:

```sql
select to_regclass('public.users')            as users,
       to_regclass('public.tenants')          as tenants,
       to_regclass('public.notifications')    as notifications,
       to_regclass('public.matches')          as matches;

select indexname
from pg_indexes
where schemaname = 'public'
  and indexname = 'matches_id_tenant_key';
```

`broadcast_sessions` needs the `(matches.id, tenant_id)` unique key
(`matches_id_tenant_key`) for its composite foreign key. If it is missing, stop
and reconcile the schema; do not "fix" it inside this window.

2. Confirm the four versions are not already recorded (and understand the
   filename-vs-history drift documented in `supabase/MIGRATION_STATUS.md`):

```sql
select version, name
from supabase_migrations.schema_migrations
where version like '20261021%'
order by version;
```

3. Confirm the objects do not already exist:

```sql
select to_regclass('public.notification_reads')       as notification_reads,
       to_regclass('public.notification_jobs')        as notification_jobs,
       to_regclass('public.media_assets')             as media_assets,
       to_regclass('public.broadcast_connections')    as broadcast_connections,
       to_regclass('public.broadcast_sessions')       as broadcast_sessions;
```

4. Take a verified backup/snapshot and record the current application SHA.

5. Check whether the deployment roles exist. The migrations grant only to
   `ssl` and `service_role` when present, and revoke `PUBLIC`, `anon` and
   `authenticated`:

```sql
select rolname from pg_roles where rolname in ('ssl', 'service_role', 'anon', 'authenticated');
```

If the application connects as a different role, reconcile grants **after**
review rather than editing the migration in place.

**Do not** run `supabase db reset` against any database that holds data, and do
not blindly run `db push` while the historical version drift described in
`supabase/MIGRATION_STATUS.md` is unresolved.

## 3. Apply

Apply one file at a time in the order above, then confirm the version row and
the objects. Example with `psql` against a reviewed staging connection:

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261021120000_notification_reads.sql
# repeat for 20261021130000, 20261021140000, 20261021150000
```

If you use the Supabase CLI, review `supabase migration list` / the generated
plan first and apply only these four versions. Record the applied versions and
the application SHA in the release evidence.

### What each migration expects after apply

**1. `notification_reads`**

- One marker per `(notification_id, user_id)`; cascades with the notification
  and the user.
- RLS enabled and forced; `ssl`/`service_role` get select/insert/update/delete.
- Application code resolves the member server-side; the table is not a
  client-writable Data API surface.
- Deploy the recipient-read-state code only after this table exists.

**2. `notification_jobs`**

- Durable outbox keyed by `(event_id, recipient_user_id, channel)`; lease,
  attempts, state and `next_attempt_at` columns.
- RLS enabled and forced; `ssl`/`service_role` get select/insert/update only
  (no delete).
- `tenant_id` is nullable **only** for account-level notices such as onboarding.
- Apply before setting `NOTIFICATION_JOBS_READY=true` or scheduling the worker.

**3. Media tables**

- `media_assets`, quota reservations, upload sessions, same-tenant bindings,
  consent evidence, webhook dedup journal and the cleanup outbox.
- Same-tenant attachment is enforced by composite foreign keys, not only by
  application code.
- RLS enabled/forced on every new table; `ssl`/`service_role` get
  select/insert/update.
- `media_quotas.limit_bytes` is `NULL` by default and a `NULL` limit **refuses**
  uploads. Creating an approved quota row is a separate operator decision; the
  migration seeds no quota and no asset.
- Apply before enabling media upload routes and before
  `MEDIA_CLEANUP_READY=true`.

**4. Broadcast tables**

- `broadcast_connections.credential_ref` is an opaque `env://`/`secret://`
  reference, never a plaintext token.
- `broadcast_sessions` separates desired operator intent from provider-observed
  state; `broadcast_jobs` is the durable outbox; `broadcast_archives` carries
  replay/retention metadata.
- RLS enabled/forced; `ssl`/`service_role` get select/insert/update.
- The migration seeds no connection and no destination. Seed an approved
  connection/destination through the super-admin route after apply.
- Legacy `matches.live_stream_url` / `stream_source` / `stream_status` remain
  the fallback and are not rewritten.

## 4. Post-apply verification

```sql
-- Objects exist
select to_regclass('public.notification_reads'),
       to_regclass('public.notification_jobs'),
       to_regclass('public.media_assets'),
       to_regclass('public.media_quotas'),
       to_regclass('public.broadcast_connections'),
       to_regclass('public.broadcast_destinations'),
       to_regclass('public.broadcast_sessions'),
       to_regclass('public.broadcast_jobs'),
       to_regclass('public.broadcast_archives');

-- RLS is enabled and forced on the new tables
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'notification_reads', 'notification_jobs',
    'media_assets', 'media_quotas', 'media_upload_sessions',
    'media_bindings', 'media_consents', 'media_processing_events',
    'media_cleanup_jobs',
    'broadcast_connections', 'broadcast_destinations',
    'broadcast_sessions', 'broadcast_jobs', 'broadcast_archives'
  )
order by c.relname;

-- No anon/authenticated table privileges on the new tables
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'notification_reads', 'notification_jobs',
    'media_assets', 'media_quotas', 'media_upload_sessions',
    'media_bindings', 'media_consents', 'media_processing_events',
    'media_cleanup_jobs',
    'broadcast_connections', 'broadcast_destinations',
    'broadcast_sessions', 'broadcast_jobs', 'broadcast_archives'
  )
  and grantee in ('anon', 'authenticated', 'PUBLIC');

-- Verified versions
select version, name
from supabase_migrations.schema_migrations
where version in (
  '20261021120000', '20261021130000',
  '20261021140000', '20261021150000'
)
order by version;
```

The `anon`/`authenticated` query must return **zero rows**. Then exercise the
real staging journeys (recipient read state, worker claim/settle, media quota
refusal/upload, broadcast prepare/start/end and replay) with matching
application artifacts.

## 5. Gate activation

Keep every gate below unset/false until its migration is applied, reviewed and
the matching application artifact is deployed.

| Flag | Default | Enable after |
|---|---|---|
| `NOTIFICATION_JOBS_READY` | unset/false | `20261021130000` applied; worker schedule and CRON secret reviewed |
| `NOTIFICATION_EMAIL_READY` / `NOTIFICATION_PUSH_READY` | unset/false | separate provider/device acceptance; not implied by the migration |
| `MEDIA_CLEANUP_READY` | `false` | `20261021140000` applied; approved quota rows and provider cleanup reviewed |
| `BROADCAST_PLAYBACK_READY` | `false` | `20261021150000` applied; public catalogue checks pass |
| `BROADCAST_CONTROL_READY` | `false` | `20261021150000` applied; owner command acceptance passes |
| `BROADCAST_WORKER_READY` | `false` | `20261021150000` applied; worker/CRON deployed and leases reviewed |
| `BROADCAST_CREDENTIALS_READY` + `BROADCAST_CREDENTIAL_NAMES` | `false` / unset | approved credential references seeded; allowlist reviewed |
| `BROADCAST_INGEST_ENCRYPTION_KEY` | unset | canonical base64 32-byte key provisioned; rotation plan agreed |

Manual Studio / Live Producer streaming remains the supported fallback while
provider approval is pending.

## 6. Rollback

- Prefer a **forward fix**. These migrations are additive and the previous
  application binary continues to work with them present.
- If you must withdraw the feature, first set the related gates to false and
  deploy the previous application artifact.
- Dropping the new tables is destructive and requires a reviewed backup plus an
  explicit decision. In particular:
  - `notification_reads` rows are recipient state; dropping loses it.
  - `notification_jobs` may hold undelivered or dead-lettered work.
  - `media_*` tables hold asset, consent and cleanup evidence; dropping them
    can orphan provider assets.
  - `broadcast_*` tables hold sessions, jobs and archive metadata; dropping
    them loses audit/reconciliation evidence.
- There is no automatic down migration. Do not restore a legacy fallback as an
  access-recovery shortcut.

## 7. Explicit non-claims

- No migration was applied, no remote/production schema or data was inspected or
  modified, and no provider was called by this repository work.
- Local tests (web, contracts, database, release and roadmap) prove source
  behavior only. They do not prove PostgreSQL locking, RLS enforcement, grants,
  provider acceptance, browser/native behavior or retention compliance.
- Real OAuth, account/embed/playlist approval, worker/CRON deployment and
  provider-mutation drills remain externally gated.
