# Premium Cricket SaaS & White-Label Master Plan

- **Created:** 2026-10-10
- **Last updated:** 2026-10-12
- **Repository:** https://github.com/Kaashmalik/mtk_ssl_official
- **Review baseline:** `main` at `87e5d6f`
- **Status:** Implementation started; progress recorded in section 14.

> **Roadmap update - 12 October 2026:** the current future delivery order and
> built/remaining phase checklists are in
> [Cricket SaaS Master Plan 2026-10-12](docs/SAAS_MASTER_PLAN_2026-10-12.md).
> This file remains the historical findings and implementation-batch evidence
> register; its recorded results and unverified acceptance requirements are preserved.

## 1. Product vision and review scope

Build a white-label cricket operating platform where organizers run leagues,
teams manage participation, scorers deliver trustworthy live coverage, and fans
follow matches through a fast, polished experience.

The three coordinated investments are reliable cricket scoring, consistent SaaS
controls, and complete premium user journeys. Delivery order:

**Correct cricket engine → consistent SaaS controls → complete operations →
premium responsive experience → commercial white-label → expansion features.**

This plan is based on a source review of repository structure, architecture
decisions, database schemas, tenant/permission logic, scoring writes, live-state
integration, mobile synchronization, branding, billing, navigation, tournament
creation, deployment configuration, and CI. Initial findings are not a claim of
browser, deployed-infrastructure, or current remote-database verification.

Existing canonical architecture:
[`docs/architecture/BACKEND_UNIFICATION_DECISION.md`](docs/architecture/BACKEND_UNIFICATION_DECISION.md).
Historical database claims in older audits must be reverified before deployment.

## 2. Existing foundation

| Area | Foundation to build on |
| --- | --- |
| Applications | Marketing, league web portal, platform admin, Expo mobile |
| Backend | Next.js product CRUD and Nest specialist services |
| Database | Shared Drizzle schemas, tenant repositories, scoring events/projections |
| Identity | Clerk, tenant memberships, permissions, invitations |
| Commercial | Free/Starter/Pro/Enterprise limits, subscriptions, invoices, manual payments |
| White-label | Branding settings, domain/email verification, ACME certificate service |
| Cricket operations | Tournaments, teams, players, matches, registrations, scorer assignment UI |
| Public experience | Match scorecards, tournament pages, leaderboards, live pages |
| Live features | Socket updates, commentary, reactions, stream embeds |
| UI | Shared components, tokens, dark mode, skeletons, mobile drawer |
| Quality | Unit tests, Playwright specifications, CI, observability packages |

Presence of a page or service does not prove that its full workflow is ready for
production. Verify existing features before rebuilding them.

## 3. Source-level baseline findings

P0 = scoring correctness/data-loss blockers. P1 = release-critical product,
isolation, integration, or operational work. P2 = premium differentiation.

| ID | Priority | Finding and source | Required outcome |
| --- | --- | --- | --- |
| SCORE-01 | P0 | `actions/scoring.ts` sends overlapping `runs`/`extras.runs`; service adds them | Explicit run components; no double counting |
| SCORE-02 | P0 | `scoring.service.ts` still rejects over/ball duplicates despite sequence schema | Repeated illegal deliveries and subsequent legal balls work |
| SCORE-03 | P0 | Operation ID absent from inspected service DTO/proxy/write | Stable replay deduplication and acknowledgements |
| SCORE-04 | P0 | Mobile sync lacks authenticated mutation contract | User-authenticated API/BFF; internal secrets remain server-side |
| SCORE-05 | P0 | Mobile treats every HTTP 400 as synchronized | Rejected operations retained with actionable errors |
| SCORE-06 | P0 | Undo reconstructs extras differently from recording | Exact event reversal/correction |
| LIVE-01 | P1 | Socket updates cannot initialize null innings in `use-scoring-socket.ts` | Complete authoritative snapshot on fresh visit/reconnect |
| TENANT-01 | P1 | Permissions and actions can select different tenants | One verified active context per operation |
| ACCESS-01 | P1 | Assigned scorer not enforced in inspected canonical write path | Resource-scoped scoring permissions |
| TOUR-01 | P1 | Wizard validates all fields on every step | Current-step validation and full final validation |
| TOUR-02 | P1 | Wizard drops match type, overs, fees, seeding, branding | Validated persistence and round-trip loading |
| BRAND-01 | P1 | Fixed SSL header/sidebar/root metadata; client-only branding | Complete server-rendered tenant identity |
| EVENT-01 | P1 | Post-commit Kafka publish can fail without durable retry | Transactional outbox and idempotent consumers |
| PAY-01 | P1 | EasyPaisa placeholder URL and default verification-success branch | Real provider verification before enabling online payments |
| OPS-01 | P1 | Compose infrastructure exposure and routing need reconciliation | Tested private-network/service contract |
| DB-01 | P1 | Migration filenames/history diverge | Reconciled history and fresh-database proof |
| TOUR-03 | P1 | Tournament `createdBy` receives Clerk string but schema requires user UUID | Resolve persisted author identity before insert |

Source paths are under `apps/web/src`, `apps/mobile/src`,
`services/scoring-service/src`, and `services/payment-service/src` unless stated.
Track partial remediation honestly; an item is complete only when its acceptance
criteria and relevant checks pass.

## 4. Target architecture and engineering practices

```text
Marketing | Tenant web | Platform admin | Mobile/PWA
                         ↓
Shared identity, verified tenant context, permissions, entitlements,
validation, domain/application operations, auditing
                         ↓
PostgreSQL / Drizzle + tenant-scoped repositories
                         ↓
Specialists: scoring, payments, notifications, domains, streaming,
analytics and commentary

Scoring transaction → event + projections + durable outbox
                   → event delivery → live clients and downstream consumers
```

1. Preserve the accepted hybrid architecture; scoring-service is the single writer.
2. Use the same verified tenant for authorization, repository calls, and writes.
3. Combine membership, capability, resource assignment, and entitlement checks.
4. Enforce server-side permissions; hiding navigation is not authorization.
5. Add tenant-aware relationship constraints where appropriate.
6. Define public/unlisted/private access across HTTP, sockets, exports, and streams.
7. Make commands/events versioned, idempotent, durable, and replayable.
8. Validate at trust boundaries; use structured errors and shared contracts.
9. Keep mobile/browser clients free of internal service tokens.
10. Build dependency declarations before downstream checks; preserve lockfile versions.
11. Ship focused, reviewable batches with meaningful regression tests.
12. Verify migrations locally/staging before remote application; reconcile existing history.

Proposed shared boundaries: identity/access, tenant management, competition,
deterministic cricket rules, commercial entitlements, branding, and API/event
contracts. Extract packages when multiple apps genuinely share the responsibility.

## 5. SaaS foundation and user controls

### Workspace lifecycle

- Multiple leagues per organization, explicit switcher, persistent active selection.
- Correct-league invitations, ownership transfer, suspension/removal.
- Archive/restore, exports, regional currency/time zone.
- Setup → active → restricted → archived lifecycle.
- Different roles for the same person in different leagues.

### Resource-scoped roles

| Role | Scope |
| --- | --- |
| Platform admin | Platform operations and audited support |
| Organization owner | Organization and league ownership |
| League administrator | League operations |
| Finance manager | Fees, invoices, reconciliation |
| Tournament director | Assigned competitions |
| Team manager / coach | Assigned teams and squads |
| Scorer | Assigned matches |
| Broadcaster | Assigned streams and overlays |
| Player | Personal profile and participation |
| Fan | Published content and followed entities |

Add session/device management, sensitive-action reauthentication, privileged MFA,
actor/resource/before-after audit history, time-limited support impersonation,
notification quiet hours, language/theme/density settings, scoped API keys, and
webhook subscriptions for eligible plans.

## 6. Complete white-label product

### Brand Studio

Logo/favicon, league/application names, light/dark palettes, approved fonts,
accessible foreground colors, homepage presets, sponsor placements, email sender
and templates, social images, reports/scorecards, PWA manifest/icons, broadcast
graphics, draft preview, publish, and rollback.

### Domain journey

Enter domain → prove ownership → show DNS records → verify routing → provision
HTTPS → verify login/application → activate.

Expose awaiting-DNS, verifying, HTTPS-provisioning, active, action-required, and
renewal-failed states. Include login redirects, sessions, cookies, canonical URLs,
email links, and socket origins in verification.

Server-render identity, remove fixed names/metadata, reset branding on tenant
switch, and use approved tokens/scoped extensions. Decide whether the host or
existing ACME service owns HTTPS. Test domain removal, reassignment, and renewal.

Delivery levels: branded portal → custom-domain portal → branded PWA → separately
scoped enterprise native application.

## 7. Live Match Center and professional feeds

Two separate products:

1. Organizer-owned matches use the platform's scoring engine.
2. Professional/international matches use a licensed external feed adapter.

External coverage requires match/competition mapping, attribution, freshness
monitoring, quotas, outage behavior, and redistribution/display entitlements.
Keep feed records distinct from organizer-owned scoring data.

### Match Center tabs

**Overview · Scorecard · Commentary · Analysis · Squads · Match Info · Watch**

- Overview: badges, score/wickets/overs, status, current/required rates, target,
  runs/balls required, batters/bowler, last six deliveries, partnership, toss,
  venue, and last-updated/stale indicator.
- Scorecard: batting, bowling, dismissal details, extras breakdown, fall of
  wickets, partnerships, yet-to-bat, XI/substitutions, award, result/revised target.
- Commentary: delivery timeline, over summaries, highlights, filtering, human
  commentary, labeled AI, English/Urdu, alignment after corrections.
- Analysis: worm/Manhattan, phases, dot/boundary rates, partnerships, spells,
  wagon wheel only when shot data exists; labeled win estimates later.
- Watch: existing embeds, score-only fallback, OBS/browser overlays, sponsors,
  fullscreen/PiP where supported, adjustable score/video delay, outage recovery.

Scoring status and video status are independent. Live matches do not require video.

## 8. Trustworthy scoring and offline operation

### Delivery contract

Separate batter runs, wides, no-ball penalty, byes, leg-byes, penalty runs,
legal-delivery status, dismissal/player/fielder, striker/non-striker, bowler,
client operation ID, server sequence, and match version. Derive totals from
deterministic rules. Store legal balls, not decimal overs.

### Command lifecycle

Authenticate → resolve tenant → verify assignment → validate version/rules →
deduplicate → serialize innings update → persist event/projections/outbox →
return authoritative state.

### Cricket behavior

Illegal deliveries, bat runs on no-balls, byes/leg-byes, either-batter run-outs,
free-hit dismissal rules, retired hurt, strike rotation, bowler changes/limits,
innings completion, chases/ties/no-result/abandonment, paired and repeated super
overs, audited corrections, and finalized scorecard locking.

Differentiate a general rain calculator from an authoritative competition-approved
DLS implementation.

### Offline-first requirements

Durable web/mobile queues, unique operation IDs, ordered replay, one sync worker,
per-operation acknowledgements, retry/rejection/conflict states, retention until
confirmed, visible unsynced count, scorer handover, and conflict resolution.

### Scorer journey

Assigned match → confirm teams/XI → toss → select batters/bowler → start → score
deliveries → contextual wicket/extras → innings break → chase → review → finalize.
Use thumb-friendly controls, outdoor contrast, and poor-network behavior.

## 9. Competition operations and premium features

- Persist and reload every wizard field; step validation; saved drafts; season cloning.
- Templates, round-robin/knockout/groups, fixture previews, venue/time conflicts.
- Team availability/rest constraints, rescheduling notifications, configurable points.
- Competition-aware NRR, standings, bracket advancement, registration/waitlists.
- Officials/scorer assignment, squad invitations, XI, availability, eligibility.
- Player claim/verification, ID cards, career/season form, comparisons, transfers.

Premium differentiation: automated fixtures, reliable offline scoring, broadcast
overlays, sponsor management, branded share cards/reports, fee dashboards,
advanced analytics, embeddable widgets/APIs, organization overview, and controlled
AI summaries/commentary.

Fantasy, auctions, ticketing, merchandise, and academy management follow stable
core operations rather than competing with launch-critical work.

## 10. Premium UI/UX and responsive requirements

Premium means clarity, consistency, speed, and confidence.

| Surface | Direction |
| --- | --- |
| Organizer | Calm, action-oriented, information-dense |
| Fan | Score-first, energetic, shareable |
| Scorer | High-contrast, large controls, minimal distraction |

Unify typography/tabular numerals, semantic colors, spacing/radii/elevation,
forms, table/mobile-list patterns, buttons, notices, loading/empty/error/offline/
permission states, charts, accessible summaries, and reduced motion.

Navigation: workspace switcher, role homepages, consistent mobile/desktop menus,
resource-name breadcrumbs, real tenant-scoped search, permission-aware quick
actions, contextual Go Live, saved filters, and clear scoring/analytics labels.

Dashboard order: live matches → missing scorers → registrations → payment
verification → upcoming fixtures → subscription/domain issues → secondary trends.

Validate at 360–430 px phones, 768–1024 px tablets, 1280–1440 px desktops, and wide
displays. No page overflow; 44–48 px primary touch targets; sticky scoring controls;
intentional mobile scorecard/table behavior; keyboard-open forms; Urdu RTL;
keyboard navigation/focus; WCAG 2.2 AA target.

## 11. Complete user journeys

- Organizer: sign up → league → brand → tournament → invite teams → registrations
  → fixtures → scorers → publish → run matches → close season.
- Manager: invitation → team → squad → register → fees → XI → availability → results.
- Fan: shared link → immediate score → scorecard/commentary → optional video → follow/alerts.
- White-label: plan → preview → domain → HTTPS/login verification → publish.
- Support: tenant → health/activity → audited support session → resolve → end.

Provide a persistent setup checklist and one clear next action for organizers.

## 12. Billing, operations, and success measures

### Commercial model

Free: small-league trial. Starter: grassroots operations. Pro: branding, analytics,
broadcasts, automation. Enterprise: domains, multi-league, integrations, support.

Implement a single effective-entitlement resolver, atomic quotas, usage meters,
contextual upgrades, annual billing, grace periods, predictable restrictions,
historical-scorecard retention, idempotent webhooks, approval history, refunds,
reconciliation, and currency/minor-unit normalization. Complete real provider
verification before online activation; preserve manual payments.

Meter AI, video delivery/storage, SMS/WhatsApp, external feeds, and native apps.

### Proposed acceptance targets (not current measurements)

| Area | Target |
| --- | --- |
| Public UX | p75 LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 |
| Score freshness | Accepted delivery visible within 2 s at p95 |
| Online command | Acknowledgement under 1 s at p95, excluding slow client network |
| Core availability | Initial monthly target 99.9% |
| Replay | No duplicate application or silent loss in retry/offline scenarios |
| Isolation | HTTP/socket/export/job/storage cross-tenant coverage |
| Accessibility | Critical journeys reviewed against WCAG 2.2 AA |

Production prerequisites: migration reconciliation/fresh setup, dependency builds,
private infrastructure, internal/read endpoint separation, multi-instance socket
fan-out, readiness/liveness, backups/restore drill, lag/queue/payment/certificate
alerts, authenticated two-tenant staging, load tests based on audience assumptions,
and Match Center/offline E2E with a running scoring service.

## 13. Delivery phases

Estimates assume 2–3 engineers, part-time product/design, and shared QA/DevOps.
Re-estimate after baseline verification; initial premium pilot planning range is
approximately 4–6 months with overlapping design work.

| Phase | Scope | Duration | Exit condition |
| --- | --- | --- | --- |
| 0 | Local/staging, auth, migrations, verified inventory | 1–2 weeks | Critical journeys reproduced |
| 1 | Rules, sequence/replay/concurrency, tenant context | 3–5 weeks | Scoring/isolation regression checks pass |
| 2 | Design system, navigation, dashboards, responsive forms | 2–4 weeks | Role journeys usable on phone/desktop |
| 3 | Wizard, fixtures, standings/NRR, approvals | 3–5 weeks | Tournament runs setup to final |
| 4 | Snapshot/live detail/reconnect/overlays | 3–5 weeks | Fan/scorer state consistent |
| 5 | Brand Studio, domains/assets, billing lifecycle | 3–5 weeks | Customer launches working branded portal |
| 6 | Load/recovery/accessibility/pilot | 2–3 weeks | Real competition meets launch criteria |
| 7 | Feeds, advanced AI, native white-label, APIs/modules | Ongoing | Per-feature reliability/adoption gate |

First core sprint: authenticated two-tenant baseline; context consistency; extras
and undo; operation IDs/sequences/concurrency; authenticated replay and rejection
retention; scorer assignment; full live snapshot; wizard persistence/validation;
complete create → schedule → score → live → finalize verification.

## 14. Implementation tracker and change log

Update this section with each delivery batch. Record actual verification and
remaining limitations, not planned results.

### 2026-10-10 — Batch 1: plan and tournament foundation

#### Completed

- [x] Save this dated master plan and link it from the README.
- [x] **TOUR-01:** validate the current wizard step instead of blocking progression
  on future required fields; retain full validation on final submission.
- [x] Prevent backward navigation during tournament submission.
- [x] **TOUR-03:** resolve the persisted user UUID for `tournaments.created_by`;
  reject incomplete account provisioning and empty insert results.
- [x] **TENANT-01 (tournament scope):** resolve the active tenant once, authorize
  that exact tenant, and use it for create/read/list/update/delete and registration
  operations. Platform-wide context unification remains open.
- [x] Correct printable scorecard team lookup from nonexistent `battingTeamId`
  to the schema's `teamId`.
- [x] Use the pure `@mtk/database/lib/plan-guard` subpath in the browser-side
  plan-error helper, avoiding the server/database barrel import.
- [x] Add 18 tournament authorization/author regression tests and four wizard
  progression/final-validation tests using the actual form resolver.

#### Verification recorded

- **PASS:** `corepack pnpm --filter @mtk/web test` — 10 files, **89 tests**,
  including **22 new regression tests**. Re-run passed after the client-import fix.
- **PASS:** web type-check after correcting the scorecard field reference.
- **PASS:** web lint — zero errors; six existing image-optimization warnings.
- **Build status:** earlier production-build attempts exposed the browser/server
  import problem. No completed successful production build is recorded for this
  batch. At the user's request, further builds were stopped; the delivery gate
  for this batch is tests and review, not a build.
- **Not verified:** browser/E2E, real authenticated tenant journeys, remote schema,
  and deployed services. Unit tests mock external auth/database calls.
- **Remote delivery:** pushed to `main` as `73c7ac0`; remote SHA was verified and
  the working tree was clean at the end of the batch.

#### Next work

- [ ] Finish remaining scoring P0 integration work: authenticated mobile replay,
  mixed-extras rules, legacy-score review, and real concurrency/network verification.
- [ ] Complete **TENANT-01** across remaining product operations.
- [x] Complete **TOUR-02** configuration persistence and round-trip loading (Batch 4;
  browser/PostgreSQL staging acceptance remains open).
- [ ] Verify live snapshot initialization and scorer assignments.
- [ ] Establish authenticated two-tenant staging and browser/E2E verification.
- [ ] Continue the responsive design, white-label, billing, and launch phases.
- [x] Implement responsive role-aware dashboard workflows and authorized active-
  tenant dashboard/shell reads (Batch 6; browser/device acceptance remains open).

Commit/push results must be reported separately if remote delivery is blocked.

### 2026-10-10 — Batch 2: delivery accounting, exact undo, and replay retention

#### Completed implementation

- [x] **SCORE-01 (web/service supported modes):** add a pure shared delivery-run
  contract. Convert UI total runs into disjoint batter/extras components; include
  byes/leg-byes in total extras; report wide/no-ball runs in extras breakdowns;
  recognize bat boundaries on no-balls.
- [x] **SCORE-02:** remove coordinate-based deduplication. Assign delivery sequences
  while holding a tenant-filtered match row lock, allowing repeated wides/no-balls
  and the next legal delivery at the same display position.
- [x] **SCORE-03:** require stable operation IDs on new delivery commands; persist
  fingerprints/IDs in immutable v2 events; acknowledge identical retries without
  another write/publication. Reject changed commands and replay of undone balls.
- [x] **SCORE-06 (v2 events):** persist exact run deltas and ball/event associations;
  reverse those deltas on undo; reconcile scorecard projections in the transaction.
  Reject corrupt accounting and ambiguous legacy extras instead of guessing.
- [x] Serialize delivery, undo, and innings-completion writes with the same match
  lock ordering. Validate command input, lifecycle, and expected legal-ball position.
- [x] Invalidate Redis state after transaction commit, not inside the transaction.
- [x] **SCORE-05:** mobile clears only successful matching operation acknowledgements;
  generic HTTP 400 and other failures retain deliveries and stop ordered replay.
- [x] Remove web retry-limit deletion; scope replay to the current match, prevent
  overlapping sync workers, retain failures, and provide pending-count/retry controls.
- [x] Queue web operations before the first request, preserve their ID across retries,
  and map confirmed database IDs back into local score/history snapshots.
- [x] Make local extras/over notation match server accounting (`6` legal balls = `1.0`).
- [x] Wait for server-confirmed undo and reload authoritative innings accounting;
  do not depend on local undo history after a reload. Disable local-only redo.
- [x] Resolve scoring reads/writes from the active tenant rather than a different
  primary membership. Platform-wide context consolidation is still pending.
- [x] Add regression coverage for run splits, exact reversal, repeated illegal
  deliveries, operation-ID conflicts, replay-after-undo, corrupted deltas,
  acknowledgement retention, local accounting, and reload-safe undo.

#### Test-only verification

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/database test` | PASS — 56 tests / 3 files |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand` | PASS — 42 tests / 4 suites |
| `corepack pnpm --filter @mtk/web test` | PASS — 109 tests / 13 files |

**207 tests pass across the affected workspaces, including 52 new tests in this
batch.** No build, lint, or standalone type-check command was run in this batch,
following the user's test-only instruction. Jest exercises the scoring service
and workspace source; Vitest exercises shared accounting, actions, store, and
replay helpers. External auth/database/Redis/Kafka are mocked. Real PostgreSQL
concurrency/trigger behavior, browser rendering, IndexedDB interruption, and
authenticated device journeys still require staging/E2E verification.

#### Contract and rollout notes

- Uses the existing event JSON and `ball_sequence`/`client_op_id` columns; no
  migration or remote-database change was performed. Migration 023 and the
  existing scoring-event/projection tables must already be present.
- Update the web app and canonical scoring service together. New writes require
  a nonempty operation ID. Deployments rebuild workspace packages through their
  normal pipeline; this session only ran tests against source.
- New ball rows hold total delivery runs; v2 events retain the batter/extras
  breakdown and innings/projection extras categories hold run totals. Historical
  rows/events and old category counts are not retroactively changed.
- Automatic undo of legacy extras is deliberately blocked because old rows do
  not retain an unambiguous delta; a reviewed correction workflow is still needed.
- Mixed no-ball/byes/leg-byes, penalties, free-hit/dismissal rules, and comprehensive
  strike/playing-XI rules are follow-up cricket-engine work.
- Mobile acknowledgement retention is fixed, but **SCORE-04 remains open**:
  authenticated mobile API/BFF integration and mobile run-contract normalization
  must be completed before claiming working end-to-end mobile synchronization.
- Durable event outbox, multi-tab/device coordination, assigned-scorer enforcement,
  and complete live-state snapshot/broadcast remain separate follow-ups.

Batch 2 was committed and pushed to `main` as `5f50ab1`; the remote SHA and clean
working tree were verified after delivery.

#### Next implementation batch

- [ ] Complete authenticated mobile scoring/replay and shared run normalization.
- [x] Enforce scorer-to-match assignment on the authenticated web scoring path (Batch 3).
- [x] Validate roster-level player/team eligibility and carry the verified web
  actor into service transactions (Batch 5; full XI rules/staging remain open).
- [x] Initialize and reconcile full innings snapshots on fresh visits/reconnect (Batch 3).
- [ ] Add real two-tenant PostgreSQL and network-interruption E2E scenarios.
- [ ] Implement mixed extras, complete wicket rules, and audited legacy corrections.

### 2026-10-12 — Batch 3: match-scoped scoring access and live initialization

#### Completed implementation

- [x] Confirmed a clean working tree and synchronized with `origin/main` using
  `git pull --ff-only origin main` before making changes (baseline `5f50ab1`).
- [x] Enforce the exact active tenant's permissions and match ownership before
  record, undo, innings creation, and innings completion. Scorers must match
  `matches.scorerId` using the provisioned database UUID, not their Clerk ID.
  Authorized league owners/tenant administrators retain oversight access.
- [x] Scope scorer assignment and candidate lists to the active tenant. Junction
  membership roles take precedence; legacy membership is used only when that
  tenant has no junction row. Validate assignment IDs and support unassignment.
- [x] Return scoring capability to the scoring page, disable unauthorized mutation
  controls, and show an explanatory read-only notice. Voice/quick scoring checks
  player selection and routes wickets through the dismissal selector.
- [x] **LIVE-01:** share a validated v2 snapshot contract with innings identities,
  teams, lifecycle, total/legal balls, run rate, and all extras categories.
  Include second innings and super over, not just numeric score updates.
- [x] Read match/innings snapshots in a read-only repeatable-read transaction and
  scope innings to the owning match tenant. Reject incomplete/cross-match cache
  payloads; reduce the polling cache TTL from one hour to five seconds.
- [x] Bypass polling cache for joins and broadcasts. Broadcast a complete fresh
  snapshot after every successful HTTP scoring mutation, including undo and
  lifecycle transitions. A failed broadcast does not report a committed write
  as rejected. Reject malformed room IDs and leave a failed join's room.
- [x] Initialize null client innings and keep status/extras on reconnect. Ignore
  malformed/cross-match traffic and older per-innings timestamps. A newer
  authoritative undo may reduce totals; never force a score to be monotonic.
- [x] Preserve unconfirmed local deliveries while a snapshot arrives and request
  a fresh snapshot after acknowledgement, rather than applying older totals.
- [x] Extract the connection lifecycle for direct event tests. Rejoin on reconnect,
  remove listeners on cleanup, and reference-count shared match subscriptions.
  A dropped broadcast socket alone no longer means HTTP scoring is offline.
- [x] Clear stale innings/history when changing matches. Hydrate scoring reloads
  into the existing chase/super over, preserve operation IDs and delivery order,
  and use the toss/innings batting team rather than assuming Team A bats first.
- [x] Add regression tests for authorization, assignment scope, snapshot decoding,
  post-commit broadcasts, reconnect/cleanup, offline preservation, and hydration.

#### Test-only verification

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 155 tests / 18 files |
| `corepack pnpm --filter @mtk/database test` | PASS — 56 tests / 3 files |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 78 tests / 6 suites |

**289 tests pass; the passing test inventory grew by 82 from Batch 2.** No builds,
lint, standalone type checks, migrations, or remote-database writes were run.
`git diff --check` passes. Tests use real accounting/store/contract code with
mocked database/auth/network infrastructure. Browser rendering, real PostgreSQL
isolation, deployed Socket.IO delivery, and authenticated devices are not yet
verified. Expected fault-path tests log simulated database/cache errors.

#### Rollout and remaining work

- Deploy web, scoring service, and workspace packages together for the v2
  snapshot contract. Old numeric-only cache entries are deliberately discarded.
  No schema migration is required for this batch.
- Assignment checks currently live in the authenticated web boundary. Service
  mutations still require their existing internal token and tenant guard;
  verified actor propagation and transactional assignment-revocation checks
  remain open before adding other clients.
- Timestamp-based stale-snapshot rejection is not a durable event revision or
  cross-instance delivery guarantee. Transactional outbox/revision sequencing,
  multi-instance room adapters, and missed-event recovery remain open.
- Snapshots initialize aggregate innings state; full remote ball history/player
  statistics, multi-tab coordination, and correction timelines remain follow-ups.
- **All phases are not complete.** Mobile authentication/run normalization,
  player eligibility, full cricket rules, tournament configuration persistence,
  platform-wide tenant consistency, white-label/billing phases, and staging/E2E
  acceptance criteria remain tracked work, not implicitly marked done.

#### Next implementation batch

- [ ] Authenticate mobile replay through a user-facing API/BFF without exposing
  internal service credentials; normalize mobile delivery runs.
- [x] Propagate verified web actor identity and enforce assignment/basic roster
  eligibility in canonical service transactions (Batch 5).
- [x] Persist the remaining tournament wizard configuration (TOUR-02, Batch 4).
- [ ] Verify real two-tenant authorization, PostgreSQL isolation, Socket.IO
  reconnects, and interrupted queue writes in staging/E2E.
- [ ] Continue the remaining phases against their original acceptance criteria.

Remote delivery must be verified after the reviewed commit and normal push;
record/report a blocker instead of assuming a push succeeded.

### 2026-10-12 — Batch 4: tournament configuration persistence and round-trip loading

#### Completed implementation

- [x] Synchronized with `origin/main` using `git pull --ff-only origin main`
  before implementation; baseline `dd09b57` was clean and already up to date.
- [x] **TOUR-02:** persist match type, overs, location, bracket slot order, and
  branding in a validated version-1 `rules.wizard` envelope. Use existing columns;
  no migration is needed. Standard T20/ODI overs are fixed; custom/tape-ball overs
  must be explicitly selected.
- [x] Store registration fees in the existing decimal `entryFee` column and prize
  amounts in a versioned decimal-string `prizePool` envelope. Validate numeric
  bounds/precision instead of silently dropping collected amounts.
- [x] Validate calendar dates, date ordering, integer overs/capacity, complete
  unique bracket slot permutations, bounded raster logo data/HTTPS URLs, and
  six-digit brand colors at the server boundary.
- [x] Round-trip settings through the tenant-authorized copy picker and detail
  summary. Copy reusable preferences, not names, dates, identities, or registration
  state. Lightweight picker responses omit logos/rules; load one selected record.
- [x] Update existing tournaments in a short tenant-scoped row-lock transaction.
  Validate partial dates against the locked row, resize seed slots when capacity
  changes, and retain sibling rules/branding. Ordinary edits do not overwrite
  existing rules or legacy prize distributions unless an amount is explicitly set.
- [x] Preserve stable bracket slot labels during reordering/capacity changes and
  clarify that slots are not registered team UUIDs or generated fixtures.
- [x] Correct single-day/inclusive schedule estimates and balanced hybrid groups;
  label estimates explicitly in English/Urdu rather than claiming fixture generation.
- [x] Prevent overlapping local create submissions; wait for logo reading, freeze
  fields during save, route invalid submissions to the relevant step, and link
  successful creation to the returned tournament ID.
- [x] Add explicit tenant predicates to tournament-detail match, team-name, and
  innings reads. This is localized hardening, not platform-wide tenant completion.
- [x] Add regression tests for persistence contracts, legacy-template fallback,
  unsafe branding, exact monetary storage, invalid dates/slots, partial edits,
  locked read-before-write ordering, and tenant predicates on both read/write.

#### Test-only verification

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 201 tests / 19 files |
| `corepack pnpm --filter @mtk/database test` | PASS — 103 tests / 5 files |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 78 tests / 6 suites |

**382 tests pass; 93 additional passing regressions compared with Batch 3.**
No build, lint, standalone type check, migration, or remote database write was
performed. Vitest exercises source validation/mapping/actions and repository
query construction with mocked auth/database infrastructure; Jest retains the
canonical scoring regressions. Expected scoring fault-path logs are simulated.
`git diff --check` passes.

#### Rollout and remaining acceptance

- Deploy the web app with rebuilt workspace packages through the normal pipeline;
  the new browser-safe configuration module and locked repository method must be
  available together. This session intentionally did not run a build.
- Legacy/unknown JSON settings are not rewritten. Monetary amounts have no
  configured currency/payment collection yet; do not describe them as paid billing.
- Logos are bounded inline raster data (128 KB) or HTTPS references. Managed
  storage, image-content inspection/processing, and tenant-wide branding/domain
  enforcement remain white-label follow-ups; this saves tournament preferences.
- Schedule estimates and seed order do not generate or bind real fixtures.
  Advanced settings editing, registered-team assignment, and fixture generation
  using saved preferences remain separate work.
- Local duplicate-click prevention is not durable creation idempotency. Ambiguous
  network responses and concurrent creators still need a persisted request-key
  workflow; do not blindly retry a create after a lost response.
- Browser reload/copy/upload journeys and real PostgreSQL locking/rollback need
  authenticated staging verification. No deployed service/database was modified.
- [ ] Complete the Clerk/Supabase mobile identity bridge, authenticated replay,
  and shared mobile run normalization without exposing internal credentials.
- [x] Propagate web actor identity and enforce revoked assignments/basic roster
  eligibility inside canonical scoring transactions (Batch 5).
- [ ] Continue full cricket rules, corrections, platform tenant consistency,
  white-label/billing phases, and the original staging/E2E acceptance criteria.

### 2026-10-12 — Batch 5: canonical scoring actor and roster authorization

#### Completed implementation

- [x] Confirmed a clean tree and synchronized with `origin/main` using
  `git pull --ff-only origin main`; baseline `0080b88` was already up to date.
- [x] Resolve `users.id` from the authenticated Clerk session on the web server;
  reject unavailable/inactive accounts, including oversight roles. Propagate only
  that database UUID in `x-scoring-actor-id`, never an actor/role from client input.
- [x] Require ordered service-token, tenant, and actor guards on every canonical
  mutation route. Reject missing/duplicate identity headers and accept UUIDv7
  tenants generated by the schema. Remove the tokenless development write bypass;
  public scoreboard reads and receive-only sockets remain unchanged.
- [x] Recheck active accounts, exact-tenant junction roles, and scorer assignment
  inside record/undo/create-innings/complete-innings/complete-match transactions.
  Apply these checks before operation-ID replay as well as before new writes.
  League-owner/super-admin oversight requires current authorized tenant membership.
- [x] Explicitly use read-committed mutation transactions and the same match-first
  lock ordering. Lock actor rows and existing role rows before resolving role
  precedence. Missing junction rows retain migration-era legacy membership support;
  query errors and lower-privilege junction roles never become privileged fallback.
- [x] Move innings creation and match completion under the canonical match lock;
  invalidate state only after commit. Identical completion retries preserve result
  and timestamps; changed completed results require an audited correction.
- [x] Validate completion IDs/details, reject third-team winners, and block new
  completion transitions from abandoned/cancelled/no-result matches. Re-completing
  an already-completed innings performs no write.
- [x] Require two distinct, active, tenant-owned match teams for new innings and
  deliveries. Check batter/bowler/dismissed-player/fielder identity, active status,
  tenant, and batting/fielding side under stable ordered team/player share locks.
  Non-striker run-outs remain supported; other dismissals must name the striker.
- [x] Check roster eligibility only for new deliveries, not immutable acknowledgements
  or undo. Current actor authorization still applies to both. This permits correction
  of historical deliveries without pretending transferred/suspended players are
  eligible for a new ball.
- [x] Persist actor/tenant UUID attribution in new delivery/undo event metadata;
  leave historical events and replay fingerprints unchanged. Filter the web player
  picker to active, available players from the two tenant-scoped teams.
- [x] Add transport, guard-wiring, role precedence, account deactivation, revoked
  assignment/replay, roster/side, event-attribution, and lifecycle regressions.
  Update `.env.example` with the required server-only credential/actor contract.

#### Test-only verification

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 231 tests / 20 files |
| `corepack pnpm --filter @mtk/database test` | PASS — 103 tests / 5 files |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 155 tests / 8 suites |

**489 tests pass; 107 additional passing regressions compared with Batch 4.**
No builds, lint, standalone type checks, migrations, or remote-database writes ran.
Tests exercise real source validation, guards, SQL construction, and service/action
logic with mocked auth, network, database, Redis, and Kafka. The new helper suite's
database client is explicitly mocked; it does not connect to PostgreSQL. Expected
database-unavailable logs come from existing fault-path tests. `git diff --check`
passes. Context7 documentation lookup was attempted but DNS was unavailable;
existing repository transaction patterns and loaded Postgres locking guidance were used.

#### Rollout, trust boundary, and remaining acceptance

- Deploy web, scoring service, and workspace packages together. Old proxies without
  the actor header now fail closed. Set the same `SCORING_SERVICE_TOKEN` on both
  server processes even for local writes; never expose it in public browser/mobile
  environment variables. No new schema migration is introduced by this batch.
- The actor is an assertion from an authenticated trusted server proxy, not a
  service-verified Clerk/Supabase bearer token. A holder of the internal secret can
  still declare an actor/tenant. Network isolation, TLS, and secret hygiene remain
  mandatory; this does not authorize direct browser/mobile calls to the service.
- Existing `user_tenant_roles`, its unique user/tenant key, and foreign keys must
  be deployed. A missing/unavailable table intentionally blocks mutations instead
  of silently using legacy roles. Historical migration drift remains unverified.
- Legacy fallback is permitted only when the exact-tenant role row is absent.
  Deleting a junction row alone is not full membership revocation if legacy
  `users.tenantIds` still grants access: revoke both sources or retain a denying
  junction role until the planned membership consolidation removes fallback.
- Actor row locks serialize concurrent scoring by the same account across matches;
  ordered team/player locks stabilize roster checks. Verify actual PostgreSQL
  contention, concurrent assignment/role changes, FK insertion, rollback, and
  lock ordering against other administrative writers in staging before rollout.
- [ ] Verify authenticated browser reload/revocation and two-tenant PostgreSQL
  scenarios; confirm no rejected command emits a deployed Socket.IO/Kafka update.
- [ ] Complete mobile user-facing authentication/BFF identity mapping and shared
  run normalization. Failed/revoked operations must remain queued for authorized
  reconciliation, not be silently discarded or given internal credentials.
- [ ] Implement immutable playing-XI/substitution eligibility, complete dismissal/
  strike/free-hit/mixed-extras rules, and competition-specific eligibility policies.
- [ ] Add full lifecycle/correction auditing and transactional outbox recovery.
  Actor metadata on delivery/undo events does not finish those larger features.
- [ ] Consolidate platform-wide tenant/role authorization and continue white-label,
  billing, premium product, and all original staging/E2E acceptance criteria.

### 2026-10-12 — Batch 6: role-aware dashboard and active workspace reads

#### Completed implementation

- [x] Started from clean `e9f4951` and synchronized with `origin/main` using
  `git pull --ff-only origin main` before implementation (already up to date).
- [x] Advance the dashboard portion of Phase 2 with a responsive league workspace
  header, permission-aware quick actions, first-record setup checklist for
  organizers, and assigned-match scoring shortcuts for scorers. Other roles get
  browsing actions rather than unsupported creation/scoring controls.
- [x] Resolve the request tenant before primary membership, then independently
  verify an active provisioned account, exact-tenant role, and active tenant before
  dashboard business reads. Junction roles override legacy roles; missing role
  rows alone permit legacy membership fallback. Lookup failures fail closed instead
  of upgrading privilege or silently switching to a primary workspace.
- [x] Use that same authorization policy in dashboard navigation and pass the
  authorized active tenant to the trial notice. Never display another membership's
  subscription or show billing notices to roles without settings-management access.
- [x] Extract dashboard data/model/server sections for focused tests. Keep every
  count, fixture, team-name, innings, and task query tenant-filtered, with explicit
  columns, ordered five-match limits, and two batched related-resource lookups
  instead of N+1 queries. Prioritize live assignments; put undated fixtures last.
- [x] Match scores to actual batting team IDs, not fixed Team A/first-innings order.
  Preserve legal-ball over notation, exclude unrelated innings, label super-over
  summaries, and avoid invented chase targets. Fixture times explicitly use UTC;
  recent results show the record update time rather than implying a scheduled time
  is the actual completion timestamp.
- [x] Show active-team/player counts with matching query predicates. Remove the
  old misleading growth percentages and the ad-hoc fixed-points standings widget
  from the home dashboard; replace the latter with organizer assignment/registration
  tasks. Competition-aware standings/NRR remain separate planned work, not fabricated
  by this dashboard. Existing tournament pages are unchanged.
- [x] Separate true empty/zero states from unavailable data. Stream independently
  loading sections with accessible status text; outages show a real full-page
  refresh link and never mark setup tasks incomplete from failed counts.
- [x] Use responsive grids, wrapping labels, visible focus rings, decorative icon
  semantics, 44px action targets, and reduced-motion-aware skeletons. This is
  implementation and server-rendered verification, not visual/browser certification.
- [x] Add 126 regressions across authorization, SQL predicates/batching/limits,
  team-order score summaries, role journeys, server-rendered HTML, route/layout
  integration, and tenant-scoped trial-notice behavior.

#### Test-only verification

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 357 tests / 26 files |
| `corepack pnpm --filter @mtk/database test` | PASS — 103 tests / 5 files |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 155 tests / 8 suites |

**615 tests pass; 126 additional regressions compared with Batch 5.** Auth,
database, and subscription/network boundaries are mocked. Rendering tests use
React's server renderer; they verify actual escaped HTML, labels, links, and class
contracts, not a real browser's layout/focus/animation behavior. Scoring fault-path
logs are expected test simulations. Current Next.js streaming and Drizzle aggregate/
bounded-query documentation was consulted through Context7. No build, lint,
standalone type-check, migration, remote-database write, or new dependency install
was performed. `git diff --check` passes.

#### Scope and remaining acceptance

- This is a focused Phase 2 dashboard batch, **not completion of Phase 2**. The
  existing RLS/database schema (including `user_tenant_roles`) must be deployed;
  missing role tables intentionally result in unavailable access.
- Dashboard scores are explicitly page-load summaries, not live Socket.IO widgets.
  Open the existing match center/scoring page for live updates. Multi-innings test
  cricket, mixed extras, XI readiness, authoritative standings/NRR, and revised
  chase targets are not supplied by the new summaries/checklist.
- Setup checks track league-level records only. Two active teams plus a player
  do not establish tournament registration, fixture eligibility, or approved XI.
- Authorization is current at render time, not a transaction locking every dashboard
  read against concurrent revocation. Canonical scoring still performs Batch 5's
  transactional recheck; a dashboard shortcut does not grant mutation authority.
- Dashboard shell role filtering is not a replacement for each page/action's
  resource authorization. Some linked legacy product pages/actions still resolve
  primary membership rather than request tenant. Full downstream tenant-context
  consolidation and two-membership navigation acceptance remain **TENANT-01** work;
  this batch does not claim those destinations are repaired.
- [ ] Verify mobile/desktop visual layout, keyboard and screen-reader journeys,
  reduced motion, refresh retries, streamed loading, and authenticated host/primary
  tenant mismatch/revocation scenarios in a real browser and PostgreSQL staging.
- [ ] Continue role-specific manager/coach/player journeys, localized display,
  user timezone selection, durable onboarding drafts, and broader responsive forms.
- [ ] Finish mobile authenticated API/BFF identity mapping and normalized replay,
  complete cricket rules/audited corrections, and remaining white-label/billing and
  original staging/E2E rollout requirements. No client receives internal credentials.

### 2026-10-12 — Batch 7: league-only member administration and enforcement

#### Completed source implementation

- Synchronized cleanly from `main` at `9ac8702` and began the new
  [12 October roadmap](docs/SAAS_MASTER_PLAN_2026-10-12.md), focusing on
  **IAM-01** and partial **ISO-04/05/06**, **IAM-02/04/05/07**, **SCORE-09**.
- Added local `user_tenant_roles.status` (active/suspended), a database-maintained
  concurrency version, constraints and a CLI-created migration. Backfill adds
  only missing legitimate memberships; explicit existing rows are preserved.
- Replaced league management of global `users.role`/`isActive` with tenant-bound,
  version-checked membership mutations. Actor/account/league/membership authority
  is rechecked under ordered locks; audit before/after shares the transaction.
  Protect all owner/platform/self changes and reject privileged role grants.
- Added owner-only Settings -> Members and access with confirmed role/status
  changes, suspension consequences, conflict/error UI, protected rows and separate
  global account status. Existing `/dashboard/users` remains available. Scope,
  expiry, full detail, pagination and assignment integration remain unfinished.
- Require active explicit membership in web RBAC/dashboard, canonical scoring and
  exported database helpers. Remove legacy array/global role authorization in
  these paths. Make shared league resolution host-first; known inactive hosts
  never silently choose a primary league. No private children are displayed on
  denied/unavailable dashboard context; pages/actions still need independent checks.
- Lock/check active league and member status on all canonical mutation types.
  Invite acceptance cannot override account/member suspension and rechecks expiry
  on its atomic claim. Basic dispatch no longer logs plaintext links or claims
  provider acceptance proves delivery. Complete provider-verified OTP, delivery
  tracking, fresh inviter authority and scoped invitation grants are NOT built.
- Protect private invitation/scorer contact lists with management permissions;
  scope personal notification rows to the active league as well.
- Added local RLS helper/grant hardening and a default-off VPS deployment gate
  (`LEAGUE_MEMBERSHIP_CONTROLS_READY`). No remote migration or deployment ran.

#### Verification

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | **31 files, 464 tests passed** |
| `corepack pnpm --filter @mtk/database test` | **7 files, 123 tests passed** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | **8 suites, 166 tests passed** |
| Combined suites | **753 tests passed; net +138 over Batch 6** |

Tests cover source/mocked boundaries, SQL predicates/migration contracts and
server-rendered/stubbed UI. They do not execute the migration or prove PostgreSQL
locking, real rollback/RLS, actual provider delivery/OTP, browser interaction,
mobile identity or deployed live fan-out. Negative-path Nest log messages are
expected fixtures. Source aliases avoid testing stale generated database/UI artifacts.

No build, lint, standalone type-check or repository dependency change ran. The
Supabase CLI was obtained via `npx` to create the local migration; Docker is not
installed, so local Supabase execution is blocked. Context7 was unreachable;
official Drizzle transaction docs and the Supabase changelog were read directly.

#### Release gates and remaining work

- **Local migration is unapplied:**
  `supabase/migrations/20261012100136_league_membership_controls.sql`.
  Follow [migration history and Batch 7 rollout gates](supabase/MIGRATION_STATUS.md).
  Do not automatically deploy this code against an old database.
- Database grant inventory/function ownership and the legacy UUID/email RLS
  identity bridge remain unverified; this is NOT a Clerk string-subject/Data API
  integration. Review elevated/owner memberships before retiring old privileges.
- Deploy matching workspace artifacts, web and scoring service together after
  real-DB/staging acceptance. The new GitHub VPS gate does not control external
  hosting Git integrations. Older binaries ignore league suspension; a rollback
  to them can reopen access and must not be used as a safe revocation strategy.
- Two-party ownership transfer, full membership lifecycle/expiry, scoped multiple
  roles, private publication/sockets, all CRUD/exports/storage/jobs isolation,
  notification UX, payment/billing and mobile/scoring recovery remain open.
- Generic CRUD permission checks occur before writes; this batch establishes
  locked revocation ordering for member commands and canonical scoring, not every
  existing transaction or dashboard read. Real concurrency proof remains open.

### 2026-10-12 — Batch 8: provider-verified invitation redemption

Delivered as `a49ea77` (recorded retroactively here). Invitation acceptance now
requires a Clerk session whose verified email matches the invited address, and
rechecks issuer authority, league, recipient account, the exact invitation row and
the team resource under ordered locks in one transaction. Acceptance cannot
promote/demote/reactivate memberships or touch global `users`/legacy arrays.
Issuance/revocation moved to tenant-asserted owner commands with atomic audit rows;
delivery states are honest (`unconfigured`/`provider_accepted`/`failed`/`unknown`).
Not verified: real provider delivery/webhooks, provider OTP code journeys,
PostgreSQL locking/rollback and browser interaction.

### 2026-10-13 — Batch 9: membership removal, invitation resend, persisted dispatch state

#### Completed implementation

- [x] **IAM-05 removal:** `removeMember` removes one league membership only, using
  the same user → league → membership lock order, a version check, an atomic
  before/after audit row and the existing owner/self/platform protection. Removal is
  refused while the member still manages a team or is an assigned scorer, so a team
  or live match cannot be silently orphaned. The global account and historical
  match/statistics records are untouched.
- [x] **IAM-05 resend:** `resendInvite` re-dispatches a pending invitation with a
  rotated token (invalidating the old link), rechecking owner authority, tenant,
  status and expiry under lock, enforcing a 60-second cooldown and auditing the
  action. The original expiry is preserved.
- [x] **IAM-04 persistence:** added `user_invites.email_state`,
  `email_attempted_at` and `email_attempt_count`; the last dispatch outcome is
  persisted after the invitation commits (best-effort, never rolls back a saved
  invite) and each attempt uses a distinct provider idempotency key so a resend is
  not deduplicated.
- [x] UI: the members table gains a confirmed Remove action; the invite manager
  gains a Resend action and a truthful delivery-state column.
- [x] Additive idempotent local migration
  `supabase/migrations/20261013090000_invitation_delivery_state.sql`; `packages/database`
  rebuilt after the schema edit.
- [x] Regression coverage for removal authorization/version/assignment-guard/lost-delete
  paths and for resend cooldown/rotation/authority/persistence/idempotency-key.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web exec vitest run` | PASS — 33 files, **610 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 7 files, **123 tests** |
| `corepack pnpm --filter @mtk/database build` | PASS |
| `corepack pnpm --filter @mtk/web type-check` | **Pre-existing failures only** — 3 untouched files (`__tests__/dashboard-data.test.ts`, `__tests__/member-view.test.tsx`, `app/matches/[matchId]/scoring/page.tsx`); they reproduce at the batch baseline |

No build, lint, migration execution, remote-database write or deployment ran. The
tests exercise source/actions with mocked auth/database/network; they do not prove
PostgreSQL locking/rollback, provider delivery, or authenticated browser journeys.

#### Next work

- [ ] Complete the membership rollout and real-DB acceptance; remaining
  `ISO-04/05/06`.
- [ ] `IAM-07` two-party ownership transfer, `IAM-08` privileged MFA;
  provider-managed OTP login; assigning a not-yet-accepted membership.
- [ ] Durable email queue with bounce/webhook delivery tracking and retries.
- [ ] Scorer handover/fencing between primary and backup (Phase 5 revisions).
- [ ] Continue the remaining phases against their original acceptance criteria.

### 2026-10-13 — Batch 10: primary/backup scorer assignment

#### Completed implementation

- [x] **Schema:** `matches.backup_scorer_id` (nullable FK to `users`, `ON DELETE
  SET NULL`) with a distinct-slot check constraint and index, in additive,
  idempotent `supabase/migrations/20261013120000_match_backup_scorer.sql` (local,
  unapplied). `packages/database` rebuilt.
- [x] **`assignScorer`** now takes a slot (`"primary" | "backup"`) and a nullable
  scorer id: loads the tenant-scoped match, validates the target as an active
  scorer-role member of the league, refuses the same person in both slots, and
  updates only the chosen column (`null` clears it).
- [x] **`canScoreMatch`** authorizes the primary **or** backup assigned scorer;
  role and active-account checks unchanged.
- [x] UI: the match scorer panel offers separate Primary and Backup selects with
  an Unassigned option; the match page passes `currentBackupScorerId`.
- [x] Regression coverage for slot selection, tenant scoping, same-person
  rejection, unknown-slot rejection, clearing, and backup authorization.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web exec vitest run` | PASS — 33 files, **618 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 7 files, **123 tests** |
| `corepack pnpm --filter @mtk/database build` | PASS |
| `corepack pnpm --filter @mtk/web type-check` | **Pre-existing failures only** — same 11 error lines in 3 untouched files; none added by this batch |

No build, lint run, migration execution, remote-database write or deployment.
Tests exercise source/actions with mocked auth/database; they do not prove
PostgreSQL constraint enforcement, concurrency or authenticated browser journeys.

#### Deliberately open

- Assigning a scorer whose membership is still pending acceptance.
- Handover/fencing between the two scorers: without an epoch, both assigned
  scorers can write concurrently (Phase 5 revisions/fencing).

### 2026-10-13 — Batch 11: verified invitation delivery webhook

#### Completed implementation

- [x] **Webhook:** `POST /api/webhooks/resend` fails closed (503) when
  `RESEND_WEBHOOK_SECRET` is unset, requires the Svix headers, verifies the
  signature before parsing the body, and never logs the payload.
- [x] **Correlation:** outgoing invitation emails carry an `invite_id` tag so an
  event is matched to its invitation without trusting an email address.
- [x] **Mapping/apply library** (`lib/invitation-delivery.ts`): `email.delivered`,
  `email.bounced`, `email.complained` map to persisted states; all other events
  are ignored; unmapped/missing/unknown cases return `applied: false` instead of
  throwing (idempotent under provider retries).
- [x] **Schema:** `InvitationEmailState` gains `delivered`/`bounced`/`complained`;
  the check constraint is widened in additive, idempotent
  `supabase/migrations/20261013150000_invitation_delivery_events.sql` (local,
  unapplied); `packages/database` rebuilt.
- [x] UI: the invite delivery column renders Delivered / Bounced / Marked-as-spam.
- [x] `.env.example` documents `RESEND_WEBHOOK_SECRET`.
- [x] Regression coverage: event mapping, tag extraction, apply/no-op paths, and
  route fail-closed / bad-signature / happy / 500 paths.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web exec vitest run` | PASS — 35 files, **638 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 7 files, **123 tests** |
| `corepack pnpm --filter @mtk/database build` | PASS |
| `corepack pnpm --filter @mtk/web type-check` | **Pre-existing failures only** — same 11 error lines in 3 untouched files; none added |

No build, lint run, migration execution, remote-database write or deployment.
Tests mock auth/database/network; they do not prove real provider webhook
delivery, signature interop or PostgreSQL constraint enforcement.

#### Deliberately open

- Durable send queue and automatic retries (a failed send still needs a manual
  resend); real provider webhook delivery; real DB constraint enforcement.

### 2026-10-13 — Batch 12: two-party league ownership transfer (IAM-07)

#### Completed implementation

- [x] **Schema:** new `ownership_transfers` table with `tenant_id`,
  `from_user_id`, `to_user_id`, `demoted_role`, `status`
  (`pending`/`accepted`/`cancelled`/`expired`), a concurrency `version`,
  `expires_at`, `resolved_at`/`resolved_by` and audit timestamps; declared checks
  for the status set, `from_user_id <> to_user_id`, `version >= 0` and
  `demoted_role NOT IN ('league_owner','super_admin')`.
- [x] **Migration:** additive, idempotent
  `supabase/migrations/20261013180000_ownership_transfers.sql` (local, unapplied)
  with a partial unique index (`WHERE status = 'pending'`) capping open requests
  at one per league, a recipient lookup index, forced RLS and `service_role`-only
  grants; `packages/database` rebuilt.
- [x] **Actions** (`app/actions/ownership.ts`): `initiateOwnershipTransfer`
  (recorded `tenants.owner_id` only, refuses self/suspended/owner/platform
  recipients and live duplicates), `acceptOwnershipTransfer` (named recipient
  only; re-verifies the initiator is still the recorded owner, the recipient is
  still active, and the request is pending/unexpired/at version),
  `cancelOwnershipTransfer` (either party) and `getOwnershipTransfer` (visible
  only to the two parties).
- [x] **Atomic handover:** promotion of the recipient, demotion of the outgoing
  owner, the conditional `tenants.owner_id` re-point and the `accepted` row occur
  in one transaction, each write conditional on the version read under lock, with
  a before/after `OWNERSHIP_TRANSFER_ACCEPT` audit row. Locks follow the
  established order (users `FOR UPDATE` -> league -> memberships -> transfer).
- [x] **UI:** owner-facing `OwnershipTransferPanel` on the Members page and
  recipient-facing `OwnershipTransferRequest` on the dashboard; the offer is inert
  until the recipient accepts.
- [x] Regression coverage: 34 action tests (authorization, two-party consent,
  self/owner/platform/suspended recipients, duplicate and lapsed requests, stale
  version, expiry, lost conditional writes, lock order, cancellation by either
  party) and 5 schema/migration contract tests.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web exec vitest run` | PASS — 36 files, **673 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @mtk/database build` | PASS |
| `corepack pnpm --filter @mtk/web type-check` | **Pre-existing failures only** — same 11 error lines in 3 untouched files; none added |

No lint run across the whole app, migration execution, remote-database write or
deployment. Tests mock auth/database; they do not prove PostgreSQL constraint,
partial-unique-index or transaction/rollback behaviour. `git diff --check`
reports one warning: a trailing-whitespace false positive on the single added
line of `packages/database/src/index.ts`, a legacy CRLF blob (most files are
LF-normalized); it was staged with `core.autocrlf=false` so no unrelated lines
were rewritten.

#### Deliberately open

- Real-PostgreSQL proof of the partial unique index, the version trigger and the
  atomic handover; delegated resource-scoped grants (the other half of IAM-07);
  privileged MFA/step-up (IAM-08).

### 2026-10-13 — Batch 13: backup scoring enforcement and plan reconciliation

#### Implemented

- Reviewed Batches 7–12 source against their recorded scopes; the SaaS roadmap
  now identifies actual commit IDs, completed slices of broad IAM tasks and
  explicit unfinished functionality. Whole-task counts remain **19 checked /
  60 open / 79 IDs**; open tasks are often partial, not untouched.
- Repaired Batch 10's web/canonical authorization mismatch: the canonical guard
  now accepts active exact-league scorers assigned to either primary or backup,
  while still rejecting missing/suspended members, non-scorer roles and revoked
  assignments. The guard is used after match locking by all five mutations.
- Included backup assignments in dashboard selection/summaries/scoring links.
  Removed the global-platform-role scoring shortcut, consistent with operational
  league authorization. Member removal refuses primary **or backup** assignment.
- Added 27 regressions across dashboard/member tests and canonical service/access
  tests, including backup record/replay/undo and replay rejection after revocation.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 36 files, **682 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **184 tests** |
| Combined | **994 passing tests** (+27 over the current Batch 12 baseline) |

No build, lint, standalone type-check, schema change, migration execution or
deployment performed. Tests exercise source/mocked boundaries and do not certify
real PostgreSQL locking/rollback, live provider journeys or writer fencing.

#### Release blockers and next batch

- Prior five local migrations remain unapplied; the repository deploy gate stays
  default-off. Release matching database artifacts/web/scoring service together
  only after staging proof and migration/grant reconciliation.
- Assignment currently checks eligibility before writing without a common
  transactional lock protocol; the removal guard cannot eliminate assignment
  races by itself. Prioritize this before calling assignment/removal reliable.
- Ownership acceptance needs fresh global-account/recipient-privilege/session
  checks and final conditional expiry; cancellation needs under-lock account and
  membership reauthorization. These are recorded follow-up findings, not fixed
  by Batch 13 or guaranteed by prior mocked tests.
- Broader IAM-03/04/05/06/07 tasks retain scoped-grant/lifecycle/provider/concurrency
  gates; source slices alone must not be labeled full task completion.

### 2026-10-15 — Batch 14: ownership-transfer resolution authorization

#### Implemented

- Synced clean local `main` with remote `a481601` before edits.
- Preserve the authenticated Clerk subject and compare the current caller's
  locked account mapping on initiation, acceptance and cancellation.
- Acceptance checks both active global accounts, current recorded ownership and
  owner membership, plus recipient membership and owner/platform privilege drift.
  Locked transfer rereads are exact-tenant, reject party drift and validate the
  persisted demotion role. Existing global accounts/roles remain unchanged.
- Final acceptance requires pending status, expected version, exact parties/
  tenant and `expires_at > clock_timestamp()` at the database write. Failed
  writes throw inside the transaction; no successful audit/cache invalidation.
- Cancellation reauthorizes the caller's account/session/league/membership under
  lock, requires initiators to remain recorded owners and audits the current
  membership role. The active recipient can decline a lapsed pending request
  without requiring the other party to remain active; no access is granted.
- Removed expiry-update-then-throw behavior (the update could never persist).
  Next authorized issuance conditionally sweeps lapsed pending offers and checks
  the returned row, including a database-clock expiry predicate.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 36 files, **734 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **184 tests** |
| Combined | **1,046 passing tests** (+52 over Batch 13) |

Ownership action coverage is **86 tests**. New regressions cover stale identity,
disabled/missing accounts, newly privileged recipients, current cancellation
access, lock/read ordering, tenant/party/status/version/clock SQL predicates,
lost conditional writes and audit failures. These mocks do **not** prove real
transaction rollback, wall-clock enforcement, deadlock freedom or RLS.

No build, lint, standalone type-check, new migration, remote database operation
or deployment performed. Five prior local migrations remain unapplied and the
release gate remains default-off. Assignment/removal concurrency and atomic
assignment auditing are next; real PostgreSQL/browser ownership acceptance,
privileged step-up and scoped grants remain open. Whole-task roadmap counts
remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 15: scorer assignment/removal concurrency and audit

#### Implemented

- Synced clean local `main` with remote `3bf64bd` before edits.
- `assignScorer` now uses a READ COMMITTED transaction and the canonical writer's
  lock order: exact-tenant match -> sorted actor/candidate accounts -> league ->
  sorted exact-league memberships. Recheck current Clerk mapping, active account/
  league, owner authority and candidate scorer membership after locks.
- Shared account locks serialize membership removal versus new assignments.
  Removal explicitly uses READ COMMITTED and reads assignments after waiting,
  without match locks that would invert the canonical writer's order.
- Opposite slots are checked on the locked match. Clears allow cleanup without
  requiring the old scorer to remain active. Unchanged commands reauthorize but
  do not rewrite/audit. Changed slots write an atomic `MATCH_SCORER_ASSIGN`
  before/after audit; caches revalidate only after transaction success.
- Generic `updateMatch` strictly parses allowlisted metadata so crafted scorer,
  backup, tenant, identity and status fields cannot bypass the command. The
  existing edit-form payload remains compatible, without defaulting omissions.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 37 files, **782 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **184 tests** |
| Combined | **1,094 passing tests** (+48 over Batch 14) |

Scorer-assignment coverage is 51 tests, with six additional deterministic
transaction-double interleavings and one removal lock/read regression. These
check both race orders for both slots, duplicate opposite-slot assignment and
staged audit failure; the model does not establish actual PostgreSQL snapshots,
lock compatibility, rollback, constraints, RLS or deadlock freedom. Drizzle's
current PostgreSQL transaction configuration documentation was consulted.

No build, lint, standalone type-check, new migration, remote database operation
or deployment ran. Prior five migrations remain unapplied; release gate remains
default-off. Real two-session assignment/removal/scoring/ownership validation and
schema/grant reconciliation are the immediate acceptance priority. Next source
work: remaining match CRUD/lifecycle and member-command identity guards (ISO-04).
Team-manager assignment/removal races, stale-operator CAS, pending assignments,
fencing, scoped grants and live fan-out remain open. Broad roadmap counts remain
**19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 16: lifecycle authority and member-session guards

#### Implemented

- Synced clean `main` with remote `1ee28e4` before implementation.
- Member role/status/removal mutations compare the authenticated Clerk subject
  against the locked current actor account; remapped/unlinked sessions fail even
  on no-op commands. Role/status transactions explicitly use READ COMMITTED.
- Toss/start use exact active league resolution and match -> account -> league
  -> membership -> sorted-team locks. Current owner or assigned primary/backup
  scorer, active account/session/league/member and exact-league team checks run
  under lock. Toss validates winner and phase; start cannot reopen ended/break
  states. Authorized identical retries preserve timestamps without duplicate audit.
- Changed toss/start commands audit bounded before/after snapshots atomically.
- End-match writes now go through the canonical completion service, not a second
  Next.js result writer. Trusted tenant/actor headers, assignment guards and an
  explicit success/match/status acknowledgement gate UI success. No local fallback.
- Added optional canonical Player of the Match validation against a locked
  exact-league player's current match-team association and atomic completion
  audit. This does not prove historical XI participation. Completed retries do
  not overwrite result/timestamp/award; omitted legacy award is preserved and a
  conflicting explicit award requires a future audited correction workflow.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 38 files, **883 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **1,204 passing tests** (+110 over Batch 15) |

Added 89 lifecycle-action, four member-session, eight transport/acknowledgement
and nine canonical service/controller regressions. Mocks verify call ordering,
SQL predicates and failure handling, not PostgreSQL locking/rollback, deployed
cache/event delivery or authenticated browser behavior. Current Drizzle
PostgreSQL transaction configuration documentation was consulted.

No build, lint, standalone type-check, new migration, remote database operation
or deployment ran. Five prior migrations remain unapplied and the release gate
stays default-off. Deploy matching web/service/artifacts after staging checks,
including audit INSERT grants and real audit-failure rollback. Old service code
would ignore the optional award field; Next toss/start does not add canonical
Redis/Kafka/Socket.IO fan-out.

ISO-04 stays open: next repair remaining match metadata CRUD/read/stream and
dashboard active-league destinations, merged team-pair/resource/date validation
and safe historical deletion rules. Scoped grants/step-up, pending assignments,
team-manager assignment races, stale-operator CAS and writer fencing remain open.
Whole-task roadmap counts remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 17: match metadata/read/stream isolation and safe cancellation

#### Implemented

- Synced clean `main` with remote `7220a97` before edits.
- Match metadata/cancel/stream actions use explicit active-league permission and
  one READ COMMITTED transaction: existing match -> current actor -> league ->
  membership -> sorted teams -> tournament -> venue as needed. Creation does
  not lock an existing match after its actor. Current Clerk/account/league and
  exact active owner membership are checked after locks, not from global roles.
- Strict payloads reject assignment/result/status/identity injection. Merged
  partial team edits cannot create self-matches. Team/venue activation and
  exact-league references, open tournament phase, bounded valid schedule values
  and PostgreSQL-safe positive match numbers are checked. Both forms send ISO
  instants; legacy timezone-less input still uses server-local interpretation.
- Edits/cancellation require an unstarted scheduled fixture with no lifecycle
  markers or scoring evidence. History existence checks cover innings, balls,
  events, projections and manual scorecards, selecting IDs only. `deleteMatch`
  now cancels instead of cascading, preserves assignments/history and ends any
  active stream. UI copy says Cancel fixture; progressed matches cannot open
  metadata editing. No restore/purge/correction workflow was added.
- Stream-start entitlement uses the locked league plan; ending remains allowed
  after downgrade/completion with current authority. URLs are bounded, disallow
  userinfo/unsafe schemes and never appear in the bounded atomic audit. This
  does not implement or validate real provider playback/RTMP/WebRTC ingest.
- Detail/list actions, match dashboard and create/edit picker reads use the
  active league. Auxiliary team/venue/player/innings queries are tenant-scoped.
  Full-scorecard detail reads share that resolver; remaining scorecard actions
  are not claimed fixed. Changed commands audit atomically; authorized cancel/
  identical stream retries and empty metadata patches avoid duplicate writes.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 40 files, **1,138 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **1,459 passing tests** (+255 over Batch 16) |

New suites: 245 management/read and 10 server-page cases. Existing creation/
edit fixtures now model transaction authorization. Tests mock DB/auth/rendering;
they do not prove real PostgreSQL lock compatibility, rollback, RLS/grants,
authenticated browser/device behavior, streaming or deployed event fan-out.
Current Drizzle transaction docs were consulted; diff whitespace checks passed.

No build, lint, standalone type-check, schema change, migration application,
remote database operation or deployment ran. Five migrations remain unapplied
and the release gate stays default-off. Keep real two-session edit/cancel/
scoring/revocation/resource-delete acceptance and audit rollback as release gates.

ISO-04 stays open. Next source work: remaining manual scorecard writes/innings
reads and team/player/tournament/venue CRUD, exact active league, canonical
writer ownership and historical cascade deletion/lock ordering. Existing manual
scorecard writers do not share the match lock; team/player cascades can still
affect historical matches. Tournament participation, published visibility,
history-query performance/index review, league timezone UX, scoped grants,
step-up, pending assignments, CAS and fencing remain open. Whole-task counts
remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 18: scorecard boundaries and safe team/player archival

#### Implemented

- Synced clean `main` with remote `ccd0199` before edits.
- Confirmed no repository TS/TSX call sites for `saveScorecard` outside its
  declaration. Replaced its competing direct-insert implementation with an
  authenticated active-league denial stub; preserve export/input type, never
  write or claim success. Existing rows remain. Manual historical import/
  correction and canonical individual-scorecard materialization are not added.
- Full scorecards validate the exact-league parent match and correlate batting/
  bowling innings to that same match/tenant. Innings-only reads validate current
  league innings and parent match, then filter every child by all three keys.
- `deleteTeam`/`deletePlayer` now archive instead of deleting/cascading. Explicit
  active-league permission plus READ COMMITTED current owner/session checks use
  account -> league -> membership -> team -> player locks. Player team-link
  drift is rejected after locking, without chasing a new reverse-order lock.
- Archival refuses unfinished team fixtures through non-locking reads after
  resource locks. No match locks are acquired after account/team/player locks.
  Team becomes inactive; player becomes inactive with status inactive. Keep
  identity/profile/membership/roster/history links and existing score data.
- Changed flags and bounded before/after audit share a transaction. Authorized
  archived retries do not rewrite/audit; failures have no false cache success.
  Confirmation copy says Archive, separate from Cancel fixture/permanent Delete;
  detail badges identify archived records. Lists/quotas may retain these rows.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 43 files, **1,256 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **1,577 passing tests** (+118 over Batch 17) |

Added 82 archival, 32 scorecard-boundary and four confirmation-copy regressions.
Updated existing full-scorecard tests for parent/innings SQL correlation. Mocks
check SQL predicates/parentheses, call ordering and failure handling; simulated
lock-wait completion is not PostgreSQL concurrency proof. Dialog rendering is
mocked and is not authenticated UI/device acceptance. Current Drizzle
transaction/operator docs and lock-order guidance were consulted.

No build, lint, standalone type-check, schema change, migration application,
remote database operation or deployment ran. Five prior migrations remain
unapplied; release gate stays default-off. Staging still needs grants/RLS,
actual hierarchy filtering/query performance, two-session archive/create/
scoring/revocation behavior and audit-failure rollback tests.

ISO-04 remains open. Next source work is the remaining team/player create/
update/read/roster and dashboard active-league paths, payload/reference checks,
locked current authority and serialized quotas. These two archival wrappers
do not close other/admin cascade-delete paths or unsafe non-participating
writers. Archive adds no restore, purge, quota release, CAS or writer fencing.
Historical import/correction requires an explicit canonical design. Whole-task
roadmap counts remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 19: locked team/player and roster mutations

#### Implemented

- Synced clean `main` with remote `9f9a508` before edits. Scope is the six team/
  player create/update/add/remove writers; read actions/dashboard pages stay open.
- Resolve and explicitly authorize the exact active league; strict schemas reject
  forged create scope and identity/ownership/activity fields. Validate IDs, bounded
  names/slugs, DOB and HTTPS image URLs. Patch omission is not a nullable clear or
  a reset to a creation default. Keep non-Latin names with a nonempty slug fallback.
- READ COMMITTED transactions lock account -> league -> membership -> sorted
  teams -> player as applicable and recheck current account/Clerk mapping, league,
  exact active membership and assigned team authority. Owner-only create/player
  edits; team edits/roster commands also allow active team-manager members with
  a matching current manager/captain binding. Managers cannot change tournament
  linkage. New/changed tournament references are locked and league/state checked.
- Creates serialize current plan/count checks on an exclusive league lock; use
  persisted account UUID authors and retain structured quota errors. Archived
  rows still consume quota. These locks protect participating writers only.
- Player create/edit and roster adds share team-locked capacity/eligibility checks;
  squad-size reductions cannot undercut the linked roster (including archived
  players). Explicit unlink is required before moving teams. Recheck player team
  after locking and reject drift rather than chasing reverse-order resource locks.
  Generic edits cannot restore archived players; inactive teams reject commands.
- Block team/status eligibility changes during toss/live/innings-break fixtures
  using non-locking current reads after resource locks. Scheduled fixtures do not
  block roster amendments; contact-only edits can proceed in play. No match locks
  after accounts/resources. This is not immutable XI/substitution enforcement.
- Atomic minimal audits include linkage/status/capacity and changed field names,
  not private profile/contact/DOB values. Reauthorized no-op add/remove retries
  do not rewrite/audit. Cache invalidation follows a successful transaction; async
  audit failures propagate. Identity and historical score rows are not deleted.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 44 files, **1,490 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **1,811 passing tests** (+234 over Batch 18) |

Added 234 roster-management regressions and updated the legacy player-create
fixture to exercise transactional authorization/count/insert/audit. SQL/call-order
and state-change mocks test the source protocol, not PostgreSQL lock behavior,
deadlock freedom, database constraints or real audit rollback. Current Drizzle
transaction/count docs were consulted. Nest negative-fixture logs are expected.

No build, lint, standalone type-check, schema change, migration application,
remote database operation or deployment ran. Five prior migrations remain
unapplied and the release gate stays default-off. Real two-session create quotas,
capacity/join races, roster versus toss/start/scoring/archive/revocation, grants,
RLS and audit-failure rollback remain release acceptance work. Archived-team
unlink/restore, immutable XI, stale-operator CAS and database-wide limits are not
implemented. Other/admin writers and tournament/venue cascade paths need review.

Next source work: exact-active-league team/player read actions and dashboard
list/detail/new/edit/roster destinations, scoped joins/pickers and current
authority/privacy-aware controls. No full ISO-04 or authenticated browser claim;
whole-task roadmap counts remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 20: scoped roster reads and dashboard controls

#### Implemented

- Synced clean `main` with remote `0b330bb`. Scope is core team/player read
  actions and list/detail/new/edit/roster dashboard routes; analytics, ID cards
  and follow/publication paths stay open.
- Exact active-league read permission is checked before business SQL. Removed
  `getMyTenant`/legacy repository reads and owned/default-league assumptions.
  Strict UUID/filter validation rejects forged scope and overposts. List/count
  predicates and deterministic ordering are shared; pages are bounded to 100.
- Explicit projections exclude contact/DOB/physical/biography/global identity and
  creator metadata from ordinary reads. Owner-only edit reads separate private
  fields. Player detail joins require the same active league. Roster add returns
  only ID/name/link, closing a manager private-field bypass.
- Team summaries use scoped database-side counts, not per-row queries. Losses
  require an opposing winner in a completed match. Archived rows remain historical;
  no restore/purge/quota release is added.
- New/edit routes enforce current owner/assigned-manager authority. Unassigned
  managers and archived/inactive resources redirect. Pickers are bounded to active
  same-league ID/name fields, retain the current team and disclose truncation.
  Creation offers only active unassigned players; moves require explicit unlink.
- Detail auxiliary reads are authorized after the exact-league parent and
  correlated to the same league/hierarchy. Player historical side comes from
  performance rows, not today's roster. Win/loss requires a valid historical side
  and opposing winner. Follow state is scoped to the same league/entity.
- Edit/roster/ID-card/archive controls match current authority. Private profile
  data is owner-only and not serialized to other clients. Player stats copy says
  league-only, not cross-league career.
- Team analytics and player ID-card list/detail routes now resolve the exact
  active league and explicitly check read permission before business SQL. Every
  child query is tenant-filtered. ID-card issuance/revocation/expiry use the same
  active-league permission and validate UUIDs and dates. The ID-card detail page
  selects only the fields the card renders and scopes team/league lookups.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 47 files, **1,706 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,027 passing tests** (+216 over Batch 19) |

Added 139 read-boundary, 13 history/hierarchy and 64 route/control regressions.
SQL/call-order mocks and rendered route component mocks are not PostgreSQL
execution, RLS, index/performance or authenticated browser proof. Current Drizzle
select/join/operator docs and N+1 guidance were consulted. Nest negative-fixture
logs are expected.

No build, lint, standalone type-check, schema change, migration application,
remote database operation or deployment ran. Five prior migrations remain
unapplied and the release gate stays default-off. These are request-local
authorization/projection checks, not read-versus-revocation locks or database-
wide privacy constraints. Real RLS/grants/indexes/query plans and concurrent
read/write behavior remain release acceptance work.

Next source work: team analytics, player ID-card list/detail and follow/
publication paths, then tournament/venue/admin writers and delete paths. No full
ISO-04 or authenticated browser claim; whole-task roadmap counts remain
**19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 21: scoped registration review writers and reads

#### Implemented

- Synced clean `main` with remote `2fa43ec`. Scope is the registration review
  writers (create/approve/reject/confirm-fee) plus a new withdraw action and the
  scoped registration review reads; tournament/venue/admin writers and public
  visibility stay open.
- Removed `getMyTenant`/`withTenantContext` and owned/default-league fallback from
  the registration actions. Exact active-league permission is checked before SQL
  and re-checked (account, active membership, active league) inside the
  transaction. Steady-state role matrix is enforced: owners review, owners or the
  team's manager/captain create/withdraw.
- Review writers lock account → league → membership → tournament → team →
  registration under READ COMMITTED. Tournament locks precede registration locks
  so approval cannot deadlock a concurrent registration. Approval locks the
  tournament row `FOR UPDATE`, checks `maxTeams` capacity, links the team and
  flips status atomically; fee confirmation inserts the payment and marks the
  entry paid atomically; both write minimal audits without squad/notes/reference/
  account data.
- Creation verifies active same-league team, open registration window and status,
  squad membership as active tenant-scoped players (fixes a prior unscoped read),
  team squad limit and `(team, tournament)` uniqueness.
- Review reads use explicit projections excluding the payment transaction
  reference and registered-by/approved-by UUIDs, join team/tournament with the
  same active-league predicate, and are bounded to 100 rows with honest totals.
  The registrations dashboard route switched to the scoped read context and a
  single joined read.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 48 files, **1,862 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,183 passing tests** (+156 over Batch 20) |

Added 156 registration review cases: exact authority, locked tournament-before-
registration ordering, capacity/squad/duplicate/window checks, payment resolution,
delegation boundaries, projection exclusion, scoped joins, bounded pages and
failure propagation. Call-order/SQL-construction mocks and in-memory callbacks
are not PostgreSQL locking, rollback or RLS proof. Nest negative-fixture logs are
expected.

No build, lint, standalone type-check, schema change, migration application,
remote database operation or deployment ran. Five prior migrations remain
unapplied and the release gate stays default-off. These are transaction-scoped
locks and request-local authorization/projection checks, not database-wide
constraints or read-versus-revocation guarantees. Real RLS/grants/indexes,
two-session create/approve/capacity races and rollback remain release acceptance
work.

Next source work: tournament/venue/admin writers and delete paths, then follow/
publication and notification paths. Withdrawal keeps the squad, fee and linkage;
refunds, slot release, waitlist and archival remain separate workflows. No full
ISO-04 or authenticated browser claim; whole-task roadmap counts remain
**19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 22: safe tournament archival replaces hard delete

#### Implemented

- Synced clean `main` with remote `bcbdca6`. Scope is the destructive tournament
  delete path; tournament list/detail lifecycle writers, venue/admin writers and
  public visibility stay open.
- `deleteTournament` no longer hard-deletes. It resolves the exact active league,
  checks `tournament:delete` and runs a locked, audited archival that cancels the
  tournament and closes registration. The FK cascades that deleted registrations
  and nulled match/team links no longer run.
- Archival locks account → league → membership → tournament under READ COMMITTED,
  re-checks current owner/active membership/active league after the wait, takes no
  match locks, refuses `live` and already-archived tournaments, and writes one
  minimal audit (`TOURNAMENT_ARCHIVE`). The detail page labels the control as
  archival rather than permanent deletion.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 48 files, **1,870 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,191 passing tests** (+8 over Batch 21) |

Added ten tournament-archival cases: owner-lock ordering, audit content/ordering,
no hard-delete, live/already-archived refusal, foreign/missing tournament,
non-owner and locked-actor/league rechecks, audit-failure propagation and id
validation. Call-order/SQL-construction mocks and in-memory callbacks are not
PostgreSQL locking, cascade or RLS proof.

No build, lint, standalone type-check, schema change, migration application,
remote database operation or deployment ran. Five prior migrations remain
unapplied and the release gate stays default-off. Cancelling is not a purge,
refund, slot-release or restore workflow and does not unlink teams or
registrations. Real lock ordering, cascade absence, audit rollback, grants,
indexes, RLS and two-session races remain release acceptance work.

Next source work: the remaining tournament lifecycle/list/detail writers and
venue/admin writers, then follow/publication and notification paths. No full
ISO-04 or authenticated browser claim; whole-task roadmap counts remain
**19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 23: isolated fan-follow identity and league scoping

#### Implemented

- Synced clean `main` with remote `c29c96a`. Scope is the follow write/read paths;
  remaining tournament lifecycle writers, venue/admin writers and public/
  anonymous follow stay open.
- Follow mutations/reads resolve the exact active league, require the `fan:follow`
  permission on an active membership, map Clerk identity → account UUID and assert
  the target exists in that league. The client tenant must equal the active league;
  a global role or tenant array never grants access.
- Fixed a Clerk-vs-UUID bug: `fan_follows.user_id` is a `users.id` UUID but the code
  stored/matched the Clerk string, so team/player follow state was always false.
  Writes now store the account UUID, reads match on it, and inserts are idempotent
  via `onConflictDoNothing`. `readRosterFollowState` and its detail callers pass
  `context.actorId`, and counts/state/list are tenant-scoped.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 49 files, **1,888 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,209 passing tests** (+18 over Batch 22) |

Added 18 follow cases: exact-league/account writes, tenant mismatch, membership/
permission/league denial, foreign-target refusal, idempotent duplicates, invalid
input before SQL, account-UUID (not Clerk) scoping for delete/count/state/list and
read resilience. Mocked SQL/call-order tests and in-memory predicates are not
PostgreSQL RLS, constraint or concurrency proof.

No build, lint, standalone type-check, schema change, migration application,
remote database operation or deployment ran. Five prior migrations remain
unapplied and the release gate stays default-off. Follows are not yet a public/
anonymous or cross-league experience and have no owner-review audit, rate limit or
notification fan-out. Real RLS, the unique constraint, grants, indexes and
two-session follow races remain release acceptance work.

Next source work: the remaining tournament lifecycle/list/detail writers and
venue/admin writers, then public/anonymous follow, publication and notification
paths. No full ISO-04 or authenticated browser claim; whole-task roadmap counts
remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 24: exact-league stats and scoring dashboard reads

#### Implemented

- Synced clean `main` with remote `6ccf8e9`. Scope is the stats, stats/compare and
  scoring dashboard read routes; remaining tournament lifecycle writers, venue/admin
  writers and public/anonymous follow stay open.
- New `lib/league-reads.ts` centralizes the exact-active-league read context
  (`requireLeagueReadContext`) and the readers. It resolves the exact active league,
  checks `requirePermissionServer(permission, league)`, maps Clerk → active account,
  then requires an active same-league membership whose role holds the permission and
  an active `tenants` row. No global role, tenant array or primary membership grants
  access.
- `stats/page.tsx`, `stats/compare/page.tsx` and `scoring/page.tsx` drop the
  `getMyTenant` fallback and the league-setup redirect, resolve the exact active
  league first (`stats:read` / `match:read`) and let failures propagate rather than
  render a fake empty state.
- Leaderboards inner-join `players` and `teams` with the active-league predicate,
  are bounded (1–50) with a deterministic tiebreak; the comparison roster is bounded
  (1–200); `readPlayerComparison` scopes the player and all batting/bowling/fielding
  children to the league and rejects non-UUID ids before SQL; the scoring console
  filters/bounds (100, +1 for truncation) matches and resolves team names with a
  league-scoped `inArray`.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 51 files, **1,921 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,242 passing tests** (+33 over Batch 23) |

Added 33 read cases across `league-reads.test.ts` (19) and `stats-pages.test.tsx`
(14): context resolution/denial, league-scoped joins and params, bounded limits,
tenant-scoped comparison aggregation, invalid-id short-circuit, console name
resolution/truncation and propagated context/query failures. Mocked SQL/call-order
tests and in-memory predicates are not PostgreSQL RLS, constraint or concurrency
proof.

No build, lint, schema change, migration application, remote database operation or
deployment ran. A standalone `tsc --noEmit` still reports only its pre-existing
unrelated errors; none reference the new lib, pages or tests. Five prior migrations
remain unapplied and the release gate stays default-off. These reads are not a
public/anonymous or cross-league experience and are not certified for export, cache
or socket scoping. Real RLS, grants and indexes on these read paths remain release
acceptance work.

Next source work: the remaining tournament lifecycle/list/detail writers and
venue/admin writers, then public/anonymous follow, publication and notification
paths. No full ISO-04 or authenticated browser claim; whole-task roadmap counts
remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 25: exact-league tournament dashboard reads

#### Implemented

- Synced clean `main` with remote `a36d01a`. Scope is the tournament dashboard list
  and creator; the registration lifecycle writers, venue/admin writers and
  public/anonymous follow stay open.
- Renamed the Batch 24 context helper to `requireActiveLeagueContext` for reuse as a
  page-level authorization gate; the stats/compare/scoring pages and tests use the
  new name.
- New `lib/tournament-reads.ts` replaces the list page's whole-league N+1 counts with
  a bounded (200, +1 for truncation) list whose team/match counts are grouped queries
  carrying the same tenant predicate as the list. `dashboard/tournaments/page.tsx`
  drops `getMyTenant` and the setup redirect, resolves the exact active league with
  `tournament:read` and propagates failures instead of returning `[]`.
  `dashboard/tournaments/new/page.tsx` gates the creator on `tournament:create` and
  no longer passes a primary-membership tenant.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 53 files, **1,935 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,256 passing tests** (+14 over Batch 24) |

Added 14 read cases across `tournament-reads.test.ts` (4) and
`tournament-pages.test.tsx` (10): league-scoped aggregated counts, child-query
scoping, zero counts, truncation/empty short-circuit, per-route permission,
resolved-league reader arguments, setup-redirect removal, propagated failures and
anonymous redirects. Mocked SQL/call-order and render tests are not PostgreSQL RLS,
index or concurrency proof.

No build, lint, schema change, migration application, remote database operation or
deployment ran. A standalone `tsc --noEmit` still reports only its pre-existing
unrelated errors; none reference the new lib, pages or tests. Five prior migrations
remain unapplied and the release gate stays default-off. These reads are not a
public/anonymous experience and are not certified for export or cache scoping. Real
RLS, grants and index support for the grouped count queries remain release
acceptance work.

Next source work: the remaining tournament registration lifecycle writers and
venue/admin writers, then public/anonymous follow, publication and notification
paths. No full ISO-04 or authenticated browser claim; whole-task roadmap counts
remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 26: locked tournament registration lifecycle

#### Implemented

- Synced clean `main` with remote `969a9ef`. Scope is the registration open/close
  writers; the tournament create/update writers, venue/admin writers and
  public/anonymous follow stay open.
- New `setTournamentRegistration` in `lib/tournament-lifecycle.ts` moves open/close
  off the repository `updateById` into a READ COMMITTED account → league → membership
  → tournament lock with a post-wait owner recheck and an atomic minimal audit
  (`TOURNAMENT_REGISTRATION_OPEN`/`..._CLOSE`). `openRegistration`/`closeRegistration`
  are thin wrappers and validate the id shape before the transaction.
- Guards: an archived tournament can neither open nor close registration;
  registration only opens for a `draft`/`registration` tournament (refusing
  `live`/`completed`); closing keeps the status and only clears `registrationOpen`.
  A failing audit aborts the write. Not a purge/refund/slot-release workflow.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 53 files, **1,942 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,263 passing tests** (+7 over Batch 25) |

The `tournament-actions.test.ts` lifecycle block adds cases for the locked open with
audit/revalidate, locked close without a status change, archived refusal,
live/completed refusal, non-owner denial, foreign/missing tournament, propagated
audit failure, permission denial before the transaction and id-shape validation.
Mocked call-order/SQL tests are not PostgreSQL lock, rollback or RLS proof.

No build, lint, schema change, migration application, remote database operation or
deployment ran. A standalone `tsc --noEmit` still reports only its pre-existing
unrelated errors. Five prior migrations remain unapplied and the release gate stays
default-off. Real two-session open/close ordering against archive and registration
writes, audit rollback and RLS remain release acceptance work.

Next source work: the remaining tournament create/update writers and venue/admin
writers, then public/anonymous follow, publication and notification paths. No full
ISO-04 or authenticated browser claim; whole-task roadmap counts remain **19 checked
/ 60 open / 79 IDs**.

### 2026-10-15 — Batch 27: locked, audited tournament create/update

#### Implemented

- Synced clean `main` with remote `ff5d12e`. Scope is the tournament create/update
  writers; venue writers, settings/billing destinations and public/anonymous follow
  stay open.
- New `lib/tournament-writes.ts` moves create/update off `tournamentRepo.insert` /
  `updateWithLock` into READ COMMITTED account → league → membership → tournament
  locks with a post-wait owner recheck and an atomic minimal audit
  (`TOURNAMENT_CREATE`/`TOURNAMENT_UPDATE`), sharing `lockOwnerContext` with the
  Batch 26 lifecycle writers. `createTournament`/`updateTournament` are thin wrappers.
- Per-league unique slug: create and a renamed slug pre-check a duplicate and map a
  PostgreSQL unique-violation (`23505`) race to the same friendly error, replacing a
  raw 500. The update write keeps the locked date/seed-order validation and
  legacy-rules preservation inside its `prepare` callback.
- `persistenceValues` is generic so a create input keeps its required `name`/`format`.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 53 files, **1,947 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,268 passing tests** (+5 over Batch 26) |

The `tournament-actions.test.ts` writer block adds cases for the locked create with
audit and lock order, duplicate-slug pre-check, unique-violation mapping, locked
update with audit and lock order, foreign/missing tournament, membership-change
denial, renamed-slug collision and permission denial before the transaction. Mocked
call-order/SQL tests are not PostgreSQL lock, rollback, unique-index or RLS proof.

No build, lint, schema change, migration application, remote database operation or
deployment ran. A standalone `tsc --noEmit` still reports only its pre-existing
unrelated errors. Five prior migrations remain unapplied and the release gate stays
default-off. Real two-session create/update/archive/registration lock ordering,
unique-index behaviour, audit rollback and RLS remain release acceptance work.

Next source work: the remaining venue writers, settings/billing and other dashboard
destinations, then public/anonymous follow, publication and notification paths. No
full ISO-04 or authenticated browser claim; whole-task roadmap counts remain **19
checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 28: exact-league settings, billing and invoices

#### Implemented

- Synced clean `main` with remote `905891b`. Scope is the settings/billing/invoices/
  white-label destinations. (`getMyTenant` is already membership-verified and
  request-tenant-first, so this is a protocol/fail-closed/projection change; the
  already-verified notifications, Stripe-checkout, `dashboard-context` and league-setup
  sites, venue writers and public/anonymous follow stay open.)
- New `lib/league-settings-reads.ts` reads the active league's identity/branding,
  bounded invoice history, one invoice and bounded white-label requests, each
  predicated on the resolved `tenantId` with explicit projections; the reader takes an
  explicit `tenantId` and never resolves one itself.
- The settings, billing, invoices and invoice-detail pages resolve the active league
  with the shared fail-closed `requireActiveLeagueContext("settings:manage")` gate
  instead of page-level `getMyTenant` + `getUserRoleForTenant`; failures propagate
  instead of silently redirecting to the dashboard/league setup or rendering fake
  empty settings, and reads are projected and bounded rather than `SELECT *`. The
  billing client/upgrade modal take a minimal `LeagueIdentity`, and a foreign invoice
  404s.
- `lib/invoices.ts` is removed; the white-label writer shares the same active-league
  resolution (`getMyTenant` was already membership-verified) and the unused
  `getMyWhiteLabelRequests` action is removed in favour of the scoped reader.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 56 files, **1,974 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,295 passing tests** (+27 over Batch 27) |

New regressions: `league-settings-reads.test.ts` (8), `settings-pages.test.tsx` (15)
and `white-label-actions.test.ts` (4). Mocked readers are not PostgreSQL RLS or grant
proof.

No build, lint, schema change, migration application, remote database operation or
deployment ran. `tsc --noEmit` still reports only its pre-existing unrelated errors.
Five prior migrations remain unapplied and the release gate stays default-off. Next
source work: tournament-detail mutation-control gating and the remaining venue
writers, then public/anonymous follow, publication and notification paths. No full
ISO-04 or authenticated browser claim; whole-task roadmap counts remain **19 checked /
60 open / 79 IDs**.

### 2026-10-15 — Batch 29: permission-gated tournament-detail controls

#### Implemented

- Synced clean `main` with remote `3dd6152`. Scope is the tournament-detail page's
  mutation controls; venue writers, registrations/new, `dashboard-context`/notifications/
  league-setup and public/anonymous follow stay open. It also corrects the Batch 28
  notes: `getMyTenant` is already membership-verified and request-tenant-first, so
  Batch 28 was a protocol/fail-closed/projection change, not a cross-tenant fix.
- `dashboard/tournaments/[id]/page.tsx` resolves the exact active league with
  `requireActiveLeagueContext("tournament:read")`, 404s a row whose `tenantId` is not
  that league, and gates each control on the viewer's precise permission: the edit link
  on `tournament:update`, the archive button on `tournament:delete`, the registration
  open/close toggle on `tournament:manage_registrations`, and the self-service
  registration CTA on `registration:create`. Previously all controls rendered for any
  viewer whose role held `tournament:read` (fan/player/coach/scorer included). The
  actions themselves are unchanged and still re-check on write.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 57 files, **1,984 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,305 passing tests** (+10 over Batch 28) |

New regression `tournament-detail-page.test.tsx` (10 tests): resolves
`tournament:read` for the exact league, shows every control to a league owner, shows a
team manager only the registration CTA, hides all four controls from
scorer/coach/player/fan, propagates a denied context before the read, and 404s a
missing or foreign-league row. Rendering a page with mocked context/actions is not
authenticated-browser proof.

No build, lint, schema change, migration application, remote database operation or
deployment ran. `tsc --noEmit` still reports only its pre-existing unrelated errors.
Five prior migrations remain unapplied and the release gate stays default-off. Next
source work: the remaining venue writers and the registrations/new
swallow-and-redirect, then public/anonymous follow, publication and notification paths.
No full ISO-04 or authenticated browser claim; whole-task roadmap counts remain **19
checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 30: self-service registration form resolves the active league

#### Implemented

- Synced clean `main` with remote `e25485b`. Scope is the registration `new` page and its
  picker reader; venue writers, the registrations review-queue catch-redirect,
  `dashboard-context`/notifications/league-setup and public/anonymous follow stay open.
- `lib/registration-reads.ts` gains `readRegistrationFormOptions(tenantId)` — a bounded,
  tenant-scoped reader for the self-service registration form's team, tournament and
  player pickers (over-fetch 101/101/201, truncate to 100/100/200; teams narrowed to
  `isActive`, tournaments carrying `registrationOpen`).
- `dashboard/registrations/new/page.tsx` resolves the exact active league with
  `requireRegistrationReadContext("registration:create")` and reads the pickers through
  that reader. It previously wrapped `getTeams`/`getTournaments`/`getPlayers` in a
  `try/catch` that redirected to `/dashboard/league/setup` — including on an authorization
  denial — and rendered fake empty pickers. Anonymous visits now go to `/`, and read or
  authorization failures propagate to the Next error boundary instead of a silent
  redirect or an empty form.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 59 files, **1,993 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,314 passing tests** (+9 over Batch 29) |

New regressions: `registration-form-options.test.ts` (3) and
`registration-new-page.test.tsx` (6). Mocked readers are not PostgreSQL or browser proof.

No build, lint, schema change, migration application, remote database operation or
deployment ran. `tsc --noEmit` still reports only its pre-existing unrelated errors.
Five prior migrations remain unapplied and the release gate stays default-off. Next source
work: the remaining venue writers, then public/anonymous follow, publication and
notification paths. No full ISO-04 or authenticated browser claim; whole-task roadmap
counts remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 31: league venue management (locked, scoped, audited)

#### Implemented

- Synced clean `main` with remote `048077f`. Scope is league venue (grounds/facilities)
  management; the registrations review-queue catch-redirect, `dashboard-context`,
  notifications and league-setup `getMyTenant` consumers, and public/anonymous follow stay
  open.
- RBAC gains two permissions: `venue:read` (every league role) and `venue:manage`
  (`super_admin`, `league_owner` only). `getNavigationForRole` returns a **Venues** item for
  any role holding `venue:read`; the sidebar and header icon map (`MapPin`) render it in the
  management group.
- `lib/venue-reads.ts` — request-local `requireVenueReadContext(permission)` plus bounded,
  tenant-scoped `readVenueList` (over-fetch `201`, truncate to 200), `readVenue(tenantId, id)`
  (exact league predicate) and `readVenueOptions(tenantId)` (`isActive`, over-fetch `201`,
  truncate to 200). Reads resolve the exact active league, reject a `super_admin` membership
  and never fall back to an owned/default tenant.
- `lib/venue-writes.ts` — `createVenueRecord`, `updateVenueRecord` and `setVenueActive`.
  Each runs in one `read committed` transaction that locks account → league → membership
  (`league_owner` only), takes the venue row `FOR UPDATE` **after** those locks (update and
  archive), rechecks the current authority after the wait, and writes its audit log
  (`VENUE_CREATE` / `VENUE_UPDATE` / `VENUE_ARCHIVE` / `VENUE_RESTORE`,
  `payload: { resourceId, changedFields[, before, after] }`) in the same transaction so a
  failed audit aborts the write. Per-league `UNIQUE(tenantId, name)` is surfaced as one
  friendly error by pre-check plus a `23505` catch. Archiving is an `isActive`
  compare-and-set, never a delete, because `matches.venueId` is `onDelete: "set null"`; an
  archive/restore to the state a venue already holds is rejected with a clear conflict
  message instead of a silent no-op.
- `app/actions/venues.ts` (no direct `db`, so it passes `no-unscoped-queries`),
  `components/venues/venue-form.tsx`, `components/venues/venue-row-actions.tsx`, and the
  `dashboard/venues` list / `new` / `[id]/edit` routes. Read or authorization failures
  propagate to the error boundary rather than rendering a fake empty list.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 63 files, **2,031 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,352 passing tests** (+38 over Batch 30) |

New regressions: `venue-reads.test.ts` (4), `venue-writes.test.ts` (10),
`venue-actions.test.ts` (11) and `venue-pages.test.tsx` (12); `rbac.test.ts` gains the
venue permission and nav assertions. The writer tests assert the exact lock ordering via
`PgDialect.sqlToQuery`. Mocked readers and a mocked `db.transaction` are **not** PostgreSQL
locking, RLS, unique-constraint or authenticated-browser proof.

No build, lint, schema change, migration application, remote database operation or
deployment ran. `tsc --noEmit` still reports only its pre-existing unrelated errors. Five
prior migrations remain unapplied and the release gate stays default-off. Next source work:
the remaining catch-redirect cleanups, then public/anonymous follow, publication and
notification paths. No full ISO-04 or authenticated browser claim; whole-task roadmap
counts remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 32: registration review queue reports failures instead of hiding them

#### Implemented

- Synced clean `main` with remote `ed2b086`. Scope is the league registration review queue's
  access decision; public/anonymous follow, publication boundaries, refunds and notification
  fan-out stay open.
- `lib/registration-reads.ts` gains `resolveRegistrationReviewAccess()` — a non-throwing
  access decision that returns the review context only when the viewer holds
  `registration:manage` in the exact active league, and `null` when they are simply not a
  league owner (no active league, no active membership, a `super_admin`-only membership, or a
  missing permission). Tenant, actor, membership and league lookups are not swallowed, so an
  infrastructure failure throws.
- `dashboard/registrations/page.tsx` replaces its
  `try { requireRegistrationReadContext("registration:manage") } catch { redirect("/dashboard") }`
  — which turned every tenant/membership/database failure into a benign-looking bounce — with
  `const context = await resolveRegistrationReviewAccess(); if (!context) redirect("/dashboard")`.
  A genuine non-owner is still sent to the dashboard; any other failure now propagates to the
  route's `error.tsx`. The queue read was already uncaught and stays that way.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 64 files, **2,037 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,358 passing tests** (+6 over Batch 31) |

New regressions: `registration-review-page.test.tsx` (6 — exact-league read; non-owner
redirect without a read; propagated access and read failures with no `/dashboard` redirect;
the anonymous bounce). Mocked readers are **not** authenticated-browser or database proof.

No build, lint, schema change, migration application, remote database operation or deployment
ran. `tsc --noEmit` still reports only its pre-existing unrelated errors. Five prior
migrations remain unapplied and the release gate stays default-off. Next source work:
public/anonymous follow, publication and notification paths. No full ISO-04 or authenticated
browser claim; whole-task roadmap counts remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 33: exact-league notification reads/writes

#### Implemented

- Synced clean `main` with remote `85dbd9d`. Scope is the personal notification
  read/write paths and the notifications route; public/anonymous follow,
  publication boundaries, refunds and notification fan-out stay open.
- New `lib/notification-reads.ts` centralizes the request-local
  `requireNotificationMemberContext()` gate. It resolves the exact active league
  and requires an *active membership of any role* — deliberately **not** a
  management permission, because fan/player/commentator roles have no
  match-scoped capability but must still see their own bell. It rejects
  `super_admin`-only identities, remapped sessions, inactive accounts/leagues,
  suspended/missing/foreign memberships, and never falls back to a global role,
  the mutable `users.tenantIds` array, a primary membership or a client-supplied
  tenant.
- `resolveNotificationMemberContext()` is the non-throwing companion used by the
  page: it returns `null` only for a confirmed non-member, while tenant/
  membership/account/league **lookup failures propagate** so an outage is not
  disguised as an empty bell.
- Bounded, tenant-scoped readers replace the previous inline queries:
  `readMyNotifications` (clamped 1–100, newest-first with an id tiebreak),
  `readUnreadNotificationCount`, `markNotificationReadById` (validates the id as
  a UUID before any write and re-asserts the tenant/ownership predicate) and
  `markAllNotificationsReadFor`. The shared `myNotificationFilter` carries the
  resolved actor + tenant on both the personal and league-wide (`user_id IS
  NULL`) branches.
- `app/actions/notifications.ts` now delegates to the reader context, keeps the
  personal-read contract (an unauthenticated/league-less caller yields empty
  results rather than a throw so the bell still renders during SSR), and lets a
  genuine infrastructure failure propagate. Direct `db` access is gone, so
  `notifications.ts` is removed from the `no-unscoped-queries` allowlist and the
  guard now enforces repo-only access there.
- `dashboard/notifications/page.tsx` gates on the exact active league, bounces
  only confirmed non-members to `/dashboard`, and propagates read/access failures
  to a new `notifications/error.tsx` boundary instead of a benign empty page.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 67 files, **2,069 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,390 passing tests** (+32 over Batch 32) |

New regressions: `notification-reads.test.ts` (21), `notification-actions.test.ts`
(6) and `notifications-page.test.tsx` (5). They assert exact-member resolution,
super-admin/remapped/suspended/foreign denial, non-throwing page resolution with
propagated failures, tenant+actor SQL predicates, UUID validation before write,
limit clamping, and the empty-vs-propagate action contract. Mocked readers/SQL and
a client-mocked page are **not** PostgreSQL RLS, index or authenticated-browser
proof.

No build, lint, schema change, migration application, remote database operation or
deployment ran. `tsc --noEmit` still reports only its **19 pre-existing** error
lines (verified identical with `git stash`), none in the new files. Five prior
migrations remain unapplied and the release gate stays default-off. The bell,
page and actions are request-local authorization/projection checks, not
read-versus-revocation locks. Next source work: public/anonymous follow and
publication boundaries, then the `dashboard-context`/`league-setup` `getMyTenant`
consumers. No full ISO-04 or authenticated browser claim; whole-task roadmap
counts remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 34: public publication boundary + leaderboard isolation

#### Implemented

- Synced clean `main` with remote `6632814`. Scope is the public/anonymous
  surface named as the next source work: the unauthenticated match, live and
  tournament routes, the scorecard PDF export, and the public leaderboard hub.
- Found and fixed a genuine **cross-tenant leak**: `app/leaderboards/page.tsx`
  aggregated `player_season_stats` and `players` with **no tenant predicate at
  all**, so a visitor on one league's host ranked every other league's players.
  It now resolves the request-host league through `requirePublicTenantId()` and
  reads through a scoped, publication-gated reader.
- New `lib/public-visibility.ts` centralizes the publication decision. Public
  pages were already tenant-scoped to the request host (`lib/public-tenant.ts`)
  but had no publication gate, so an organizer's unannounced `draft` tournament
  and a `cancelled` fixture were publicly readable. The library derives
  publication from the existing lifecycle columns (no new schema), so nothing
  ambiguous is exposed and the database stays authoritative.
- Pure predicates `isTournamentPublished` (only `registration`/`live`/`completed`)
  and `isMatchPublished` (every match status except `cancelled`) are the single
  source of truth and are exported with their value tuples for reuse in SQL
  `inArray` filters.
- Scoped readers: `readPublishedTournament`, `readPublishedMatch` (also rejects a
  match whose same-tenant parent tournament is unpublished, and fails closed on a
  broken/missing parent; a tournament-less friendly follows its own status),
  `readPublishedMatchTeams`, `matchHasInnings`, and the publication-gated
  `readPublicBattingLeaderboard`/`readPublicBowlingLeaderboard` (joined to
  published tournaments, deterministic tiebreak on `playerId`, bounded by
  `PUBLIC_LEADERBOARD_LIMIT`).
- Wired the gate into `matches/[matchId]/page.tsx`, `matches/[matchId]/live/page.tsx`,
  `tournaments/[id]/page.tsx` and the `api/scorecards/[matchId]/pdf` route. Each
  still 404s (or returns 404) for a hidden row exactly as for a foreign/missing
  id, so nothing signals that an unpublished row exists. Unused direct-`db`
  imports were trimmed.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 69 files, **2,098 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,419 passing tests** (+29 over Batch 33) |

New regressions: `public-visibility.test.ts` (26) and `leaderboards-page.test.tsx`
(3). They assert the publication predicates, the tenant+id SQL predicates on
every reader, match hiding on a cancelled status or unpublished/missing parent,
friendly status omission, leaderboard tenant/status joins and bound, and that the
leaderboard page reads for the resolved host league and propagates a no-tenant
resolution instead of rendering a global list. Mocked readers/SQL and a
client-mocked page are **not** PostgreSQL RLS, index or authenticated-browser
proof.

No build, lint, schema change, migration application, remote database operation or
deployment ran. `tsc --noEmit` still reports only its **19 pre-existing** error
lines, none in the new files. Five prior migrations remain unapplied and the
release gate stays default-off. Publication here is derived from lifecycle status
(request-local reads), not a read-versus-revocation lock, and does not yet cover
private contact fields, exports or sockets. Next source work: the
`dashboard-context`/league-setup `getMyTenant` consumers, then public/anonymous
follow. No full ISO-04 or authenticated browser claim; whole-task roadmap counts
remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 35: league-setup ownership gate + serialized league-create cap

#### Implemented

- Synced clean `main` with remote `f2f27ba`. Scope is the remaining
  `dashboard-context`/league-setup `getMyTenant` consumers named as the next
  source work, and the league-creation writer behind that page.
- Found and fixed a real **flow wall**: `dashboard/league/setup/page.tsx`
  bounced any account holding an active membership in *any* league, but its
  writer `createTenant` caps only *ownership* (one league per account). A
  fan/scorer of one league could therefore never reach the "Create your league"
  form even though the backend allows it. The page now gates on the new
  `getMyOwnedTenant()` (owned-league lookup by database UUID), matching the
  writer's cap exactly.
- The setup page's ownership-lookup failures now propagate to a new
  `league/setup/error.tsx` boundary instead of crashing to the default error
  page or silently rendering the form.
- Closed a real **one-league cap race** in `createTenant`: the ownership cap was
  a non-transactional pre-check and `tenants.owner_id` has no unique constraint,
  so two parallel submissions could both pass it and each create a league. The
  transaction now locks the actor row (`SELECT … FOR UPDATE`, the repo's
  established idiom) and re-checks ownership inside the transaction; the
  `tenants.slug` unique index is additionally surfaced through a `23505`
  unique-violation mapping (the tournaments pattern of pre-check + catch), so a
  lost slug race yields the friendly "URL already taken" error.
- Reviewed the remaining `getMyTenant` consumers without change —
  `lib/dashboard-context.ts` and `lib/rbac-server.ts` resolve host-first and
  fail closed with dedicated suites (`dashboard-context.test.ts`,
  `rbac-server.test.ts`); `api/billing/stripe/checkout` re-verifies the actor
  owns the resolved league; `updateTenantBrandingSettings` re-resolves behind
  `settings:manage`. Their fallback-primary-resolver semantics are deliberate
  and documented at each site.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 71 files, **2,111 tests** |
| `corepack pnpm --filter @mtk/database test` | PASS — 8 files, **128 tests** |
| `corepack pnpm --filter @ssl/scoring-service exec jest --runInBand --silent` | PASS — 8 suites, **193 tests** |
| Combined | **2,432 passing tests** (+13 over Batch 34) |

New regressions: `tenant-create.test.ts` (9) and `league-setup-page.test.tsx`
(4). They assert the `FOR UPDATE` actor lock and in-transaction cap re-check
(with real SQL parameters), refusal to insert when the re-check finds ownership,
slug `23505` mapping, verbatim rethrow of infrastructure errors, the
ownership-not-membership semantics of `getMyOwnedTenant`, owner bounce and
member-only form access on the page, and propagated lookup failures. Local git
`core.whitespace` was extended with `cr-at-eol` because these files are committed
with CRLF endings; no file bytes were altered for the check. Mocked SQL and a
client-mocked page are **not** PostgreSQL RLS, lock-timing or
authenticated-browser proof.

No build, lint, schema change, migration application, remote database operation or
deployment ran. `tsc --noEmit` still reports only its **19 pre-existing** error
lines. Five prior migrations remain unapplied and the release gate stays
default-off; a real `UNIQUE` constraint on `tenants.owner_id` remains the durable
fix (recorded as schema work, not guessed at without a migration window). Next
source work: public/anonymous follow hardening. No full ISO-04 or authenticated
browser claim; whole-task roadmap counts remain **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 36: repo-only guard tightened for follows and registrations

#### Implemented

- Synced clean `main` with remote `f4f1be6`. Scope is the follow/registration
  action modules and the tenant-isolation guard named in the public/anonymous
  follow work.
- Verified source: `app/actions/follows.ts` and `app/actions/registrations.ts`
  now contain **zero** direct `db` access — follows delegates entirely to the
  tenant-scoped `lib/fan-follows.ts` (Batch 23) and registrations to its
  dedicated readers/writers. Both were removed from the
  `no-unscoped-queries` allowlist, so the guard now *enforces* repo-only access
  there and fails on any future unscoped query, exactly as Batch 33 did for
  `notifications.ts`. The remaining allowlist (`matches`, `scoring`,
  `scorecards`, `player-ids`, `users-invites` + the bootstrap flows) still has
  real direct-`db` call sites (verified per file) and stays listed with its
  migration TODO.
- Re-reviewed the follow surface for the anonymous half of this task: writes
  require an active `fan:follow` membership in the exact active league; reads
  are tenant-scoped and anonymous calls read as `0`/`false`/`[]` with no
  cross-tenant or cross-account leakage; `fan-follows.test.ts` covers denial,
  UUID/enum validation, foreign-target refusal and scope assertions.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS — 71 files, **2,111 tests** |
| Combined suites | web/databases/scoring unchanged from Batch 35 (**2,432 total**) |
| `git diff --check` | Clean |

No production behavior changed in this batch; it converts an audit observation
into an enforced guard. `tsc --noEmit` still reports only its **19 pre-existing**
error lines. No build, lint, schema change, migration application, remote
database operation or deployment ran. Next source work: `matches.ts`,
`scorecards.ts`, `player-ids.ts` and `users-invites.ts` allowlist migrations, then
the remaining admin APIs. Whole-task roadmap counts remain **19 checked / 60
open / 79 IDs**.

### Batch 37 — player-ids actions become pure delegates (15 October 2026)

`app/actions/player-ids.ts` no longer touches `db` directly. All of its database
work moved to the new tenant-scoped `lib/player-id-cards.ts`
(`findExistingPlayerIdCard`, `requirePlayerInLeague`, `getLeagueSlug`,
`issuePlayerIdCard`, `revokePlayerIdCard`, `setPlayerCardExpiry`,
`listIssuedPlayerIdCards` + the `idPrefix` helper and the 200-row list bound).
The action file now keeps only the `withAuth` gate, Clerk session check, zod
validation, permission resolution, `revalidatePath` and response shaping, and
every passed `playerId`/`tenantId` pair is re-predicated inside the lib, so a
foreign-league player id can still never be issued, revoked, listed or
expiry-amended through these actions. The advisory-lock allocation transaction
(`pg_advisory_xact_lock` + `max(sequence)+1`) and its unique-violation
lost-race recovery (`23505` → return the winning card) moved to the lib intact.

`player-ids.ts` is removed from the `no-unscoped-queries` allowlist, so the
guard now **enforces** repo-style access there (remaining allowlist:
`tenants.ts`, `users.ts` bootstrap; `matches.ts`, `scoring.ts`, `scorecards.ts`,
`users-invites.ts` pending migration).

New regressions: `src/__tests__/player-id-cards.test.ts` (10 tests) asserts
league-scoped select/update parameters (`params` never contain a foreign
tenant), the list join's dual-tenant predicate, the 200-row cap, prefix
formatting rules, no-allocation on an existing card, the locked-transaction
allocation (`SSL-2026-0007` formatting, single transaction), and the
`23505` lost-race recovery. Consumer pages (`dashboard/players/id-cards`,
`components/players/player-id-actions`) keep the unchanged action signatures;
`IssuedPlayerIdCard.issueDate` is typed `Date` (Drizzle `notNull`), catching a
real `new Date(r.issueDate)` overload error in the page before it shipped.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **72** files, **2,121 tests** (+10) |
| `--filter @mtk/database test` | PASS - 128 tests (unchanged) |
| `--filter @ssl/scoring-service exec jest --runInBand --silent` | PASS - 193 tests (unchanged) |
| Combined suites | **2,442 total** (+10 over Batch 36) |
| `tsc --noEmit` | **19 pre-existing** error lines only (id-cards clean after the `issueDate` fix) |
| `git diff --check` | Clean |

(Also this session, outside the batch cadence: the linked Supabase project was
rebuilt from the canonical chain and reconciled — see
`supabase/MIGRATION_STATUS.md`, commit `58f77cf`.)

Next source work: `scorecards.ts` (7 direct-db sites), `users-invites.ts`
(12), `matches.ts` (7), then the remaining admin APIs. Whole-task roadmap
counts remain **19 checked / 60 open / 79 IDs**.

### Batch 38 — scorecards actions become pure delegates (15 October 2026)

`app/actions/scorecards.ts` no longer touches `db` directly. Its read surface
moved to the new tenant-scoped `lib/scorecard-reads.ts` (`requireScorecardMatch`,
`findScopedInnings`, `readMatchScorecards`, `readInningsScorecards` + the
`scopedInnings` exists-subquery helper); the action keeps only the `withAuth`
gate, Clerk session check, zod validation, exact-league permission resolution
and the legacy zod input schemas / `SaveScorecardInput` export. The two-write
surface stays as before: `saveScorecard` remains the exported, fail-closed
denial stub (scoring-service is the sole writer), so this batch moves reads
into the guarded lib layer with zero behavior change — the match→innings→child
hierarchy checks, the dual-key `(inningsId, matchId, tenantId)` binding, the
exists-subquery defense against legacy rows whose child tenant disagrees with
the referenced innings, and the rejects-before-any-query ordering are all
preserved verbatim.

Remaining allowlist after removal: `tenants.ts`/`users.ts` bootstrap;
`matches.ts` (7 direct-db sites), `scoring.ts` (tenant-scoped authz reads),
`users-invites.ts` (12 sites).

The existing 32 `scorecard-boundaries.test.ts` regressions (exact SQL shape,
`params` per query, call ordering, fail-closed paths) pass unchanged against
the lib-backed actions, which is the point: module-wide `@mtk/database` mocking
means the boundary contract transferred to the lib delegate without edits.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **72** files, **2,121 tests** |
| Focused: guard + boundaries + match-management | PASS - 296 tests |
| `tsc --noEmit` | **19 pre-existing** error lines only (scorecard files clean) |
| `git diff --check` | Clean |

Next source work: `users-invites.ts` (12 direct-db sites, includes the
invite-accept transaction flow), `matches.ts` (7), then the remaining admin
APIs. Whole-task roadmap counts remain **19 checked / 60 open / 79 IDs**.

### Batch 39 — users-invites flows become pure delegates (15 October 2026)

`app/actions/users-invites.ts` no longer touches `db` directly. Its entire
database surface — the four locked transactional flows and all reads — moved to
the new `lib/invite-records.ts` (`issueInviteInLeague`, `revokePendingInvite`,
`rotateInviteToken`, `claimInvite`, plus `readLeagueInvites`, `findUserByClerkId`,
`findInviteByTokenHash`, `findPendingInvitePreview`, `recordEmailAttempt` and the
private `lockInvitationAuthority` / `auditInvite` helpers). The action keeps only
the `requireManager` authority gate, zod validation, token crypto (`randomBytes`
+ SHA-256 `hashToken`), the Resend dispatch (`sendInviteEmail` — intentionally
outside the transactions, preserving the no-network-under-locks design), the TTL
constant and response shaping.

Every ordering-sensitive property transferred verbatim: the FOR UPDATE lock
ordering (users → tenants → memberships, sorted-id deadlock avoidance, issuance
FOR UPDATE vs read FOR SHARE), the second-look re-verification under lock, the
`UNIQUE`-safe claim predicate on the invite UPDATE, the membership-role
no-promotion check, the single-management-team rule, insert order
(userTenantRoles → auditLogs → notifications), and audit payloads.

Deliberate type upgrade: `issueInviteInLeague` takes `InvitableRole`
(`"team_manager" | "coach" | "scorer"`), matching the now-real enum column on
`user_invites` (post-rebuild Drizzle enums reject bare `string` comparisons) and
the zod-narrowed input, so the compiler enforces what the policy asserted.

Remaining allowlist after removal: `tenants.ts`/`users.ts` bootstrap;
`matches.ts` (7 direct-db sites); `scoring.ts` (tenant-scoped authz reads).

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **72** files, **2,121 tests** |
| Focused: guard + membership-invites | PASS - 124 tests (105 invite regressions unchanged) |
| `tsc --noEmit` | **19 pre-existing** error lines only (invite files clean) |
| `git diff --check` | Clean |

Next source work: `matches.ts` (7 direct-db sites, includes the
`withTenantContext` transaction for create/update), then the remaining admin
APIs. Whole-task roadmap counts remain **19 checked / 60 open / 79 IDs**.

### Batch 40 — matches actions become pure delegates (15 October 2026)

`app/actions/matches.ts` no longer touches `db` directly. Its reads and the
scorer-assignment writer moved to the new tenant-scoped `lib/match-records.ts`
(`findTenantMatch`, `readMatchFormOptions`, `listTenantMatches`,
`listTenantScorers`, `assignScorerInMatch` + the `MatchStatus`/`MatchListFilters`
types); `withTenantContext` moved inside the lib functions so the action holds
only gates. The action keeps the zod schemas (and `CreateMatchInput`/
`MatchFilters` exports), `requireMatchTenant`, Clerk checks, `revalidatePath`
shaping, and its existing delegations: lifecycle commands to
`lib/match-management.ts` (`manageMatch`), toss/start to
`lib/match-lifecycle.ts`, `endMatch` still proxies to scoring-service and never
writes results locally.

The `assignScorerInMatch` transaction transferred verbatim: match FOR UPDATE →
sorted-id users FOR UPDATE → league FOR SHARE → ordered memberships FOR UPDATE,
under-lock owner re-verification, active-scorer membership check on the target,
the both-slots-distinct rule, no-op short-circuit, preconditions-in-predicate
UPDATE, `read committed` isolation, and the MATCH_SCORER_ASSIGN audit with
before/after payload.

Deliberate typing: `MatchListFilters.status` mirrors the real `matches` enum
(post-rebuild), so the zod-validated filter narrows exactly into
`eq(matches.status, …)`.

The allowlist is now at its floor: `tenants.ts`/`users.ts` (bootstrap) and
`scoring.ts` (writes proxy to scoring-service; remaining selects are
tenant-scoped authz reads). Every other action file delegates to lib/ or
repo-style writers.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **72** files, **2,121 tests** |
| Focused: guard + management + assignment + concurrency + lifecycle | PASS - **410 tests** (all unchanged) |
| `tsc --noEmit` | **19 pre-existing** error lines only (match files clean) |
| `git diff --check` | Clean |

Next source work: `scoring.ts` is the only remaining allowlist entry — decide
whether an explicit opt-out (e.g. `unscoped()` marking) or a repo read-layer fits
its authz selects; then the remaining admin-API audit items. Roadmap counts
remain **19 checked / 60 open / 79 IDs**.

### Batch 41 — scoring actions become pure delegates; allowlist reaches its floor (15 October 2026)

`app/actions/scoring.ts` no longer touches `db` directly. All of its reads moved
to the new tenant-scoped `lib/scoring-reads.ts` (`findScoringTenant`,
`readInningsForCommand`, `findInningsId`, `findScoringMatch`,
`readMatchScoringBatch`, `readMatchPlayersForScoring`, `readBallHistory`); the
action keeps the zod schemas (and `RecordBallInput`/`CreateInningsInput`
exports), `requireTenant` gating, Clerk checks, `requireMatchScoringAccess`/
`requireScoringActorId`, the scoring-service proxy calls and response shaping.

The migration kept every semantic verbatim: the innings gate that predicated
`recordBall`/`completeInnings`/`getBallHistory` on `(inningsId, matchId,
tenantId)` (the third having been the historical tenant-scope fix), the
match→canScore→batch ordering of the scoring page, the 60-ball recency bound,
the match-players two-tenant predicate, and the exact WHERE-parameter sequence
the `scoring-actions` regression asserts. All writes still belong to the
scoring-service SoT — this batch moved **reads only**, so the option to
introduce an explicit `unscoped()`-style opt-out for `scoring.ts` became
moot: a read-layer was both possible and consistent.

**The `no-unscoped-queries` allowlist is now at its floor:** `tenants.ts` /
`users.ts` bootstrap only (the pre-context first-tenant/actor provisioning).
Every other action file is guard-enforced repo/lib-only. The five-batch sweep
(37–41) retired the last direct-`db` action files with zero behavior change
and zero edits to existing test suites.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **72** files, **2,121 tests** |
| Focused: guard + scoring actions/access/hydration | PASS - **68 tests** (all unchanged) |
| `tsc --noEmit` | **19 pre-existing** error lines only (scoring files clean) |
| `git diff --check` | Clean |

Next source work: the remaining admin-API audit items from the master plan; the
allowlist sweep is complete. Roadmap counts remain **19 checked / 60 open /
79 IDs**.

### Batch 42 — admin leagues API: lib reader, gate regressions (15 October 2026)

First pass over the remaining admin-API surface (`app/api/**`, previously the
only untested tier). `GET /api/admin/leagues` — the super-admin platform
league list consumed by `branding-settings` — was extracted: the read moved to
the new `lib/admin-reads.ts` (`listAllLeaguesForAdmin` +
`adminLeagueListLimit = 500`, identical field projection and newest-first
ordering); the route now holds only the auth→`isSuperAdmin` gate, the read and
its error mapping. The query is no longer unbounded (was `select … order by`
with no limit).

New regressions, previously absent for this tier:

- `admin-leagues-route.test.ts` (5): 401 before any role check, 403 without a
  read, super-admin 200 with the exact 7-field projection, logged 500 on a
  read failure, and the documented list bound/newest-first order.
- `super-admin.test.ts` (10): the platform-role gate grants only an *active*
  `super_admin` row, denies any other role or inactive account, denies on
  database failure (fail closed), denies unauthenticated sessions before any
  query, and pins the `SUPER_ADMIN_EMAIL` fallback to **non-production only**
  and to the case where no account row exists (a live row always decides).

Cross-tenant here is by design — the boundary is the `isSuperAdmin` gate, not a
tenant predicate; that is exactly why its fail-closed behavior now has
regressions.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **72** files, **2,136 tests** (+15) |
| `tsc --noEmit` | **19 pre-existing** error lines only (admin files clean) |
| `git diff --check` | Clean |

Next source work: continue the admin-API tier audit (impersonation session/exit,
`settings/branding`, `cron/subscription-renewal` writes, `billing/stripe`
checkout reads — all still direct-db with no tests). Roadmap counts remain
**19 checked / 60 open / 79 IDs**.

### Batch 43 — impersonation routes: atomic claim + first regressions (15 October 2026)

Second pass over the admin-API tier: `GET /api/impersonation/session` and
`POST /api/impersonation/exit` (previously untested, and the session route
carried a real duplicate-use race).

**Fix — atomic single-use claim.** The old flow read the ledger row with
`status = "issued"` and *later* updated it by `jti` alone, so two concurrent
redemptions of one token could both observe `issued` and both proceed. The new
`lib/impersonation-ledger.ts` claims the row in a single `UPDATE … WHERE jti
AND status = "issued" RETURNING` — the status transition is the predicate, so
exactly one redemption wins and the loser sees the same 409 as a reused token.
`revokeImpersonationSession` likewise only transitions live sessions
(`issued`/`active`), so the ledger never re-stamps an existing revocation;
`findImpersonationTarget` is the cosmetic display lookup. Routes keep token
shape/errors/status codes; the exit route keeps clearing its cookie on every
path — success, invalid token, and error — which the regressions now pin.

New regressions: `impersonation-routes.test.ts` (11) — 400 missing token before
any work; 401 surfacing the token-verify reason before the ledger; the atomic
claim (`status = "issued"` inside the UPDATE predicate) with the identity
body, httpOnly/lax 30-minute cookie value `{ email, jti }`; 409 without a
cookie when the claim loses (incl. concurrent redemptions); 500 fail-closed
without a cookie on ledger errors; exit revoking only live sessions
(predicates carry `issued`/`active`), ignoring invalid tokens, and clearing
the cookie in all four paths.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **74** files, **2,147 tests** (+11) |
| Focused: impersonation routes | PASS - 11 tests |
| `tsc --noEmit` | **19 pre-existing** error lines only (impersonation files clean) |
| `git diff --check` | Clean |

Next source work: continue the admin-API tier audit (`settings/branding` write,
`cron/subscription-renewal` transaction, `billing/stripe/checkout` reads,
`webhooks/stripe`). Roadmap counts remain **19 checked / 60 open / 79 IDs**.

### Batch 44 — Stripe billing: serialized intents, verified extraction, regressions (15 October 2026)

Third pass over the admin-API tier: `POST /api/billing/stripe/checkout` and
`POST /api/webhooks/stripe` (both previously untested, direct-db routes).
Cross-checked against current Stripe guidance (context7): PKR is a
**two-decimal** currency (paisa ×100 in checkout, ÷100 at settlement — the
arithmetic was already consistent; the old "zero-decimal" comment was wrong and
is fixed), and the manual `t=`/`v1` signature scheme already matched Stripe's
documented HMAC-SHA256 + five-minute-tolerance verification.

**Fix — checkout duplicate-creation race.** Two concurrent owner POSTs could
both pass the pending-check before either inserted, minting two Stripe sessions
and two live `subscription_requests`. New `lib/stripe-billing.ts` creates the
intent inside one transaction that first takes a `FOR UPDATE` lock on the tenant
row and re-checks for a pending request under the lock; the loser now gets 409.
The Stripe HTTP call stays outside the transaction (no network under locks) and
still rejects the intent (`markIntentRejected`) when session creation fails;
`attachIntentCheckoutUrl` stores the session URL as the payment reference.

**Webhook.** `verifyStripeSignature` is extracted as a pure function implementing
Stripe's signed-payload scheme exactly (constant-time compare across every
`v1`, ±300 s timestamp tolerance); `settleCheckoutCompleted` keeps the
settlement transaction verbatim — `SELECT … FOR UPDATE`, pending-window expiry,
amount verified against `PLAN_PRICES`, claim via `UPDATE … WHERE status =
"pending" RETURNING` (idempotent against Stripe's duplicate deliveries), plan
upgrade + subscription upsert + payment row; unknown plans / mismatched amounts
throw so Stripe retries. `expireCheckoutSession` re-predicates the expired event
on `status = "pending"`. Routes are thin wrappers; error mapping is unchanged
(400 bad signature, 500 transient failure → retry, 501 unconfigured).

New regressions: `stripe-billing.test.ts` (16) — signature accepts valid and
multi-`v1` headers, rejects tampered body / wrong secret / stale timestamp /
missing header; intent creation asserts the tenant lock + insert values and the
conflict path with no insert; settlement pins ignore-on-missing-reference,
`already_resolved` short-circuit without writes, pending-window expiry,
amount-mismatch and invalid-price rejection, the full settle path (claim
predicate, plan update, subscription insert/update, payment row), and
pending-only expiry.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **76** files, **2,163 tests** (+16) |
| Focused: stripe billing | PASS - 16 tests |
| `tsc --noEmit` | **19 pre-existing** error lines only (stripe files clean) |
| `git diff --check` | Clean |

Next source work: `settings/branding` unscoped write and
`cron/subscription-renewal` unattended transaction close out the admin/API tier.
Roadmap counts remain **19 checked / 60 open / 79 IDs**.

### Batch 45 — branding + renewal cron: validated writes, tested sweep (15 October 2026)

Final pass over the admin/API tier: `GET/PUT /api/settings/branding` (previously
ran super-admin-gated but unvalidated, direct-db reads/writes) and
`GET /api/cron/subscription-renewal` (untested, unattended transaction sweep).

**Branding.** New `lib/branding-settings.ts`: `brandingPlanViolation` is the
pure white-label/custom-domain gate (free/starter cannot set gated fields or a
custom domain; pro cannot set a custom domain; enterprise passes — verified
against `getPlanLimits`); `saveBrandingSettings` applies settings in one
transaction that locks the tenant row `FOR UPDATE` and reads the plan under the
lock, so a concurrent plan change (e.g. a Stripe settlement downgrade) cannot
race a white-label write past the gate. The custom-domain update and the
branding upsert (`tenantId` is the table's primary key, so no silent
duplicates) stay in that transaction; gating answers before any write. The
route now zod-validates the PUT body (`400 Invalid input` instead of writing
untrusted raw JSON strings into every column) and maps
missing → 404 / violation → 403 with the unchanged client-facing messages.
GET shape is unchanged (`branding` row spread plus `customDomain`).

**Renewal cron.** New `lib/subscription-renewal.ts` holds the sweep verbatim:
notify pass with day-range buckets and the 36 h idempotency guard, `past_due`
flip only for `active` rows, and the unbounded enforce pass whose pause is
claimed via `UPDATE … WHERE id AND status IN (live) RETURNING` so a concurrent
sweep cannot double-downgrade; the tenant downgrade shares that transaction.
`secretsMatch`, `daysUntil`, `fillTemplate`, `GRACE_DAYS` are exported pure.
The route is now only the fail-closed auth gate (unset `CRON_SECRET` → 503,
constant-time bearer comparison → 401) plus response shaping.

New regressions: `branding-settings.test.ts` (9) — gating matrix, read shapes,
locked save paths (missing tenant / violation-before-writes / insert with
domain / update-in-place) and `subscription-renewal.test.ts` (15) — pure
helpers, bucket insert with filled templates, `past_due` flip rules,
idempotent skip, transactional pause+downgrade with the claim predicate, lost
races leaving the tenant untouched, and the cron route's 503/401/200/500 gate.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **78** files, **2,187 tests** (+24) |
| Focused: branding + renewal | PASS - 24 tests |
| `tsc --noEmit` | **19 pre-existing** error lines only (new files clean) |
| `git diff --check` | Clean |

Next source work: the admin/API tier is complete. Candidate next batches:
remaining untested API routes (e.g. `dns/verify`, `email/verify`), or returning
to the roadmap register. Roadmap counts remain **19 checked / 60 open / 79 IDs**.

### Batch 46 — domain verification trio: DKIM redaction, validated inputs (15 October 2026)

The custom-domain trust surface: `GET/POST /api/dns/verify`,
`GET/POST /api/email/verify` and `GET /api/ssl/status` — previously untested
direct-db routes with unvalidated inputs.

**Fix — DKIM private key no longer leaves the server.** Both `email/verify`
endpoints returned the full verification row **including the DKIM RSA private
key** (`dkimPrivateKey`, PKCS#8 PEM) to the HTTP client — gratuitously, since
the admin UI renders only `dkimPublicKey`/`dkimSelector` and the mail service
reads the key from the DB. New `lib/domain-verification.ts` returns responses
through `toClientEmailVerification`, which omits the private key while keeping
every published-record field. Key generation/rotation semantics are unchanged
(new RSA 2048 pair on every POST, 90-day expiry; DNS tokens rotate on every
POST with a 7-day window).

**Extraction (verbatim behavior otherwise).** `canManageTenantDomain`
(super admin or exactly the league owner), DNS TXT check, email
SPF/DMARC/DKIM triple-check (all three required), verification upserts, the
two-row "verified" transitions (verification row + tenant flag) and the SSL
certificate read all move to the lib. Routes become thin wrappers with
zod-validated inputs (`400` on a malformed domain/tenantId/senderEmail instead
of storing arbitrary strings), keeping every status code and client-facing
message (401/403/404/409/500).

New regressions: `domain-verification.test.ts` (17) — owner/super-admin
authority matrix, TXT token matching (including the honest pinned boundary
that a token split across 255-byte chunks does **not** reassemble, fixed
fail-closed behavior on resolver errors, and unsupported types), the all-three
email-record requirement with per-record failure isolation, the private-key
redaction contract, DKIM key-pair publishability, DNS mint insertion/rotation,
two-row verified writes, and the route gates (401/400/403/409).

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **79** files, **2,204 tests** (+17) |
| Focused: domain verification | PASS - 17 tests |
| `tsc --noEmit` | **19 pre-existing** error lines only (new files clean) |
| `git diff --check` | Clean |

Next source work: remaining direct-db API routes (`auth/otp/send|verify`,
`webhooks/clerk`, `payments/upload-proof`, `subscriptions/request`) or the
roadmap register. Roadmap counts remain **19 checked / 60 open / 79 IDs**.

### Batch 47 — OTP flows: brute-force-cap race fixed, tested (16 October 2026)

The OTP entry points `POST /api/auth/otp/send` and `POST /api/auth/otp/verify`
previously ran untested direct-db flows. The zod schemas, constants and helpers
from `lib/otp` were already sound — the verify flow had a real race: the
wrong-attempt counter was **read-then-written**, so two concurrent wrong
guesses could both pass the `attempts >= maxAttempts` check and both increment,
pushing the counter past the brute-force cap.

New `lib/otp-verification.ts`:
- `sendOtp` holds the hourly rate-limit (`OTP_MAX_PER_HOUR` per
  identifier+purpose), the resend cooldown, hashed-token minting inside the TTL
  and dispatch — returning a discriminated result the route maps to
  429/200 (messages unchanged).
- `verifyLatestOtp` keeps the latest-unverified-unexpired selection and the
  exhausted fast path, but claims the wrong-attempt increment optimistically:
  `UPDATE … SET attempts = attempts + 1 WHERE id AND maxAttempts > attempts
  AND attempts = <observed> RETURNING attempts`. A concurrent loser gets an
  empty result and is answered `exhausted` (429) — the counter can now reach
  exactly `maxAttempts`, never beyond it. Correct codes still mark
  `verifiedAt` (single-use via the `verifiedAt IS NULL` selection filter).
- Caught while testing: the lib initially referenced `OTP_MAX_PER_HOUR`
  without importing it — the new suite failed it immediately.

Both routes are thin wrappers; response shapes, status codes and messages are
unchanged. New regressions: `otp-verification.test.ts` (11) — mint
values/expiry window, rate-limit and cooldown paths (incl. cooldown expiry
recovery), not-found/exhausted fast paths, verified stamping, the predicated
increment (with the optimistic-clause params pinned), the lost-race 429, and
the route mappings (400/429/200).

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **80** files, **2,215 tests** (+11) |
| Focused: OTP flows | PASS - 11 tests |
| `tsc --noEmit` | **19 pre-existing** error lines only (new files clean) |
| `git diff --check` | Clean |

Next source work: remaining direct-db API routes (`webhooks/clerk` (already
Svix-verified — needs regressions only), `payments/upload-proof`,
`subscriptions/request`) or the roadmap register. Roadmap counts remain
**19 checked / 60 open / 79 IDs**.

### Batch 48 — manual billing + proofs + clerk sync: last direct-db routes (16 October 2026)

The final three direct-db API routes, closing the API tier.
`webhooks/clerk` was already correct (Svix-verified with fail-closed secret
handling and conflict-aware upserts) and gains regression coverage only.

**Fix — manual request duplicates.** `POST /api/subscriptions/request` (the
bank/jazzcash/easypaisa sibling of the Stripe checkout) had the same
read-then-insert race: two concurrent owner submissions could both pass the
pending-check and mint two live `subscription_requests`. New
`lib/subscription-requests.ts` creates the request in one transaction that
locks the tenant row `FOR UPDATE` and re-checks pending under the lock
(loser → 409), with the 7-day expiry computed inside the transaction. It also
dedupes the route's redundant double `users` lookup into
`findOwnedTenant` (discriminating user-missing vs league-missing so the
distinct 404 messages survive, e.g. "Create a league first."). The receipt
allow-list (origin + `/storage/v1/object/sign/payment-proofs/receipts/<user>/`
+ required token) is kept byte-for-byte. `GET` stays bounded (20, newest first).

**Proof uploads.** `lib/payment-proof.ts` extracts the pure primitives —
magic-byte sniffing (JPEG/PNG/GIF/WebP), hostile-filename sanitization and the
uploader-namespaced storage path — for direct regression; the route keeps the
flow (declared-type allow-list, 5 MB cap, sniff-is-authority check, private
bucket, 7-day signed URL, 503 fail-closed without service credentials).

New regressions: `subscription-requests.test.ts` (6) — owned-tenant resolution
(distinct missing-reasons), locked creation values/expiry, conflict without
insert, bounded history; `payment-proof.test.ts` (5) — magic bytes
(incl. RIFF-without-WEBP and truncated headers), sanitization alphabet
(no separators survive), name cap, namespaced path; `clerk-webhook.test.ts`
(8) — health alias, fail-closed 500 without a secret, 400 on missing
Svix headers and bad signature without any write, `user.created` fan-account
insert values (conflict set without login backfill), username fallback +
`lastLoginAt` on update, `user.deleted` soft-delete predicate, ignored events.

#### Verification recorded

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @mtk/web test` | PASS - **83** files, **2,233 tests** (+18) |
| Focused: requests/proofs/clerk | PASS - 18 tests |
| `tsc --noEmit` | **19 pre-existing** error lines only (new files clean) |
| `git diff --check` | Clean |

Next source work: the API tier is fully covered. Remaining register items are
product slices (fixtures/advancement, member UI, records) or environment-
dependent acceptance. Roadmap counts remain **19 checked / 60 open / 79 IDs**.

### Batch 49 — fixture generation: approved registrations to planned fixtures (16 October 2026)

COMP-04 groundwork. No fixture generation existed anywhere before this batch;
matches were create-one-at-a-time forms.

**Pure planners — new `lib/fixture-planning.ts`.** Deterministic registration
ranking (earliest approval = seed 1, untimed approvals last, team-id
tie-break); seed binding `resolveSeededSlots` (a saved bracket-slot
permutation maps seed rank → slot; fail-closed on invalid permutations,
strict mode blocks mismatched lengths so knockout brackets are never
silently re-seeded, group formats fall back to ranking with the fallback
recorded in the audit); league single round-robin via the circle method
(Berger tables — every pairing exactly once, one match per team per round as
the structural rest check, byes for odd counts); knockout first-round
planning with standard top-vs-bottom seeding and stage labels
(final/semi_final/quarter_final/knockout for 2/4/8/16/32 only); hybrid
group-stage planning (balanced snake-distributed groups of ≤ 4 with complete
group round-robins; the knockout stage waits for standings, one qualifier per
group per the wizard's documented assumption).

**Locked writer — new `lib/fixture-generation.ts`.**
`generateTournamentFixtures` runs in one `read committed` transaction:
account → league/membership shares → tournament row `FOR UPDATE` → re-checks
(archived/completed blocked, any pre-existing fixture blocks regeneration —
the row lock makes concurrent generations race-free), wizard configuration
required (`readTournamentConfiguration`), ≥ 2 approved teams and capacity
enforced, knockouts restricted to power-of-two counts (checked before
seeding so a wrong count never masquerades as a seeding problem), every
slotted team verified present and active. Persists scheduled matches with
sequential `matchNumber` and format-derived `matchType`/`matchFormat`/
`totalOvers`; match dates are deliberately left unscheduled (rescheduling is
COMP-07). Creating fixtures starts the competition: tournament → `live`,
registration closed, audited as `TOURNAMENT_FIXTURES_GENERATE` with
before/after, counts and whether the saved seed order applied. New server
action `generateFixtures` (permission `match:create`) delegates with both
dashboard revalidations.

New regressions: `fixture-planning.test.ts` (16) — ranking order, seed
binding (identity/permutation/invalid/strict-mismatch), round-robin
properties for 3/4/6/7/10 teams, knockout labels and standard pairings,
power-of-two gate, hybrid balance/caps; `fixture-generation.test.ts` (14) —
lock order, archived/duplicate/missing-config/small/capacity/inactive-team
fail-closed gates, league happy path (values, bindings, numbering, live
transition, audit), seed order applied vs stale fallback, live-tournament
no-op transition, knockout first round/counts/strict seeding, hybrid groups;
`tournament-actions.test.ts` (+2) — action permission mapping and
delegation. Group labels are intentionally not persisted (the matches table
has no group column) — they live in the returned rounds/plan where needed.

#### Verification recorded

| Command | Result |
| --- | --- |
| `npx vitest run` (web) | PASS — **85** files, **2,265 tests** (+32) |
| Focused: planning/generation/actions | PASS — 87 tests |
| `tsc --noEmit` | **19 pre-existing** error lines only (new files clean) |
| `git diff --check` | Clean |

Next source work: advancement + standings (COMP-05) — shared points/NRR/
tie-breaker module replacing the inline standings in both tournament pages,
and a locked advancement writer that creates knockout rounds from group
standings and transitions live → completed. Then COMP-06/07 (eligibility,
toss, rescheduling) or the remaining smaller product IDs. Roadmap counts:
**19 checked / 60 open / 79 IDs** (COMP-04 partially closed — generation done,
binding-to-UI surfaces still to wire).

### Batch 50 — standings/NRR/tie-breakers + knockout advancement (16 October 2026)

COMP-05 core. Both tournament pages previously carried separate inline
standings (the public one didn't even count no-results or break ties by name).

**Pure rules module — new `lib/standings.ts` (rules version 1).** One shared
computation: a fixture is played when `completed` or `no_result` (abandoned/
scheduled/live excluded — rescheduling is COMP-07); 2 points win / 1 point
no-result-or-undecided / 0 loss; cricket NRR = (runs/balls faced) − (runs/
balls bowled) aggregated over counted fixtures, only when BOTH sides' innings
rows exist so voided innings can't skew it, with teams lacking evidence
sorting after evidenced teams at equal points; tie-breaks points → NRR →
wins → name; `formatNetRunRate` follows broadcast convention (signed, 3
decimals). The dashboard page now collects match+innings inputs in its
existing loop and computes via the module (new NRR column with positive/
negative coloring and "—" without evidence); the public page uses the same
module (compact P/W/L/Pts columns unchanged, better tie-breaks). Group-wise
tables need a group column on matches which doesn't exist — computation is
tournament-wide, recorded honestly.

**Locked advancement writer — new `lib/tournament-advancement.ts`.**
`planKnockoutAdvancement` (in `fixture-planning.ts`, pure) derives the next
stage from existing fixtures: a stage is always created atomically, so the
fixture count uniquely identifies the bracket size and progress (cumulative
prefix sums are distinct across 2/4/8/16/32 chains) and the next round pairs
stage winners mirror-wise (early v late), keeping top seeds apart classically.
Fail-closed on empty/undecided/no-result fixtures, inconsistent numbering and
non-chain counts. `advanceKnockoutTournament` persists the next stage in one
`read committed` transaction (same owner→league→tournament-row lock family,
fail-closed on non-live tournaments, continues match numbering, reuses wizard
config for format/overs) and — when the final is decided — transitions the
tournament live → completed via a claim-locked update that can never touch a
cancelled tournament, all audited as `TOURNAMENT_ADVANCE`. New
`advanceTournament` action (`match:create`) and an `AdvanceTournamentButton`
on the dashboard (knockout + live + permission gated) with stage/completion
toasts.

**Honest limits:** advancement supports knockout format only — hybrid
group→knockout progression needs persisted group labels (matches has no group
column); result-correction effects and rescheduling remain COMP-07.

New regressions: `standings.test.ts` (11 — points mapping, excluded statuses,
NRR aggregation over balls, missing-innings handling, tie-break order,
formatting), `fixture-planning.test.ts` (+5 — mirror pairings for 8/16-team
chains, final creation, completion, non-chain/undecided/no-result/numbering
gates), `tournament-advancement.test.ts` (8 — lock order, gates (draft/
archived/non-knockout/idempotent-completed/undecided/no-result), next-stage
creation with continuing numbers + audit, completion transition),
`tournament-actions.test.ts` (+1 — advance delegation).

#### Verification recorded

| Command | Result |
| --- | --- |
| `npx vitest run` (web) | PASS — **89** files, **2,289 tests** (+24) |
| Focused: standings/planner/advancement/actions | PASS — 97 tests |
| `tsc --noEmit` | **19 pre-existing** error lines only (new files clean) |
| `git diff --check` | Clean |

Next source work: COMP-06 (eligible XI/official approval, toss, match
readiness) and COMP-07 (rescheduling, forfeits/disputes, competition locks);
then member UI + records pages, feed/media, and the environment-dependent
acceptance batches that this workspace cannot complete without the Supabase
auth user and real-DB staging (Phase 0 BASE-04..06 and Phase 9 REL-01..07).
Roadmap counts: **19 checked / 60 open / 79 IDs** (COMP-05's core computed
rules are in — reviewed result-correction effects remain open).

### Batch 51 — fixture rescheduling behind rest/venue checks (16 October 2026)

COMP-07 slice (rescheduling). The generic metadata `updateMatch` could change
`scheduledDate` with no scheduling rules at all; unstarted fixtures could be
booked on top of each other.

**Pure checks — new `lib/rescheduling.ts` (rule v1).** A proposed start must
keep `DEFAULT_MIN_REST_HOURS = 4` of separation from every other uncancelled
fixture of either participating team (`team_rest`) and from any other use of
the same venue (`venue_in_use`). Threshold-based rather than duration-based
because matches carry no duration column; the target fixture itself,
cancelled fixtures and undated fixtures are exempt, and a custom stricter
window can be supplied per call. Negative thresholds are rejected.

**Locked writer — `match-management` gains a `reschedule` command** (exported
as the `rescheduleMatch` action, permission `match:update`): the same
account→league→membership→match-row locks, only an unstarted scheduled
fixture (via `requireUnstarted`), the league's other fixtures read in the
same transaction and checked with the pure planner, and a dedicated
`MATCH_RESCHEDULE` audit name so a reschedule is never confused with generic
metadata edits in the audit trail. Generic `updateMatch` remains available
for team/venue/metadata edits — it no longer changes dates through
rescheduling-grade checks, so the scheduling rule has exactly one doorway.

**Honest limits:** the rule is a rest-window heuristic, not a full
fixture-duration model (no duration column); venue checks reuse the same
window; no UI surface yet — the action is the contract, UI wiring lands with
the matches management slice.

New regressions: `rescheduling.test.ts` (7 — both conflict reasons, window
boundaries, exemptions, custom window, negative threshold),
`match-management.test.ts` (+4 — audited move, team-rest block, venue block,
unstarted-only gate, all write-free on rejection).

#### Verification recorded

| Command | Result |
| --- | --- |
| `npx vitest run` (web) | PASS — **88** files, **2,300 tests** (+11) |
| Focused: rescheduling + match-management | PASS — 256 tests |
| `tsc --noEmit` | **19 pre-existing** error lines only (new files clean) |
| `git diff --check` | Clean |

Next source work: forfeits/disputes and competition locks/notices (COMP-07
remainder — needs schema decisions record cleanly), eligible XI/toss
readiness (COMP-06), member UI + records pages; then the environment-
dependent acceptance batches that this workspace cannot complete without the
Supabase auth user and real-DB staging (Phase 0 BASE-04..06, Phase 9
REL-01..07). Roadmap counts: **19 checked / 60 open / 79 IDs** (rescheduling
closed inside COMP-07; locks/notices/forfeits remain open).

### Batch 52 — squad eligibility on the scoring player list (16 October 2026)

COMP-06 slice. Toss decisions were already complete (pre-match `setTossResult`
plus in-scoring flow — covered by earlier regression suites); officials
approval and a match-readiness dashboard need schema decisions, so they stay
open. The reachable gap was squad enforcement: tournaments declare
`squadPlayerIds` at registration approval, but the scoring player selectors
still offered every active roster player.

**Rule v1 — new pure `lib/squad-eligibility.ts`.** When an approved
registration declares a NON-EMPTY squad, the team's scoring player list is
filtered to it; empty/null squads (legacy approvals) and non-tournament
friendlies keep the full active roster. Ordering preserved; fail-safe by
design so legacy competitions stay playable.

**Read wiring — `readMatchPlayersForScoring`** now resolves the match's
tournament link, reads both sides' approved registrations (tenant- and
tournament-scoped, `inArray` team sides) and applies the filter per side
before returning. Selection-time enforcement is where scorers actually pick
players; the delivery writers' accept-anything behaviour is recorded honestly
as a remaining server-side-enforcement gap (needs the scoring-service
contract, not a UI fix).

New regressions: `squad-eligibility.test.ts` (6 — declared-squad filtering
per side, friendly matches, legacy empty squads, missing approvals,
not-found, plus the pure filter cases).

#### Verification recorded

| Command | Result |
| --- | --- |
| `npx vitest run` (web) | PASS — **89** files, **2,306 tests** (+6) |
| `tsc --noEmit` | **19 pre-existing** error lines only (new files clean) |
| `git diff --check` | Clean |

Next source work (COMP-06 remainder): officials approval + match-readiness
dashboard (schema decisions needed), server-side XI enforcement in delivery
writers (scoring-service contract); COMP-07 remainder: forfeits/disputes,
competition locks and scoped notices (schema). Then member UI + records; the
environment-dependent acceptance batches (Phase 0 BASE-04..06, Phase 9
REL-01..07) still cannot close without the Supabase auth user and real-DB
staging. Roadmap counts: **19 checked / 60 open / 79 IDs**.

### Batch 53 — match readiness checklist (16 October 2026)

COMP-06 slice (readiness dashboard). The match detail page showed status and
controls but nothing told an owner whether a fixture was actually playable:
missing venue/date, no scorer, a half-declared squad or a missing toss all
surfaced only as surprises.

**Pure rules — new `lib/match-readiness.ts` (rule v1).** Six computed checks:
date and venue are blocking (the fixture must be playable); the toss blocks
once the match has moved past `scheduled`; scorer assignment, umpire listing
and — for tournament fixtures — squad declaration are advisory in v1. Squad
declaration semantics match Batch 52: a registration that exists but declares
no players fails the check (owner started, didn't finish); no registration at
all is legacy "unknown" and never fails. `ready` = every blocking check
passes. Formal official APPROVAL remains open (schema decision).

**UI wiring — new `MatchReadinessCard`** on the dashboard match detail page:
badge (`Ready` / `Not playable` / `Almost there`) plus a two-column checklist
(pass / blocking-fail / advisory-recommended icons). The page resolves squad
declaration state from the teams' approved registrations in one query.

New regressions: `match-readiness.test.ts` (6 — blocking vs advisory, toss
gating by status, backup-s scorer satisfaction, squads semantics,
empty-string officials).

#### Verification recorded

| Command | Result |
| --- | --- |
| `npx vitest run` (web) | PASS — **90** files, **2,312 tests** (+6) |
| `tsc --noEmit` | **19 pre-existing** error lines only (new files clean) |
| `git diff --check` | Clean |

Next source work: officials approval + server-side XI enforcement (schema /
scoring-service contracts), COMP-07 remainder (forfeits/disputes, competition
locks and scoped notices — schema), member UI + records. Environment-
dependent acceptance (Phase 0 BASE-04..06, Phase 9 REL-01..07) still cannot
close without the Supabase auth user and real-DB staging. Roadmap counts:
**19 checked / 60 open / 79 IDs**.

### Batch 54 — member management leaves the action tier (16 October 2026)

ISO-04 consolidation. `app/actions/users.ts` was the last action file that still ran
direct `db` queries; the `no-unscoped-queries` allowlist had recorded it as a "Clerk
session sync" bootstrap, but the file had become the league member-administration module
(roster read, role/status change, removal).

That logic moves to a tenant-scoped `lib/member-management.ts`: the bounded
`readLeagueMembers` roster read (deterministic order, `LIMIT 100`), `updateMemberRole` /
`toggleMemberStatus` (locked, version-compared, audited `MEMBERSHIP_CHANGE`) and
`removeLeagueMember` (assignment-aware, audited `MEMBERSHIP_REMOVE`). Lock order is
unchanged (users → league → membership) and the acting owner is still re-verified inside
the transaction after the locks. `app/actions/users.ts` keeps its exported names and
behavior and now only resolves the session/`user:manage` gate, parses input and
revalidates; the page and `UserListTable` are unchanged.

The `no-unscoped-queries` allowlist is down to `tenants.ts` (the sole genuine bootstrap),
and a new guard assertion pins `users.ts` to the lib.

New regressions: `member-management.test.ts` (6); `no-unscoped-queries.test.ts` gains the
migration assertion (19 → 20). No schema, migration, RLS, grant or deployment change, and
a mocked transaction is not PostgreSQL locking or browser proof. The web suite required the
gitignored `@mtk/observability` `tsc` output (turbo's `test` → `build` prerequisite), which
was absent here and was rebuilt with the package's own script — not an app or product build.

#### Verification recorded

| Command | Result |
| --- | --- |
| `npx vitest run` (web) | PASS — **91** files, **2,319 tests** (+7) |
| `tsc --noEmit` | **19 pre-existing** error lines only (new files clean) |
| `git diff --check` | Clean |

Next source work: officials approval + server-side XI enforcement (schema /
scoring-service contracts), COMP-07 remainder (forfeits/disputes, competition locks and
scoped notices — schema), member UI + records. Roadmap counts: **19 checked / 60 open /
79 IDs**.

### Batch 55 — member assignments visibility (IAM-02 slice) (16 October 2026)

The Members & access table showed a member's league role and status but not the operational
assignments that block a removal, even though the removal guard refuses to orphan a managed
team or an assigned scoring slot — the confirmation said "unassign those first" without
saying what.

New tenant-scoped `lib/member-assignments.ts` adds `readMemberAssignments(tenantId,
userIds)`: one bounded read of the league's managed teams (`teams.managerId`) and one of its
matches (`matches.scorerId`/`backupScorerId`), both `LIMIT 200` and both filtered by the
exact tenant, assembled into a per-account map that seeds every loaded member. A member
holding both scoring slots is recorded once (primary). An empty roster short-circuits
before querying, since `inArray([])` is invalid SQL.

`dashboard/users/page.tsx` passes the map to `UserListTable`, which gains an
**Assignments** column ("None" when clear) and, in the removal confirmation, names the
exact blockers. The prop is optional so the view still renders without assignments.

New regressions: `member-assignments.test.ts` (6) and `member-view.test.tsx` (+3). No
schema, migration, RLS, grant or deployment change; SSR/stubbed rendering is not browser
certification.

#### Verification recorded

| Command | Result |
| --- | --- |
| `npx vitest run` (web) | PASS — **92** files, **2,328 tests** (+9) |
| `tsc --noEmit` | **19 pre-existing** error lines only (new files clean) |
| `git diff --check` | Clean |

Next source work: officials approval + server-side XI enforcement (schema /
scoring-service contracts), COMP-07 remainder (forfeits/disputes, competition locks and
scoped notices — schema), then records/awards. Roadmap counts: **19 checked / 60 open /
79 IDs**.

### Batch 56 — truthful assignment completeness and actionable resources (16 October 2026)

IAM-02 follow-up after syncing clean `main` with `origin/main` at `0736dc2`.
The Batch 55 assignment list stopped after 200 rows per resource kind. A member whose
assignments were omitted could appear to have "None", even though removal would refuse.

`readMemberAssignments` now validates UUIDs and bounds the input roster to 100 accounts,
orders both exact-league reads by resource ID, and fetches one extra row to detect
overflow. Only the first 200 resources per kind are returned. If either read overflows,
all loaded members are marked incomplete because omitted rows could belong to any of
them. An exact 200-row result remains complete. Reads remain two bounded queries with
no per-member query fan-out; failures propagate.

The table no longer calls unloaded or partial assignments "None". Partial counts are
lower bounds, linked resources take the owner to existing guarded team/match pages,
and the confirmation explains that listed blockers are a snapshot, rechecked by the
unchanged removal writer. The members page now surfaces unavailable authorization
context instead of redirecting it as an ordinary denial. Confirmed denial/non-owner
redirects remain unchanged, including the settings-members alias.

Regressions: assignment reader +9 (overflow in either kind, exact boundary, input
validation and failure propagation); member view +4 (unknown/partial/escaped resources);
new `members-page.test.tsx` (14 — league-scoped wiring, alias, denial and failure paths).

Fresh verification: full web **2,355 tests / 93 files passed** (+27), process exit 0;
targeted **143 tests / 6 files passed**. Type checking still fails on **18 pre-existing
errors**, down from 19 after correcting the touched view fixture's status type rather
than using an incompatible literal cast. No new diagnostics; `git diff --check` clean. These
are mocked-query/SSR/page tests, not real PostgreSQL concurrency or browser certification.
No schema, migration, RLS, grants, providers, remote database or deployment changes.
Next: remaining IAM-02 search/pagination/detail work and PUB-03 format-qualified records.
The release gate remains default-off; roadmap stays **19 checked / 60 open / 79 IDs**.

### Batch 57 — public leaderboard minimum qualifications (16 October 2026)

PUB-03 partial slice after Batch 56. Public season-stat aggregates have no match-format
column; this batch does not infer format, certify careers or invent award policies.

`lib/leaderboard-filters.ts` centralizes validated optional minimum innings and balls
(0–10,000, default zero). Its GET parser rejects ambiguous/duplicate or malformed values;
the reader validates numeric inputs independently. Public batting/bowling queries retain
all exact-league/publication joins and predicates, and qualify summed innings/balls via
`HAVING` before the deterministic aggregate ranking and top-10 limit. Batting uses innings
batted/balls faced; bowling uses innings bowled/balls bowled.

The page provides a labelled GET form and reset link, validation and qualified-empty
states, column headers/captions, and an explicit combined-format league-season disclaimer.
Bad filters skip both ranking reads rather than broadening the query or rendering a fake
empty ranking; read failures remain visible. Thresholds are user-selected, not official
league minimums. Verified careers, format-specific records and consent remain open.

Fresh verification: full web **2,390 tests / 94 files passed** (+35), process exit 0.
Targeted parser/query/page suites passed **64 tests / 3 files**; type checking remains
at **18 pre-existing errors**, no new diagnostics; `git diff --check` is clean. Added
coverage: parser 15, query +11, page +9 (35). No schema, migration, RLS/grant, provider,
remote database or deployment change; mocked aggregate predicates are not real-DB proof.
Roadmap counts stay **19 checked / 60 open / 79 IDs**.

### Batch 58 — searchable member directory, cursor navigation and details (16 October 2026)

IAM-02 source slice. Replaced the first-100, loaded-row-only member administration
surface with owner-only exact-league server reads. New member-directory filters/readers
and action delegates validate search/role/status/UUID cursors, parameterize and escape
literal name/email search, and return 50 ID-ordered memberships plus next-cursor metadata
derived from one extra row. No OFFSET scan, per-member query fan-out or invented total.

The shared users/settings-members page gets labelled GET filters and next/first links;
filter submissions deliberately reset the cursor. Ownership recipients come from the
current results, with an explicit instruction to search/page to locate another member.
An owner-only membership detail route shows one same-league member, assignments and
the existing versioned save-confirmed controls. It 404s missing/foreign/malformed IDs
and propagates read outages. Private contact fields never become team-manager-readable.
Both existing URLs remain supported; settings members has shared loading/error states.

Fresh verification: web **2,445 tests / 98 files passed**, process exit 0 (+55);
targeted member/guard **177 / 8 files passed**; `git diff --check` clean. New query/filter
tests 19, action 14, SSR controls 4, detail page 12, existing page +5 and table +1.
Type check remains at its
18 pre-existing diagnostics, none introduced here. No schema, migration, remote database,
RLS/grant, provider or deployment change. Actual expiry/grants, database concurrency
and browser/device acceptance are still separate requirements. Docker/PostgreSQL tools
were not available through this environment's PATH/service checks.
Roadmap counts remain **19 checked / 60 open / 79 IDs**.

### Batch 59 — zero-diagnostic web TypeScript gate (16 October 2026)

Removed all 18 previously carried TypeScript errors without compiler suppression,
configuration weakening, builds or generated-file edits. Team/player list routes now
require the framework props object (tests pass `{}`); dashboard query test adapters have
explicit table/SQL/order/limit/promise types and reject missing predicates; unused imports
were removed from fan-follow tests and team analytics. A pure voice-delivery normalizer
keeps bare voice wickets in the dedicated dismissal flow, preserving numeric/extra
behavior and removing impossible comparisons after type narrowing.

Fresh verification: web **2,456 tests / 99 files**, database **128 / 8 files**, scoring
**193 / 8 suites** — **2,777 total**, all processes exit 0. `tsc --noEmit` exits **0**,
zero diagnostics; affected suites **112 tests / 4 files passed**, including 11 new voice
cases; `git diff --check` clean.
No schema, migration, RLS/grant, remote database, provider or deployment change.
This makes type checking usable as a gate; it does not certify real-DB concurrency,
browser/provider behavior or production rollout. Roadmap stays **19 checked / 60 open /
79 IDs**; canonical declared-squad enforcement is the next source priority.

### Batch 60 — canonical registered-squad enforcement (16 October 2026)

COMP-06 source slice. Declared squad filtering previously existed only in web selectors,
so a crafted canonical delivery could use an active team player outside that squad.
The shared pure `registered-squad-eligibility` policy now governs both web selection
and canonical participant validation. Existing non-approved registration states deny
eligibility rather than re-enabling the whole roster. Friendly/missing-registration and
approved null/empty legacy squads preserve the established compatibility behavior.

The canonical transaction locks side registrations by stable ID after team rows and
before player rows, with exact tenant/tournament/side predicates and a third-row corruption
bound. No tournament lock is acquired after teams. All four participant roles are checked
before effects; duplicate/mis-scoped rows and read failures fail closed. Accepted replay
still resolves its original effect before current-roster/squad checks, while a new command
after withdrawal is denied. Selectors and readiness now use the same registration state,
including known withdrawals; readiness blocks known non-approved registrations.

Missing tournament context also fails closed in writer/selector code; only an explicit
null parent means a friendly. The new shared helper requires the normal workspace package
artifact build at rollout, with web and service deployed together.

Fresh verification: web **2,473 tests / 99 files**, database **146 / 9 files**, scoring
**217 / 8 suites** — **2,836 passing tests** (+59), all processes exit 0. Web type check
also exits **0**; `git diff --check` clean. New coverage: web +17, shared policy +18,
canonical scoring +24.
No build/schema/migration, RLS/grant, remote database, provider or deployment changes.
Mocked transactions/SQL ordering are not real PostgreSQL locking or rollback evidence;
missing-row legacy fallback is not a predicate lock or immutable XI declaration.
Official approval, frozen XI/substitution history and real-DB/browser acceptance remain
open. Roadmap stays **19 checked / 60 open / 79 IDs**, release gate default-off.

### Batch 61 — publication-gated public scoring HTTP and sockets (16 October 2026)

SCORE-13/ISO-08 source slice. Canonical service HTTP state/history accepted a bare UUID;
socket joins subscribed before looking up state, and commentary/reactions bypassed the
web publication gate. This was not protected by CORS, UUID secrecy or cached state.

Added shared lifecycle policy and publication-aware service reads: exact league/match,
active league, same-league published tournament or explicit friendly; failures never
authorize. Public state/history uses fresh repeatable-read read-only transactions rather
than the internal Redis cache. History verifies innings parentage and projects bounded,
allowlisted fields without operation/actor metadata. GET routes now require `x-tenant-id`.

Socket contracts carry tenant+match; public room names include both. Joins authorize
before subscribing. State broadcasts, commentary and reactions recheck publication;
denied rooms are evicted without turning committed writes into failed acknowledgements,
even if the transport adapter is unavailable. Commentary strips unrelated event metadata.
Reactions require approved room membership/emoji and a one-second per-connection limit;
distributed anti-abuse is still open. Clients scope subscriptions/reactions, show denied
updates and preserve unconfirmed work; public custom-domain resolution also requires
active league status. The anonymous channel deliberately does not grant private access.

Coordinated rollout requires normal shared-package artifact generation, gated backend
deployment/draining of old UUID-only instances, then the new client. No rollout occurred.
Fresh verification: web **2,482 / 101 files**, database **181 / 11 files**, scoring
**262 / 10 suites** — **2,925 passing tests** (+89), all processes exit 0. Targeted web
**53 / 4 files**, policy/events **35 / 2 files**, scoring **166 / 6 suites** passed.
Web type check exits 0; `git diff --check` clean. The legacy API scoring module is
already unregistered, confirmed by source inspection; it is not a live endpoint.
No schema/migration, RLS/grant, remote database,
provider, build or deployment changes. Real multi-instance fan-out/withdrawal, browser,
consent and private socket grant acceptance are not certified. Other gateways still need
review. Roadmap **19 checked / 60 open / 79 IDs**; release gate remains default-off.

### Batch 62 — retained release evidence and exact-candidate production guard (16 October 2026)

REL-07 source foundation only. Local Docker/PostgreSQL/Bash remain unavailable, and
Supabase discovery exposed no project clearly linked to this repository. No project
schema/data/logs were queried; the rebuild was not re-certified.

Added native Node release-evidence validation: exact SHA/target, distinct staging,
18 prescribed real acceptance methods, fresh timestamps, subsequent owner approval,
bounded retained report files with SHA-256 verification, traversal/symlink rejection
and fail-closed missing/blocked/skipped/waived/mock-method handling. Integrity checks
cannot prove claims or reviewer identity. Fixtures are explicitly synthetic.

CI/manual production stays default-off, requires retained evidence, and never treats
a template as approval. CI accepts artifacts only from a successful manually dispatched
same-repository/main run for the exact SHA; validates before SSH and serializes the
job. Actual acceptance runner/uploader is still missing. VPS deployment refuses dirty
work and checks out the reviewed SHA instead of resetting/advancing to newer main.
Manual production verifies the same evidence before Docker access. Removed the
automatic Drizzle migration attempt and false success message: canonical SQL-chain
acceptance and reviewed schema rollout are separate. Removed DB credential-prefix
logging. Added blocked manifest example, operator contract and historical-guide hold.

Fresh verification: web **2,482 / 101 files**, database **181 / 11 files**, scoring
**262 / 10 suites**, native checker **87 tests** — **3,012 passing tests**, all exits 0.
Web type check exits 0; `git diff --check` clean. Both workflow YAML files parse; Bash/source/SSH contracts
are not deployed execution proof. No build, schema/migration operation, remote project
query, provider action, variable toggle, owner approval or deployment occurred. Release
acceptance remains open; roadmap **19 checked / 60 open / 79 IDs**.

### Batch 63 — durable transactional scoring outbox (16 October 2026)

SCORE-12 storage/producer half. Scoring previously published ball/intro/end events
post-commit with swallowed Kafka failures, so a broker outage or crash silently
lost events for commentary, notifications and live fan-out feeders.

Added an internal `scoring_outbox` journal written atomically with the score or
result transaction (additive local migration, unapplied): same-league composite FK
to `matches(id, tenant_id)` via a new `matches_id_tenant_key` index, unique
`(topic, event_id)` identity for redelivery dedupe, partial pending indexes,
envelope CHECKs binding tenant/match/event to the row, topic allowlist, RLS
enabled+forced with every grant revoked from PUBLIC/anon/authenticated and no
DELETE grant anywhere — pending rows are retained, never purged. The publisher
now requires all-replica acks (`acks -1`), one in-flight send, bounded retries
and propagates failures; the new default-paused dispatcher drains per-match
head-of-line rows with `FOR UPDATE SKIP LOCKED` and a predecessor predicate,
never locking match/team/actor rows, marks delivered only after a broker ACK,
retains failures with capped backoff and sanitized error codes, and surfaces
database unavailability instead of reporting an empty queue. Journaling failure
rolls back the scoring write/audit/cache invalidation; display names in lifecycle
events are accepted only from same-league id+tenant rows. Delivery is
at-least-once: consumers must deduplicate on the stable eventId.

Fresh verification: web **2,482 / 101 files**, database **186 / 12 files**, scoring
**295 / 12 suites**, release checker **87 tests** — **3,050 passing tests**, all exits 0.
Web type check exits 0; `git diff --check` clean; both compose YAML files parse.
Consumer-side idempotence, multi-instance recovery, real PostgreSQL/multi-broker
drills and applied-migration acceptance remain open; SCORE-12 stays unchecked.
No migration applied, no remote database/provider/deployment action; release gate
default-off. Roadmap **19 checked / 60 open / 79 IDs**.

### Batch 64 — idempotent commentary consumers and bridge dedupe (16 October 2026)

SCORE-12 consumer half, following the Batch 63 producer outbox. Outbox
redelivery or a consumer crash could previously regenerate the same commentary,
double-publish it and duplicate the live feed.

Deduplication now spans the pipeline without becoming an authorization point:
the commentary consumer validates envelopes and claims the event identity (SET
NX EX 24h) before generating — duplicate identities skip regeneration and
publication, failures release claims so redelivery reprocesses, and Redis
outages fail open with surfaced warnings. Ball identity prefers the producer
`idempotency-key` header, then payload `eventId`, then the deterministic
delivery composite; lifecycle events use the outbox's `matchId:Type` key.
Published commentary carries the identity inline and as a header, and the
scoring-service bridge claims it before forwarding through the publication-aware
gateway (unchanged authorization recheck), releasing on forward failure. A hard
crash between claim and commit can still skip one regeneration until the TTL
expires; delivery remains at-least-once with bounded suppression.

Fresh verification: commentary service **39 / 4 files**, scoring **300 / 12
suites**, database **186 / 12 files**, web **2,482 / 101 files**, release
checker **87 tests** — **3,094 passing tests**, all exits 0. Web type check
exits 0; `git diff --check` clean. No schema/migration operation, remote
database, provider or deployment action. Multi-instance drills and real-broker
acceptance remain open; SCORE-12 stays unchecked pending acceptance. Roadmap
**19 checked / 60 open / 79 IDs**; release gate default-off.

### Definition of done for each batch

- Focused code follows existing monorepo conventions and source-of-truth ownership.
- Relevant regression tests and requested checks pass or blockers are recorded.
  Builds run only when requested for the delivery batch.
- No secrets or generated artifacts are staged.
- Diff reviewed; only intended files committed; changes pushed with normal Git flow.
- Tracker records completed behavior, check results, and next work.
