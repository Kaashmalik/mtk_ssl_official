# ADR 003: Match chat transport (ENH-10-02)

**Status:** Accepted for implementation, 2026-10-26. Chat stays **off** for every
league until its owner enables it (ENH-10 phase gate: moderation coverage).

## Context

ENH-10 adds moderated, tenant-scoped fan chat to match pages. The roadmap
requires choosing the real-time transport owner before implementation and
forbids inventing an unowned extra service.

Options already in the repository:

1. **Scoring socket (`scoring-service`, Socket.IO).** Real-time, but it is the
   canonical scoring path. Putting untrusted fan traffic on it couples a chat
   flood or outage to scoring, which ENH-10-04 explicitly forbids ("chat outage
   does not block scoring/video").
2. **A new WebSocket/SSE service.** Lower latency, but a new deployable with no
   owner, scaling, or on-call story. Rejected by the roadmap rule.
3. **Authenticated HTTP polling against Postgres via `apps/web`.** No new
   service, reuses Clerk identity, league membership checks, fan blocks and
   the existing database. Latency equals the poll interval.

## Decision

Use **option 3**: cursor-based polling of a Next.js route handler
(`GET /api/matches/[matchId]/chat`), and server actions for posting and
moderation.

- **Order and cursor.** Each message gets a database identity `seq`. Identity
  values are allocated at insert time, so a transaction can commit a lower
  `seq` after a higher one is already visible. The server therefore only
  advances the returned cursor to messages older than
  `MATCH_CHAT_CURSOR_SETTLE_MS`, and always returns everything above the
  client's cursor; the client de-duplicates by message id. Late commits inside
  the settle window are re-delivered rather than skipped.
- **Moderation propagation.** Each poll also returns ids hidden since the
  client's last poll, so removed messages disappear for every viewer.
- **Idempotent posting.** The client sends a `clientKey` (uuid) per message;
  `(author_user_id, client_key)` is unique, so a retried send after a lost
  response never creates a duplicate.
- **Rate limits across replicas.** Slow mode and the flood floor are computed
  from the database (the shared source of truth), not process memory.
- **Poll interval.** `MATCH_CHAT_POLL_MS` while the tab is visible; polling
  pauses when hidden.

## Consequences

- Delivery latency is a few seconds, acceptable for fan chat beside a provider
  video that is itself delayed.
- Load is one indexed query per viewer per interval. If a league's audience
  outgrows this, move delivery to a dedicated service with its own ADR; the
  table, cursor and moderation contracts stay unchanged.
- Chat is fully independent of scoring and video: if the chat route fails, the
  panel shows an error and nothing else on the page is affected.
