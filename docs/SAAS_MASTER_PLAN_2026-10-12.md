# Cricket SaaS 2026: League Isolation, User Control and Premium Experience

## 1. Document Control and Status Rules

| Field | Value |
| --- | --- |
| Created / last reviewed | **13 October 2026 / 15 October 2026** |
| Repository | https://github.com/Kaashmalik/mtk_ssl_official |
| Pre-Batch 7 baseline | `main` at `9ac8702abd10e86408e8467c5015b145752787ed`; earlier six code batches end at `3d7e3fd` |
| Document purpose | Execution roadmap, end-to-end flows, acceptance cases, and built/remaining checklists |
| Current implementation | Batch 49: fixture generation exists for the first time — `lib/fixture-planning.ts` plans leagues (circle-method round-robin with per-round rest), knockout first rounds (standard seeding, 2/4/8/16/32 with stage labels) and hybrid group stages (snake-distributed groups ≤ 4) from approval-ranked, seed-order-bound registrations; `lib/fixture-generation.ts` persists them in one locked transaction (tournament row `FOR UPDATE`, no regeneration over existing fixtures, wizard config + capacity + active-team gates, knockout power-of-two check before seeding; tournament → live + registration closed + audited); `generateFixtures` action (`match:create`) delegates; Batch 48: the API tier is fully covered — `api/subscriptions/request` creates manual (bank/wallet) upgrade requests through the new `lib/subscription-requests.ts` with the Stripe-checkout sibling fix (tenant row `FOR UPDATE` + pending re-check under the lock, loser 409s; double `users` lookup deduped into `findOwnedTenant`; distinct user/league 404s and the signed-receipt allow-list byte-for-byte unchanged); `api/payments/upload-proof` delegates its pure primitives to `lib/payment-proof.ts` (magic-byte sniffing is the stored content-type authority; hostile filenames sanitized; uploader-namespaced paths) keeping the allow-list/5 MB/sniff-match/private-bucket flow; `webhooks/clerk` gains regression coverage only (already Svix-verified fail-closed); Batch 47: the OTP entry points (`api/auth/otp/send`, `api/auth/otp/verify`) are thin wrappers over the new `lib/otp-verification.ts` — rate limit + cooldown + hashed minting, and a brute-force-cap race fixed via an optimistic attempt-claim (`UPDATE … WHERE id AND maxAttempts > attempts AND attempts = <observed> RETURNING`, loser 429s); Batch 46: the custom-domain trust surface (`api/dns/verify`, `api/email/verify`, `api/ssl/status`) is thin wrappers over the new `lib/domain-verification.ts` — zod-validated inputs, super-admin/owner authority, fail-closed DNS + SPF/DMARC/DKIM checks, token rotation, and client responses redacted of the DKIM private key (`toClientEmailVerification`); Batch 45: the admin/API tier is closed out — `api/settings/branding` is a thin wrapper over the new `lib/branding-settings.ts` (zod-validated PUT body, pure plan gating, tenant-row-locked save that reads the plan under the lock before answering the gate); `api/cron/subscription-renewal` delegates to the new `lib/subscription-renewal.ts` (verbatim notify buckets + 36 h idempotency guard, pause claimed via `UPDATE … WHERE id AND status IN (live) RETURNING` with the tenant downgrade in the same transaction; route keeps the fail-closed 503/401 gate with constant-time bearer comparison); Batch 44: the Stripe surface (`api/billing/stripe/checkout`, `api/webhooks/stripe`) is thin wrappers over the new `lib/stripe-billing.ts` — per-tenant serialized checkout-intent creation (tenant row `FOR UPDATE` + pending re-check under the lock, loser 409s; Stripe HTTP stays outside transactions), pure signature verification (Stripe t=/v1 HMAC-SHA256 scheme, constant-time, five-minute tolerance), and verbatim idempotent settlement (claim via `UPDATE … WHERE status = "pending" RETURNING`, `PLAN_PRICES` amount verification); PKR confirmed two-decimal (the wrong "zero-decimal" comment is fixed); Batch 41: `scoring.ts` actions are pure delegates to the new tenant-scoped `lib/scoring-reads.ts` (reads only; all writes stay with the scoring-service SoT) — the `no-unscoped-queries` allowlist is at its floor: `tenants.ts`/`users.ts` bootstrap only; Batch 40: `matches.ts` actions are pure delegates to the new tenant-scoped `lib/match-records.ts` (reads + the verbatim locked scorer-assignment writer; lifecycle/stream commands stay in `lib/match-management.ts`; `endMatch` still proxies to scoring-service); Batch 39: `users-invites.ts` flows are pure delegates to the new `lib/invite-records.ts` (locked issue/revoke/resend-rotate/accept-claim transactions, audit + in-app notification, Resend dispatch still outside all locks, `InvitableRole`-narrowed typing); Batch 38: `scorecards.ts` actions are pure delegates to the new tenant-scoped `lib/scorecard-reads.ts` (match→innings→child hierarchy, exists-subquery legacy-row defense; `saveScorecard` stays a fail-closed denial stub); Batch 37: `player-ids.ts` actions are pure delegates to the new tenant-scoped `lib/player-id-cards.ts` (issue with intact `pg_advisory_xact_lock` allocation + `23505` lost-race recovery, revoke/expiry/list all re-predicated on the explicit `(playerId, tenantId)`); Batch 36: `follows.ts` and `registrations.ts` left the `no-unscoped-queries` allowlist (both are pure delegates with zero direct `db`; the guard now enforces repo-only access) and anonymous follow reads read as `0`/`false`/`[]` tenant-scoped; Batch 35: the league-setup page gates on *ownership* (`getMyOwnedTenant()`) so member-only accounts can still create their own league (correctly matching the `createTenant` cap), and `createTenant` enforces that cap under an actor row lock with an in-transaction re-check plus `23505` slug unique-violation mapping; Batch 34: the public (unauthenticated) surface gains a real publication boundary (`lib/public-visibility.ts`) derived from existing lifecycle columns, gating the match/live/tournament routes and the scorecard PDF export so a `draft`/`cancelled` tournament, a `cancelled` match and any match under an unpublished parent now 404, and scoping the public `/leaderboards` hub (previously aggregated across **every** tenant) to the request-host league and published competitions; Batch 33: personal notification reads/writes (`lib/notification-reads.ts`, `app/actions/notifications.ts`, `dashboard/notifications`) are scoped to the exact active league through a verified *membership* gate (`requireNotificationMemberContext`), with `super_admin`/remapped/suspended/foreign denial, UUID-validated and tenant-filtered mutations, bounded readers, fail-closed page resolution and a route error boundary; `notifications.ts` left the `no-unscoped-queries` allowlist; Batch 32: the league registration review queue (`dashboard/registrations`) decides access with the non-throwing `resolveRegistrationReviewAccess()` and bounces only genuine non-owners, so tenant/membership/read failures reach the route error boundary instead of a benign redirect; Batch 31: league venue management — `venue:read`/`venue:manage` RBAC plus a gated **Venues** nav item, bounded tenant-scoped `lib/venue-reads.ts` readers, and locked/audited `lib/venue-writes.ts` create/update/archive writers (lock order account → league → membership → venue row; archive is an `isActive` compare-and-set that never deletes, because `matches.venueId` is `ON DELETE SET NULL`; per-league unique names map to one friendly error) surfaced by the `dashboard/venues` list/new/edit routes; Batch 30: the self-service `/dashboard/registrations/new` page resolves the exact active league (`registration:create`) and reads bounded, tenant-scoped team/tournament/player pickers through `lib/registration-reads.ts`, replacing a `try/catch` that silently redirected to `/dashboard/league/setup` and rendered fake empty pickers; Batch 29 gated the tournament-detail page's mutation controls on the exact-league role and 404s a foreign-league row; Batch 28 scoped the settings/billing/invoices/white-label destinations through the shared fail-closed `requireActiveLeagueContext` gate and `lib/league-settings-reads.ts`; tournament create/update are locked, audited exact-league writes (Batch 27); registration open/close locked lifecycle (Batch 26); tournament/stats/scoring dashboard reads (Batches 24–25); fan-follow isolation (Batch 23); `dashboard-context`/league-setup destinations, public/anon follow and real-DB acceptance remain open; no remote database writes or deployment |
| Future-roadmap precedence | This plan sets the new delivery order; the [10 October plan](../MASTER_PLAN_2026-10-10.md) remains the historical findings and batch-evidence register |
| Architecture precedence | Preserve the accepted [hybrid backend decision](architecture/BACKEND_UNIFICATION_DECISION.md) |

Status vocabulary:

- **BUILT / `[x]`:** the narrowly stated behavior has implementation evidence, with the verification boundary recorded. It does not mean deployed or production-certified.
- **PARTIAL / FOUNDATION:** source, schemas, or screens exist, but the whole journey is incomplete or insufficiently verified. Remaining work stays `[ ]`.
- **PLANNED / `[ ]`:** proposed functionality or outstanding acceptance work; do not market it as delivered.
- **UNVERIFIED / BLOCKED:** requires real authentication, devices, PostgreSQL, email, payment, or deployed infrastructure evidence.
- A phase is complete only when its implementation AND exit gates pass. Do not turn all of a phase green because one batch passed unit tests.

This is a professional living plan covering known requirements and failure cases, not a guarantee that every future edge case has been discovered. New rules, incidents, and product decisions must extend its acceptance matrix.

### Contents

1. Document control and status rules
2. Executive direction and non-negotiable requirements
3. Verified baseline and outstanding risks
4. Target architecture and data ownership
5. Identity, league membership and resource permissions
6. Platform administration and league onboarding
7. Organizer settings, member controls and scorer OTP flow
8. Team, captain, player and registration journeys
9. Tournament operations and match-day readiness
10. Canonical scoring, offline operation and live match center
11. Public hub, player records, awards and prizes
12. Fan engagement, white-label and commercial features
13. UI/UX, accessibility and backend synchronization
14. Database, security, privacy and operational reliability
15. Edge-case and acceptance matrix
16. Phased implementation checklists: built and remaining
17. Delivery gates, metrics and next batch
18. Sources, evidence and maintenance

## 2. Executive Direction and Non-Negotiable Requirements

**Vision:** one cricket SaaS serving many independent leagues, with trustworthy operational controls and a shared public experience containing only published cricket information.

**Priority:** league isolation -> membership/OTP controls -> registration and eligibility -> reliable match-day scoring -> rich published statistics -> commercial white-label -> moderated engagement and scale.

1. One global login may have different memberships and jobs in different leagues. Global identity must not become global league authority.
2. Every team, player registration, tournament, match, official assignment, fee, prize, and private operational record belongs to its correct league.
3. Use role + capability + resource scope + current membership/assignment + valid lifecycle + entitlement. UI visibility alone is never authorization.
4. Separate platform account suspension, league membership suspension, and match assignment revocation.
5. Never allow a league organizer to create platform administrators or disable a person's account in other leagues.
6. Treat email OTP as identity verification, not automatic membership or proof of administrative authority.
7. Make the canonical scoring service the only delivery writer. Publish only server-confirmed events; preserve offline work without presenting it as official.
8. Make every settings action database-backed, validated, auditable, and visible as pending/succeeded/failed.
9. Public users see published leagues, matches, records, awards, and prizes, not private email, identity, payment, or registration data.
10. Isolation, authentication, recovery, and score integrity are mandatory on every plan, not premium upgrades.
11. Preserve historical statistics and eligibility; archive or correct official records rather than silently rewriting/deleting them.
12. Do not claim verified payments, complete cricket rules, professional feed rights, or production readiness from scaffolding or mocked tests.

## 3. Verified Baseline and Outstanding Risks

### 3.1 Delivered implementation batches

| Batch | Commit | Built behavior and boundary |
| --- | --- | --- |
| 1 | `73c7ac0` | Tournament authorization/author UUID, wizard validation, browser-safe plan guard, scorecard lookup fixes |
| 2 | `5f50ab1` | Explicit delivery accounting, stable operation IDs, replay retention, sequence allocation, exact undo/projection reconciliation |
| 3 | `dd09b57` | Web assignment enforcement, tenant-scoped assignment candidates, validated rich snapshots, reconnect/chase hydration |
| 4 | `0080b88` | Wizard configuration persistence/reading/copying, validated dates/money/branding/seeds, locked partial updates |
| 5 | `e9f4951` | Verified web actor propagation, transactional active-account/tenant-role/assignment checks, basic roster eligibility, delivery/undo actor metadata |
| 6 | `3d7e3fd` | Role-aware responsive dashboard, authorized active-tenant dashboard/shell/trial reads, accurate summaries and honest error states |
| 7 | `1ae95b2` | Versioned league-only member role/status commands, owner-only Members and access UI, explicit active membership guards, local migration and coordinated-release gate; deployment/real-DB proof open |
| 8 | `a49ea77` | Provider-verified invited-email redemption via the Clerk session identity, transactional issuer/recipient/league/invitation/team rechecks, honest dispatch states; recorded after Batch 7 |
| 9 | `29a98f4` | League membership removal, invitation resend with token rotation/cooldown, persisted invitation dispatch state; local migration, no remote database writes or deployment |
| 10 | `daff4f9` | Primary/backup match scorer assignment with tenant-scoped, membership-validated slots; canonical backup enforcement/dashboard/removal gaps repaired in Batch 13 |
| 11 | `f4861ae` | Signature-verified invitation delivery webhook recording delivered/bounced/complained; local migration, no remote database writes or deployment |
| 12 | `85d95b0`, migration timestamp `190d710`, evidence `3e55bde` | Two-party league ownership transfer: recorded-owner initiation, recipient-only acceptance, either-party cancellation, 7-day expiry and an atomic promote/demote/owner-id change; local migration, no remote database writes or deployment |
| 13 | `a481601` | Canonical backup write authorization, backup dashboard summaries/shortcuts and backup member-removal guard; no new migration or remote database writes |
| 14 | `3bf64bd` | Ownership-transfer under-lock account/session/privilege checks, cancellation reauthorization and final database-clock expiry predicate; no new migration or remote database writes |
| 15 | `1ee28e4` | Transactional scorer assignment/removal serialization, current authorization and atomic before/after audit; generic match edits cannot bypass assignment; no new migration or remote database writes |
| 16 | `7220a97` | Exact-active-league toss/start with locked assignment checks; end-match proxies canonical completion/award validation/audit; member commands reject remapped sessions; no new migration or remote database writes |
| 17 | `ccd0199` | Locked match metadata/cancel/stream commands; exact-active-league reads/dashboard/pickers, merged references and bounded dates; safe fixture cancellation instead of hard deletion; no new migration or remote database writes |
| 18 | `9f9a508` | Disabled unused manual scorecard write action, scoped match/innings read hierarchy and locked owner-only team/player archival with unfinished-fixture guards; no new migration or remote database writes |
| 19 | `0b330bb` | Locked active-league team/player create/update and roster commands, current owner/assigned-manager authority, shared capacity/eligibility checks and serialized create quotas; reads/dashboard and real-DB acceptance remain open |
| 20 | `2fa43ec` | Active-league roster read actions and core dashboard routes with scoped joins, private-field separation, bounded pickers and current-authority controls; team analytics/ID-card/follow paths scoped in the follow-up commit |
| 21 | `bcbdca6` | Locked active-league registration review writers and scoped bounded review reads; tournament/venue/admin writers, public visibility and real-DB acceptance remain open |
| 22 | `c29c96a` | Tournament hard-delete replaced with a locked, audited cancel/archival that preserves registration/team/match links; venue/public visibility/real-DB acceptance remain open |
| 23 | Current batch; see Git history | Fan-follow mutations/reads scoped to the exact active league and account UUID, fixing a Clerk-vs-UUID follow-state bug; venues/admin writers, public/anon follow and real-DB acceptance remain open |

Latest **previously recorded** test baseline: web **357 tests / 26 files**, database **103 / 5**, scoring service **155 / 8**; **615 passing tests** in total. These are mocked-boundary automated checks recorded by Batch 6, not a fresh test run or production verification for this document.

Batch 19 verification and rollout boundaries are recorded in section 17. The
615-test result remains historical evidence, not the current suite count.

### 3.2 Existing foundations are not complete new features

- Invitation tokens, email dispatch, atomic invitation claiming, and basic team-manager assignment exist. A hardened scorer OTP/settings journey is not established.
- `user_tenant_roles` still provides one role per user/tenant. Batch 7 adds local `active`/`suspended` status and a database-incremented version; deployed status is unverified. Expiry, full lifecycle, scoped multiple grants and broader roles remain open.
- Team/player/match CRUD, registrations, public pages, branding, billing, reactions, and specialist services exist in varying states. Audit each before reuse; presence is not end-to-end acceptance.
- Score snapshots, web queue retention, and canonical write authorization are implemented foundations. Mobile authenticated replay, outbox recovery, complete cricket rules, and private publication controls remain open.

### 3.3 Release-critical gaps

| ID | Current evidence | Required resolution |
| --- | --- | --- |
| GAP-01 | Batch 7 replaces global user-management writes with league-only membership commands | Verify migration/rollout and browser behavior; platform role-grant redesign remains open |
| GAP-02 | Some pages/actions still use primary membership or legacy global roles | One verified active league across page, action, repository, and notification paths |
| GAP-03 | Batch 7 removes fallback in web/scoring/shared membership helpers and proposes matching RLS helper changes; legacy columns remain | Verify safe backfill, existing elevated grants, real RLS and other consumers before declaring retirement complete |
| GAP-04 | Batches 7–11 remove plaintext logging/false delivery claims, persist dispatch outcomes and support token-rotating resend plus signed delivery events; dispatch is still synchronous | Durable queue, retries/recovery and live provider acceptance proof |
| GAP-05 | Batch 8 checks provider-verified invited email and current issuer/resource authority during transactional redemption | Authenticated OTP/login/provider-outage acceptance, scoped multiple grants and real concurrency proof |
| GAP-06 | Mobile Supabase sessions and web Clerk identity are not a completed scoring transport contract | Approved identity strategy and explicit account mapping; no client internal tokens |
| GAP-07 | Scoring sockets/state reads are currently anonymous public interfaces | Publication gates and protected private-match room/read access before offering private matches |
| GAP-08 | Migration history, real locking, private networking, and deployed event delivery are not reverified | Local/staging schema proof, concurrency tests, infrastructure acceptance |
| GAP-09 | Payment provider placeholders and unverified online paths remain | Signed-provider verification, replay protection and reconciliation before enabling checkout |
| GAP-10 | Dashboard shortcuts can lead to legacy tenant-inconsistent destinations | Repair destination authorization; do not equate dashboard role filtering with safe CRUD |

## 4. Target Architecture and Data Ownership

```text
Platform console        League web/mobile           Public cricket hub
        |                      |                           |
Verified identity + active league + scoped authorization   |
        |                      |                    Published read model
Platform operations     Next.js product CRUD                |
                               |                           |
                       Tenant-scoped PostgreSQL            |
                               |                           |
Scoring client -> authenticated BFF -> canonical Nest scoring transaction
                               |
                 Immutable events + projections + outbox
                               |
             Live delivery / notifications / analytics / overlays
```

- Next.js owns product CRUD; Nest owns authoritative scoring and other accepted specialists. No big-bang service rewrite.
- Shared database with enforceable tenant ownership is the default. Dedicated enterprise deployments are optional later, not necessary for logical league separation.
- Canonical scoring can use a privileged connection, so explicit transactional actor/tenant/resource checks remain necessary; RLS alone cannot protect a bypass-RLS service.
- Public data crosses leagues intentionally through publication-approved representations. Administrative queries never become cross-league because a public hub exists.
- Organization-level billing may own several leagues later; league remains the operational isolation boundary. Do not add unnecessary organization complexity to the first corrective batch.

### Proposed boundaries to map onto existing tables

| Boundary | Responsibility |
| --- | --- |
| Accounts and external identities | Internal account UUID; unique provider issuer/subject; no email-only account merging |
| Platform role grants | Platform administration, support and abuse authority, independent of league roles |
| League memberships | User/league relationship, status, expiry, join/revoke history |
| Scoped role grants | Membership permissions limited to league, tournament, or team |
| Invitations | Intended verified email, role/scope, issuer, expiry, token hash, acceptance/revocation |
| Official/scorer assignments | Match scope, primary/backup, handover epoch, expiry and history |
| League player/competition records | League-specific profile, squad registration, transfers, historical participation |
| Match squads and decisions | Immutable eligibility/XI snapshots and official approvals |
| Scoring events/projections/outbox | Authoritative deliveries, corrections, revisions and reliable event delivery |
| Awards/prizes/votes | Approved recognition, announced prizes, payout records and separate fan voting |
| Audits/notification delivery | Actor/resource changes, trace IDs, provider status, retries and retention |

Names above are design boundaries, not approved migration/table names. Reuse and extend existing schemas where safe.

## 5. Identity, League Membership and Resource Permissions

### 5.1 Identity strategy

Recommended direction: coherent Clerk authentication across web, platform admin, and mobile, with an explicit migration/linking decision for existing Supabase mobile identities. Use the supported Supabase third-party Clerk integration where direct data access is needed, not deprecated shared-secret JWT templates.

- Validate token issuer, audience, signature and expiry; map provider subject to the application's UUID.
- A provider-verified email may prove an invitation recipient but is not the enduring account key.
- Do not assume `auth.uid()` equals `users.id` for a Clerk string subject. Design mappings/RLS against the chosen identity integration.
- Do not trust client-editable metadata, a selected role, or an arbitrary tenant header as authority.
- Require enrolled strong factors for privileged users; do not silently downgrade required MFA to an email-only check.
- Document recovery, lost-device, email-change, duplicate-account and provider-outage journeys before mobile migration.

### 5.2 Scope and roles

| Role | Allowed job | Explicit restrictions |
| --- | --- | --- |
| Platform super admin | Platform plans, league onboarding, abuse, platform account suspension, audited support | Separate console; league access is explicit/audited, not ordinary organizer membership |
| League owner | Own-league settings, staff, competitions, ownership and commercial configuration | Cannot grant platform roles or affect another league |
| League administrator | Delegated staff and operational responsibilities | No ownership transfer or financial authority unless separately granted |
| Tournament director | Registrations, fixtures, officials, result/award approvals | Assigned competitions only |
| Finance manager | Fees, approved refunds, reconciliation, prize payment records | Cannot score or change access roles |
| Team owner/manager | Team identity, roster, applications and delegated team staff | Assigned teams; cannot approve own application or another team's squad |
| Captain | Availability, eligible XI, toss acknowledgement, match requests | Assigned team/fixtures; cannot mutate official score |
| Coach | Approved squad information and analytics | No automatic roster changes, medical-data access or scoring rights |
| Scorer | Deliveries and permitted corrections | Current assigned matches and valid membership; no other league authority |
| Umpire/referee | Assigned match decisions, disputes and approved results | Assigned fixtures; score-writing only if explicitly granted |
| Broadcaster | Stream configuration, score overlays and approved assets | Assigned streams; cannot change canonical scores |
| Player | Own profile/availability, participation and correction requests | Cannot edit historical official statistics or others' records |
| Fan | Published browsing, follows, moderated reactions and votes | No operational CRUD or private membership access |

New roles/scopes are proposals; the current enum/permission matrix is smaller. Do not use a numeric role hierarchy to grant unrelated capabilities. Multiple scoped jobs may coexist; owner-only actions remain explicit. Team ownership, team management and captaincy are separate assignments.

### 5.3 State and revocation model

- Platform account: `active -> suspended -> restored` (platform-controlled).
- League membership: `pending -> active -> suspended/expired/revoked` (league-scoped).
- Invitation: `pending -> accepted/expired/revoked`; delivery status is a separate state machine.
- Match assignment: `pending -> active -> ended/revoked`; primary/backup handover is separate from login.
- Suspending League A membership never alters League B membership. Platform suspension blocks all authenticated operational access while retaining authorized historical/public records.
- The next server-authorized mutation must respect revocation; serialize revocation and scoring writes to define which in-flight command committed first. Rejected offline commands stay retained for authorized reconciliation.
- Last-owner removal, self-escalation and unauthorized delegation are rejected. Ownership transfer is a two-party, fresh-verified, audited workflow.
- Support access is consented/time-limited where appropriate, with a visible banner, read-only default and no secret sharing.

## 6. Platform Administration and League Onboarding

### Organizer flow

```text
Sign up -> verify email -> create league application -> choose plan
-> required review/payment checks -> activate workspace
-> configure brand, timezone, rules and staff -> publish approved content
```

Platform application states: draft, submitted, needs-information, approved, rejected, withdrawn. Workspace states: setup, active, restricted, suspended, archived. Billing states remain separate.

Platform console responsibilities:

- Review league ownership/contact identity and required application information.
- Approve/reject with reasons; prevent duplicate approval/provisioning on retries.
- Configure plans/entitlements and monitor usage without reading every league's private operational records by default.
- View operational health, domain/email delivery health, abuse reports, support cases and audit trails.
- Restrict/suspend with a clear reason, effective policy, appeal/support path and preservation of records.
- Archive/restore/export through explicit authorization and retention policies.

Product decisions before implementation:

1. Which league types are self-service versus approval-only?
2. Is each owner initially allowed one or several leagues, and how does the plan limit apply?
3. What happens to a live match during billing restriction? Recommended: permit safe completion/read access under a documented grace policy; do not silently lose scoring work.
4. Security suspension may block writes immediately; billing restriction and public publication are not interchangeable.
5. Approval of a league must not automatically approve its teams, fees, player eligibility or public data publication.

## 7. Organizer Settings, Member Controls and Scorer OTP Flow

### 7.1 Settings information architecture

| Settings tab | Main controls |
| --- | --- |
| General | Name, contact, timezone, language, seasons, archive/restore |
| Members and access | Invitations, scoped roles, league-only status, expiry, revocation and ownership transfer |
| Teams and eligibility | Managers/captains, squad limits, transfer windows, approval/eligibility rules |
| Scoring and officials | Match assignments, backup scorer, handover, correction rights, official approvals |
| Competition rules | Format, overs, points, tie-breakers, qualification and rain-policy disclosure |
| Branding and domains | Draft/published brand, logo, accessible palette, verified domain and email sender |
| Notifications | Event subscriptions, recipient scope, reminders, language, quiet hours and unsubscribe |
| Fees and prizes | Currency, registration amounts, reconciliation, announced prizes and payment status |
| Privacy and publishing | League/match/profile visibility, consent and publication approvals |
| Security and audit | Privileged authentication policy, scoped changes, access history and support access |
| Personal account | Own authentication, devices/sessions and preferences; separate from league member control |

### 7.2 Member UI

Show verified identity, current league, roles/scopes, membership status, invitation delivery, expiry, assigned resources and allowed actions. Search/paginate within the authorized league. Do not show a member's unrelated league memberships.

Actions: invite, resend, revoke, activate, suspend, reactivate, change scope, assign, unassign and remove membership. Separate destructive confirmation from ordinary toggles; show consequences and affected assignments. Never silently affect platform account status.

### 7.3 Example: invite `aliscorer@gmail.com`

```text
Organizer -> Settings / Members and access / Invite scorer
-> enter recipient email -> select this league's competition/match scope
-> optional access expiry -> choose activation policy -> send invitation
Recipient -> open invite -> sign in/sign up -> verify invited email by OTP
-> review league, role and scope -> accept
Backend -> atomically claim valid invite + establish membership/grants
-> activate eligible assignment -> show only authorized scoring jobs
```

The Gmail address is a recipient, not a custom sending domain. Send through a verified platform/league sender with appropriate SPF/DKIM/DMARC; no Gmail impersonation. Custom-domain sender verification is a separate setup journey.

Required checks at redemption:

- Valid authenticated identity; invited email verified by the identity provider.
- Unexpired/unrevoked invitation checked at atomic claim time, not merely at preview time.
- Correct active league, current grant authority and still-existing allowed resources.
- Existing membership/grants handled without demotion, duplicate side effects or unintended elevation.
- If activation is off, verification/acceptance does not grant operational access until authorized activation.
- Pending assignment cannot grant scoring before membership becomes active.
- Response loss/retry returns a safe idempotent outcome for the same accepted identity without repeating notifications/grants.

### 7.4 OTP and sensitive-action policy

- Prefer provider-managed codes. Short-lived, single-use verification; bound attempts, resend cooldowns, recipient/account/IP abuse controls and generic unauthenticated responses.
- Invitation TTL and OTP TTL differ. Set supported defaults after checking provider capabilities; do not invent guarantees the SDK cannot enforce.
- Never show OTPs to organizers or put codes/secret invitation links in logs, analytics or referrers. No production development bypass/test codes.
- A code verifies identity, not a role. Accepting an invitation additionally requires resource/membership checks.
- No OTP on every ball. Use a valid authenticated scoring session, renewed safely as needed.
- Ownership transfer, privileged grants, account recovery and sensitive financial changes require fresh server-enforced verification and the required enrolled factors. For action-specific single-use authorization, bind verification to the exact operation and consume it atomically.
- Outages, bounce, provider acceptance and actual delivery must be distinguishable. Resend/revoke races and expired invitations need explicit UI outcomes.

## 8. Team, Captain, Player and Registration Journeys

### 8.1 Team manager

```text
Verified account -> authorized league/team membership -> create/manage team
-> invite players/coaches -> submit competition application + squad
-> resolve requested information -> track approval and fees -> manage approved participation
```

- A team in League A cannot be selected for League B's tournament, even by manipulating an ID.
- Reusing a brand/team in another league creates an explicit league-specific record with consent, not a cross-tenant foreign key.
- Team transfer of ownership is audited and does not transfer league administration.
- Managers may propose player changes; eligibility/competition locks determine when changes take effect.

### 8.2 Player

```text
Verify account -> accept league/team invitation -> approve permitted profile publication
-> maintain own details/availability -> join approved squad -> participate
-> view official records -> request corrections rather than edit statistics
```

- Separate account identity, league profile, competition registration and historical match participation.
- No email/name-only player merging. Verified linking supports consented public career aggregation.
- Transfers affect future participation, not past match team identity.
- A player in two teams/leagues gets separate scopes. Double participation in one competition follows explicit rules, normally disallowed unless the competition permits it.
- Handle injured/suspended/retired status, reinstatement, guardians/minors and account-less player profiles through documented policies.

### 8.3 Captain and coach

Captains submit availability and proposed playing XI for their assigned team/fixtures; officials approve eligibility as required. Toss acknowledgement is separate from the authoritative recorded toss. Coaches see only permitted squad/analytics information; private medical/identity information is not included by default.

### 8.4 Tournament registration

```text
Published competition -> draft application -> submit -> pending review
-> needs information / approved / rejected / waitlisted / withdrawn
-> eligible competition squad -> fixture allocation
```

Maintain independent application, payment and squad-eligibility states. Payment does not imply approval, and approval does not prove payment. Handle deadlines, capacity/waitlist promotion, duplicate submissions, refunds, registration withdrawal and amended squads with request IDs and audit history.

## 9. Tournament Operations and Match-Day Readiness

### Competition lifecycle

Draft -> configured -> registrations open -> registrations locked -> fixtures published -> in progress -> results under review -> finalized -> archived.

- Persist rules/settings and season templates; saved preferences are not generated fixtures.
- Support league, round robin, knockout, groups/hybrid formats only when fixture and qualification logic is implemented and tested.
- Fixture generation must consider venues, availability, rest, duplicates, timezones, capacity and rescheduling notices.
- Points, ties, no-results, abandoned matches, NRR and advancement use versioned competition rules. Do not invent fixed points for every tournament format.
- Freeze or explicitly version material rule changes once matches start; disclose retrospective effects and require approval.
- Store timezone/currency configuration; display localized schedules without altering recorded instants or interpreting money as floating-point values.

### Match-day readiness checklist

Approved teams -> eligible squad/XI -> officials/scorer -> venue/time -> toss -> striker/non-striker/bowler -> innings -> scoring -> break/chase -> review -> result -> awards/prizes/publication.

The dashboard's existing first-record checklist is not XI or match-readiness certification. Readiness must validate real registrations and resource approvals.

### Result governance

- Provisional result, official approval, dispute, correction and finalized result are distinct states.
- Record forfeits, cancellations and no-results explicitly; do not treat all missing winners as ties.
- A participating scorer may require independent official approval by competition policy.
- Corrected results recompute standings, qualification, public summaries and awards where relevant; notify affected parties and retain the earlier decision.

## 10. Canonical Scoring, Offline Operation and Live Match Center

### 10.1 Command lifecycle

```text
Scorer action -> durable local operation -> authenticated BFF
-> validated actor + league + membership + assignment + expected revision
-> match transaction / rules / deduplication
-> delivery + immutable event + projection + durable outbox
-> committed acknowledgement -> live broadcast / overlays / downstream statistics
```

Existing web actor/assignment transactions are a foundation. Complete memberships, revision checks, mobile identity, writer handover and outbox delivery remain required.

### 10.2 Cricket engine

- Explicit batter runs, wide/no-ball penalties, byes, leg-byes, penalties and legal balls; implement valid mixed combinations.
- Striker/non-striker, over-end strike, wicket crossing/ends, bowler changes and dismissed-player identity follow the chosen laws/version and competition rules.
- Validate dismissals on wides/no-balls/free hits, retired hurt/out, substitutes, injuries and appropriate fielder requirements.
- Innings limits, all-out, winning chase delivery, ties, super overs, abandoned/no-result and revised targets need state-machine tests.
- Gate unsupported formats. Complete test-cricket/multi-innings support is not established by a three-innings UI or a super-over label.
- Rain calculators must disclose their basis; do not call a heuristic authoritative DLS without approved implementation/rights.
- Undo of ambiguous historical extras stays blocked until a reviewed correction can establish the true delta. Corrections require reason, actor, before/after and durable history.

### 10.3 Offline and concurrent writers

- Queue before sending, preserve operation IDs and normalized run components, acknowledge per operation, retain rejection/conflict data.
- Distinguish local provisional score from server-confirmed official score. Never broadcast an unaccepted offline delivery as official.
- Scope queues to account + league + match; logout/switch/handover must not replay another person's work.
- One active scoring writer: primary/backup assignment plus server-enforced handover epoch/fencing. A TTL alone is insufficient if a stale device can still write.
- Reconcile expected revisions and snapshots after a gap/reconnect; do not discard unconfirmed operations simply because a snapshot arrives.
- Assignment/membership revocation blocks new authoritative writes and unauthorized replay; retain work for approved reconciliation.
- Define recovery for lost responses, expired sessions, application reload, multiple tabs, device replacement and undo while a queue is pending.

### 10.4 Live Match Center

Tabs: **Overview / Scorecard / Commentary / Analysis / Squads / Match info / Watch**.

- Score/wickets/overs; current/required rates; target and runs/balls needed; batter/bowler figures; partnership and recent deliveries.
- Full batting/bowling cards, extras, dismissal details, fall of wickets, innings summaries and eligible XI.
- Timestamped commentary aligned to confirmed events, over summaries, highlights, filtering and corrections.
- Worm/Manhattan, phase comparisons and spells; shot maps only when genuine shot data exists.
- Toss, venue, officials, result, awards, stream and score-only fallback.
- Durable revisions, stale/duplicate event rejection, authoritative fresh snapshots, last-confirmed freshness and reconnect messaging.
- Outbox retries with idempotent consumers; recover multi-instance fan-out without duplicate score effects.
- Private matches require HTTP and socket authorization before room join/snapshot delivery. Publication withdrawal must invalidate caches and terminate unauthorized room access.
- Distinguish organizer scoring from optional licensed professional-feed data, including attribution, quotas, coverage, outages and redistribution rights.

## 11. Public Hub, Player Records, Awards and Prizes

Public users may browse **all published leagues**, not all private database records.

### Public discovery

- Live/upcoming matches, league/season filters, published teams, players and competition pages.
- Followed entities, result notifications, league champions, award galleries and prize announcements.
- Stable share URLs, SEO metadata and branded cards without leaking private information.
- Public/unlisted/private visibility and explicit field allowlists. An unlisted link is not private authorization.

### Records and rankings

- Batting, bowling, fielding and wicketkeeping records by league, competition, season and format.
- Career aggregation only after verified player linkage and appropriate publication consent.
- Minimum qualification, tie-breakers, rule/version disclosure and correction provenance.
- Do not equate fan votes, AI suggestions or cross-format raw totals with official ranking.
- Historical scores remain authoritative; deletion/unlinking policies separate account access from lawful record retention/publication.

### Awards

Player of the Match, Player of the League/Tournament, best batter/bowler/fielder/keeper, emerging player, fair play and custom awards. Authorized officials approve with reason/evidence; fan favorite is independently labeled. Corrections/disputes can revise awards through recorded approvals.

### Prizes

Define sponsor, category, cash/non-cash type, currency/decimal amount, eligibility, recipient and approval. Track announced -> awarded -> payment pending -> paid/withdrawn/disputed as applicable. Publication does not prove funds exist or payout succeeded. Sensitive payout/refund workflows use the appropriate financial approvals and provider verification.

## 12. Fan Engagement, White-Label and Commercial Features

### Engagement

- Follows, boundary/wicket/start/result notifications, moderated reactions and polls.
- Fan-favorite voting with eligibility, per-user limits, rate limits, vote windows and abuse review.
- Milestone/share cards, league hall of fame, weekly recaps and fan badges.
- Report/block/moderation tools, community rules and clear separation of official decisions from popularity.
- Push/email consent, quiet hours, delivery status, unsubscribe and deduplicated event notifications.
- Later: consented highlight tagging/clips, coaching analytics and clearly labeled AI summaries using confirmed events only. AI must not invent deliveries or modify official scores.

### White-label

Brand Studio: league identity, logo/favicon, light/dark tokens, accessible fonts/colors, public templates, sponsor positions, email templates, scorecards, share images and broadcast graphics. Draft -> preview -> publish -> rollback; reload/tenant-switch must restore the correct identity.

Domain flow: enter -> prove ownership -> show DNS -> verify routing -> provision HTTPS -> verify login/cookies/redirects/socket origins -> activate. Include failed verification, expiry, reassignment, removal and renewal recovery. Sender-domain verification is distinct from recipient OTP.

### Proposed product tiers

| Tier | Illustrative differentiation; pricing/limits require approval |
| --- | --- |
| Core | Safe memberships, necessary OTP, correct scoring, basic public pages and recovery |
| Pro | Advanced statistics, registration tools, scheduling, reports and richer notifications |
| White-label | Custom domain, Brand Studio, sponsor placements, branded email and overlays |
| Enterprise | Multiple-workspace administration, approved SSO, scoped APIs/webhooks, audit exports, contractual support/isolation options |

Apply limits on the backend; UI upsells never replace entitlement checks. Billing states, approvals and usage are reconciled through verified providers. Do not enable placeholder online payment paths. Avoid cash betting/fantasy wallets in the initial roadmap; rights, jurisdiction and financial compliance need separate review.

## 13. UI/UX, Accessibility and Backend Synchronization

### Role-first UX

- Persistent league name/role and an explicit switcher; warn before cross-workspace navigation with pending work.
- Separate platform console, league settings, team operations, personal account and public hub.
- Organizer: readiness/tasks/registrations/scorer assignments. Scorer: assigned matches/queue/connectivity. Manager/captain: assigned teams/squads/XI. Player: own participation. Fan: published discovery.
- Show only permitted actions and enforce the identical capability on the server. Explain read-only and missing-assignment states.
- Mobile-first layouts, 44px action targets, keyboard focus, screen-reader labels, accessible contrast, reduced motion, outdoor scoring and Urdu/English including RTL where applicable.
- Test WCAG 2.2 AA-relevant journeys; do not claim conformance from utility classes alone.
- Preserve form drafts, validate per step then at final submission, show linked success destinations and avoid accidental duplicate creation.

### Database-backed interaction contract

```text
UI -> session identity -> one active league -> scoped permission/resource checks
-> validated command -> database transaction + audit/outbox
-> confirmed response -> invalidate affected reads -> notify/update clients
```

- Changes use operation/request IDs and version checks where retries or conflicts matter.
- Toggle UI: previous state -> saving -> confirmed state; on failure restore previous state with actionable error.
- High-impact changes show affected league/resources, consequences and fresh verification/approval where needed.
- Server derives actor and verifies selected league; no browser-supplied role grants or secret tokens.
- Locked/stale resources return conflict guidance instead of last-write-wins permission changes.
- Distinguish empty, zero, loading, offline, unauthorized, unavailable, pending and rejected; never represent failed reads as zero records or successful saves.
- Optimism is limited to reversible local UX; official score, financial success and access grants require confirmed outcomes.
- Keep durable unsent work isolated and visible when changing account/league; do not silently discard it.

## 14. Database, Security, Privacy and Operational Reliability

### Schema and migration design

- Inspect deployed schema/history before changes; reconcile recorded migration divergence. No migration is applied by this document.
- Add tenant-consistent relationship constraints (such as appropriate composite tenant/resource keys), unique membership/grant/idempotency constraints and status rules after auditing existing data.
- Index tenant/status/resource access paths based on actual query plans; paginate/bound administrative and public queries.
- RLS/grants protect exposed data paths. Prefer least-privileged application roles where viable; keep explicit safeguards for connections that bypass RLS.
- Use verified request-local transaction context, not persistent pooled-connection tenant settings that can leak into another request.
- Reconcile legacy membership sources, backfill, compare decisions, then remove fallback. Do not delete legacy authority until dependants and membership data are verified.
- Decimal currency amounts, configured currency, UTC instants + display timezone, durable revisions and structured command errors.
- Archive official resources; reviewed correction/export/deletion processes preserve relational and statistical integrity.

### Security and privacy

- Least privilege at every page/action/API/socket/export/job; database safety does not remove backend responsibility.
- No internal service tokens, secret/service-role keys or OTP/invite secrets in browser/mobile bundles or logs.
- Production MFA enrollment/recovery for privileged identities; token/session freshness and DB-backed membership revocation checked for sensitive operations.
- CSRF/origin/session protections appropriate to each transport; replay and request-abuse controls.
- Storage authorization includes tenant object paths, type/content/size checks, malware/risk handling and protected links; no trusted client filename/path alone.
- Public representations allowlist fields; exclude private contact, identity, financial, medical and admin records.
- Minors/guardians, consent withdrawal, account deletion/export, retention and regional privacy obligations require explicit policy/legal review.
- Revoke publication across HTTP, sockets, caches, search and exports where supported; explain that already downloaded public copies cannot be recalled.

### Operations

- Private service networks, TLS, scoped secrets, documented rotation and environment isolation.
- Backups and restore drills with approved recovery point/time objectives; tenant export and disaster recovery are not the same operation.
- Transactional outbox retry/dead-letter handling, idempotent webhooks/consumers, queue observability and safe replay tools.
- Monitor auth failures, OTP/email abuse, revoked writes, live latency, event gaps, queue age, payment mismatches and per-league load.
- Rate limits and fair-use quotas prevent one league overwhelming the platform; load-test live event fan-out and cache consistency.
- Publish rollout/rollback, incident response, maintenance and communication runbooks. Backfill/correction jobs must remain tenant-scoped and auditable.

2026 compatibility note: Supabase's announced explicit Data API grant change applies to new exposed tables, with enforcement scheduled for existing projects on **30 October 2026**. Review needed grants/RLS for intended Data API access; direct Drizzle connections are not made safe or unsafe merely by that exposure setting. Do not grant every table publicly to make a client work.

## 15. Edge-Case and Acceptance Matrix

Each case requires positive and negative assertions plus evidence. The matrix is a required test backlog; no row is certified by this planning change.

| Case | Required outcome | Owning phase |
| --- | --- | --- |
| A scorer in A, suspended member in B, outsider in C | Only A's assigned writes succeed; B/C cannot expose private data | 1/2/5 |
| Organizer in A, player in B | A's administrative role never propagates to B | 1 |
| Host tenant differs from primary membership | Authorize/read/write one explicit active tenant; no silent switch on lookup failure | 1 |
| Forged tenant/team/player/tournament/match ID | Reject before mutation; no cross-league relation or disclosure | 1/3/4/5 |
| Tenant/account/membership is inactive or expired | Enforce the correct scope without erasing historical records | 1/2 |
| Deleted membership but legacy array remains | No residual grant after planned fallback retirement; test migration behavior | 1 |
| Last owner removed or self-escalation attempted | Reject; audited two-party ownership transfer remains available | 2 |
| Lower-role invite accepted by existing owner | No demotion, accidental extra scope or unrelated role grant | 2 |
| Same person is captain/manager/scorer | Resource limits and configured independent approval still apply | 2/3/5 |
| Invited email differs from logged-in account | Require provider-verified invited email; no email-only takeover | 2 |
| Expired/revoked/used invite, including concurrent acceptance | Atomic valid single claim; safe same-actor response-loss recovery | 2 |
| Inviter loses grant authority or resource disappears | Refuse/require reissue; no obsolete assignment becomes active | 2 |
| OTP wrong/reused/expired or resend races | Provider-supported single-use/attempt controls; clear recovery, no bypass | 2 |
| Email provider absent, accepted-but-not-delivered, bounce/outage | Truthful separate delivery states, redacted logs and controlled retry | 2 |
| New account webhook/provisioning delayed | Recoverable pending state; never write a Clerk string into a UUID field | 2 |
| Suspension while scorer has pending deliveries | Subsequent server checks deny; retain local work for approved reconciliation | 2/5 |
| Two admins edit role/status simultaneously | Version conflict or serialized decision; no silent privilege overwrite | 2 |
| Duplicate registration/payment callback | One business effect; payment and application states remain independent | 3/8 |
| Waitlist slot opens, deadline passes, squad amended | Explicit policy and consistent audited promotion/eligibility | 3/4 |
| Player transfers/suspends after earlier participation | Historical team/statistics stable; new eligibility correctly evaluated | 3/5/6 |
| Concurrent team/player creates or roster join/capacity reduction | Current league plan/count after quota lock; same sorted-team lock protocol before capacity checks; test real two-session limits and rollback | 1/3/9 |
| Player team/status changes while toss/start/scoring waits | Current post-lock eligibility or explicit rejection; never lock matches after accounts/resources; prove real interleavings without deadlocks | 1/3/5/9 |
| Archived roster rows or retry after unlink/join | Preserve identities/history, no implicit restore or quota release; reauthorize idempotent roster retries; review archived-team unlink/restore separately | 1/3/9 |
| Same player joins two teams in one competition | Enforce configured participation policy at approval and match readiness | 3/4 |
| Fixture overlaps, timezone/DST change, unavailable venue | Detect conflicts; preserve UTC instants and send scoped reschedule notices | 4 |
| Rule/fee/prize changed after publication | Version/approval policy; no undisclosed retrospective effects | 4/6/8 |
| Double-click/lost response/replayed delivery | Stable operation ID; exactly one scoring effect and durable acknowledgement | 5 |
| Wide/no-ball repetitions, mixed extras and illegal dismissal | Correct tested legal-ball/run/dismissal accounting for supported rules | 5 |
| Undo after reload, ambiguous legacy extras, queued undo | Confirm exact reversal or block for reviewed correction; no guessed history | 5 |
| Match-winning ball, innings limit, tie/super over/no result | Valid lifecycle; no extra accepted deliveries or fabricated winner | 5 |
| Two devices/tabs, stale scorer after handover | Revision/fencing rejects stale writes; authorized queue recovery | 5 |
| Session expires, offline reload/logout/league switch | Isolated retained queue; authenticated ordered replay only | 5 |
| DB commit succeeds but Redis/Kafka/socket fails | No duplicate scoring; durable event retry and fresh snapshot recovery | 5/9 |
| Out-of-order/duplicate broadcasts and reconnect gaps | Durable revisions converge to authoritative snapshot | 5 |
| Team B bats first or unsupported multi-innings format | Scores attach to batting IDs; unsupported formats are gated | 5/6 |
| Private/unpublished match joined anonymously | Deny room/state access before data is sent | 1/5/6 |
| Publication revoked with open sockets/cached pages | Remove future access, invalidate controlled caches, document public-copy limits | 6/9 |
| Public profile contains contact/minor/private data | Allowlist/consent prevents disclosure; guardian policy applied | 6 |
| Corrected result changes standings, awards and notifications | Deterministic versioned recomputation and audit/provenance | 4/6 |
| Fan vote floods, bots, offensive reactions | Validation/rate limits/moderation; fan votes never alter official awards | 7 |
| Prize announced but unpaid, refund disputed | Clearly separate promise, approval, funds and verified settlement | 6/8 |
| Billing restriction during live match | Documented safe-completion/grace policy; security suspension remains distinct | 8 |
| Domain removed/reassigned or email sender fails verification | No stale tenant/session/brand leakage; actionable recovery | 8 |
| Storage URL/export/search/job for another league | Enforce tenant scope and purpose at every boundary | 1/9 |
| Support impersonation expires or attempts scoring | Time-limited audited access; restricted action cannot proceed | 1/9 |
| Restore, migration rollback, duplicate event replay | Recover consistent schema/records without tenant mixing or duplicate effects | 0/9 |
| Keyboard/RTL/screen-reader/reduced-motion/poor-network journey | Usable complete role flows, not merely attractive static screens | All |

## 16. Phased Implementation Checklists: Built and Remaining

**Batches 1–19 have recorded source implementations. No full phase below is production-complete.** Top-level checkboxes represent their complete stated scope, not just one implemented slice. The source-completion register below identifies completed portions of open tasks; unfinished functionality and release acceptance remain explicitly separate. IDs and historical evidence are preserved.

### Source-completion register — reviewed from Batch 7 (updated 15 October 2026)

| Task | Implemented source slice | Still open before the whole task is complete |
| --- | --- | --- |
| IAM-01 | Batch 7: league-only role/status commands, version checks and atomic audit | Deployment acceptance remains a release gate; this narrowly stated source task is checked |
| IAM-02 | Batch 7: owner-only list, confirmed-save controls and suspension confirmation; Batch 9: removal UI | Member detail, pagination, expiry, scoped grants and assignment integration |
| IAM-03 | Batch 8: Clerk-verified invited-email redemption, provider email-code UI and transactional issuer/recipient/resource checks | Live provider/login/OTP journeys, abuse/outage and real concurrent redemption proof |
| IAM-04 | Batches 8/9/11: honest persisted dispatch outcomes, signed delivery/bounce/complaint events and manual resend | Durable queued sends, automatic retries, operational provider proof |
| IAM-05 | Batches 7/9: role/status changes, versioned removal, revoke/resend/token rotation, audit | Full command idempotency and complete lifecycle/staging acceptance |
| IAM-06 | Batches 10/13/15: primary/backup slots, canonical checks, dashboard/removal integration, transactional assignment and atomic audit | Pending-membership assignment, stale-operator conflict checks, writer handover/fencing and real-DB acceptance |
| IAM-07 | Batches 7/12/14: ordinary owner-edit protection, two-party handover, under-lock resolution authorization and database-clock acceptance expiry | Delegated resource grants, privileged fresh-auth/step-up (IAM-08) and real DB acceptance |

**Counts:** 79 stable task IDs, 19 checked, 60 open. Open composite tasks above
are partially implemented, not untouched. Source completion is not production
certification. No broad IAM checkbox is checked solely because one slice landed.

### Phase summary

| Phase | Priority | Built scope | Remaining scope | Overall status |
| --- | --- | --- | --- | --- |
| 0. Evidence and release foundation | P0 | Plan/batch register and automated test foundations | Real schema/infrastructure/staging proof | PARTIAL |
| 1. Isolation and authorization | P0 | Tournament/scoring/dashboard-scoped checks | Full CRUD/sockets/storage/jobs context, memberships, constraints | PARTIAL |
| 2. Settings, memberships and OTP | P0/P1 | League-only role/status commands, member removal/resend, persisted dispatch state and verified delivery events, two-party ownership transfer with last-owner safeguards, basic Members UI and invitation foundations | Migration acceptance, scoped grants/expiry and verified OTP journey | PARTIAL; target journey remains |
| 3. League/team/player registration | P1 | Existing CRUD and registration scaffolding | Full reviewed onboarding, team/captain/player eligibility flows | FOUNDATION; acceptance open |
| 4. Competition operations | P1 | Wizard configuration save/reload/copy and locked updates | Fixtures, XI readiness, rules/standings/advancement | PARTIAL |
| 5. Reliable match day and live delivery | P0/P1 | Accounting, actor/assignment transactions, snapshots, primary/backup scorer assignment, retained web queues | Mobile auth, complete rules, handover/revisions/outbox, private reads | PARTIAL |
| 6. Public hub, records and awards | P1/P2 | Existing public pages and corrected dashboard summaries | Publication model, verified career linkage, awards/prizes | FOUNDATION; expanded product remains |
| 7. Premium role UX and fan engagement | P2 | Role-aware dashboard and basic engagement foundations | Remaining role journeys, moderated voting/notifications and analytics | PARTIAL |
| 8. White-label and commercial | P1/P2 | Branding/billing/domain scaffolding, tournament branding persistence | End-to-end brand/domain/verified payment/entitlement journeys | FOUNDATION; acceptance open |
| 9. Reliability and launch | P0 release gate | Unit/SQL-construction/server-rendered tests | Browser/device/real-DB/load/recovery/security proof | UNVERIFIED / OPEN |

### Phase 0 - Evidence and release foundation

- [x] **BASE-01:** Preserve accepted hybrid ownership and a dated findings/batch tracker.
- [x] **BASE-02:** Deliver six reviewed implementation batches with recorded remote commits.
- [x] **BASE-03:** Record the 615-test Batch 6 baseline with mocked-boundary caveats.
- [ ] **BASE-04:** Inventory deployed schema/roles/grants and reconcile migration history; prove a fresh local/staging database.
- [ ] **BASE-05:** Establish two isolated test leagues, all representative roles, email/auth sandbox and reproducible browser/device fixtures.
- [ ] **BASE-06:** Establish operational environments, secrets/networking, observability and rollback/restore evidence.

Exit: repeatable baseline and a verified staging environment; old unit-test counts alone do not satisfy this gate.

### Phase 1 - League isolation and authorization

- [x] **ISO-01:** Use exact active tenant for tournament operations and configuration updates (Batches 1/4).
- [x] **ISO-02:** Enforce web/canonical scoring tenant, actor and assignment checks (Batches 3/5).
- [x] **ISO-03:** Authorize active-tenant dashboard/shell/trial reads without role-query-error fallback (Batch 6).
- [ ] **ISO-04:** Consolidate remaining pages/actions/admin APIs/repositories, especially users/invites and dashboard destinations.
  Batch 7 repairs user management and shared host-first/default membership resolution, including known inactive hosts. Remaining direct paths, unknown/removed-domain handling, private sockets and exports still need audit.
  Batch 16 adds under-lock session mapping checks for member role/status/removal commands and fixes exact-active-league toss/start/completion authority. Match metadata CRUD/read/stream actions and dashboard pages still require separate active-league and transactional authorization review; this whole task stays open.
  Batch 17 implements that match-actions/dashboard slice, including exact-league form pickers and full-scorecard detail reads, under-lock owner reauthorization, merged fixture validation and cancellation without hard deletes. Other scorecard actions, team/player/tournament/venue writers and their cascading-delete/lock interactions, remaining pages/admin APIs, public visibility, private sockets and exports are not certified; ISO-04 remains open.
  Batch 18 disables the unused `saveScorecard` alternate writer, scopes both scorecard read actions through the current league/match/innings hierarchy, and replaces only `deleteTeam`/`deletePlayer` with audited archival. Other team/player CRUD, roster writes and dashboard read paths still use legacy ownership/context assumptions and need review; no database-wide cascade prevention or full ISO-04 completion is claimed.
  Batch 19 replaces the six team/player create/update/add/remove writers with exact-active-league transactions, locked owner/assigned-manager checks, atomic minimal audits, shared roster capacity/eligibility checks and serialized create quotas. Batch 20 replaces core team/player read actions and list/detail/new/edit/roster dashboard routes with exact-active-league context, scoped joins, explicit field projections, bounded pickers and current-authority controls. Batch 21 replaces the registration create/approve/reject/confirm-fee writers and adds withdraw with exact-active-league locked review transitions and scoped bounded review reads. Batch 22 replaces the destructive tournament hard-delete with a locked, audited cancel/archival that never cascades and preserves registration, team and match links. Batch 23 scopes fan-follow mutations/reads to the exact active league with the `fan:follow` membership check and the account UUID (fixing a Clerk-vs-UUID bug that made team/player follow state always false). Batch 24 scopes the stats, stats/compare and scoring dashboard reads to the exact active league with explicit `stats:read`/`match:read` membership checks, league-scoped child (player/team/scorecard) joins, bounded reads and failure propagation, removing the primary-membership fallback and the silent empty-leaderboard/empty-console catches. Batch 25 scopes the tournament dashboard list and creator to the exact active league (`tournament:read`/`tournament:create`), replacing the whole-league N+1 counts with league-scoped aggregated queries, bounding the list and propagating failures instead of returning a fake empty list. Batch 26 replaces the registration open/close writers with locked, audited exact-active-league transitions that recheck the owner, refuse an archived tournament and refuse to open registration outside the draft/registration phase. Batch 27 replaces the tournament create/update repository writes with locked, audited exact-active-league transactions (owner recheck under lock, per-league unique-slug pre-check plus unique-violation mapping). Batch 28 replaces the settings/billing/invoices/white-label destinations' page-level `getMyTenant` + silent-redirect/`SELECT *`/empty-list handling with the shared fail-closed `requireActiveLeagueContext` gate plus scoped, projected, bounded readers in `lib/league-settings-reads.ts` (`getMyTenant` was already membership-verified, so this is a protocol/fail-closed/projection change, not a cross-tenant fix), sharing one active-league resolution with the white-label writer. Batch 29 replaces the tournament-detail page's unconditional mutation controls with exact-active-league permission gating: the page resolves `tournament:read` through `requireActiveLeagueContext`, 404s a row whose `tenantId` is not the resolved league, and renders edit/archive/registration controls and the self-service registration CTA only for the roles that actually hold `tournament:update`/`tournament:delete`/`tournament:manage_registrations`/`registration:create`. Batch 30 replaces the self-service `/dashboard/registrations/new` page's three-action `try/catch` — which silently redirected to `/dashboard/league/setup` and rendered empty pickers on any failure, including authorization denials — with `requireRegistrationReadContext("registration:create")` and bounded, tenant-scoped team/tournament/player pickers from a new `readRegistrationFormOptions` in `lib/registration-reads.ts`; read and authorization failures now propagate to the error boundary. Remaining venue writers, the registrations review-queue catch-redirect, the `dashboard-context`/notifications/league-setup destinations, remaining admin APIs, public/anonymous follow and publication writers still require review. This does not implement a purge/refund/slot-release or waitlist lifecycle, immutable playing XI, scoped multiple grants, stale-operator CAS, database-wide quota constraints or full ISO-04 acceptance.
  Batch 28 scoped the settings, billing, invoices and white-label destinations through the shared fail-closed `requireActiveLeagueContext` and `lib/league-settings-reads.ts`. Batch 29 gated the tournament-detail page's mutation controls on the exact-league role. Batch 30 scoped the self-service registration form and its pickers. Batch 31 added league venue management (`venue:read`/`venue:manage` RBAC, bounded `lib/venue-reads.ts`, locked/audited `lib/venue-writes.ts`). Batch 32 made the registration review queue fail loud instead of redirecting. Batch 33 scopes the personal notification read/write paths and the notifications route to the exact active league through a verified-membership gate (`lib/notification-reads.ts`, `app/actions/notifications.ts`), rejecting `super_admin`/remapped/suspended/foreign access, validating ids and re-asserting the tenant/ownership predicate on every mutation; `notifications.ts` no longer uses direct `db` and left the `no-unscoped-queries` allowlist. Batch 34 adds a public publication boundary (`lib/public-visibility.ts`) derived from the existing lifecycle columns, gating the unauthenticated match/live/tournament routes and the scorecard PDF export so a `draft`/`cancelled` tournament, a `cancelled` match and any match under an unpublished parent now 404, and scoping the public `/leaderboards` hub (previously aggregated across **every** tenant) to the request-host league and published competitions only. Batch 35 gates the league-setup page on *ownership* (`getMyOwnedTenant()`, matching the `createTenant` cap that previously walled member-only accounts off from creating their own league) and enforces the one-league cap under an actor row lock with an in-transaction re-check plus `23505` slug mapping. Batch 36 removes `follows.ts` and `registrations.ts` from the allowlist (both are pure delegates with zero direct `db`), and anonymous follow reads are confirmed tenant-scoped (`0`/`false`/`[]`). The remaining admin APIs, `matches`/`scorecards`/`player-ids`/`users-invites` allowlist migrations, private contact-field/exports/sockets and notification fan-out still require review.
- [ ] **ISO-05:** Add authoritative league membership status/expiry and resource-scoped grant design; separate platform roles.
  Local active/suspended status and version are implemented; expiry, scoped multiple grants and platform-grant redesign remain open.
- [ ] **ISO-06:** Reconcile and safely retire legacy `users.role` / `tenantIds` authorization fallback.
  Fallback is removed in selected source helpers and the proposed RLS migration. Legacy data/identity bridges and deployed consumer/grant inventory still require review.
- [ ] **ISO-07:** Enforce tenant-consistent relationships, grants/RLS and service-role safeguards with real DB tests.
- [ ] **ISO-08:** Scope uploads, exports, caches, search, notifications/jobs and sockets; define public/private publication boundaries.
- [ ] **ISO-09:** Implement safe workspace switching, context indicators and isolated offline/client caches.

Exit: A/B/C league scenario passes across every private data/mutation boundary, including direct crafted requests.

### Phase 2 - Settings, member controls and OTP

Existing invitation token storage/atomic claiming and match-scorer assignment are reusable foundations, not a checked complete OTP product.

- [x] **IAM-01:** Replace league UI operations that mutate global roles/status with authorized league-only membership commands (Batch 7 source/tests; migration/deployment gates remain open).
- [ ] **IAM-02:** Build Members and access list/detail UI with scoped role/status/expiry/assignment and save-confirmed toggles.
  Batch 7 provides the owner-only list, confirmed role changes, suspension/reactivation confirmation, protected access, workspace/version assertions and an honest 100-row search boundary. Detail/scoped grants, expiry, assignment integration and pagination remain open.
- [ ] **IAM-03:** Implement provider-verified invited-email OTP/login and atomic recipient/expiry/revocation/scope redemption.
  Batch 8 replaces application-email trust with provider-verified Clerk identity and transactional issuer/recipient/league/invitation/team rechecks. Provider-managed OTP/login and authenticated staging acceptance remain open.
- [ ] **IAM-04:** Add accurate queued email/delivery/bounce/retry states; eliminate secret-link logging and false delivery success.
  Batch 7 fixed logging/false delivery claims; Batch 9 persists the last dispatch outcome and attempt count with a distinct idempotency key; Batch 11 adds a signature-verified provider webhook that records `delivered`/`bounced`/`complained` correlated by an `invite_id` tag. A durable send queue and automatic retries are not implemented.
- [ ] **IAM-05:** Implement activate/suspend/reactivate/remove/revoke/resend with version checks, idempotency and audit history.
  Batch 9 adds version-checked, audited membership removal (refused while team/scorer assignments exist) and invitation resend (rotated token, cooldown, audit). Full lifecycle idempotency across every command and staging proof remain open.
- [ ] **IAM-06:** Support primary/backup scorer assignment through settings and pending membership acceptance.
  Batches 10/13/15 add primary/backup slots, exact-tenant candidates, canonical backup-write enforcement, dashboard/removal integration, shared-lock transactional assignment and atomic before/after audit. Pending-membership assignment, stale-operator conflict checks, handover/fencing and real-PostgreSQL concurrency proof remain open.
- [ ] **IAM-07:** Implement last-owner safeguards, delegated grants and two-party ownership transfer.
  Batch 12 adds a two-party handover: only the recorded owner (`tenants.owner_id`) may initiate, only the named recipient may accept, and acceptance atomically promotes the recipient, demotes the outgoing owner to a chosen non-owner role and re-points `owner_id`, so the league is never left ownerless. Ordinary member CRUD already refuses every owner/platform/self edit. Delegated (resource-scoped) grants and real-PostgreSQL proof of the handover remain open.
- [ ] **IAM-08:** Enforce privileged MFA/step-up and recovery; no silent factor downgrade or client-only sensitive checks.
- [ ] **IAM-09:** Verify OTP abuse/outage, concurrent invitation acceptance and A/B/C revocation in authenticated staging.

Exit: invite `aliscorer@gmail.com` -> verify -> accept -> activate -> assign -> score -> suspend/revoke works without affecting another league.

### Phase 3 - League, team, captain and player registration

- [ ] **REG-01:** Complete platform league-application/review/activation flow and duplicate-provisioning safeguards.
- [ ] **REG-02:** Audit/harden existing league-scoped team/player CRUD; archive/history policies and scoped manager/team-owner assignments.
- [ ] **REG-03:** Implement complete tournament application, needs-information/waitlist/approval/withdrawal workflow.
- [ ] **REG-04:** Separate registration approval, fee status and squad eligibility; verify related same-league resources.
- [ ] **REG-05:** Add captain/coach/player invitations, availability, self-profile and correction-request journeys.
- [ ] **REG-06:** Implement squad/transfer/participation rules, account-less players, minors/guardian consent and historical membership.
- [ ] **REG-07:** Test manager scope, own-application approval denial, deadline/capacity races and duplicate submissions.

Exit: super-admin/organizer -> league -> manager -> captain/player -> approved registration completes with role-specific limitations.

### Phase 4 - Competition operations and readiness

- [x] **COMP-01:** Persist/read/copy validated wizard match type, overs, location, seeds, fees, prizes and bounded branding (Batch 4).
- [x] **COMP-02:** Apply row-locked partial configuration updates and preserve unspecified settings (Batch 4).
- [ ] **COMP-03:** Add durable tournament draft/request-key creation recovery and authenticated reload/copy/upload acceptance.
- [ ] **COMP-04:** Bind real approved registrations to seeds; generate fixtures with conflict/availability/rest checks.
- [ ] **COMP-05:** Implement rule-versioned points/NRR/tie-breakers/groups/bracket advancement and reviewed result correction effects.
- [ ] **COMP-06:** Implement eligible XI/official approval, toss decisions and real match-readiness dashboard.
- [ ] **COMP-07:** Add rescheduling, forfeits/disputes, competition locks and scoped notices.

Exit: approved squads produce valid fixtures and readiness; final results update the correct competition deterministically.

### Phase 5 - Canonical match day, offline and live updates

- [x] **SCORE-01:** Explicit batter/extras deltas, legal-ball aggregates and monotonic delivery sequences (Batch 2).
- [x] **SCORE-02:** Stable required operation IDs, accepted replay deduplication and replay-after-undo rejection (Batch 2).
- [x] **SCORE-03:** Exact validated event undo/projection reconciliation; block ambiguous legacy-extra reversal (Batch 2).
- [x] **SCORE-04:** Retain failed/unconfirmed web/mobile queue items and server-confirmed web undo (Batch 2; mobile auth still incomplete).
- [x] **SCORE-05:** Validated full snapshot initialization/reconnect and chase/super-over hydration (Batch 3).
- [x] **SCORE-06:** Web actor UUID and transactional account/tenant-role/assignment checks on canonical mutations (Batch 5).
- [x] **SCORE-07:** Basic team/player-side roster eligibility and delivery/undo actor metadata (Batch 5; not full XI/lifecycle audit).
- [ ] **SCORE-08:** Implement approved mobile identity/BFF transport and shared normalized delivery contract.
- [ ] **SCORE-09:** Add full membership expiry/suspension checks after Phase 1 and account/league/match-scoped queues.
- [ ] **SCORE-10:** Implement full supported cricket rules, immutable XI/substitution eligibility and audited legacy corrections.
- [ ] **SCORE-11:** Add durable revisions, conflict reconciliation, writer fencing/handover and multi-tab/device tests.
- [ ] **SCORE-12:** Add transactional outbox, idempotent consumers and recovery across instances.
- [ ] **SCORE-13:** Protect private HTTP/socket reads and publication lifecycle; expand rich Match Center/overlays.
- [ ] **SCORE-14:** Verify real concurrent PostgreSQL writes, auth expiry, interrupted queues and deployed live fan-out.

Exit: one accepted ball yields one durable scoring effect and convergent authorized clients despite retries, outages, revocation and reconnects.

### Phase 6 - Public hub, records, awards and prizes

- [x] **PUB-01:** Correct dashboard team/innings score attribution and page-load freshness/error disclosures (Batch 6).
- [ ] **PUB-02:** Implement publication-approved cross-league hub/read models and protected private/unlisted behavior.
- [ ] **PUB-03:** Expand verified player records, format-aware leaderboards, minimum qualifications and consented career linkage.
- [ ] **PUB-04:** Implement official awards, fan-favorite separation, disputes and correction provenance.
- [ ] **PUB-05:** Implement configurable prize categories/currency/sponsors, approval and truthful payout records.
- [ ] **PUB-06:** Verify public field allowlists, minor consent, withdrawal/cache invalidation and unauthorized export/socket access.

Exit: common users can browse published leagues and records without any private operational/contact/financial leakage.

### Phase 7 - Role UX, engagement and analytics

- [x] **UX-01:** Role-aware dashboard, organizer first-record setup/tasks and scorer assignment shortcuts (Batch 6).
- [x] **UX-02:** Accessible loading/empty/unavailable server-rendered dashboard states, focus/touch/reduced-motion class contracts (Batch 6; browser certification open).
- [ ] **UX-03:** Complete manager/captain/coach/player/official role journeys, localized/RTL/timezone preferences and durable forms.
- [ ] **UX-04:** Verify keyboard, screen reader, contrast, outdoor/mobile layout and poor-network journeys on devices.
- [ ] **FAN-01:** Harden reactions and add moderated polls/votes, report/block and anti-abuse tooling.
- [ ] **FAN-02:** Add scoped follows/notifications, consent/quiet hours, deduplication and provider delivery tracking.
- [ ] **FAN-03:** Add milestone/share cards, hall of fame, recap/highlight tools and approved analytic packages.
- [ ] **FAN-04:** Gate/labeled AI summaries and any prediction features; never change official scores or present estimates as facts.

Exit: complete role journeys and engagement are usable, accessible, consented and moderated; fan actions cannot change official decisions.

### Phase 8 - White-label and commercial operations

- [ ] **PREM-01:** Audit existing branding/domain/billing scaffolding and approve concrete tiers, limits/currency and grace policies.
- [ ] **PREM-02:** Implement server-rendered Brand Studio draft/publish/rollback across app, public pages, emails, scorecards and overlays.
- [ ] **PREM-03:** Complete verified domain/sender/HTTPS lifecycle, tenant-switch cleanup and login/socket-origin acceptance.
- [ ] **PREM-04:** Implement sponsor/broadcast placements, scoped access and premium reporting/exports.
- [ ] **PREM-05:** Verify payment webhooks/providers, reconciliation/refunds, plan enforcement and upgrade/downgrade/restriction recovery.
- [ ] **PREM-06:** Add enterprise capabilities only after security/usage gates: scoped APIs/webhooks, SSO, multi-league organization controls and support/audit exports.

Exit: brand/domain/entitlement/payment journeys are proven end to end; no placeholder gateway or security paywall.

### Phase 9 - Reliability, compliance and launch acceptance

- [ ] **REL-01:** Run full real two-league RLS/constraint/service-role isolation and concurrency suite.
- [ ] **REL-02:** Run authenticated browser/mobile OTP/CRUD/registration/live-scoring journeys and interruption recovery.
- [ ] **REL-03:** Verify socket fan-out/load, fairness quotas, live-latency targets, cache invalidation and outbox recovery.
- [ ] **REL-04:** Verify storage/uploads/exports, incident/abuse procedures, data retention and applicable privacy/minor policies.
- [ ] **REL-05:** Perform backup restore, migration rollback, secret rotation and lost-account/device recovery drills.
- [ ] **REL-06:** Verify paid-provider/domain/email integrations in permitted test/staging modes.
- [ ] **REL-07:** Complete release checklist, deployment/rollback runbooks, owner approvals and truthful feature documentation.

Exit: measured staging evidence and an approved rollout. Unit success or a plan file cannot close this phase.

## 17. Delivery Gates, Metrics and Next Batch

### Batch definition of done

1. Select stable task IDs; record actor/resource/state rules and acceptance scenarios before code.
2. Sync with `main`; inspect existing schemas/source and preserve unrelated work.
3. Implement a small complete vertical slice, not a disconnected UI or alternative scoring writer.
4. Test affected shared/source logic and negative paths. Use real staging for concurrency/auth/provider claims.
5. Review intended changes and migration/rollout/rollback implications; do not write remote databases without the separately authorized workflow.
6. Update checklists with commit, scope, commands/results, remaining acceptance and blockers.
7. Commit/push normally and verify remote delivery. Builds run only when requested; retain the user's test-only implementation-session workflow.

### Proposed metrics (targets, not current measured guarantees)

| Metric | Initial acceptance direction |
| --- | --- |
| Tenant isolation | Zero unauthorized cross-league reads/writes in required negative test matrix |
| Score integrity | Exactly one durable scoring effect per accepted operation; deterministic tested replay/correction |
| Revocation | Next authorized operation respects committed revocation; test in-flight ordering explicitly |
| Live latency | Target p95 committed-score-to-viewer below 2 seconds under an agreed documented load |
| Queue recovery | No unconfirmed command silently discarded; visible conflict/rejection/retry path |
| Email/OTP | Accurate provider status, bounded abuse, no replay/secret logs, verified-recipient acceptance |
| UX | Tested responsive role journeys and relevant WCAG 2.2 AA criteria; no blanket claim before audit |
| Recovery | Agree RPO/RTO after infrastructure inventory and prove them through restore drills |
| Commercial | No entitlement activation or settlement based on unverified client success/placeholder provider |

### Next implementation batch

**Updated after Batch 35:** The league-setup page now gates on *ownership* (`getMyOwnedTenant()`), matching the `createTenant` one-league cap that previously walled member-only accounts off from creating their own league, with lookup failures propagating to a new `league/setup/error.tsx`; and the `createTenant` cap is enforced under an actor row lock with an in-transaction re-check (previously a racy pre-check with no `owner_id` unique index), plus `23505` slug unique-violation mapping. **Updated after Batch 34:** The public (unauthenticated) surface now has a real publication boundary. `lib/public-visibility.ts` derives publication from the existing lifecycle columns and gates `matches/[matchId]`, `matches/[matchId]/live`, `tournaments/[id]`, the scorecard PDF export and `/leaderboards`; a `draft`/`cancelled` tournament and a `cancelled` match, and any match under an unpublished parent tournament, now 404. The public leaderboard, which previously aggregated `player_season_stats`/`players` across **every** tenant, is now scoped to the request-host league and only counts published competitions. **Updated after Batch 33:** Personal notification read/write paths now resolve the exact active league through a verified-membership gate (`lib/notification-reads.ts`), rejecting `super_admin`/remapped/suspended/foreign access with UUID-validated, tenant-filtered mutations, bounded readers and a fail-closed page/error boundary; `notifications.ts` no longer uses direct `db`. **Updated after Batch 32:** The league registration review queue (`dashboard/registrations`) now decides access with the non-throwing `resolveRegistrationReviewAccess()` in `lib/registration-reads.ts`, so only genuine non-owners are bounced to the dashboard and tenant/membership/read failures reach the route's `error.tsx` instead of a benign redirect. League venue management is now a first-class surface: `venue:read`/`venue:manage` RBAC plus a gated **Venues** nav item, bounded tenant-scoped `lib/venue-reads.ts` readers, and locked/audited `lib/venue-writes.ts` create/update/archive writers whose lock order is account → league → membership → venue row and whose archive is an `isActive` compare-and-set (never a delete, because `matches.venueId` is `ON DELETE SET NULL`), with per-league unique names mapped to one friendly error and `dashboard/venues` list/new/edit routes that propagate failures instead of rendering a fake empty list. Team/player create/update and add/remove roster writers use exact-active-league transactions, locked authority, shared capacity/eligibility checks and serialized create quotas. Core list/detail/new/edit/roster dashboard routes use the same active-league context, scoped joins, explicit field projections, bounded pickers and current-authority controls. Registration create/approve/reject/withdraw/confirm-fee writers now use exact-active-league locked review transitions with capacity/squad checks and atomic minimal audits, and registration review reads are scoped and bounded. Tournament removal is now a locked, audited cancel/archival that never hard-deletes or cascades, and registration open/close is a locked, audited transition that refuses archived or non-registration-phase tournaments. Tournament create/update are now locked, audited exact-active-league writes with a post-wait owner recheck and per-league unique-slug handling (both a pre-check and a unique-violation mapping) instead of repository `insert`/`updateWithLock` with no audit or duplicate-slug error. The settings, billing, invoices and invoice-detail destinations now resolve the active league through the shared fail-closed `requireActiveLeagueContext("settings:manage")` gate and read the league identity/branding, invoice history and white-label requests only inside that league through `lib/league-settings-reads.ts` with explicit projections and bounds, replacing page-level `getMyTenant` calls that silently redirected to the dashboard on denial and `SELECT *`/empty-list reads; the white-label writer shares the same active-league resolution and the redundant unscoped read action is removed. The tournament-detail page now resolves `tournament:read` through `requireActiveLeagueContext`, 404s a row whose `tenantId` is not the resolved league, and renders the edit link, archive button, registration open/close toggle and the self-service registration CTA only for roles that actually hold `tournament:update`, `tournament:delete`, `tournament:manage_registrations` or `registration:create` (was unconditional). The self-service `/dashboard/registrations/new` page now resolves the exact active league (`registration:create`) and reads bounded, tenant-scoped team/tournament/player pickers through a new `readRegistrationFormOptions`, replacing a `try/catch` that silently redirected to `/dashboard/league/setup` and rendered fake empty pickers on any failure. Fan-follow write/read paths now resolve the exact active league, check `fan:follow`, store and match the account UUID (not the Clerk identity), assert the same-league target and scope counts/lists by tenant. Stats, stats/compare and scoring dashboard routes now resolve the exact active league, require `stats:read`/`match:read` on an active membership and read leaderboards, comparison scorecards and console matches only inside that league with bounded reads and propagated failures. The tournament dashboard list and creator now resolve the exact active league (`tournament:read`/`tournament:create`), aggregate team/match counts with tenant-scoped queries, bound the list and propagate failures. Full `ISO-04` and `IAM-03/04/05/06/07` remain incomplete. `BASE-04/05/06` schema/grant reconciliation and real PostgreSQL two-session acceptance remain the release priority. Next source work: the remaining venue writers, then public/anonymous follow, publication and notification paths. Review private contact-field exposure and archived-row behavior rather than treating a scoped writer as proof of safe reads. Archive/cancel is not a quota-release, refund, slot-release or restore workflow. Historical import/correction needs an explicit canonical audited design, not re-enabling direct inserts. Public visibility/private sockets/exports, scoped grants/step-up, pending assignments, stale-operator CAS, durable email retries, lifecycle fan-out and writer fencing stay open.

- Inspect current membership data/schema and all user-management readers/writers.
- Define platform-account versus league-member authority and scoped audit requirements.
- Design/backfill membership status safely; preserve existing identities and historical records.
- Replace league role/status changes that currently mutate global user columns.
- Add a confirmed-save Members and access UI using one active tenant; update every enforcing path, including canonical scoring, so a visual toggle is not a false security control.
- Test Ali as active/assigned in A, suspended in B and outsider in C, including concurrent status changes and retained offline operations.
- Keep the OTP invitation expansion as the following complete slice (`IAM-03/04/05/06`), after membership authority works. Do not ship a scorer activation UI that the backend ignores.

### 2026-10-12 — Batch 7: membership isolation and safe member controls

**Implementation:**

- New local membership `status` (`active`/`suspended`) and version columns/constraints, reviewed-source backfill for missing legitimate memberships, and a database version trigger. Existing explicit memberships/global accounts/assignments are preserved.
- Owner-authorized, tenant-asserted role/status commands replace global user writes. Users/league/memberships are locked in a defined order; actor authority is rechecked after locks. Conditional version changes and before/after audit insertion share one transaction.
- Ordinary CRUD cannot edit self, any owner, recorded primary owner or platform account/grant, nor grant owner/platform roles. This protects the last owner by blocking all ordinary owner edits; two-party ownership transfer is NOT implemented.
- Members and access is available through Settings and the existing users route, with controlled/server-confirmed role values, league-only status wording, confirmation, conflict/errors, protected rows and distinct platform account status. List/search is capped at 100 loaded members, not complete pagination.
- Web RBAC, dashboard, scorer candidates, canonical scoring writes and exported database membership helpers require explicit active memberships; missing rows and errors cannot upgrade via global roles/arrays. Known inactive hosts do not switch to a primary league. Host lookup behavior for unknown/removed domains still needs a fuller audit.
- Shared `getMyTenant()` is now host-first and membership-authorized, reducing guard/query workspace mismatches. Dashboard denial/unavailability hides private children as UX defense; individual server actions/pages must still authorize their reads.
- Canonical record/undo/create-innings/complete-innings/complete-match transactions reject suspended memberships and inactive leagues, without accepting offline commands or removing retained work. Owner oversight requires an explicit active owner membership; global platform status alone does not grant scoring.
- Invite acceptance cannot reactivate suspended members/accounts; the claim rechecks pending state, tenant and expiry in the transaction. Provider-verified recipient/OTP and current inviter/resource authority remain unfinished. Email dispatch no longer logs secret links or calls provider acceptance delivery.
- Private invitations/scorer contact lists require management permissions. Notification queries scope personal as well as league-wide rows to the active league.
- Local migration updates `current_tenant_id()` to active account/member/league joins with no legacy array fallback, checks global account activity for the existing platform override, and revokes direct `anon`/`authenticated` mutations of users/memberships. Existing RLS identity resolution still uses the legacy UUID/email bridge: Clerk string-subject compatibility is NOT implemented or certified.
- The repository-defined VPS deployment job is default-off until `LEAGUE_MEMBERSHIP_CONTROLS_READY` is explicitly set to `true` after rollout gates. This does not inspect/control external hosting Git integrations.

**Evidence and boundaries:**

The exact commands/results are recorded in the historical master plan's Batch 7
entry. Tests exercise source, mocked authentication/database/services, SQL
construction/migration contracts, and server-rendered/stubbed UI. They do not
execute the migration, prove PostgreSQL locks/RLS/rollback, deliver real email,
exercise OTP, certify browser/device behavior or demonstrate production uptime.

Supabase CLI was used to create the local migration. Docker is unavailable in
this environment, so no local Supabase stack/migration execution ran. No remote
database, provider/authentication configuration, production deployment, build,
lint or standalone type-check was performed. The Context7 endpoint was
unreachable; current official Drizzle transaction documentation and the Supabase
changelog were read directly instead.

**Release blocker:** follow [Batch 7 rollout gates](../supabase/MIGRATION_STATUS.md)
before deployment. Deploy workspace database/UI artifacts, web and scoring
service together after schema/identity/grant review. Do not roll back to binaries
that ignore suspension while preserving an expectation of revoked access.

### 2026-10-12 — Batch 8: provider-verified invitation redemption

Recorded retroactively; the code was committed as `a49ea77` before this plan was
updated, so this entry documents existing source rather than new work.

**Implementation:**

- Invitation acceptance no longer trusts an application-email match. The recipient
  must present a Clerk session whose verified email equals the invited address;
  acceptance rechecks the issuer's active league-owner authority, the league, the
  recipient account, the exact invitation row and the team resource under ordered
  locks in one transaction.
- Acceptance cannot promote, demote or reactivate a suspended membership, cannot
  mutate global `users`/legacy tenant arrays, and refuses team-scoped coach/scorer
  grants the one-role schema cannot represent.
- Issuance/revocation moved to tenant-asserted owner commands with atomic audit
  rows and bounded, idempotent provider dispatch. Delivery states are honest
  (`unconfigured`/`provider_accepted`/`failed`/`unknown`); provider acceptance is
  never reported as delivery. Preview masks the invited email for bearer links and
  signed-out visitors.

**Boundary:** real provider delivery/webhooks, provider-managed OTP code journeys,
PostgreSQL locking/rollback and browser interaction remain staging gates.

### 2026-10-13 — Batch 9: membership removal, invitation resend and persisted dispatch state

**Implementation:**

- **IAM-05 removal:** `removeMember` deletes one league membership only, with the
  same user → league → membership lock order as member edits, a version check, an
  atomic before/after audit row and the same owner/self/platform protection.
  Removal is refused while the member still manages a team or is an assigned
  scorer, so a live match or team cannot be silently orphaned. The global account
  and historical match/statistics records are untouched.
- **IAM-05 resend:** `resendInvite` re-dispatches a pending invitation with a
  freshly rotated token (the old link is invalidated), rechecks owner authority,
  tenant, status and expiry under lock, enforces a 60-second cooldown from the last
  attempt and audits the action. The original expiry is kept, so a resend cannot
  extend an invitation indefinitely.
- **IAM-04 persistence:** `user_invites` gains `email_state`, `email_attempted_at`
  and `email_attempt_count`. The last dispatch outcome is persisted after the
  invitation is committed (best-effort; a bookkeeping failure cannot roll back a
  saved invitation) and each attempt uses a distinct provider idempotency key so a
  resend is not deduplicated. The Members UI shows a truthful delivery state and a
  Resend control; the members table gains a confirmed Remove action.
- **Schema/migration:** additive, idempotent
  `supabase/migrations/20261013090000_invitation_delivery_state.sql` (local only;
  not applied). `packages/database` was rebuilt after the schema edit.

**Evidence:** web **610 tests / 33 files** pass, database **123 / 7** pass (see the
historical master plan's Batch 9 entry for exact commands). No build, lint,
standalone type-check, migration execution, remote database write, deployment or
new dependency install was performed. Web type-check still reports three
**pre-existing** errors in files this batch did not touch
(`__tests__/dashboard-data.test.ts`, `__tests__/member-view.test.tsx`,
`app/matches/[matchId]/scoring/page.tsx`); they reproduce at the batch baseline.

**Remaining acceptance:** real PostgreSQL locking/rollback, provider delivery and
bounce webhooks, authenticated browser journeys (remove/resend/cooldown/conflict),
and the still-open `IAM-07/08` and scoped grants/expiry remain staging work.

### 2026-10-13 — Batch 10: primary/backup scorer assignment

**Implementation:**

- **Schema:** `matches.backup_scorer_id` (nullable FK to `users`, `ON DELETE SET
  NULL`) plus a distinct-slot check constraint and an index, in additive,
  idempotent `supabase/migrations/20261013120000_match_backup_scorer.sql` (local
  only; not applied). `packages/database` rebuilt after the schema edit.
- **Assignment (`assignScorer`):** now takes a slot (`"primary" | "backup"`) and a
  nullable scorer id. It loads the exact tenant-scoped match, validates the target
  as an active scorer-role member of that league (same `scorerMembership`
  contract), refuses to place the same person in both slots, and updates only the
  selected column. `null` clears a slot.
- **Scoring access (`canScoreMatch`):** either the primary or the backup assigned
  scorer may record for the match; role (`league_owner`/`scorer`) and active-account
  checks are unchanged. The league owner retains oversight.
- **UI:** the match page's scorer panel now offers separate Primary and Backup
  selects (with an explicit Unassigned option) and passes `currentBackupScorerId`.

**Evidence:** web **618 tests / 33 files** pass, database **123 / 7** pass, database
build passes, eslint clean on changed files (see the historical master plan's
Batch 10 entry for exact commands). Web type-check reports the same 11 **pre-existing**
error lines in three untouched files; this batch added none.

**Deliberately open:** assigning a scorer whose membership is still pending
acceptance, and handover/fencing between the two scorers — without an epoch, both
assigned scorers can write concurrently, which the Phase 5 revision/fencing work
addresses. Real PostgreSQL constraint enforcement and authenticated browser
journeys remain staging gates.

### 2026-10-13 — Batch 11: verified invitation delivery webhook

**Implementation:**

- **Webhook:** new `POST /api/webhooks/resend` (`apps/web/src/app/api/webhooks/
  resend/route.ts`). It fails closed with **503** when `RESEND_WEBHOOK_SECRET` is
  unset, requires the Svix headers, verifies the signature before parsing, and
  never logs the payload (it contains the recipient address).
- **Correlation:** outgoing invitation emails now carry an `invite_id` tag, so an
  event is matched to its invitation without trusting an email address.
- **Mapping/apply library** (`apps/web/src/lib/invitation-delivery.ts`):
  `email.delivered → delivered`, `email.bounced → bounced`,
  `email.complained → complained`; all other events are ignored. Unmapped events,
  missing tags and unknown invitations return `applied: false` rather than
  throwing, so a provider retry is an idempotent no-op.
- **Schema/migration:** `InvitationEmailState` gains `delivered`/`bounced`/
  `complained`; the `user_invites_email_state_check` constraint is widened in
  additive, idempotent `supabase/migrations/20261013150000_invitation_delivery_events.sql`
  (local only; not applied). `packages/database` rebuilt.
- **UI:** the invite manager's delivery column now renders Delivered / Bounced /
  Marked-as-spam.
- **Env:** documented `RESEND_WEBHOOK_SECRET` in `.env.example`.

**Evidence:** web **638 tests / 35 files** pass (14 delivery-mapping + 6 webhook
route tests new), database **123 / 7** pass, database build passes, eslint clean on
changed files (see the historical master plan's Batch 11 entry). Web type-check
reports the same 11 **pre-existing** error lines in three untouched files; this
batch added none.

**Deliberately open:** a durable send queue and automatic retries (a failed send
still requires a manual resend); real provider webhook delivery; real PostgreSQL
constraint enforcement.

### 2026-10-13 — Batch 12: two-party league ownership transfer (IAM-07)

**Implementation:**

- **Schema:** new `ownership_transfers` table
  (`packages/database/src/schema/ownership-transfers.ts`) with `tenant_id`,
  `from_user_id`, `to_user_id`, the outgoing owner's `demoted_role`, `status`
  (`pending`/`accepted`/`cancelled`/`expired`), a concurrency `version`,
  `expires_at`, `resolved_at`/`resolved_by` and audit timestamps. Declared checks
  cover the status set, `from_user_id <> to_user_id`, `version >= 0` and
  `demoted_role NOT IN ('league_owner','super_admin')`; a partial unique index
  (`WHERE status = 'pending'`) permits at most one open request per league.
- **Migration:** additive, idempotent
  `supabase/migrations/20261013180000_ownership_transfers.sql` (local only; not
  applied). It enables and forces RLS and revokes all access from `anon`/
  `authenticated`, granting only `service_role`. `packages/database` rebuilt.
- **Actions** (`apps/web/src/app/actions/ownership.ts`):
  `initiateOwnershipTransfer`, `acceptOwnershipTransfer`,
  `cancelOwnershipTransfer` and `getOwnershipTransfer`.
  - Initiation requires an active owner context **and** that the caller is the
    recorded `tenants.owner_id` (an owner-role junction row alone is not enough).
    It refuses self, suspended, owner-role and platform recipients, and refuses
    while a live request exists (a lapsed one is swept to `expired` first).
  - Acceptance is restricted to the named recipient; it re-verifies under lock
    that the initiator is still the recorded owner with active owner access, that
    the recipient membership is active, and that the request is pending,
    unexpired and at the expected version.
  - The handover is one transaction: promote the recipient to `league_owner`,
    demote the outgoing owner to `demoted_role`, re-point `tenants.owner_id` (only
    while it still names the outgoing owner) and record an `accepted` row, with a
    before/after `OWNERSHIP_TRANSFER_ACCEPT` audit row. Every write is conditional
    on the version read under lock, so a concurrent change rolls the whole
    handover back rather than half-applying it.
  - Locks follow the established order — users `FOR UPDATE`, then the league
    (`FOR SHARE` on initiate/cancel, `FOR UPDATE` on accept because it rewrites
    `owner_id`), then memberships, then the transfer row.
  - Either party may cancel; a third party cannot. Every state change is audited
    (`OWNERSHIP_TRANSFER_INITIATE`/`ACCEPT`/`CANCEL`).
- **UI:** `OwnershipTransferPanel` on the Members page (recorded owner offers
  ownership, chooses their own post-transfer role, and can cancel) and
  `OwnershipTransferRequest` on the dashboard (the recipient accepts or declines
  from their own session). The offer is inert until the recipient accepts.

**Evidence:** web **673 tests / 36 files** pass (34 new action tests), database
**128 / 8** pass (5 new schema/migration contract tests), database build passes,
eslint clean on changed files. Web type-check reports the same 11 **pre-existing**
error lines in three untouched files; this batch added none. `git diff --check`
reports one warning — a trailing-whitespace false positive on the single added
line of `packages/database/src/index.ts`, whose committed blob is legacy CRLF
(most repo files are LF-normalized); the line was staged with `core.autocrlf=false`
so the diff is exactly one line and no unrelated lines were rewritten.

**Deliberately open:** real-PostgreSQL proof of the partial unique index, the
version trigger and the atomic handover; delegated resource-scoped grants
(the other half of IAM-07); and privileged MFA/step-up (IAM-08).



### 2026-10-13 — Batch 13: close backup-scorer enforcement gaps

Reviewed the recorded implementation from Batch 7 through Batch 12 against
current source and Git history. Commit IDs and the source-completion register
above replace stale status text; earlier evidence remains historical.

**Implemented:**

- Repaired a Batch 10 integration bug: the web allowed backups to score but the
  canonical scoring service still required the primary `scorerId`. The shared
  transactional write guard now accepts either slot **after** current account,
  league and exact-membership checks. All five canonical mutation callers pass
  the locked match row through that guard; no client field grants authority.
- Added backup assignments to tenant-scoped scorer dashboard selection and
  summaries, with scoring shortcuts only for an eligible scorer or league owner.
  Global platform role alone no longer offers a scoring shortcut.
- Member removal now refuses both primary and backup match assignments, so the
  owner must unassign either slot first. This does not claim assignment/removal
  races are transactionally solved: the current assignment action still uses
  pre-write eligibility reads without a shared ordered-lock protocol.
- Added regressions for backup record/replay/undo, rejected replay after backup
  revocation, all five mutation rejections, membership/role denial despite backup
  assignment, exact-tenant removal guards and backup dashboard links.

**Fresh automated evidence:** web **682 / 36 files**, database **128 / 8 files**,
scoring service **184 / 8 suites**, **994 passing tests** (+27 over the reviewed
Batch 12 baseline). Commands and boundaries appear in the historical master
plan's Batch 13 entry. Tests are mocked/SQL-construction/SSR checks, not real
PostgreSQL, multi-device writer-handover or deployed provider certification.

No new migration, remote database change, deployment, build, lint or standalone
type-check ran in this batch. Prior unapplied migrations and the default-off
deployment gate remain release blockers. Matching database workspace artifacts,
web and scoring service must deploy together after staging validation.

**Next:** transactional assignment/removal authorization/concurrency; ownership
resolution must recheck both active global accounts/current privileges and
session mapping under lock, plus fresh expiry at the final conditional write.
The current ownership cancel path acquires locks but does not reread the actor's
account/membership under those locks. These remain review findings, not fixes
silently implied by the successful unit suites. Resource-scoped grants,
privileged step-up, durable sends, pending assignments and writer fencing follow.

### 2026-10-15 — Batch 14: ownership-transfer authorization hardening

Synced clean `main` with remote `a481601` before implementation. This batch
closes the ownership-resolution source findings recorded in Batch 13; it does
not claim assignment/removal concurrency or the whole IAM-07 scope is complete.

**Implemented (`apps/web/src/app/actions/ownership.ts`):**

- Preserve the authenticated Clerk subject in the server-only actor context.
  Initiation, acceptance and cancellation compare it to the current caller's
  locked account mapping, rejecting remapped/unlinked sessions.
- Acceptance rereads both global accounts after ordered users -> league ->
  memberships -> transfer locks. The outgoing owner must still be active and
  the recorded owner with active owner membership. The recipient must still
  have active league/account access and must not have become an owner or
  platform account since the offer. Global roles/accounts are never rewritten.
- Lock and reread the exact league/transfer; reject party drift so an unlocked
  replacement party cannot be authorized. Validate persisted demotion against
  the same restricted role set used during initiation.
- The final conditional acceptance write requires exact tenant, parties,
  pending status, version and `expires_at > clock_timestamp()`. Database wall
  clock, not transaction-start `now()`, governs that claim; rejection throws
  inside the transaction before audit/success. Real rollback proof is still open.
- Cancellation rechecks the caller's account/session, active league and exact
  active membership under lock. Initiator withdrawal additionally requires
  current recorded ownership and owner membership. An active named recipient
  may decline without the other party remaining active, even after expiry:
  withdrawal grants no authority. Audit uses the current locked membership role.
- Failed expiry acceptance makes no misleading expiry update that would roll
  back with its error. The next authorized issuance conditionally sweeps a
  lapsed pending row using tenant/status/version/database-clock predicates and
  requires a returned row before issuing another offer.

**Fresh verification:** web **734 tests / 36 files**, database **128 / 8 files**,
scoring service **184 / 8 suites**; **1,046 passing tests**, +52 over Batch 13.
Ownership action coverage is now **86 tests**, including stale session/account,
recipient privilege drift, cancellation authorization, lock/read order,
SQL predicates, rejected conditional writes and audit-failure propagation.
Mocks establish call ordering and failure handling, not PostgreSQL rollback,
clock behavior, RLS or concurrent accept/cancel/account-disable correctness.

No new migration, database inspection/write, deployment, build, lint or
standalone type-check ran. The five prior local migrations remain unapplied;
the coordinated-release gate stays default-off. **Next batch:** assignment/
removal concurrency and atomic assignment audit. Privileged step-up, delegated
grants and real authenticated ownership/browser acceptance remain open.

### 2026-10-15 — Batch 15: transactional scorer assignment and removal serialization

Synced clean `main` with remote `3bf64bd`. No database schema changes were
needed. This closes the assignment/removal source gap recorded in Batches 13/14,
not the real PostgreSQL release gate or the whole IAM-06 scope.

**Implemented:**

- `assignScorer` uses one explicit READ COMMITTED transaction: exact-tenant match
  `FOR UPDATE` -> actor/candidate accounts `FOR UPDATE` in sorted UUID order ->
  league `FOR SHARE` -> exact-league memberships `FOR UPDATE` in stable order.
  The match lock serializes opposite-slot checks with assignment/scoring writers.
- After locking, recheck the caller's account activation, Clerk subject and
  active league-owner membership, plus the active league and candidate's active
  account/exact scorer membership. A global role or stale permission precheck
  does not substitute for current league authority.
- Member removal explicitly uses READ COMMITTED and keeps assignment reads
  **non-locking**, after its existing ordered account locks. It must not lock
  matches after accounts, which would invert scoring/assignment's lock order.
  If assignment wins the shared candidate-account lock, removal sees its
  committed slot and refuses; if removal wins, assignment sees missing
  membership and refuses. Clearing a slot does not require old scorer access.
- Write a `MATCH_SCORER_ASSIGN` audit with both slots before/after in the same
  transaction; audit failure prevents command success. Unchanged assignments are
  still authorized but cause no rewrite/audit. Revalidate dashboard and scoring
  views after transaction success; deployed socket/client fan-out is not proven.
- Closed an alternate writer bypass: `updateMatch` now strictly allowlists
  metadata fields rather than spreading unchecked server-action input. Crafted
  scorer/backup/tenant/identity/status fields are rejected. The existing edit
  form's allowlisted payload and omitted-field behavior are regression tested.

**Fresh evidence:** web **782 / 37 files**, database **128 / 8 files**, scoring
service **184 / 8 suites**; **1,094 passing tests**, +48 over Batch 14. Scorer
assignment tests now cover 51 cases; six deterministic transaction-double
interleavings exercise both assignment/removal orders for both slots,
opposite-slot conflicts and a staged audit failure. A removal regression checks
READ COMMITTED/read-after-lock ordering with no reverse match lock.

The scheduling double models current reads, exclusive resource locks and staged
commit/discard; it is **not PostgreSQL** and does not prove lock compatibility,
actual rollback, triggers, constraints, RLS or deadlock freedom. Staging must
repeat both two-session orders, disable/suspend/demote versus assignment,
canonical scoring versus unassignment and audit-failure rollback, checking that
no orphaned assignment or cross-league change survives. Review other writers
before extending the protocol; the team-manager-assignment race is not fixed.

No build, lint, standalone type-check, new migration, remote database operation
or deployment ran. The five prior local migrations remain unapplied and the
release gate stays default-off. No pending-member assignment, writer fencing,
operator CAS/version token or durable event notification is implied. Immediate
acceptance and next source priorities are listed in “Next implementation batch”.

### 2026-10-15 — Batch 16: lifecycle authorization and member session mapping

Synced clean `main` with remote `1ee28e4`. This is a focused `ISO-04` slice,
not a full match CRUD or league-isolation certification.

**Implemented:**

- Member role/status/removal commands preserve the authenticated Clerk subject
  and compare it with the current locked actor account. Remapped/unlinked
  identities are rejected even for no-op commands; role/status transactions now
  explicitly use READ COMMITTED, matching removal. Global accounts and roles
  remain untouched; ordinary owner/platform/self protections remain intact.
- Toss/start actions resolve the exact active league rather than an ownership/
  fallback workspace. The new server-side `match-lifecycle.ts` transaction locks
  match -> account -> league -> exact membership -> sorted match teams, aligned
  with the canonical writer. It checks current account/session, active league,
  active owner or currently assigned primary/backup scorer, and active exact-
  league teams. Global-role authority and stale prechecks cannot substitute.
- Toss winner must be a match team; toss changes stop once play starts. Start
  accepts scheduled/toss only, with an authorized live retry preserving the
  original timestamp. Neither action rewinds ended/break states. Changed commands
  atomically write before/after audits; identical retries do not rewrite/audit.
  These are transition guards, not a complete cricket-law/toss approval model.
- `endMatch` no longer writes results directly from Next.js. It checks current
  web access and proxies to the existing guarded canonical completion endpoint
  with server-derived tenant/actor headers. The proxy validates an explicit
  success/match/status acknowledgement; rejection/unavailability has no local
  fallback. The existing UI only consumes success/failure, not a local match row.
- Canonical completion accepts optional Player of the Match metadata, checks a
  locked exact-league player belongs to one of the match teams, and atomically
  audits result/award changes. This checks current team association, not historical
  XI participation. Existing canonical assignment/membership checks still run
  before completion/retry. Identical retries preserve the timestamp and award;
  legacy commands omitting an existing award do not clear it. A different explicit award
  on a completed result is rejected pending an audited correction workflow.

**Fresh automated evidence:** web **883 / 38 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **1,204 passing tests**, +110 over Batch 15.
New checks include 89 lifecycle-action cases, four member-session regressions,
eight transport/acknowledgement cases and nine canonical service/controller
cases. These mock database/auth/HTTP boundaries; PostgreSQL rollback, real lock
compatibility, authenticated UI journeys and deployed cache/event fan-out are
not established by these tests. Current Drizzle transaction docs were consulted.

**Release boundaries:** no build, lint, standalone type-check, schema change,
migration application, remote database operation or deployment ran. Prior five
local migrations remain unapplied; release gate stays default-off. Release
matching web/scoring-service code and database workspace artifacts together:
the old canonical endpoint would not persist the new optional award field.
Verify scoring-service audit INSERT grants and actual audit rollback in staging.
Next-only toss/start cache revalidation is not new Redis/Kafka/Socket.IO fan-out.

**Next:** remaining match metadata CRUD/read/stream and dashboard active-league
paths, merged partial-team/resource/date validation and safe deletion/history
rules. Team-manager assignment races, scoped grants, privileged step-up, pending
assignments, stale-operator CAS, outbox/fencing and real-DB release proof remain
open. Whole-task counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 17: match management and dashboard active-league isolation

Synced clean `main` with remote `7220a97`. No database schema changes were
needed. This implements the next match-actions/dashboard `ISO-04` source slice,
not a certification of all metadata/scorecard writers or tenant isolation.

**Implemented:**

- Match create/update/cancel/start-stream/end-stream commands resolve the active
  league and explicitly check its permission. The shared management transaction
  uses READ COMMITTED: existing exact-tenant match `FOR UPDATE` -> actor account
  `FOR UPDATE` -> league/membership `FOR SHARE` -> sorted teams -> tournament ->
  venue shared locks as needed. Creation has no existing match lock and never
  acquires one after locking the actor. Current Clerk mapping, active account/
  league and exact active league-owner membership are checked after locks;
  global roles, stale permissions and a supplied tenant cannot widen authority.
- Strict metadata allowlists protect assignment/result/status/identity fields.
  Partial edits validate the resulting stored-plus-patch team pair, not just
  supplied IDs. Both teams must be active in this league; any remaining venue
  must be active and any tournament must be draft/registration/live in this
  league. Explicit null clears optional references. Tournament participation/
  registration eligibility and historical XI validation are not implemented.
- Schedule values have bounded ISO/datetime-local syntax and calendar/time
  validation, rejecting rollover dates and invalid dates. Match numbers fit a
  positive PostgreSQL integer; pagination is bounded. Browser form submissions
  normalize local selections to ISO instants. Legacy timezone-less action input
  is still accepted with server-local interpretation; league-timezone UX and
  real device/DST acceptance remain open.
- Metadata edits/cancellation are restricted to unstarted scheduled fixtures
  with no toss/result/start/end/award markers and no innings, balls, events,
  projections or manual scorecards. History checks select only IDs and refuse
  inconsistent legacy evidence even if its child tenant is wrong. They do not
  expose that evidence. The `deleteMatch` compatibility action now cancels,
  preserving the row, assignments and history; an active stream is ended. The
  UI explicitly says **Cancel fixture**, and hides edit/cancel for progressed
  matches. No privileged correction, restore or purge workflow is introduced.
- Stream start checks the locked league's current plan and refuses ended match
  phases. End-stream still allows cleanup after plan downgrade/completion, with
  current owner authorization. URLs are bounded and disallow embedded userinfo
  and unsafe schemes (HTTPS; RTMP(S) only for the RTMP source). This is URL
  metadata management, not provider verification or working RTMP/WebRTC ingest.
- Changed management commands atomically write bounded before/after audits,
  excluding raw stream URLs/keys. Authorized cancellation/identical stream
  retries and empty metadata patches do not duplicate writes/audits. New match
  `createdBy` uses the current database actor ID. Errors have no local fallback
  or false cache success.
- Match detail/list actions, match dashboard list and new/edit pickers now use
  active-league permission checks rather than owned/default league actions.
  Detail/list auxiliary team/venue/roster/player/innings reads are tenant-scoped;
  full-scorecard detail reads use the same active-league resolver. Other
  scorecard action writers and innings-only reads remain a separate audit.

**Fresh verification:** web **1,138 / 40 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **1,459 passing tests**, +255 over Batch 16.
New suites cover 245 management/read cases and 10 server-page cases, including
revoked/remapped authority, exact tenant predicates, merged self-matches,
inactive/foreign references, legacy history, stream downgrade cleanup and audit
failure propagation. Existing creation/edit tests now model the transaction.
These mocked DB/auth/server-render tests do not prove real PostgreSQL locks,
rollback/RLS/grants, authenticated browser behavior, streaming or event fan-out.
Current Drizzle transaction docs were consulted; `git diff --check` passed.

**Release boundaries / next:** no build, lint, standalone type-check, migration,
remote database operation or deployment ran. Five prior migrations remain
unapplied and the release gate stays default-off. Existing team/player cascade
deletes can still affect historical matches; manual scorecard writers do not yet
share the match-lock protocol. Those writers/locks/deletion policies and
remaining active-league paths are the next source priority. Real two-session
revocation/edit/cancel/scoring/resource-deletion tests, audit rollback, grants,
history-query performance/index review, published visibility and reliable
lifecycle fan-out remain required. No stale-operator CAS or writer fencing was
added. Whole-task counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 18: scorecard writer boundary and roster archival

Synced clean `main` with remote `ccd0199`. This is another bounded `ISO-04`
source slice, not a migration, full team/player CRUD repair or release approval.

**Implemented:**

- A repository-wide TS/TSX search found no callers of `saveScorecard` outside its
  declaration. That legacy action directly inserted batting/bowling rows without
  canonical authorization/locking/idempotency. It is now a deprecated denial
  stub: keep the export/input type for source compatibility, authenticate and
  check the active league's permission, then reject all payloads without writing
  or reporting success. No existing scorecard data is removed. No replacement
  manual import endpoint, historical correction or per-player materialization
  workflow was introduced; supported delivery mutations remain canonical.
- Full-scorecard reads require an exact-active-league parent match. Batting and
  bowling queries also correlate the referenced innings to that same match and
  tenant, excluding inconsistent legacy hierarchy rows. Innings-only reads now
  resolve the innings in the active league, validate its parent match and filter
  children by innings + match + tenant. These are scoped reads, not serialized
  read-versus-revocation acceptance or a database constraint certification.
- `deleteTeam`/`deletePlayer` retain their compatibility names but no longer call
  repository/SQL deletes. They resolve the active league, explicitly check its
  delete permission and use a READ COMMITTED owner-only archival transaction.
  Lock current actor -> league -> exact membership -> team -> player as needed;
  recheck Clerk mapping, active account/league and exact active owner membership.
  Global roles and stale prechecks cannot substitute. Team sets `isActive=false`;
  player sets `isActive=false,status=inactive`. Identity/profile/league membership,
  roster links, scorer assignments, matches and historical scorecards remain.
- Player archival discovers its current team, locks team before player and
  rejects a changed team link after waiting rather than taking another team lock
  in reverse order. Unassigned players do not require a team lock. Both commands
  refuse when that team has scheduled/toss/live/innings-break fixtures, using a
  non-locking current read after resource locks. This conservative team-level
  rule is not playing-XI eligibility. Never add match locks after account/team
  locks: canonical scoring starts with the match. The protocol assumes other
  participating fixture writers follow the shared resource locks.
- Changed archival flags and minimal before/after audits are atomic. Already
  archived retries still reauthorize but do not rewrite timestamps/audit twice;
  failures do not invalidate caches or signal success. UI confirmation now says
  **Archive** and preserves the separate cancel/permanent-delete wording. Team/
  player detail badges identify archived records. Records may remain in existing
  list/history/quotas; no restore, purge, quota-release or list redesign is claimed.

**Fresh verification:** web **1,256 / 43 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **1,577 passing tests**, +118 over Batch 17.
New suites: **82** archival-action cases, **32** scorecard-boundary cases and
**4** confirmation-copy cases. Existing match-management tests now include the
parent/correlated innings contract. Tests cover current authority, foreign IDs,
team-link drift, no hard-delete calls, unfinished-fixture read ordering, scoped
SQL (including EXISTS parentheses), retries and audit-failure propagation. The
lock-wait fixture is a call-order double, not actual PostgreSQL interleaving;
rendered confirmation tests mock dialogs, not an authenticated browser journey.
Current Drizzle transaction/operator docs and lock-order guidance were consulted.

**Boundaries / next:** no build, lint, standalone type-check, schema change,
migration application, remote database operation or deployment ran. Five prior
migrations remain unapplied and the release gate stays default-off. Real DB
revocation/archive/create/scoring interleavings, grants, audit rollback, hierarchy
filter execution/performance and RLS remain unverified. Other team/player CRUD,
roster mutations and dashboard reads still need active-league/authorization
repair; direct admin/other cascade paths are not closed by these two wrappers.
No alternate scoring writer may be revived without an explicit canonical
import/correction design. Whole-task counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 19: transactional team/player and roster writers

Synced clean `main` with remote `9f9a508`. This is a bounded `ISO-04` writer
slice; team/player read actions and dashboard destinations are not repaired here.

**Implemented:**

- `createTeam`, `updateTeam`, `createPlayer`, `updatePlayer`, `addPlayerToTeam`
  and `removePlayerFromTeam` resolve the exact active league and explicitly check
  its permission. No mutation uses the owned/default-league fallback or legacy
  repository writes. Strict payloads reject identity/ownership/activity overposts
  and forged create tenant IDs. UUIDs, bounded fields, real nonfuture DOBs,
  credential-free HTTPS image URLs and bounded team slugs are validated. Omitted
  patch fields stay omitted; nullable clears are preserved. Non-Latin display
  names receive a nonempty fallback slug, not a renamed display value.
- Every command uses READ COMMITTED account -> league -> exact membership ->
  sorted teams -> player locking as applicable. After lock waits, recheck the
  current Clerk mapping, active account/league, exact active membership, team
  binding and resource scope. Owners may create/edit; active `team_manager`
  members may edit/manage a team only when its current manager/captain binding
  matches their account. A global/platform role or stale binding is not authority.
  Managers cannot create players/teams, edit player profiles or change tournament
  linkage. New/changed non-null tournament references require the same league
  and draft/registration/live state; only owners may change that linkage.
- Both creates serialize current plan/count checks on the exclusive league row,
  then insert and audit in that transaction. Authors use the persisted account
  UUID. All league records, including archived ones, consume existing quotas;
  structured plan-limit errors propagate unchanged. This covers participating
  helpers, not database-wide limits or unaudited admin/import writers.
- Create/edit team links and explicit roster adds share the same locked capacity
  checks. A squad-size reduction cannot go below the full linked roster count,
  including inactive/archived rows. No direct cross-team move: explicitly unlink
  first. Player team discovery is rechecked after team -> player locks; drift
  rejects without chasing a new reverse-order team lock. New joins require an
  active player and team; generic edits do not restore archived players. Locked
  inactive teams reject edits/roster commands; archived-team unlink/restore needs
  a separately reviewed workflow.
- Roster team/status eligibility changes use a current non-locking match read
  after resource locks and refuse when a team has toss/live/innings-break play.
  Scheduled fixtures are not blocked by this roster rule (archival still blocks
  them). Contact-only edits may proceed during play. No match locks are acquired
  after accounts/resources, preserving canonical scoring/lifecycle ordering.
  This is current team-level eligibility, not immutable XI/substitution policy.
- Changed rows and bounded before/after audit share one transaction. Audit carries
  linkage/status/capacity and changed field names, not profile/contact/DOB values.
  Already-authorized same-team add/already-unassigned remove retries do not
  rewrite/audit; audit failures cannot report cache success. Dashboard layout
  invalidation follows successful commits. No identities or score/history rows
  are deleted, and no competing scoring writer was introduced.

**Fresh verification:** web **1,490 / 44 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **1,811 passing tests**, +234 over Batch 18.
The new **234-case** suite covers current authority, exact league/resource
predicates, delegated bindings, strict payloads, quotas/count ordering, capacity
checks, post-lock team/eligibility drift, playing-state guards, nullable versus
omitted fields, retries and asynchronous audit-failure propagation. The older
player action fixture now exercises the transactional path rather than the
retired repository insert. Current Drizzle transaction/count docs were consulted.
These mocked SQL/call-order tests are not PostgreSQL concurrency/rollback proof.

**Boundaries / next:** no build, lint, standalone type-check, schema change,
migration application, remote database operation or deployment ran. All five
prior migrations remain unapplied; the release gate stays default-off. Prove
two-session create quotas, join/capacity races, player-team drift, roster versus
toss/start/scoring/archive/revocation and audit rollback on real PostgreSQL;
inspect grants, constraints, query plans and RLS. Team/player read actions and
dashboard ownership/context/privacy controls remain the next source slice.
Other/admin writers and tournament/venue cascades remain unaudited. No complete
registration/transfer/archival lifecycle, immutable XI, CAS, fencing, browser
acceptance or full `ISO-04` certification is claimed. Whole-task roadmap counts
stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 20: scoped roster reads and dashboard controls

Synced clean `main` with remote `0b330bb`. This is a bounded `ISO-04` read/
dashboard slice; team analytics, player ID-card list/detail and follow/publication
paths are not repaired here.

**Implemented:**

- `getTeam`, `getTeamWithRoster`, `getTeams`, `getPlayer` and `getPlayers` now
  resolve the exact active league and explicitly check the corresponding read
  permission before business SQL. They no longer use `getMyTenant`, legacy
  repository reads or owned/default-league assumptions. UUIDs and strict bounded
  filters reject forged scope, overposted fields and invalid route pages. List and
  count queries share the same tenant/filter predicates; deterministic secondary
  ID ordering prevents page drift.
- Ordinary team/player reads use explicit projections. They exclude contact,
  DOB, physical, biography, global identity/profile links and creator metadata.
  Player detail joins the team only when both IDs belong to the active league.
  Owner-only edit reads separately retrieve private profile fields; managers cannot
  obtain them through ordinary or roster reads. `addPlayerToTeam` returns only the
  player ID/name/link needed by the UI, closing a manager privacy bypass.
- Team list summaries use database-side scoped counts rather than one query per
  row. Losses count only completed matches won by the opposing side; no-result and
  abandoned fixtures are not losses. Lists are bounded to 100 rows per page and
  expose honest page totals. Archived rows remain visible/historical by design;
  no restore, purge or quota release is introduced.
- New/edit team and player routes require the exact active league and current
  owner/assigned-manager authority. Unassigned managers and archived/inactive
  resources redirect rather than receiving edit forms. Pickers query only active
  same-league ID/name fields, retain a current team outside the first 100, and
  disclose truncation. Player creation offers only active unassigned players;
  cross-team moves still require explicit unlink first.
- Detail pages authorize the parent in the active league before auxiliary reads.
  Team fixtures/opponents/innings and player scorecards/matches/tournaments are
  correlated to the same league and parent hierarchy. Player historical side comes
  from performance rows, not today's mutable roster link. Win/loss attribution
  requires a valid historical side and opposing winner; no-result/abandoned matches
  are not losses. Follow counts/current state are scoped to the same league/entity.
- Edit, roster-manager, ID-card and archive controls match current authority.
  Owners may manage active assigned teams and active players; assigned active
  team managers may manage their team roster but not private player profiles.
  Archived detail history remains readable without edit/archive/roster controls.
  Player stats copy says league-only, not cross-league career. Private profile data
  is rendered only for the current owner and never serialized to other clients.
- Team analytics and player ID-card list/detail routes now resolve the exact
  active league and explicitly check read permission before business SQL. Every
  child query (fixtures, scorecards, innings, performers, teams, tournaments) is
  tenant-filtered. ID-card issuance/revocation/expiry use the same active-league
  permission and validate UUIDs and dates. The ID-card detail page selects only
  the fields the card renders and scopes team/league lookups to the active league.

**Fresh verification:** web **1,706 / 47 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **2,027 passing tests**, +216 over Batch 19.
New suites: **139** read-boundary cases, **13** history/hierarchy cases and **64**
route/control cases. They cover exact membership/league checks, private-field
exclusion, scoped joins, bounded filters/pages, picker truncation, historical-side
attribution, failure propagation and control visibility. Rendered route tests mock
database/UI components and are not authenticated browser acceptance. Current Drizzle
select/join/operator docs and N+1 guidance were consulted.

**Boundaries / next:** no build, lint, standalone type-check, schema change,
migration application, remote database operation or deployment ran. All five
prior migrations remain unapplied; the release gate stays default-off. These are
request-local authorization/projection checks, not read-versus-revocation locks,
database-wide privacy constraints or query-plan certification. Prove real RLS,
grants, indexes, scoped query performance and concurrent read/write behavior.
Team analytics, player ID-card list/detail and follow/publication paths remain the
next source slice, followed by tournament/venue/admin writers and delete paths.
No complete registration/transfer/archival lifecycle, immutable XI, CAS, fencing,
browser acceptance or full `ISO-04` certification is claimed. Whole-task roadmap
counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 21: scoped registration review writers and reads

Synced clean `main` with remote `2fa43ec`. This is a bounded `ISO-04`/`REG-03`/
`REG-04` slice; tournament/venue/admin writers, waitlist/needs-information,
refund/quota-release and public visibility are not repaired here.

**Implemented:**

- `registerTeam`, `approveRegistration`, `rejectRegistration` and
  `confirmRegistrationPayment` no longer use `getMyTenant`/`withTenantContext` or
  the owned/default-league fallback. They resolve the exact active league, check
  the explicit permission and re-check the account, active membership and league
  inside the transaction. A new owner/team-manager `withdrawRegistration` action
  was added.
- Review writers lock account → league → membership → tournament → team →
  registration under READ COMMITTED. Tournament locks always precede registration
  locks, so approval cannot deadlock with a concurrent registration. Approval
  locks the tournament row `FOR UPDATE`, re-checks capacity against `maxTeams`
  and links the team to the tournament; the fee-confirmation path inserts the
  payment and flips the fee state atomically. Minimal audits exclude squad lists,
  notes, fee references and account UUIDs.
- Creation verifies the team is active and same-league, the tournament is open
  within its window and in an acceptable status, the squad members are active
  players on that team (tenant-scoped, fixing an unscoped prior read), the squad
  fits the team limit, and the `(team, tournament)` pair is not duplicated.
- Review reads use explicit projections that exclude the payment transaction
  reference and the global registered-by/approved-by UUIDs, join team and
  tournament with the same active-league predicate, and are bounded to 100 rows
  with honest page totals. The registrations dashboard route now uses the scoped
  read context and a single joined read instead of the owned/default fallback and
  per-row lookups.

**Fresh verification:** web **1,862 / 48 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **2,183 passing tests**, +156 over Batch 20.
The new `registration-management.test.ts` adds **156** cases covering exact
membership/league authority, locked tournament-before-registration ordering,
capacity/squad/duplicate/eligibility checks, payment resolution, delegation
boundaries, projection exclusion, scoped joins, bounded pages and failure
propagation. Call-order/SQL-construction mocks and in-memory callbacks are not
PostgreSQL locking, rollback or RLS proof.

**Boundaries / next:** no build, lint, standalone type-check, schema change,
migration application, remote database operation or deployment ran. All five
prior migrations remain unapplied; the release gate stays default-off. These are
transaction-scoped locks and request-local authorization/projection checks, not
database-wide constraints or read-versus-revocation guarantees. Prove real RLS,
grants, indexes, two-session create/approve/capacity races and rollback. Next
source work: tournament/venue/admin writers and delete paths, then follow/
publication and notification paths. Withdrawal keeps the squad, fee and any
team/tournament linkage; refunds, slot release, waitlist and archival remain
separate workflows. No complete registration/transfer/archival lifecycle,
immutable XI, CAS, fencing, browser acceptance or full `ISO-04` certification is
claimed. Whole-task roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 22: safe tournament archival replaces hard delete

Synced clean `main` with remote `bcbdca6`. This is a bounded `ISO-04` delete-path
slice; tournament list/detail lifecycle writers, venue/admin writers, public
visibility and a purge/refund/slot-release workflow are not repaired here.

**Implemented:**

- `deleteTournament` no longer calls `tournamentRepo.deleteById`. The action name
  is kept for the form binding, but it now resolves the exact active league, checks
  `tournament:delete` and delegates to a locked, audited archival that sets the
  tournament status to `cancelled` and closes registration. Registrations, team
  links and match links are preserved; the previous FK cascades
  (`league_registrations` delete, `matches`/`teams` `SET NULL`) no longer run.
- Archival locks account → league → membership → tournament under READ COMMITTED,
  re-checks the current owner, active membership and active league after the wait,
  and takes no match locks. It refuses a `live` tournament (finish/abandon matches
  first) and an already-archived one, and writes one minimal audit
  (`TOURNAMENT_ARCHIVE`, status/registrationOpen only).
- The tournament detail page now labels the control as archival (`operation="archive"`)
  rather than permanent deletion; the shared `DeleteButton` already distinguishes
  delete vs archive wording.

**Fresh verification:** web **1,870 / 48 files**, database **128 / 8 files**, scoring
service **193 / 8 suites**; **2,191 passing tests**, +8 over Batch 21. The
`tournament-actions.test.ts` suite grew by ten cases: owner-lock ordering,
audit content/ordering, no hard-delete, live/already-archived refusal, foreign/
missing tournament, non-owner and locked-actor/league rechecks, audit-failure
propagation and id validation. Call-order/SQL-construction mocks and in-memory
callbacks are not PostgreSQL locking, cascade or RLS proof.

**Boundaries / next:** no build, lint, standalone type-check, schema change,
migration application, remote database operation or deployment ran. All five prior
migrations remain unapplied; the release gate stays default-off. Cancelling is not
a purge, refund, slot-release or restore workflow and does not unlink teams or
registrations. Prove real PostgreSQL lock ordering, cascade absence, audit-failure
rollback, grants, indexes and RLS, plus two-session races. Next source work: the
remaining tournament lifecycle/list/detail writers and venue/admin writers, then
follow/publication and notification paths. No browser acceptance or full `ISO-04`
certification is claimed. Whole-task roadmap counts stay **19 checked / 60 open /
79 IDs**.

### 2026-10-15 — Batch 23: isolated fan-follow identity and league scoping

Synced clean `main` with remote `c29c96a`. This is a bounded `ISO-04`/`ISO-05`
follow-path slice; remaining tournament lifecycle writers, venue/admin writers,
public/anonymous follow and publication boundaries are not repaired here.

**Implemented:**

- `followEntity`, `unfollowEntity`, `isFollowing` and `getFollowerCount` no longer
  trust a client-supplied tenant or the Clerk identity. They resolve the exact
  active league, require the `fan:follow` permission on an active membership
  (never a global role or tenant array), map the Clerk identity to the account
  UUID and assert the target team/player/tournament exists in that league. The
  client tenant must equal the resolved active league.
- Fixed a correctness bug: `fan_follows.user_id` is a `users.id` UUID, but the
  previous code inserted and matched the Clerk string, so team/player follow state
  read as always false. Writes now store the account UUID and reads match on it;
  inserts are idempotent under the `(userId, type, id)` unique index via
  `onConflictDoNothing`.
- `readRosterFollowState` and its team/player detail callers now pass the account
  UUID (`context.actorId`) rather than `context.clerkId`; the follow-state and
  follower-count queries stay correlated to the same active league and entity.
- Follow reads are scoped by the active league: follower counts and current-user
  state include the tenant predicate, and `getMyFollowing` uses the
  server-resolved tenant and account instead of a client parameter. Invalid ids
  read as false/zero rather than throwing during render.

**Fresh verification:** web **1,888 / 49 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **2,209 passing tests**, +18 over Batch 22. The
new `fan-follows.test.ts` adds 18 cases: exact-league/account writes, tenant
mismatch, membership/permission/league denial, foreign-target refusal, idempotent
duplicates, invalid input before SQL, account-UUID (not Clerk) scoping for
delete/count/state/list, and read resilience. Mocked SQL/call-order tests and
in-memory predicates are not PostgreSQL RLS, constraint or concurrency proof.

**Boundaries / next:** no build, lint, standalone type-check, schema change,
migration application, remote database operation or deployment ran. All five prior
migrations remain unapplied; the release gate stays default-off. Follows are not a
public/anonymous or cross-league experience yet, and there is no owner-review
audit, rate limit or notification fan-out. Prove real RLS, the unique constraint,
grants, indexes and two-session follow races. Next source work: remaining
tournament lifecycle/list/detail writers and venue/admin writers, then
public/anonymous follow, publication and notification paths. No browser acceptance
or full `ISO-04` certification is claimed. Whole-task roadmap counts stay **19
checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 24: exact-league stats and scoring dashboard reads

Synced clean `main` with remote `6ccf8e9`. This is a bounded `ISO-04` dashboard
read slice; remaining tournament lifecycle/list/detail writers, venue/admin
writers, public/anonymous follow and publication boundaries are not repaired here.

**Implemented:**

- New `lib/league-reads.ts` centralizes the exact-active-league read context and
  the stats/scoring readers. `requireLeagueReadContext(permission)` resolves the
  exact active league, calls `requirePermissionServer` for that league, maps the
  Clerk identity to the active local account, then requires an active
  `userTenantRoles` membership for the same league whose role actually holds the
  permission and an active `tenants` row. It never treats a global role, tenant
  array or primary membership as authority.
- `stats/page.tsx`, `stats/compare/page.tsx` and `scoring/page.tsx` no longer call
  `getMyTenant` (the previous primary-membership fallback that could surface a
  different league than the active subdomain) and no longer redirect to
  league-setup on an authorization failure. They resolve the exact active league
  first (`stats:read` for both stats routes, `match:read` for the scoring console)
  and let permission/resolution/query failures propagate instead of rendering a
  fake empty state.
- Leaderboard reads inner-join `players` and `teams` with the same active-league
  predicate as the `batting_scorecards`/`bowling_scorecards` filter, group by
  player and are bounded (1–50, default 5) with a deterministic tiebreak. The
  comparison roster is league-scoped and bounded (1–200, default 100).
- `readPlayerComparison` scopes the player lookup and all three child scorecard
  reads (batting/bowling/fielding) to the active league and rejects a non-UUID id
  before any SQL. The old compare page's batting/bowling/fielding reads filtered
  by `playerId` only, with no tenant predicate.
- `readScoringConsoleMatches` filters matches to the active league and the
  active/scheduled statuses with SQL ordering, bounds the console to 100 rows
  (fetching 101 to flag truncation, which the page states), and resolves team
  names with a league-scoped `inArray` instead of the previous unscoped batch
  lookup. The page no longer swallows team-name failures into `TBD`.

**Fresh verification:** web **1,921 / 51 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **2,242 passing tests**, +33 over Batch 23.
New `league-reads.test.ts` adds 19 cases (context resolution/denial,
league-scoped joins and params, bounded leaderboard/comparison/scoring limits,
tenant-scoped comparison aggregation, invalid-id short-circuit, console name
resolution, truncation and no-match short-circuit) and `stats-pages.test.tsx`
adds 14 cases (per-route permission, resolved-league reader arguments,
setup-redirect removal, propagated context/query failures, anonymous redirects
and truncation copy). Mocked SQL/call-order tests and in-memory predicates are
not PostgreSQL RLS, constraint or concurrency proof.

**Boundaries / next:** no build, lint, schema change, migration application,
remote database operation or deployment ran. A standalone `tsc --noEmit` still
reports only its pre-existing unrelated errors (generated `.next` types, older
test/test-page typing); none reference the new lib, pages or tests. All five prior
migrations remain unapplied; the release gate stays default-off. Reads are not a
public/anonymous experience, and the stats/scoring pages are not yet certified for
export, cache or socket scoping. Prove real RLS, grants and indexes on these read
paths. Next source work: remaining tournament lifecycle/list/detail writers and
venue/admin writers, then public/anonymous follow, publication and notification
paths. No browser acceptance or full `ISO-04` certification is claimed.
Whole-task roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 25: exact-league tournament dashboard reads

Synced clean `main` with remote `a36d01a`. This is a bounded `ISO-04` dashboard
read slice; the tournament registration lifecycle writers, venue/admin writers,
public/anonymous follow and publication boundaries are not repaired here.

**Implemented:**

- Renamed the Batch 24 context helper to `requireActiveLeagueContext` so it is reused
  as a page-level authorization gate beyond stats reads; the stats/compare/scoring
  pages and their tests use the new name.
- New `lib/tournament-reads.ts` `readTournamentList(tenantId)` replaces the
  tournaments page's whole-league N+1 counts. The list is bounded (200 rows, +1
  fetch to flag truncation) and orders deterministically. Team and match counts are
  aggregated with grouped queries that carry the same tenant predicate as the list,
  so a foreign team or match link cannot inflate a tournament's totals.
- `dashboard/tournaments/page.tsx` drops `getMyTenant` and the league-setup
  redirect, resolves the exact active league with `tournament:read` and lets
  resolution/query failures propagate instead of returning `[]` from a swallowed
  `try/catch`. A truncation note states how many tournaments are shown.
- `dashboard/tournaments/new/page.tsx` gates the creator on the exact active league
  with `tournament:create` before rendering the form; it no longer passes a
  primary-membership `tenantId` (the form already ignored it and the create action
  resolves the league server-side).

**Fresh verification:** web **1,935 / 53 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **2,256 passing tests**, +14 over Batch 24. New
`tournament-reads.test.ts` adds 4 cases (league-scoped aggregated counts, scoping of
every child query, zero counts, truncation and empty short-circuit) and
`tournament-pages.test.tsx` adds 10 cases (per-route permission, resolved-league
reader arguments, setup-redirect removal, propagated context/query failures,
anonymous redirects and truncation copy). Mocked SQL/call-order and render tests are
not PostgreSQL RLS, index or concurrency proof.

**Boundaries / next:** no build, lint, schema change, migration application, remote
database operation or deployment ran. A standalone `tsc --noEmit` still reports only
its pre-existing unrelated errors; none reference the new lib, pages or tests. All
five prior migrations remain unapplied; the release gate stays default-off. These
reads are not a public/anonymous experience and are not certified for export or
cache scoping. Prove real RLS, grants and index support for the grouped count
queries. Next source work: remaining tournament registration lifecycle writers and
venue/admin writers, then public/anonymous follow, publication and notification
paths. No browser acceptance or full `ISO-04` certification is claimed.
Whole-task roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 26: locked tournament registration lifecycle

Synced clean `main` with remote `969a9ef`. This is a bounded `ISO-04` lifecycle
writer slice; the tournament create/update writers, venue/admin writers,
public/anonymous follow and publication boundaries are not repaired here.

**Implemented:**

- New `setTournamentRegistration` in `lib/tournament-lifecycle.ts` moves the
  registration open/close writes off the repository (`tournamentRepo.updateById`)
  into a READ COMMITTED transaction that locks account → league → membership →
  tournament, rechecks the current owner after the wait, and writes an atomic
  minimal audit. `openRegistration`/`closeRegistration` are now thin wrappers over
  it and add a `z.string().uuid()` shape check before the transaction.
- Guards: an archived (`cancelled`) tournament can neither open nor close
  registration; registration only opens for a `draft`/`registration` tournament
  (refusing `live`/`completed`). Closing keeps the current status and only clears
  `registrationOpen`. This is not a purge/refund/slot-release workflow.
- Audits record `TOURNAMENT_REGISTRATION_OPEN`/`..._CLOSE` with the before/after
  status and `registrationOpen` and the changed fields; the audit row and the status
  write share the transaction, and a failing audit aborts the write.

**Fresh verification:** web **1,942 / 53 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **2,263 passing tests**, +7 over Batch 25. The
`tournament-actions.test.ts` lifecycle block adds cases (locked open with audit and
revalidate, locked close without a status change, archived refusal, live/completed
refusal, non-owner denial, foreign/missing tournament, propagated audit failure,
permission denial before the transaction and id-shape validation). Mocked
call-order/SQL tests are not PostgreSQL lock, rollback or RLS proof.

**Boundaries / next:** no build, lint, schema change, migration application, remote
database operation or deployment ran. A standalone `tsc --noEmit` still reports only
its pre-existing unrelated errors; none reference the changed files. All five prior
migrations remain unapplied; the release gate stays default-off. Prove real
two-session open/close ordering against archive and registration writes, audit
rollback and RLS before rollout. Next source work: remaining tournament create/update
writers and venue/admin writers, then public/anonymous follow, publication and
notification paths. No browser acceptance or full `ISO-04` certification is claimed.
Whole-task roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 27: locked, audited tournament create/update

Synced clean `main` with remote `ff5d12e`. This is a bounded `ISO-04` writer slice;
venue writers, settings/billing destinations, public/anonymous follow and
publication boundaries are not repaired here.

**Implemented:**

- New `lib/tournament-writes.ts` moves create/update off `tournamentRepo.insert` /
  `updateWithLock` into READ COMMITTED transactions that lock account → league →
  membership (and, for update, the tournament row), recheck the current owner after
  the wait, and write an atomic minimal audit (`TOURNAMENT_CREATE`/`TOURNAMENT_UPDATE`).
  `createTournament`/`updateTournament` are now thin wrappers; `lockOwnerContext` is
  shared with the Batch 26 lifecycle writers.
- Slug handling: create and a renamed slug pre-check for a per-league duplicate and
  map a PostgreSQL unique-violation (`23505`) race to the same friendly error, so a
  `(tenant_id, slug)` collision surfaces as a validation message instead of a raw
  500. The update write still runs the existing locked date/seed-order validation and
  legacy-rules preservation inside the `prepare` callback.
- `persistenceValues` is now generic so a create input keeps its required
  `name`/`format` through validation.

**Fresh verification:** web **1,947 / 53 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **2,268 passing tests**, +5 over Batch 26. The
`tournament-actions.test.ts` writer block adds cases (locked create with audit and
lock order, duplicate-slug pre-check, unique-violation mapping, locked update with
audit and lock order, foreign/missing tournament, membership-change denial,
renamed-slug collision and permission denial before the transaction), while the
existing wizard-envelope, seed-resize and date-validation cases assert the same
`prepare` output through `tx.set`. Mocked call-order/SQL tests are not PostgreSQL
lock, rollback, unique-index or RLS proof.

**Boundaries / next:** no build, lint, schema change, migration application, remote
database operation or deployment ran. A standalone `tsc --noEmit` still reports only
its pre-existing unrelated errors; none reference the changed files. All five prior
migrations remain unapplied; the release gate stays default-off. Prove real
two-session create/update/archive/registration lock ordering, unique-index behaviour,
audit rollback and RLS before rollout. Next source work: remaining venue writers,
settings/billing and other dashboard destinations, then public/anonymous follow,
publication and notification paths. No browser acceptance or full `ISO-04`
certification is claimed. Whole-task roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 28: exact-league settings, billing and invoices

Synced clean `main` with remote `905891b`. This is a bounded `ISO-04`/`TEN-*`
destination slice; the `dashboard-context`, notifications, Stripe-checkout and
league-setup destinations, venue writers, public/anonymous follow and publication
boundaries are not repaired here.

**Implemented:**

- New `lib/league-settings-reads.ts` reads the active league's identity/branding,
  bounded invoice history, a single invoice and bounded white-label requests, each
  predicated on the caller's resolved `tenantId` and returning explicit projections
  (no private tenant/contact fields are serialized to the client). It takes an
  explicit `tenantId` and never resolves one itself, so it cannot re-point at another
  league.
- The settings, billing, invoices and invoice-detail pages now resolve the active
  league with `requireActiveLeagueContext("settings:manage")` instead of page-level
  `getMyTenant` + `getUserRoleForTenant`; a missing league or insufficient role
  throws to the error boundary rather than silently redirecting to the dashboard (or
  league setup, for billing) or rendering fake empty settings. Reads go through the
  scoped, projected, bounded helpers above rather than `SELECT *`. The billing client
  and upgrade modal receive a minimal `LeagueIdentity` rather than the whole `Tenant`
  row, and the invoice page 404s a foreign invoice.
- `lib/invoices.ts` (whose `getMyInvoices` returned `[]` when no tenant was found) is
  removed. The white-label writer shares the same active-league/plan resolution
  (previously `getMyTenant`, which was already membership-verified) and the now-unused
  `getMyWhiteLabelRequests` action is removed in favour of the scoped reader.

**Fresh verification:** web **1,974 / 56 files**, database **128 / 8 files**,
scoring service **193 / 8 suites**; **2,295 passing tests**, +27 over Batch 27. New
regressions: `league-settings-reads.test.ts` (8 — exact-league predicates on every
read, minimal identity projection, hard-fail on a missing league, null branding,
bounded invoice/white-label limits, uuid validation, foreign-invoice null),
`settings-pages.test.tsx` (15 — each page resolves `settings:manage` and reads only
the resolved league, propagates denial/failure without a setup redirect, redirects
anonymous visits, 404s a foreign invoice) and `white-label-actions.test.ts` (4 — the
writer resolves the active league through the shared resolver and never `getMyTenant`,
fails closed without an active league, enforces plan limits on the resolved plan,
refuses a duplicate pending request). Mocked readers are not PostgreSQL RLS or grant
proof.

**Boundaries / next:** no build, lint, schema change, migration application, remote
database operation or deployment ran. A standalone `tsc --noEmit` still reports only
its pre-existing unrelated errors; none reference the changed files. All five prior
migrations remain unapplied; the release gate stays default-off. Next source work:
tournament-detail mutation-control gating and the remaining venue writers, then
public/anonymous follow, publication and notification paths. No browser acceptance or
full `ISO-04` certification is claimed.
Whole-task roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 29: permission-gated tournament-detail controls

Synced clean `main` with remote `3dd6152`. This is a bounded tournament-detail
(`ISO-04`) slice; the registrations/new page, venue writers, `dashboard-context`,
notifications/league-setup destinations and public/anonymous follow are not repaired
here. It also corrects the Batch 28 notes: `getMyTenant` was already
membership-verified and request-tenant-first, so Batch 28 was a
protocol/fail-closed/projection change, not a cross-tenant fix.

**Implemented:**

- `dashboard/tournaments/[id]/page.tsx` now resolves the exact active league with
  `requireActiveLeagueContext("tournament:read")` and 404s a tournament whose
  `tenantId` is not that league, then gates each mutation control on the viewer's
  precise permission: the edit link on `tournament:update`, the archive button on
  `tournament:delete`, the registration open/close toggle on
  `tournament:manage_registrations`, and the self-service registration CTA on
  `registration:create`. Previously every control rendered for every viewer whose role
  held `tournament:read` (fan/player/coach/scorer included), so a click failed only at
  the action. The actions themselves are unchanged and still re-check on write.

**Fresh verification:** web **1,984 / 57 files**, database **128 / 8 files**, scoring
service **193 / 8 suites**; **2,305 passing tests**, +10 over Batch 28. New regression
`tournament-detail-page.test.tsx` (10 — resolves `tournament:read` for the exact
league, shows every control to a league owner, shows a team manager only the
registration CTA, hides all four controls from scorer/coach/player/fan, propagates a
denied context before the read, and 404s a missing or foreign-league row). Rendering a
page with mocked context/actions is not authenticated-browser proof.

**Boundaries / next:** no build, lint, schema change, migration application, remote
database operation or deployment ran. A standalone `tsc --noEmit` still reports only
its pre-existing unrelated errors; none reference the changed files. All five prior
migrations remain unapplied; the release gate stays default-off. Next source work: the
remaining venue writers and the registrations/new swallow-and-redirect, then
public/anonymous follow, publication and notification paths. No browser acceptance or
full `ISO-04` certification is claimed. Whole-task roadmap counts stay **19 checked /
60 open / 79 IDs**.

### 2026-10-15 — Batch 30: self-service registration form resolves the active league

Synced clean `main` with remote `e25485b`. This is a bounded registration-destination
(`ISO-04`/`TEN-*`) slice; venue writers, the registrations review-queue catch-redirect,
`dashboard-context`/notifications/league-setup destinations, public/anonymous follow and
publication boundaries are not repaired here.

**Implemented:**

- `lib/registration-reads.ts` gains `readRegistrationFormOptions(tenantId)`, a bounded,
  tenant-scoped reader for the self-service registration form's team, tournament and
  player pickers (over-fetch 101/101/201, truncate to 100/100/200; teams narrowed to
  `isActive`).
- `dashboard/registrations/new/page.tsx` resolves the exact active league with
  `requireRegistrationReadContext("registration:create")` and reads the pickers through
  that reader. It no longer wraps `getTeams`/`getTournaments`/`getPlayers` in a
  `try/catch` that redirected to `/dashboard/league/setup` (including on an authorization
  denial) and rendered fake empty pickers; anonymous visits go to `/`, and read or
  authorization failures now propagate to the Next error boundary.

**Fresh verification:** web **1,993 / 59 files**, database **128 / 8 files**, scoring
service **193 / 8 suites**; **2,314 passing tests**, +9 over Batch 29. New regressions:
`registration-form-options.test.ts` (3 — every picker predicated on the active league and
never another; teams narrowed to active with each picker bounded; an over-fetched picker
truncated) and `registration-new-page.test.tsx` (6 — resolves `registration:create`,
forwards the pickers and `defaultTournamentId`, propagates a denied context and a picker
failure without redirecting to league setup, and sends an anonymous visit to `/`).
Mocked readers are not PostgreSQL or browser proof.

**Boundaries / next:** no build, lint, schema change, migration application, remote
database operation or deployment ran. A standalone `tsc --noEmit` still reports only its
pre-existing unrelated errors; none reference the changed files. All five prior
migrations remain unapplied; the release gate stays default-off. Next source work: the
remaining venue writers, then public/anonymous follow, publication and notification
paths. No browser acceptance or full `ISO-04` certification is claimed. Whole-task
roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 31: league venue (grounds/facilities) management

Synced clean `main` with remote `048077f`. This is a bounded venue-administration
(`TEN-*`) slice; the registrations review-queue catch-redirect,
`dashboard-context`/notifications/league-setup destinations, public/anonymous follow and
publication boundaries are not repaired here.

**Implemented:**

- RBAC adds `venue:read` (every league role) and `venue:manage` (`super_admin`,
  `league_owner` only), and `getNavigationForRole` surfaces a **Venues** item for any role
  holding `venue:read`; the sidebar/header (`MapPin`) render it in the management group.
- `lib/venue-reads.ts` — request-local `requireVenueReadContext(permission)` plus bounded,
  tenant-scoped `readVenueList` (over-fetch `201`, truncate to 200), `readVenue(tenantId, id)`
  and `readVenueOptions(tenantId)` (`isActive`, over-fetch `201`, truncate to 200). Reads
  resolve the exact active league, reject a `super_admin` membership and never fall back to
  an owned/default tenant.
- `lib/venue-writes.ts` — `createVenueRecord`, `updateVenueRecord` and `setVenueActive` run
  in one `read committed` transaction that locks account → league → membership
  (`league_owner` only, matching `archive-roster-resource`/`match-management`), takes the
  venue row `FOR UPDATE` **after** those locks for update/archive, rechecks the current
  authority after the wait, and writes the audit
  (`VENUE_CREATE`/`VENUE_UPDATE`/`VENUE_ARCHIVE`/`VENUE_RESTORE`,
  `payload: { resourceId, changedFields[, before, after] }`) in the same transaction so a
  failed audit aborts the write. Per-league `UNIQUE(tenantId, name)` is surfaced as one
  friendly error by pre-check plus a `23505` catch. Archiving is an `isActive`
  compare-and-set, never a delete, because `matches.venueId` is `onDelete: "set null"`;
  archiving/restoring to the state a venue already holds is rejected with a clear conflict
  message.
- `app/actions/venues.ts` (no direct `db`), `components/venues/venue-form.tsx`,
  `components/venues/venue-row-actions.tsx` and the `dashboard/venues` list / `new` /
  `[id]/edit` routes. Read or authorization failures propagate to the error boundary rather
  than rendering a fake empty list.

**Fresh verification:** web **2,031 / 63 files**, database **128 / 8 files**, scoring service
**193 / 8 suites**; **2,352 passing tests**, +38 over Batch 30. New regressions:
`venue-reads.test.ts` (4 — exact-league predicates, `super_admin` refusal, bounded/truncated
lists and options) and `venue-actions.test.ts` (11 — active-league re-resolution, no direct
`db`, audit shape, duplicate-name mapping) and `venue-writes.test.ts` (10 — lock ordering via
`PgDialect.sqlToQuery`, owner recheck, compare-and-set archive, duplicate mapping) and
`venue-pages.test.tsx` (12 — page context/permission gating and failure propagation); plus
venue permission/nav assertions in `rbac.test.ts`. Mocked readers and a mocked
`db.transaction` are not PostgreSQL locking, RLS, unique-constraint or browser proof.

**Boundaries / next:** no build, lint, schema change, migration application, remote database
operation or deployment ran. A standalone `tsc --noEmit` still reports only its pre-existing
unrelated errors; none reference the changed files. All five prior migrations remain
unapplied; the release gate stays default-off. Next source work: the remaining
catch-redirect cleanups, then public/anonymous follow, publication and notification paths.
No browser acceptance or full `ISO-04` certification is claimed. Whole-task roadmap counts
stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 32: registration review queue reports access and read failures

Synced clean `main` with remote `ed2b086`. This is a bounded failure-propagation slice for
the league registration review queue; public/anonymous follow, publication boundaries,
refunds and notification fan-out are not repaired here.

**Implemented:**

- `lib/registration-reads.ts` gains `resolveRegistrationReviewAccess()`, a non-throwing
  access decision. It returns the review context only when the viewer holds
  `registration:manage` in the exact active league, and `null` when they are simply not a
  league owner (no active league, no active membership, a `super_admin`-only membership, or
  a missing permission). Tenant, actor, membership and league lookups are not swallowed, so
  an infrastructure failure throws.
- `dashboard/registrations/page.tsx` replaces its
  `try { requireRegistrationReadContext("registration:manage") } catch { redirect("/dashboard") }`
  — which turned every tenant/membership/database failure into a benign-looking bounce — with
  `const context = await resolveRegistrationReviewAccess(); if (!context) redirect("/dashboard")`.
  A genuine non-owner is still bounced; every other failure now reaches the route's
  `error.tsx`. The queue read remains uncaught, so read failures already propagated and still do.

**Fresh verification:** web **2,037 / 64 files**, database **128 / 8 files**, scoring service
**193 / 8 suites**; **2,358 passing tests**, +6 over Batch 31. New regressions:
`registration-review-page.test.tsx` (6 — exact-league read; non-owner redirect with no read;
propagated access and read failures with no `/dashboard` redirect; the anonymous bounce).
Mocked readers are not authenticated-browser or database proof.

**Boundaries / next:** no build, lint, schema change, migration application, remote database
operation or deployment ran. A standalone `tsc --noEmit` still reports only its pre-existing
unrelated errors; none reference the changed files. All five prior migrations remain
unapplied; the release gate stays default-off. Next source work: public/anonymous follow, then
publication and notification paths. No browser acceptance or full `ISO-04` certification is
claimed. Whole-task roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 33: exact-league notification reads and writes

**Implementation (`apps/web/src/lib/notification-reads.ts`, `app/actions/notifications.ts`, `app/dashboard/notifications/`):**

- The personal notification read/write paths now resolve the exact active league through a new
  request-local `requireNotificationMemberContext()` gate. It requires an **active membership of
  any role** — deliberately not a management permission, so fan/player/commentator roles with no
  match-scoped capability still see their own bell — and rejects `super_admin`-only identities,
  remapped sessions, inactive accounts/leagues and suspended/missing/foreign memberships. It
  never falls back to a global role, the mutable `users.tenantIds` array, a primary membership or
  a client-supplied tenant.
- The non-throwing `resolveNotificationMemberContext()` companion returns `null` only for a
  confirmed non-member; tenant/membership/account/league lookup failures propagate, so an outage
  is not disguised as an empty bell.
- Bounded, tenant-scoped readers replace the inline queries: `readMyNotifications` (clamped
  1–100, newest-first with an id tiebreak), `readUnreadNotificationCount`,
  `markNotificationReadById` (validates the id as a UUID before any write and re-asserts the
  tenant/ownership predicate) and `markAllNotificationsReadFor`. The shared
  `myNotificationFilter` carries the resolved actor + tenant on both the personal and
  league-wide (`user_id IS NULL`) branches.
- `app/actions/notifications.ts` delegates to the reader context, keeps the personal-read
  contract (an unauthenticated/league-less caller yields empty results so the bell still renders
  during SSR) and lets genuine infrastructure failures propagate. It no longer uses direct `db`,
  so it was removed from the `no-unscoped-queries` allowlist and the guard now enforces repo-only
  access there.
- `dashboard/notifications/page.tsx` gates on the exact active league, bounces only confirmed
  non-members to `/dashboard`, and propagates read/access failures to a new
  `notifications/error.tsx` boundary instead of a benign empty page.

**Fresh verification:** web **2,069 / 67 files**, database **128 / 8 files**, scoring service
**193 / 8 suites**; **2,390 passing tests**, +32 over Batch 32. New regressions:
`notification-reads.test.ts` (21), `notification-actions.test.ts` (6) and
`notifications-page.test.tsx` (5). Mocked readers/SQL and a client-mocked page are not
PostgreSQL RLS, index or authenticated-browser proof.

**Boundaries / next:** no build, lint, schema change, migration application, remote database
operation or deployment ran. A standalone `tsc --noEmit` still reports only its **19
pre-existing** error lines (verified identical with `git stash`); none reference the new files.
All five prior migrations remain unapplied; the release gate stays default-off. These are
request-local authorization/projection checks, not read-versus-revocation locks. Next source
work: public/anonymous follow and publication boundaries, then the `dashboard-context`/
`league-setup` `getMyTenant` consumers. No browser acceptance or full `ISO-04` certification is
claimed. Whole-task roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 34: public publication boundary and leaderboard isolation

**Implementation (`apps/web/src/lib/public-visibility.ts`, `app/leaderboards/`, public match/live/tournament routes, `api/scorecards/[matchId]/pdf`):**

- Fixed a genuine **cross-tenant leak**: `app/leaderboards/page.tsx` aggregated
  `player_season_stats` and `players` with no tenant predicate, so a visitor on one league's
  host ranked every other league's players. It now resolves the request-host league through
  `requirePublicTenantId()` and reads through a scoped, publication-gated reader.
- New `lib/public-visibility.ts` centralizes the publication decision for the unauthenticated
  surface. Those routes were already tenant-scoped to the request host (`lib/public-tenant.ts`)
  but had **no publication gate**, so an organizer's unannounced `draft` tournament and a
  `cancelled` fixture were publicly readable. Publication is derived from the existing lifecycle
  columns (no new schema), so nothing ambiguous is exposed and the database stays authoritative.
- Pure predicates `isTournamentPublished` (only `registration`/`live`/`completed`) and
  `isMatchPublished` (every status except `cancelled`) are the single source of truth and are
  exported with their value tuples for reuse in SQL `inArray` filters.
- Scoped readers: `readPublishedTournament`, `readPublishedMatch` (also rejects a match whose
  same-tenant parent tournament is unpublished, failing closed on a broken/missing parent; a
  tournament-less friendly follows its own status), `readPublishedMatchTeams`, `matchHasInnings`,
  and publication-gated `readPublicBattingLeaderboard`/`readPublicBowlingLeaderboard` (joined to
  published tournaments, deterministic tiebreak on `playerId`, bounded by
  `PUBLIC_LEADERBOARD_LIMIT`).
- The gate is wired into `matches/[matchId]/page.tsx`, `matches/[matchId]/live/page.tsx`,
  `tournaments/[id]/page.tsx` and `api/scorecards/[matchId]/pdf`, each of which still 404s (or
  returns 404) for a hidden row exactly as for a foreign/missing id, so nothing signals that an
  unpublished row exists.

**Fresh verification:** web **2,098 / 69 files**, database **128 / 8 files**, scoring service
**193 / 8 suites**; **2,419 passing tests**, +29 over Batch 33. New regressions:
`public-visibility.test.ts` (26) and `leaderboards-page.test.tsx` (3). Mocked readers/SQL and a
client-mocked page are not PostgreSQL RLS, index or authenticated-browser proof.

**Boundaries / next:** no build, lint, schema change, migration application, remote database
operation or deployment ran. A standalone `tsc --noEmit` still reports only its **19
pre-existing** error lines; none reference the new files. All five prior migrations remain
unapplied; the release gate stays default-off. Publication here is derived from lifecycle status
in request-local reads, not a read-versus-revocation lock, and does not yet cover private contact
fields, exports or sockets. Next source work: the `dashboard-context`/league-setup `getMyTenant`
consumers, then public/anonymous follow. No browser acceptance or full `ISO-04` certification is
claimed. Whole-task roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 35: league-setup ownership gate and serialized league-create cap

**Implementation (`apps/web/src/app/actions/tenants.ts`, `app/dashboard/league/setup/`):**

- Fixed a real flow wall: the league-setup page bounced any account holding an active
  membership in *any* league, but its writer `createTenant` caps only *ownership*. A
  fan/scorer of one league could never reach the "Create your league" form even though the
  backend allows it. The page now gates on the new `getMyOwnedTenant()` (owned-league lookup
  by database UUID), matching the writer's cap exactly, and lookup failures propagate to a
  new `league/setup/error.tsx` boundary instead of crashing or silently showing the form.
- Closed the one-league cap race in `createTenant`: the cap was a non-transactional pre-check
  and `tenants.owner_id` has no unique constraint, so two parallel submissions could both pass
  and each create a league. The transaction now locks the actor row (`SELECT … FOR UPDATE`)
  and re-checks ownership inside the transaction; the `tenants.slug` unique index is also
  surfaced through a `23505` unique-violation mapping so a lost slug race yields the friendly
  "URL already taken" error.
- Reviewed the remaining `getMyTenant` consumers without change: `lib/dashboard-context.ts`
  and `lib/rbac-server.ts` resolve host-first and fail closed with dedicated suites;
  `api/billing/stripe/checkout` re-verifies the actor owns the resolved league;
  `updateTenantBrandingSettings` re-resolves behind `settings:manage`. Their
  fallback-primary-resolver semantics are deliberate and documented at each site.

**Fresh verification:** web **2,111 / 71 files**, database **128 / 8 files**, scoring service
**193 / 8 suites**; **2,432 passing tests**, +13 over Batch 34. New regressions:
`tenant-create.test.ts` (9) and `league-setup-page.test.tsx` (4) — asserting the `FOR UPDATE`
actor lock and in-transaction cap re-check with real SQL parameters, refusal to insert when
the re-check finds ownership, slug `23505` mapping, verbatim rethrow of infrastructure errors,
ownership-not-membership semantics, owner bounce/member-only form access, and propagated
lookup failures. Mocked SQL and a client-mocked page are not PostgreSQL RLS, lock-timing or
authenticated-browser proof.

**Boundaries / next:** no build, lint, schema change, migration application, remote database
operation or deployment ran. A standalone `tsc --noEmit` still reports only its **19
pre-existing** error lines. All five prior migrations remain unapplied; the release gate stays
default-off. A real `UNIQUE` constraint on `tenants.owner_id` remains the durable fix
(recorded as schema work). Local git `core.whitespace` gained `cr-at-eol` because these files
are committed with CRLF endings; no file bytes were altered for that check. Next source work:
public/anonymous follow hardening. No browser acceptance or full `ISO-04` certification is
claimed. Whole-task roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 36: repo-only guard tightened for follows and registrations

- Verified `app/actions/follows.ts` and `app/actions/registrations.ts` contain zero direct
  `db` access (follows delegates to tenant-scoped `lib/fan-follows.ts`; registrations to its
  dedicated readers/writers) and removed both from the `no-unscoped-queries` allowlist, so the
  guard now *enforces* repo-only access there (as Batch 33 did for `notifications.ts`). The
  remaining allowlist entries still have real direct-`db` call sites (verified per file).
- Re-reviewed the anonymous half of the follow work: writes require active `fan:follow`
  membership in the exact league; reads are tenant-scoped and anonymous calls read as
  `0`/`false`/`[]` with no cross-tenant leakage.

**Fresh verification:** web **2,111 / 71 files** (suites otherwise unchanged from Batch 35;
**2,432 total**); `git diff --check` clean. No production behavior changed — an audit
observation became an enforced guard. No build, lint, schema change, migration application,
remote database operation or deployment ran; `tsc --noEmit` parity at **19 pre-existing**
lines. Next source work: `matches.ts`, `scorecards.ts`, `player-ids.ts` and
`users-invites.ts` allowlist migrations, then remaining admin APIs. Whole-task roadmap counts
stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 37: player-ids actions become pure delegates

- `app/actions/player-ids.ts` no longer touches `db` directly. All database work moved to
  the new tenant-scoped `lib/player-id-cards.ts` (`issuePlayerIdCard` with the intact
  `pg_advisory_xact_lock` + `max(sequence)+1` allocation transaction and the `23505`
  lost-race recovery, plus scoped find/issue/revoke/expiry/list readers). The action keeps
  only the `withAuth` gate, Clerk check, zod validation, permission resolution,
  `revalidatePath` and response shaping. Every call site is re-predicated on the explicit
  `(playerId, tenantId)` pair, so a foreign-league id can never be issued, revoked, listed
  or expiry-amended.
- `player-ids.ts` removed from the `no-unscoped-queries` allowlist (remaining:
  `tenants.ts`/`users.ts` bootstrap; `matches.ts`, `scoring.ts`, `scorecards.ts`,
  `users-invites.ts` pending migration).
- New regressions: `player-id-cards.test.ts` (10 tests) — league-scoped parameters (params
  never contain a foreign tenant), dual-tenant list join predicate, 200-row cap, prefix
  rules, no-allocation on an existing card, locked-transaction allocation formatting
  (`SSL-2026-0007`), and `23505` recovery. `IssuedPlayerIdCard.issueDate` typed `Date`
  (Drizzle `notNull`), catching a real `new Date(r.issueDate)` overload error in the
  id-cards page before it shipped.

**Fresh verification:** web **2,121 / 72 files** (+10), database **128 / 8**, scoring
**193 / 8** — **2,442 total**; `tsc --noEmit` at **19 pre-existing** lines; `git diff --check`
clean. Next source work: `scorecards.ts` (7 direct-`db` sites), `users-invites.ts` (12),
`matches.ts` (7), then remaining admin APIs. Whole-task roadmap counts stay
**19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 38: scorecards actions become pure delegates

- `app/actions/scorecards.ts` no longer touches `db` directly. Reads moved to the new
  tenant-scoped `lib/scorecard-reads.ts` (`requireScorecardMatch`, `findScopedInnings`,
  `readMatchScorecards`, `readInningsScorecards` + the `scopedInnings` exists-subquery
  helper); the action keeps only the `withAuth` gate, Clerk check, zod validation/
  schemas and exact-league permission resolution. Hierarchy ordering, the dual-key
  `(inningsId, matchId, tenantId)` binding and the legacy-row exists-subquery defense
  transferred verbatim. `saveScorecard` remains the exported fail-closed denial stub —
  scoring-service stays the sole writer.
- `scorecards.ts` removed from the `no-unscoped-queries` allowlist (remaining:
  `tenants.ts`/`users.ts` bootstrap; `matches.ts`, `scoring.ts`, `users-invites.ts`).
- The existing 32 `scorecard-boundaries.test.ts` regressions (exact SQL shape, per-query
  params, call ordering, fail-closed paths) pass unchanged against the lib-backed
  actions; no behavior change.

**Fresh verification:** web **2,121 / 72**; `tsc --noEmit` at its **19 pre-existing**
lines; `git diff --check` clean. Next source work: `users-invites.ts` (12 direct-`db`
sites, invite-accept transaction flow), `matches.ts` (7), then remaining admin APIs.
Whole-task roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 39: users-invites flows become pure delegates

- `app/actions/users-invites.ts` no longer touches `db` directly. The four locked
  transactional flows (issue/revoke/resend-rotate/accept-claim) and all reads moved to
  the new `lib/invite-records.ts`; the action keeps only the `requireManager` gate, zod,
  token crypto, the Resend dispatch (still outside all transactions) and response
  shaping. Lock ordering (sorted-id FOR UPDATE users → tenants → memberships), the
  under-lock re-verification, the all-preconditions-in-predicate invite claim, the
  no-promotion membership check and insert order (userTenantRoles → auditLogs →
  notifications) transferred verbatim.
- Type upgrade: `issueInviteInLeague` takes `InvitableRole` ("team_manager" | "coach" |
  "scorer") matching the post-rebuild enum column and the zod-narrowed input.
- `users-invites.ts` removed from the `no-unscoped-queries` allowlist (remaining:
  `tenants.ts`/`users.ts` bootstrap; `matches.ts`; `scoring.ts` tenant-scoped reads).
- The existing 105 `membership-invites.test.ts` regressions (lock/insert ordering,
  exact params, fail-closed paths, verified-email flow) pass unchanged against the
  lib-backed actions; no behavior change.

**Fresh verification:** web **2,121 / 72**; `tsc --noEmit` at its **19 pre-existing**
lines; `git diff --check` clean. Next source work: `matches.ts` (7 direct-`db` sites,
`withTenantContext` create/update transaction), then remaining admin APIs. Roadmap
counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 40: matches actions become pure delegates

- `app/actions/matches.ts` no longer touches `db` directly. Reads plus the scorer-assignment
  writer moved to the new tenant-scoped `lib/match-records.ts` (`findTenantMatch`,
  `readMatchFormOptions`, `listTenantMatches`, `listTenantScorers`, `assignScorerInMatch`);
  `withTenantContext` moved inside the lib. Lifecycle/stream/cancel commands keep
  delegating to `lib/match-management.ts`; `endMatch` still proxies to scoring-service and
  never writes results locally. The assign transaction (FOR UPDATE match → sorted-id
  users → league FOR SHARE → memberships, under-lock re-verification, both-slots rule,
  preconditions-in-predicate UPDATE, `read committed`, before/after audit) transferred
  verbatim.
- `matches.ts` removed from the `no-unscoped-queries` allowlist — the list is now at its
  floor: `tenants.ts`/`users.ts` bootstrap plus `scoring.ts` (scoring-service is the write
  SoT; remaining selects are tenant-scoped authz reads).
- The existing 245 match-management, 51 scorer-assignment and 6 lock-race concurrency
  regressions pass unchanged against the lib-backed actions; no behavior change.

**Fresh verification:** web **2,121 / 72**; `tsc --noEmit` at its **19 pre-existing**
lines; `git diff --check` clean. Next decision: `scoring.ts`, the last allowlist entry —
explicit opt-out vs a repo read-layer for its authz selects. Roadmap counts stay
**19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 41: scoring actions become pure delegates; allowlist at its floor

- `app/actions/scoring.ts` no longer touches `db` directly. All reads moved to the new
  tenant-scoped `lib/scoring-reads.ts` (`findScoringTenant`, `readInningsForCommand`,
  `findInningsId`, `findScoringMatch`, `readMatchScoringBatch`,
  `readMatchPlayersForScoring`, `readBallHistory`); the action keeps gates, zod, the
  scoring-service proxies and response shaping. The tenant-scoped innings gates
  (including `getBallHistory`'s historical fix), the scoring-page ordering, the 60-ball
  recency bound and the exact WHERE-param sequence transferred verbatim. Reads only —
  every write still belongs to the scoring-service SoT, which made an explicit
  opt-out marker unnecessary.
- `scoring.ts` removed from the `no-unscoped-queries` allowlist: it now contains only the
  `tenants.ts`/`users.ts` bootstrap entries. Every other action file is guard-enforced.
- The existing 20 scoring-actions, 23 scoring-access and 6 scoring-hydration regressions
  pass unchanged; no behavior change.

**Fresh verification:** web **2,121 / 72**; `tsc --noEmit` at its **19 pre-existing**
lines; `git diff --check` clean. The allowlist sweep (Batches 37–41) is complete; next
source work is the remaining admin-API audit items. Roadmap counts stay
**19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 42: admin leagues API — lib reader + first gate regressions

- `GET /api/admin/leagues` now reads through the new `lib/admin-reads.ts`
  (`listAllLeaguesForAdmin`, 500-row bound, same 7-field projection and ordering); the
  route keeps only the auth→`isSuperAdmin` gate and error mapping. Previously untested
  and unbounded; the consumer (`branding-settings`) takes the newest-first list, so the
  bound preserves the contract.
- New regressions: `admin-leagues-route.test.ts` (401/403/200/500 gate contract,
  projection, bound) and `super-admin.test.ts` (active-`super_admin`-row-only grant,
  fail-closed on DB error, dev-only `SUPER_ADMIN_EMAIL` fallback pinned: non-production,
  missing-row-only, case-insensitive).

**Fresh verification:** web **2,136 / 72** (+15); `tsc --noEmit` at its **19
pre-existing** lines; `git diff --check` clean. Next: continue the admin-API tier audit
(impersonation, `settings/branding`, `cron/subscription-renewal`, `billing/stripe`).
Roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 43: impersonation routes — atomic claim + first regressions

- `GET /api/impersonation/session` no longer races: the ledger row is claimed in one
  `UPDATE … WHERE jti AND status = "issued" RETURNING` (`lib/impersonation-ledger.ts`),
  so concurrent redemptions of a single-use token cannot both succeed — the loser 409s.
  The old read-then-update flow allowed a duplicate-use window. `revokeImpersonationSession`
  only transitions live sessions; the exit route still clears its cookie on every path.
- New regressions: `impersonation-routes.test.ts` (11) covering 400/401/200/409/500 on
  session (claim predicate, cookie attributes, no-cookie-on-failure) and all exit paths.

**Fresh verification:** web **2,147 / 74** (+11); `tsc --noEmit` at its **19 pre-existing**
lines; `git diff --check` clean. Next: continue the admin-API tier audit (`settings/
branding`, `cron/subscription-renewal`, `billing/stripe/checkout`, `webhooks/stripe`).
Roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 44: Stripe billing — serialized intents + verified extraction

- `api/billing/stripe/checkout` had a duplicate-creation race: two concurrent owner
  POSTs could both pass the pending-check and mint two Stripe sessions / two live
  requests. New `lib/stripe-billing.ts` creates the intent in one transaction that
  locks the tenant row `FOR UPDATE` and re-checks pending under the lock (loser 409s);
  the Stripe HTTP call stays outside the transaction, session creation failure still
  rejects the intent, and the session URL is stored as the payment reference.
- `api/webhooks/stripe`: signature verification extracted as a pure function
  (`verifyStripeSignature` — Stripe's t=/v1 HMAC-SHA256 scheme, constant-time across
  every v1, five-minute tolerance, unchanged 400 mapping); settlement kept verbatim in
  `settleCheckoutCompleted` (FOR UPDATE, pending-window expiry, `PLAN_PRICES` amount
  check, claim via `UPDATE … WHERE status = "pending" RETURNING` — idempotent against
  duplicate deliveries); `expireCheckoutSession` is pending-predicated. Routes are thin
  wrappers. context7 check confirmed PKR is a *two-decimal* currency (paisa math was
  already consistent; the wrong "zero-decimal" comment is fixed).
- New regressions: `stripe-billing.test.ts` (16): signature accept/reject matrix
  (valid, multi-v1, tampered, wrong secret, stale, missing header); intent lock +
  conflict path; settlement ignore/already-resolved/expiry/amount-mismatch/invalid-price
  + full settle path and pending-only expiry.

**Fresh verification:** web **2,163 / 76** (+16); `tsc --noEmit` at its **19 pre-existing**
lines; `git diff --check` clean. Next: close the admin/API tier with `settings/branding`
(unscoped write) and `cron/subscription-renewal` (unattended transaction). Roadmap counts
stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 45: branding + renewal cron — validated writes, tested sweep

- `api/settings/branding`: new `lib/branding-settings.ts` — pure plan gating
  (`brandingPlanViolation`: white-label fields pro+, custom domain enterprise-only) and
  `saveBrandingSettings`, one transaction that locks the tenant row `FOR UPDATE` and
  reads the plan under the lock before answering the gate (a concurrent plan change
  cannot race a white-label write past it), then updates the custom domain and upserts
  the branding row (primary-key`tenantId`, no duplicates). The route now zod-validates
  the PUT body (400 instead of writing untrusted raw JSON into every column) and maps
  missing → 404 / violation → 403 with unchanged messages; GET shape unchanged.
- `api/cron/subscription-renewal`: sweep extracted verbatim to
  `lib/subscription-renewal.ts` — notify pass (day-range buckets, 36 h idempotency
  guard, `past_due` flip only for active rows), enforce pass (pause claimed via
  `UPDATE … WHERE id AND status IN (live) RETURNING`, tenant downgrade in the same
  transaction, `free` on win, nothing on a lost race). Route is now only the fail-closed
  auth gate (unset CRON_SECRET → 503; constant-time bearer compare → 401).
- New regressions: `branding-settings.test.ts` (9) and `subscription-renewal.test.ts`
  (15): gating matrix, locked save paths, pure helpers, bucket inserts with filled
  templates, flip rules, idempotent skip, transactional pause+downgrade with the claim
  predicate, lost-race safety, and the cron route's 503/401/200/500 gate.

**Fresh verification:** web **2,187 / 78** (+24); `tsc --noEmit` at its **19 pre-existing**
lines; `git diff --check` clean. Admin/API tier complete; next candidates are the
remaining untested API routes (`dns/verify`, `email/verify`) or the roadmap register.
Roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-15 — Batch 46: domain verification trio — DKIM redaction, validated inputs

- **Security fix:** `api/email/verify` (GET+POST) returned the full verification row
  including the DKIM RSA private key to the client; the UI only renders
  `dkimPublicKey`/`dkimSelector` and the mail service reads the key from the DB. New
  `lib/domain-verification.ts` redacts responses via `toClientEmailVerification`.
- `api/dns/verify`, `api/email/verify`, `api/ssl/status` extracted to the lib verbatim
  (authority = super admin or exact league owner; DNS TXT + email SPF/DMARC/DKIM checks
  all-required and fail-closed; token rotation on every POST; verified transitions write
  the verification row and the tenant flag together). Routes now zod-validate inputs
  (400 on malformed domain/tenantId/senderEmail) with unchanged status codes/messages.
- New regressions: `domain-verification.test.ts` (17): authority matrix, TXT matching
  (pins the existing chunk-split non-assembly boundary), resolver-error fail-closed,
  redaction contract, DKIM publishability, mint insert/rotate, two-row verified writes,
  and route gates.

**Fresh verification:** web **2,204 / 79** (+17); `tsc --noEmit` at its **19 pre-existing**
lines; `git diff --check` clean. Next: remaining direct-db API routes (`auth/otp/send|
verify`, `webhooks/clerk`, `payments/upload-proof`, `subscriptions/request`). Roadmap
counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-16 — Batch 49: fixture generation — approved registrations to planned fixtures (COMP-04 groundwork)

- Pure planners in the new `lib/fixture-planning.ts`: deterministic approval
  ranking (earliest approved = seed 1, team-id tie-break), seed binding via the
  saved bracket-slot permutation (fail-closed on invalid permutations; knockout
  is strict — a mismatched saved order blocks generation, group formats fall
  back to ranking with the fallback recorded), league single round-robin via
  the circle method (every pairing exactly once, one match per team per round,
  byes for odd counts), knockout first round with standard top-vs-bottom
  seeding (2/4/8/16/32 only, stage labels final/semi_final/quarter_final/
  knockout), hybrid group stage (snake-distributed groups of ≤ 4, complete
  group round-robins; knockout stage defers to advancement).
- Locked writer in the new `lib/fixture-generation.ts`: one `read committed`
  transaction — account → league/membership shares → tournament row
  `FOR UPDATE` → re-checks (no regeneration over existing fixtures, archived/
  completed blocked, wizard config required, ≥ 2 approved teams, capacity,
  power-of-two knockout counts checked before seeding, all slotted teams
  active). Persists scheduled matches with sequential match numbers; dates
  deliberately unscheduled (COMP-07). Creating fixtures starts the
  competition: tournament → live, registration closed, audited
  `TOURNAMENT_FIXTURES_GENERATE` (before/after, counts, seed-order-applied
  flag). New `generateFixtures` server action (`match:create`) delegates with
  dashboard revalidations.
- Group labels are not persisted (matches has no group column) — they live in
  the returned rounds/plan.
- New regressions: `fixture-planning.test.ts` (16), `fixture-generation.test.ts`
  (14 — lock order, all fail-closed gates, league happy path incl. live
  transition + audit, seed applied vs stale fallback, knockout first round/
  counts/strict seeding, hybrid groups), `tournament-actions.test.ts` (+2 —
  permission mapping + delegation).

**Fresh verification:** web **2,265 / 85** (+32); `tsc --noEmit` at its **19 pre-existing**
lines; `git diff --check` clean. Next: advancement + standings (COMP-05) —
shared points/NRR/tie-breaker module and a locked knockout-advancement writer
(live → completed). Roadmap counts stay **19 checked / 60 open / 79 IDs**
(COMP-04: generation done; binding-to-UI surfaces still to wire).

### 2026-10-16 — Batch 48: manual billing + proofs + clerk sync — last direct-db routes

- The final three direct-db API routes are closed; the API tier is fully covered.
  `webhooks/clerk` was already correct (Svix-verified, fail-closed secret handling,
  conflict-aware upserts) and gains regression coverage only.
- **Race fix:** `POST /api/subscriptions/request` (the bank/jazzcash/easypaisa sibling
  of the Stripe checkout) had the same read-then-insert duplicate-pending race Batch 44
  fixed on the Stripe side. New `lib/subscription-requests.ts` creates the request in
  one transaction: tenant row `FOR UPDATE`, pending re-check under the lock (loser 409),
  7-day expiry computed inside the transaction. `findOwnedTenant` dedupes the route's
  redundant double `users` lookup while keeping the distinct user-missing vs
  league-missing 404 messages; the receipt allow-list (our storage origin +
  `/storage/v1/object/sign/payment-proofs/receipts/<user>/` + required token) is
  byte-for-byte unchanged.
- `lib/payment-proof.ts` extracts the proof-upload pure primitives — magic-byte
  sniffing (JPEG/PNG/GIF/WebP) is the stored content-type authority, hostile filenames
  are sanitized to the safe alphabet, storage paths are uploader-namespaced. The route
  keeps the flow: declared-type allow-list, 5 MB cap, sniff-equals-declared check,
  private bucket, 7-day signed URL, 503 fail-closed without service credentials.
- New regressions: `subscription-requests.test.ts` (6 — owned-tenant resolution with
  distinct missing-reasons, locked creation values/expiry, conflict without insert,
  bounded history), `payment-proof.test.ts` (5 — magic bytes incl. RIFF-without-WEBP
  and truncated headers, sanitization alphabet, name cap, namespaced path),
  `clerk-webhook.test.ts` (8 — health alias, 500 fail-closed without a secret, 400 on
  missing Svix headers/bad signature with no write, `user.created` insert values
  without login backfill, username fallback + `lastLoginAt` on update, `user.deleted`
  soft-delete predicate, ignored events).

**Fresh verification:** web **2,233 / 83** (+18); `tsc --noEmit` at its **19 pre-existing**
lines; `git diff --check` clean. Next: API tier done — remaining register items are
product slices (fixtures/advancement is the largest gap) or environment-dependent
acceptance. Roadmap counts stay **19 checked / 60 open / 79 IDs**.

### 2026-10-16 — Batch 47: OTP flows — brute-force-cap race fixed, tested

- `api/auth/otp/send` and `api/auth/otp/verify` extracted to
  `lib/otp-verification.ts` (routes stay thin: unchanged status codes/messages).
- **Race fix:** verify's wrong-attempt counter was read-then-written, so two concurrent
  wrong guesses could both pass the cap check and push `attempts` past `maxAttempts`.
  The increment is now an optimistic claim — `UPDATE … WHERE id AND maxAttempts >
  attempts AND attempts = <observed> RETURNING` — the loser is answered 429 `exhausted`;
  the counter can reach exactly `maxAttempts`, never beyond. Rate limit, cooldown,
  hashed minting and verified-stamping behavior unchanged.
- New regressions: `otp-verification.test.ts` (11) — mint/expiry, rate-limit/cooldown,
  not-found/exhausted, verified stamping, predicated increment params, lost-race 429,
  route mappings. The suite also caught the lib missing its `OTP_MAX_PER_HOUR` import.

**Fresh verification:** web **2,215 / 80** (+11); `tsc --noEmit` at its **19 pre-existing**
lines; `git diff --check` clean. Next: `webhooks/clerk` regressions (already
Svix-verified), `payments/upload-proof`, `subscriptions/request`. Roadmap counts stay
**19 checked / 60 open / 79 IDs**.

### Decisions still requiring explicit review

Identity migration/linking; membership/grant schema and fallback retirement; MFA/recovery policy; invite/OTP defaults; league onboarding policy; official independent approvals; supported cricket laws/formats; currency/payment providers; visibility/minor consent; product limits/grace; feed/media rights; recovery/performance load targets. Record decisions rather than guessing business/legal rules in code.

## 18. Sources, Evidence and Maintenance

### Repository evidence

- [Historical master plan and six batch trackers](../MASTER_PLAN_2026-10-10.md).
- [Accepted backend ownership](architecture/BACKEND_UNIFICATION_DECISION.md) and [project guide](PROJECT_GUIDE.md).
- [Current global user-management actions](../apps/web/src/app/actions/users.ts), [invitation actions](../apps/web/src/app/actions/users-invites.ts), [ownership transfer actions](../apps/web/src/app/actions/ownership.ts), [tenant role schema](../packages/database/src/schema/user-tenant-roles.ts), [ownership transfer schema](../packages/database/src/schema/ownership-transfers.ts).
- [Scoring service](../services/scoring-service/src/scoring.service.ts), [write access](../services/scoring-service/src/scoring-write-access.ts), [gateway](../services/scoring-service/src/scoring.gateway.ts).
- [Dashboard context](../apps/web/src/lib/dashboard-context.ts), [data](../apps/web/src/lib/dashboard-data.ts), [sections](../apps/web/src/components/dashboard/dashboard-sections.tsx).
- [Tournament configuration](../packages/database/src/lib/tournament-configuration.ts) and [migration status](../supabase/MIGRATION_STATUS.md).

### Current documentation consulted during the 12 October planning discussion

- [Clerk session reverification](https://clerk.com/docs/guides/secure/reverification): custom server-side sensitive-action checks; factor caveats and action-bound verification.
- [Clerk email/SMS OTP flows](https://clerk.com/docs/guides/development/custom-flows/authentication/email-sms-otp): provider-managed verification; check installed SDK compatibility before implementation.
- [Supported Supabase Clerk third-party integration](https://supabase.com/docs/guides/auth/third-party/clerk): legacy shared-JWT-template integration is deprecated.
- [Supabase 2026 explicit Data API grants change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically): distinguish grants, RLS and direct connection access.

### Maintenance protocol

- This document owns future priority and stable phase task IDs. The original plan preserves historical findings, acceptance caveats and delivered batch detail; do not erase or retroactively relabel them.
- On each batch, update last-reviewed date, baseline/commit evidence and exact checkbox scopes; add unresolved regression/operational cases to section 15.
- Link new architecture/security/product decisions from this file. No inferred feature-wide completion percentages from raw checkbox counts.
- Record automated tests separately from authenticated browser/device, real PostgreSQL, deployed event and provider evidence.
- Never mark a feature production-ready because a plan describes it. Keep partial features and release gates visibly open until evidence exists.
