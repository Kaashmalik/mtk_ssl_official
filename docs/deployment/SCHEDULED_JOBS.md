# Scheduled jobs (`/api/cron/*`)

Every recurring worker in the web app is a `GET /api/cron/<job>` route that:

1. requires `Authorization: Bearer $CRON_SECRET` (an unset secret answers 503 —
   it never runs unauthenticated),
2. does a **bounded** batch per invocation (each route caps its own page size),
3. stays **fail-closed** behind its own `*_READY` gate — the scheduler can be
   wired before the owner opts in, and the route then reports `ran: false`
   instead of doing the work.

Because of (3) it is safe to enable the schedule first and flip the gate later.

## Jobs

| Route | Cadence | Gate | What it does when the gate is off |
| --- | --- | --- | --- |
| `/api/cron/broadcast-jobs` | every 15 min | `BROADCAST_WORKER_READY=true` | nothing is claimed; jobs stay queued |
| `/api/cron/notification-jobs` | every 15 min | `NOTIFICATION_JOBS_READY=true` | nothing is claimed; rows retained |
| `/api/cron/invitation-emails` | every 15 min | `INVITATION_EMAIL_QUEUE_READY=true` | nothing is sent; outbox retained |
| `/api/cron/push-receipts` | every 15 min | `EXPO_ACCESS_TOKEN` + pending tickets | no ticket is chased; rows retained |
| `/api/cron/media-cleanup` | every 15 min | `MEDIA_CLEANUP_READY=true` | expiry reconciliation is DB-only and **always** runs; no provider destruction |
| `/api/cron/chat-retention` | daily (03:00 UTC) | `MATCH_CHAT_RETENTION_READY=1` | answers 200 `ran: false`, deletes nothing |
| `/api/cron/ssl-renewal` | daily (03:00 UTC) | NestJS API + Cloudflare config | reports the upstream error; no certificate action |
| `/api/cron/subscription-renewal` | daily (03:00 UTC) | provider/billing config | no grace-window enforcement until configured |

Nothing here is a substitute for the database migration: `chat-retention` also
requires `20261027120000_match_chat_retention.sql` (applied — see
`supabase/MIGRATION_STATUS.md`).

## Option A — GitHub Actions (default, plan-independent)

`.github/workflows/scheduled-jobs.yml` runs two schedules and can also be
triggered manually (`workflow_dispatch`, `fast` / `daily` / `all`).

Repository secrets required:

| Secret | Value |
| --- | --- |
| `CRON_APP_URL` | production web origin, e.g. `https://www.cricketleague.tech` |
| `CRON_SECRET` | exactly the web deployment's `CRON_SECRET` |

If either secret is absent the workflow logs a notice and exits 0, so a repo
without deployments stays green. A 401/403 fails the run (a rotated secret must
never look healthy); a 503 is reported as a warning (gate/config intentionally
off).

## Option B — Vercel Cron

A Vercel **Pro** project can drive the same routes from
`apps/web/vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/notification-jobs", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/invitation-emails", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/push-receipts", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/broadcast-jobs", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/media-cleanup", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/chat-retention", "schedule": "0 3 * * *" },
    { "path": "/api/cron/ssl-renewal", "schedule": "0 3 * * *" },
    { "path": "/api/cron/subscription-renewal", "schedule": "0 3 * * *" }
  ]
}
```

Vercel sends the bearer automatically when `CRON_SECRET` exists in the project
env. **Hobby** plans allow only 2 crons, once per day — that is why the default
is Option A. Enable one option only; running both is wasteful (every worker is
idempotent and leased, so it is not unsafe).

## Verifying a schedule end to end

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  "$CRON_APP_URL/api/cron/chat-retention"
```

Expect `200` with `{"ran":false,...}` while `MATCH_CHAT_RETENTION_READY` is
unset, and `401` without the bearer.
