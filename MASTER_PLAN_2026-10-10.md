# Premium Cricket SaaS & White-Label Master Plan

- **Created:** 2026-10-10
- **Last updated:** 2026-10-10
- **Repository:** https://github.com/Kaashmalik/mtk_ssl_official
- **Review baseline:** `main` at `87e5d6f`
- **Status:** Implementation started; progress recorded in section 14.

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

### Definition of done for each batch

- Focused code follows existing monorepo conventions and source-of-truth ownership.
- Relevant regression tests and requested checks pass or blockers are recorded.
  Builds run only when requested for the delivery batch.
- No secrets or generated artifacts are staged.
- Diff reviewed; only intended files committed; changes pushed with normal Git flow.
- Tracker records completed behavior, check results, and next work.
