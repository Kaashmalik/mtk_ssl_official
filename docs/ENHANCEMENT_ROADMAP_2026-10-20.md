# Cricket SaaS Enhancement Roadmap — 20 October 2026

> **Start here:** read sections 1–4, select the earliest unblocked task in section 6, and use the handoff template in section 8. Do not attempt this entire roadmap in one change.

## 1. Document control and execution rules

| Field                             | Value                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Created / research reference date | **2026-10-20**                                                                                                                                                |
| Repository source baseline        | `9322d9d` on `main`; recheck HEAD and working tree before implementation                                                                                      |
| Purpose                           | Model-independent, file-oriented implementation guide covering frontend, backend, native mobile, synchronization, media, live production, and fan interaction |
| Delivery status                   | **Planning document created. All enhancement tasks below are proposed, not implemented or production-verified by this document.**                             |
| Recommended direction             | Incremental improvements to existing architecture; daylight-first operational UI; server-authoritative scoring; centrally owned, tenant-separated broadcasts  |
| Schedule                          | 70-workday planning baseline, approximately 60–90 workdays for the expanded scope; not a commitment or automatic deadline                                     |
| First implementation task         | `ENH-00-01`, followed by the safety findings before broader rollout                                                                                           |

### Authority and related documents

- [Canonical SaaS master plan](SAAS_MASTER_PLAN_2026-10-12.md): existing product scope, canonical task IDs, and completion rules.
- [Accepted backend decision](architecture/BACKEND_UNIFICATION_DECISION.md): Next.js owns product CRUD; Nest scoring-service owns scoring.
- [Migration status](../supabase/MIGRATION_STATUS.md): latest dated migration/deployment evidence, not old unchecked copies.
- [Session ownership](PARALLEL_SESSION_DIVISION.md) and [delivery groups](DELIVERY_EXECUTION_GROUPS.md): verify current ownership before touching shared files. Historical session assignments are not permission to overwrite current work.
- [Release checklist](../RELEASE_CHECKLIST.md), [release evidence](RELEASE_EVIDENCE.md), and [rollback runbook](ROLLBACK_RUNBOOK.md): retain existing gates; review commands against the actual environment before executing them.

This roadmap is an **execution overlay**, not a replacement completion register. `ENH-*` IDs are local work packages, not new canonical master-plan IDs. Link implementation evidence back to the relevant canonical item; do not alter its parser/counts or close existing checkboxes just because this document exists.

### Evidence and scope boundaries

The underlying review was a broad source audit plus official-provider/design research, not exhaustive line-by-line certification. Browser, real-device, outdoor, live database, provider account, and end-to-end broadcast acceptance were not performed for this roadmap.

Earlier session evidence recorded type-check success for 19 tasks and test/build success for 30 Turbo tasks; web tests reported 3,271 passed and 9 skipped. These are **historical local baseline results**, not newly run acceptance and not proof of the edge cases below. Mocked SQL/provider tests do not establish real concurrency, provider delivery, or privacy behavior.

At document creation these dependency files already had local changes; preserve them and review ownership before staging:

```text
apps/marketing/package.json
packages/ui/package.json
services/notification-service/package.json
pnpm-lock.yaml
```

Rules for every implementing model:

1. Re-read the current source, branch, diff, relevant instructions, and canonical status. Paths below are starting points, not permission for a repository-wide rewrite.
2. Reproduce a finding with a focused failing test before fixing it. Record a disproven finding with evidence instead of inventing work.
3. Declare exact write paths, contracts, tests, deployment dependencies, and rollback before editing. A directory listed below must be expanded to actual files.
4. Keep work vertical: policy/contract → backend → UI/native adapter → tests → evidence. No dead-end buttons or backend-only claims of completed journeys.
5. Never broaden roles, disable validation/RLS, expose secrets, fabricate success, or delete queued work to obtain a passing test.
6. No unrelated package upgrades, broad formatting, destructive Git operations, production migrations, or provider mutations without explicit authorization.
7. Mark source implementation, local verification, staging acceptance, and production verification separately. Do not mark a phase complete while its exit gate is blocked.

## 2. Source findings and existing foundations

### Preserve what is already implemented

- Clerk identity and webhook account mapping; reviewed league onboarding and instant Free creation.
- MFA-protected platform review and the transactional approval path that creates tenant, subscription, and owner membership.
- Hardened staff invitations, expiry-aware principal membership checks, scoped roster management, and audited member commands.
- Canonical Nest scoring writes, operation identity/revisions, web offline recovery, public tenant/publication checks, and scoring outbox infrastructure.
- Role-aware web dashboards, some accessible loading/error states, durable form drafts, and branding draft/publish/rollback.
- YouTube/Facebook embeds, public match scorecards, reactions, polls, follows, and private no-stakes predictions, with different access requirements.
- Private Supabase payment-proof storage. Do not move financial evidence into public media delivery.

### Prioritized findings to reproduce

| Priority                       | Source evidence / starting point                                                                      | Required investigation                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 candidate: identity privacy | `apps/web/src/lib/public-visibility.ts`, `minorConsentPublicSql`                                      | DOB comparison appears reversed relative to `minor-consent-policy.ts`; test actual SQL and every affected public projection. Do not claim a confirmed production incident. |
| P0 candidate: score integrity  | `apps/mobile/app/scoring/[matchId].tsx`, `use-offline-sync.ts`, web `scoring-submission.ts`           | Queued extras/wickets and wire payload disagree; a wicket can carry an unintended run. Trace real serialization, not only mocked acknowledgement.                          |
| P1: cached private pages       | `apps/web/public/sw.js`                                                                               | Same-origin navigations include authenticated pages; test sign-out/account-switch/offline confidentiality and old-cache eviction.                                          |
| P1: native replay              | `apps/mobile/src/store/offline-store.ts`, `use-offline-sync.ts`                                       | Multiple commands reuse stale state/revisions and conflicts can be skipped; establish ordered reconciliation.                                                              |
| P1: application integrity      | `apps/web/src/lib/tournament-applications.ts` and its migration CHECKs                                | Nonterminal decisions, tenant linkage, expiry, deadlines, and lock-time rereads need equivalence tests.                                                                    |
| P1: league onboarding          | `league-application-form.tsx`, dashboard context/layout, admin tenant creation                        | Restart retains terminal version; post-submit form remains editable; delayed webhook looks like denial; manual provisioning diverges.                                      |
| P1: delivery/security          | `notification-reads.ts`, `push-delivery.ts`, `push-receipts.ts`, Nest notification controller/gateway | Preference fields, Expo ticket `id`, partial receipts, token lifecycle, recipient read state, and legacy arbitrary-room writers need repair.                               |
| P1: upload trust               | Admin `cloudinary-upload.tsx`, media schema, web/admin image/CSP settings                             | Unsigned URL-only uploads lack shared authorization/finalize/delete; tournament/venue APIs omit some submitted image fields.                                               |
| UX/parity                      | Shared primitives, admin shell, native screens, web/native i18n                                       | Inconsistent tokens/themes, incomplete motion reduction, small/unnamed controls, missing native error states, and language mismatch.                                       |

Current web locales are `en`, `bn`, and `ar` in `apps/web/src/i18n/config.ts`; native `apps/mobile/src/lib/i18n.ts` includes Urdu. **Do not describe web Urdu or full RTL parity as implemented.** Approve the language matrix, add reviewed translations, and test layout separately.

Latest migration notes record REG-01 reconciliation and the tenant-array retirement as applied in October 2026. Do not rerun these because an older plan/session paragraph says pending. Verify current ledger/catalog only when authorized.

## 3. Product decisions and non-negotiable architecture

### 3.1 Decisions requiring an owner

| Decision                             | Recommended initial position                                                                                    | Blocks                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Instant Free versus reviewed leagues | Retain both current paths until a policy change is approved                                                     | Onboarding policy changes        |
| New fan acquisition                  | Explicit fan destination and safe fan-only join flow; never create organizer rights automatically               | Broad fan engagement rollout     |
| Organizer information                | Approve required/optional phone, location, description, and information-request replies                         | Application schema expansion     |
| WhatsApp                             | Manual support at **+92 303 8111297**; no automatic approval or background sending                              | Support content/privacy sign-off |
| Native organizer enrollment          | Secure web handoff first, full native flow only if approved                                                     | Native onboarding scope          |
| Languages                            | Agree web/native locale matrix; retain existing languages, add Urdu deliberately if approved                    | Localized release                |
| Broadcast ownership                  | Super-admin owns provider connections; scoped operators manage assigned match sessions                          | Provider automation              |
| Public/private video                 | Social embeds for public viewing; managed authenticated delivery for genuinely private viewing                  | Private archives                 |
| Media and chat consent               | Explicit participant/guardian policy, retention, moderation, and withdrawal/takedown process                    | Public photos/videos/chat        |
| Capacity and money                   | Approve provider quotas, storage/egress budget, supported concurrent matches, and any revenue-sharing agreement | Scale and monetization           |

“Live credit” is ambiguous: broadcast-control delegation and revenue sharing are different features. Central-channel YouTube earnings do not automatically split by tenant. Financial reporting/payouts need a separate approved specification; do not add paid gifts or betting-like leaderboards here.

### 3.2 One canonical write path

```text
Web server actions / Admin routes / Native HTTP adapters
                  |
      validated, versioned application contracts
                  |
      verified actor + tenant + effective membership
                  |
     command-specific resource and lifecycle policy
                  |
    Next.js/Drizzle product CRUD | Nest canonical scoring
                  |
           transaction + audit + durable events
                  |
   live views / overlay / notifications / read-model refresh
```

- Keep the accepted hybrid architecture. Do not migrate all CRUD to Nest or route product traffic through an incompatible legacy gateway.
- Add a small runtime-neutral contracts package only after checking existing exports. Share DTOs, enums, validation, and pure presentation semantics—not database clients or server credentials.
- Web and native call the same domain commands through thin adapters. Tenant IDs, player IDs, and URLs from clients are requests, never authority.
- Continue exact-tenant public allowlists and active-account/membership checks. Privileged Drizzle queries require application scoping even when RLS exists.
- Use locked rereads, consistent lock order, expected versions, unique idempotency keys, and explicit conflicts. Do not hold DB transactions open during external provider calls.
- Store timestamps consistently, use database time for sensitive expiry, and convert at display boundaries. Model cricket overs as legal balls, not decimal arithmetic.
- Durable event/job delivery is at-least-once: use stable event IDs and idempotent consumers. Do not promise magical exactly-once socket delivery.

### 3.3 Assigned-role operations

Complete permitted journeys, not unrestricted CRUD for everyone. This is a proposed baseline; preserve stricter existing policy until reviewed.

| Actor                          | Intended scope                                                    | Not implied                                    |
| ------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------- |
| Guest                          | Published viewing; chat read only if approved                     | Posting, private records, operational writes   |
| Fan                            | Own follows/preferences, allowed polls/reactions/predictions/chat | Organizer rights or official result changes    |
| Player                         | Approved self-profile, availability and requests                  | Other players' records or official score edits |
| Captain / coach                | Named functions for assigned teams                                | General roster/finance administration          |
| Team manager                   | Assigned-team roster and registration commands                    | Other teams or approval of own application     |
| Scorer                         | Assigned-match deliveries and authorized lifecycle/corrections    | Unassigned matches or platform operations      |
| Umpire assignment              | Explicit approved match functions                                 | A new unrestricted user role                   |
| League owner                   | Own-league resources, members, assignments and reviews            | Platform account administration                |
| Super admin                    | MFA-protected platform administration and audited intervention    | Automatic league scoring authority             |
| Broadcast operator / moderator | Proposed scoped capabilities for assigned resources               | A silently introduced all-powerful role        |

For each resource record list/read/create/update/archive/delete rules, owner, assignments, expiry, lifecycle, audit, and confirmation UX. Protect historical official records through correction/archive workflows. Add generic custom grants only after a separate requirement/design review.

## 4. Daylight-first UI specification

**Selected direction: Daylight Cricket Operations.** Opaque surfaces, readable text, stable scores, restrained green, prominent touch actions, and limited purposeful motion. Borrow expressive hierarchy, not excessive glass, gradients, or bouncing controls. “Best” means measured user outcomes, not a universal 2026 trend ranking.

| Semantic token           | Value                  | Computed opaque pairing        |
| ------------------------ | ---------------------- | ------------------------------ |
| Background / surface     | `#F6F8F5` / `#FFFFFF`  | —                              |
| Foreground / secondary   | `#17231C` / `#47554B`  | 16.23:1 / 7.87:1 against white |
| Primary / hover          | `#146C43` / `#115A38`  | White text 6.45:1 / 8.26:1     |
| Warning                  | `#7A4B00` on `#FFF3D6` | 6.72:1                         |
| Error                    | `#B42318` on `#FFF0EE` | 5.93:1                         |
| Info / focus             | `#175CD3`              | 5.99:1 against white           |
| Essential control border | `#7A877E`              | 3.75:1 against white           |

These calculations do not certify rendered/translucent/disabled/tenant-branded states. Separate semantic action/focus/status colors from arbitrary tenant decoration. Preserve light/dark/system choices and an explicit daylight option.

- WCAG 2.2 AA: ordinary text 4.5:1, qualifying large text 3:1, required nontext indicators 3:1; no color-only meaning.
- AA minimum target is 24 CSS px with exceptions; choose the stronger **48px web operational target**, Android 48dp, and verified iOS logical touch areas. Scoring actions should be approximately 56–60 units where practical. These units are not physical pixels.
- Reflow at 320 CSS px; test 200% text and 400% desktop zoom. Contain genuine two-dimensional scorecard scrolling rather than causing page-wide overflow.
- 16px web body/form baseline, tabular scores, visible labels, named icon actions, readable validation, focus restoration, error summary and honest loading/empty/offline/conflict states.
- Suggested layouts: phone below 640px, compact/tablet 640–1023px, full sidebar from 1024px when content fits. Native uses available width/font scale/safe-area insets, not device-name assumptions.
- Suggested micro-feedback 120–200ms; avoid route translation, width animation, infinite decoration, and button movement in scorer screens. Respect CSS and JS reduced motion and native accessibility settings.
- Match celebrations have separate Full / Reduced / Off preferences; the broadcast operator controls encoded graphics, while viewers control optional local effects.
- Keep DOM-based `@mtk/ui` out of React Native. Share token meanings/contracts, not browser components. Reuse existing libraries; justify any added dependency and version compatibility.
- Target field p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1; lab scores are not field percentiles. Proposed pilot bundle-growth budget: +10KB gzip first-load JS, no new UI framework.

## 5. Phase schedule, dependencies, and milestones

> **P00 execution record (2026-10-20):** the reconciled baseline and the
> owner-decision register (approved D-01…D-08 + explicit blockers) live in
> [P00_BASELINE_AND_DECISIONS_2026-10-20.md](P00_BASELINE_AND_DECISIONS_2026-10-20.md).

Workdays are relative to an approved start, not calendar promises. All phases start **proposed**. Schedule one or two small task IDs daily and carry blockers forward honestly. The earlier 50-day outline did not include the full broadcast/chat scope; this expanded baseline is 70 workdays.

| Phase | Workdays | Dependencies                     | Deliverable / canonical areas                         |
| ----- | -------- | -------------------------------- | ----------------------------------------------------- |
| P00   | D01–D02  | None                             | Baseline/decisions; BASE/REL                          |
| P01   | D03–D08  | P00                              | Safety and invariants; PUB/ISO/SCORE/IAM              |
| P02   | D09–D13  | P00; relevant P01 gates          | Onboarding/WhatsApp/fan entry; REG/IAM/FAN            |
| P03   | D14–D17  | P01                              | Shared contracts and readers; SCORE/ISO/BASE          |
| P04   | D18–D23  | P00; pilot contracts             | Daylight UI and accessibility; UX/PREM                |
| P05   | D24–D28  | P01/P03                          | Assigned-role CRUD; IAM/REG/COMP                      |
| P06   | D29–D35  | P03/P05                          | Native parity, replay, notifications; SCORE/FAN/REL   |
| P07   | D36–D44  | P03/P05; consent/budget          | Verified media lifecycle; ISO/PREM/FAN                |
| P08   | D45–D52  | P03/P05; provider approval       | Isolated broadcasts and archives; PREM/SCORE/FAN      |
| P09   | D53–D58  | P06/P08; permitted assets        | OBS scoreboard and accurate animations; SCORE/UX/PREM |
| P10   | D59–D65  | P02/P05/P06; moderation approval | Moderated match chat and viewer interaction; FAN/IAM  |
| P11   | D66–D70  | All release-critical gates       | Device/staging/production acceptance; REL/BASE        |

Milestones: registration/support around D13; core web/native parity around D35; media/broadcast preparation around D52; professional graphics around D58; moderated fan launch around D65. Actual dates depend on evidence and external approvals. Scoped prototypes may run earlier, but cannot bypass safety gates.

## 6. Task-by-task implementation guide

All paths are repository-relative. **New** means a proposed file/surface; confirm naming/export conventions before creation. Add focused tests in existing package test directories; do not assume an admin/native test harness already exists. Every phase inherits section 7's acceptance matrix and section 8's definition of done.

### P00 — Baseline, decisions, and ownership

**ENH-00-01 — Reconcile the current state.** Read the master plan, accepted ADR, migration status, session ownership, root `package.json`, `turbo.json`, and current diff. Record baseline SHA, existing changes, package/test scripts, deploy topology, and actual completed features. Expand this phase's canonical mappings without changing historical completion counts. **Accept:** a reproducible baseline and no accidental adoption/reset of another person's changes.

**ENH-00-02 — Approve product/environment decisions.** Record section 3 decisions with owner/date; inventory staging identities, provider account access, supported formats, budgets, moderation and consent owners. Verify production Clerk/webhook/MFA readiness rather than trusting old notes. **Accept:** each dependent task has a decision or explicit blocker; no secrets in evidence.

**Phase gate / rollback:** documentation and fixture planning only; no permission expansion or live mutations. Stop work with ambiguous ownership.

### P01 — Close release-critical source findings

**ENH-01-01 — Prove consent equivalence.** Backend: `apps/web/src/lib/public-visibility.ts`, `packages/database/src/lib/minor-consent-policy.ts`. Frontend: affected public tables/PDF/name projections. Tests: minor/adult/18th-birthday, unknown DOB, future/withdrawn consent, SQL-versus-policy truth in approved local/staging PostgreSQL. **Accept:** agreed identity rules match on public web/API/PDF/overlay; do not remove statistical rows where official totals require them.

**ENH-01-02 — Correct protected caching.** Frontend: `apps/web/public/sw.js` and account/workspace transition hooks identified during implementation. Backend: verify protected response cache headers. Purge old affected caches, keep anonymous offline shell and separately scoped command queues. **Accept:** account A → sign-out → B → offline cannot show A's protected HTML; anonymous assets remain installable.

**ENH-01-03 — Repair transactional application/membership invariants.** Backend: `apps/web/src/lib/tournament-applications.ts`, `packages/database/src/tenant-context.ts`, `apps/web/src/lib/rbac-server.ts`; inspect `supabase/migrations/20261018230000_tournament_applications.sql` without editing applied history. Fix live-state decision fields, both-resource tenant checks, deadline/registration flags, effective membership, and locked rereads/conditional transitions. Review SQL `current_tenant_id()` expiry equivalence through a new migration if needed. **Accept:** real CHECK constraints and racing approve/withdraw/review cases agree with shared policy.

**ENH-01-04 — Contain unsafe delivery/replay paths.** Files: native `use-offline-sync.ts` / `offline-store.ts`, web `rate-limit.ts`, Nest notification controller/gateway, `packages/database/src/repositories/base.ts`. Add conflict-head barrier, explicit exhausted-bucket refusal, authentication/room derivation or quarantine for legacy notification writers, and prevent generic authority/tenant-field mutation. **Accept:** no skipping unresolved commands or joining arbitrary private rooms; latent helper risks are classified separately from reachable exploits.

**Phase gate / rollback:** each P0/P1 finding has reproduction and fix evidence or documented disproof. Pause affected surfaces rather than restoring unsafe behavior; preserve pending commands/audits. Full semantic scoring repair continues in P03/P06.

### P02 — Recoverable league onboarding and platform contact

**ENH-02-01 — Repair fresh-account navigation.** Frontend: dashboard layout/setup, `apps/web/src/lib/dashboard-context.ts`, signup redirects. Backend: `apps/web/src/app/api/webhooks/clerk/route.ts` and existing verified-identity reconciliation where appropriate. Distinguish pending local provisioning from suspended/forbidden accounts. Add approved fan-versus-organizer destination without granting membership. **Accept:** delayed webhook, existing fan, returning applicant, owner and denied account get truthful recovery; no redirect loops.

**ENH-02-02 — Repair applicant and admin state.** Files: `apps/web/src/components/league-application-form.tsx`, `apps/web/src/app/actions/league-applications.ts`, shared `league-application-policy.ts`, admin `league-applications/route.ts` and `league-applications-management.tsx`. Reset terminal identity/version for a fresh application; make submitted state read-only; display saved status/reviewer request and refresh; remove illegal repeated review actions. Add approved persisted applicant replies without confusing league applications with existing tournament replies. **Accept:** draft → submit → request information → reply/resubmit → approval, plus rejection/withdrawal/new attempt, stale tabs and duplicate clicks.

**ENH-02-03 — Normalize provisioning and fan entry.** Backend: `apps/admin/src/app/api/tenants/route.ts`, web `actions/tenants.ts`, membership policy/writers. Frontend: `apps/admin/src/app/tenants/[id]/tenant-detail.tsx` and exact tenant API DTO. Reuse atomic owner/membership/subscription/branding/audit invariants, lock order and ownership cap; fix snake_case/camelCase mismatch. Implement the approved fan-only joining command with isolated membership tests; do not repurpose staff invites blindly. **Accept:** manual-create/approval/self-service races cannot duplicate ownership or leave inaccessible workspaces; fan joins gain no operational rights.

**ENH-02-04 — Add privacy-conscious WhatsApp support.** New: `apps/web/src/lib/platform-support.ts`, `apps/web/src/components/support/platform-contact.tsx`. Integrate setup/apply/status/recovery and replace hardcoded billing contact; native Settings uses the same message contract later. Link `https://wa.me/923038111297`; display `+92 303 8111297`. Prefill bounded saved league/slug/plan/application reference/displayed status, encode once, preview disclosure, manual Send, copy-number fallback. **Accept:** Unicode/query-character tests; no email/token/OTP/reviewer-note/payment-document defaults, no approval mutation, no claim a message was sent.

**Phase gate / rollback:** complete fresh-signup and cross-console review journey in staging. Keep instant Free/reviewed behavior unless a change is approved. Hide support components independently if needed; retain applications and history. Decision delivery is completed in P06.

### P03 — Contracts and canonical application readers

**ENH-03-01 — Define portable contracts.** Proposed new `packages/contracts/` with `src/scoring.ts`, `src/public-reads.ts`, `src/capabilities.ts`, and explicit exports/package configuration. Reuse existing pure policies initially. Define versioned commands, complete status enums, errors, acknowledgements, pagination, revision and public/member projections. **Accept:** web/native adapters validate real payloads; no Next/DOM/database/server-secret dependency leaks into native.

**ENH-03-02 — Normalize delivery semantics.** Files: web `scoring-submission.ts`, `scoring-service-client.ts`, mobile scoring routes, native scoring screen/serializer, scoring-service command/rules adapters. Resolve extra booleans versus nested objects, wicket attribution, bye/leg-bye boundaries, legal-ball deltas and UI 8 versus server 7 explicitly. Use strict validated boundary schemas and migration-compatible adapters. Add canonical active-participant state before promising automatic striker/bowler graphics; current client-owned strike assumptions are not server truth. **Accept:** each scoring button → persisted command → actual JSON → backend → official state test; no silently stripped intent or invented runs.

**ENH-03-03 — Replace divergent native reads.** Files: `apps/web/src/app/api/mobile/`, native `match-store.ts`, `types/index.ts`, matches/teams/player/detail/standings screens. Keep one documented mobile BFF convention; an alternative version prefix requires ADR review. Serve explicit publication-filtered public DTOs and scoped member DTOs, cursor pagination and canonical standings/NRR. **Accept:** more than 50 fixtures, omitted/forfeited/postponed states, route switches and tenant switches do not produce truncated/wrong/stale results; do not loosen raw Supabase policies to obtain parity.

**Phase gate / rollback:** compatibility routes remain until clients migrate. No second ball writer; keep old compatible clients functional or enforce explicit minimum version. Capture cross-platform contract fixtures.

### P04 — Daylight design, accessibility, and responsive shells

**ENH-04-01 — Normalize themes/primitives.** Files: all three app `globals.css`, provider components, `packages/ui/src/components/theme-toggle.tsx`, shared `button.tsx`, `input.tsx`, `select.tsx`, `card.tsx`. Fix complete-color versus channel formats, class-based dark utilities, resolved system theme and invalid primary glow expressions. New native token/theme files must use runtime-neutral values. **Accept:** light/dark/system and representative tenant colors pass contrast/focus review; existing component APIs remain compatible.

**ENH-04-02 — Repair shared semantics/motion.** Files: shared `data-table.tsx`, `sheet.tsx`, `motion-wrapper.tsx`, `page-transition.tsx`, dashboard shell/loading. Name search/clear/pagination/icon controls, title dialogs, announce loading and failures, restore focus, enlarge operational targets; use JS and CSS reduced-motion controls. **Accept:** keyboard, screen reader, no-motion settings and error recovery work; don't imply unsupported table sorting/search exists.

**ENH-04-03 — Pilot operational screens and shells.** Files: web layout header/sidebar, scoring controls/recovery; admin layout/header/sidebar and users grid; native tabs/scoring/matches/standings/ErrorView. Add compact admin Sheet, role-filtered action launchers, wrapping dismissal controls, dynamic text/safe areas, true store-error handling, per-action pending states and stable scoring controls. **Accept:** section 7 device/viewport matrix and account/role variants; never report a failed read as an empty league.

**ENH-04-04 — Align languages/public presentation.** Files: web `src/i18n/`, existing `messages/` dictionaries, native `src/lib/i18n.ts`, home content and marketing hero/nav/waitlist. Preserve locale support while adding approved Urdu/human-reviewed text and RTL. Fix missing labels, demo destinations and fake rotating “live” claims; label samples honestly. **Accept:** dictionary parity and reviewed locale layout; no unverified adoption/real-time claims.

**Phase gate / rollback:** pilot scorer usability before spreading styles. Preserve dark mode and accessible states; scoped visual flags permit rollback without replacing domain behavior. Outdoor acceptance remains P11.

### P05 — Complete scoped operational CRUD

**ENH-05-01 — Make the capability matrix executable.** Files: web `rbac.ts`, `rbac-server.ts`, database `resource-grants.ts`, Nest `scoring-write-access.ts`, portable capability contracts. Inventory team/player/tournament/match/venue/member/registration/billing/media operations and server checks. **Accept:** role × action × assigned/unassigned × own/foreign tenant × active/expired/suspended table tests, including crafted requests independent of UI.

**ENH-05-02 — Complete assignment/member lifecycle.** Files: `member-management.ts`, `member-assignments.ts`, membership actions/interfaces, scorer/captain/umpire assignment commands. Define block-removal versus atomic revoke for each pointer; recheck effective authority, fresh authentication and fencing where required. **Accept:** removal/reassignment during scoring or roster writes leaves no unauthorized live operation or unexplained stale assignment.

**ENH-05-03 — Close real resource journeys.** Files: relevant web actions/forms and proven `roster-management.ts` / `registration-management.ts`; review dormant `registration-records.ts` / `squad-rules.ts` before reuse. Add missing list/detail/create/update/archive/error flows using audited domain commands. **Accept:** owner/manager/player/captain/scorer journeys match approved rights; official history is not silently deleted; submissions survive recoverable failures.

**Phase gate / rollback:** no arbitrary custom permission JSON or new blanket roles. New delegation/operator/moderator grants require explicit scope, validity, issuer, revocation, audit, and policy approval. Disable new actions independently without corrupting memberships.

### P06 — Native synchronization, identity, and notification convergence

**ENH-06-01 — Build ordered acknowledged replay.** Files: native scoring screen, `use-offline-sync.ts`, `offline-store.ts`, `scoring-ack.ts`, web mobile state/ball routes. Use stable command identity, immutable semantic payload, predicted local sequence where valid, authoritative acknowledgement reconciliation and conflict-head barriers. Isolate queues by verified account/tenant/match and handover epoch; never blind-rebase after conflict. **Accept:** multiple offline balls, duplicates, crash/restart, timeout-after-commit, revoke/handover and account/league switch preserve correct official totals and pending work.

**ENH-06-02 — Repair native session lifecycle.** Files: native root layout, `sign-in.tsx`, `app-api.ts`, push hook and notification service. Align key resolution and provider placement, supported MFA/resend/change-email/recovery, intended return route and web onboarding handoff. Register after session readiness and deactivate/reassign device tokens on sign-out/account change. **Accept:** no pre-session registration, silent lost account scope, or unsupported-factor dead end; real Android/iOS session proof.

**ENH-06-03 — Correct notification contracts.** Files: web `notification-reads.ts`, `notification-dispatch.ts`, `push-delivery.ts`, `push-receipts.ts`, preferences form, push registration/receipt cron routes. Preserve channel booleans on reload/save; parse actual Expo `id`; keep missing/partial receipts pending; retry transport uncertainty; provide authorized match deep links and recipient-specific broadcast read state. Choose provider-specific token records and reconcile legacy Firebase/Expo paths. **Accept:** real-shape fixtures, duplicate/crash recovery, consent/quiet hours and token revocation; provider acceptance is never device delivery.

**ENH-06-04 — Connect durable notifications/realtime recovery.** Reuse existing outbox/job patterns; locate actual fanout/lifecycle callers and background workers, scoring gateway/bootstrap/dispatcher. Add account-level onboarding delivery without requiring membership; dedup event/recipient/channel; reconcile failed jobs. Validate cross-replica fanout and dead-letter head inspection/retry/resolution. **Accept:** restart/poison/multi-instance drills; unconfigured channels remain honestly disabled. Do not run workers in best-effort serverless request lifetimes.

**Phase gate / rollback:** native contract/replay and approved delivery channels have staging evidence. Disable replay/transports without discarding records; multi-instance deployment is blocked until its acceptance passes.

### P07 — Verified photo/video lifecycle

**ENH-07-01 — Define media policy, records, and contracts.** Existing: `packages/database/src/schema/media.ts`; proposed portable `contracts/src/media.ts`, server-only `packages/media/`, web `media-policy.ts` / `media-records.ts`, reviewed schema exports/migrations. Track provider asset identity/version, upload session/quota, resource binding, processing/publication, consent, webhook deduplication and cleanup jobs. Support tournament/venue/branding bindings and same-tenant constraints. **Accept:** sensitive metadata is private; legacy URLs remain `legacy_unverified`, never silently approved; foreign bindings fail.

**ENH-07-02 — Implement authorize/upload/finalize.** Proposed routes: `apps/web/src/app/api/media/uploads/authorize/route.ts`, `uploads/[sessionId]/finalize/route.ts`, `[id]/route.ts`, `[id]/delivery/route.ts`; admin thin adapters call shared commands after platform authorization. Authorize active scoped actors, reserve quotas atomically, issue unpredictable public IDs and approved signed parameters with overwrite disabled. Client uploads directly; server verifies authoritative metadata/content before ready/attachment. **Accept:** wrong tenant/session/asset, revoked membership, forged size/format, malicious URL/SSRF, duplicate finalize and quota races refuse safely.

**ENH-07-03 — Add processing, privacy, and cleanup.** New Cloudinary webhook and durable maintenance worker/trigger. Verify raw-body signature/freshness/dedup; quarantine malformed content; separate ready from public. Tombstone on delete and enqueue provider destruction/invalidation, retries, expiry cleanup and orphan reconciliation; retain assets needed for branding rollback. **Accept:** webhook ordering, provider outage, consent withdrawal, replacement/cancel and tenant deletion preserve cleanup identity and don't leak originals/derivatives.

**ENH-07-04 — Complete web/admin/native forms.** Existing admin uploader and tournament/venue APIs, web team/player/tournament branding/settings, web/admin `next.config.js`; proposed native `services/media.ts`, `components/MediaPicker.tsx`, `MediaView.tsx`, `store/media-upload-store.ts`. Add precise upload/image/video CSP domains, persist verified media IDs, display processing/error/progress and interrupted upload recovery. Select Expo-compatible picker/player dependencies only after review. **Accept:** all platforms reload the same asset revision/state; picker cancellation, app restart, network loss and account switch are honest and safe.

**Provider-specific constraints:** Cloudinary upload signatures have a one-hour acceptance window; an app's shorter session does not revoke them. File/resource type are not protected as arbitrary signed fields. Upload response signatures cover public ID/version, not all client metadata. Obtain authoritative server metadata or verified webhook content. Restrict transformations and detected format/bytes/pixels/duration; no arbitrary URL imports. `private` originals do not imply protected derivatives; authenticated/entitled expiring delivery requires explicit design. Proposed starting caps of 10MiB images and 100MiB/120-second clips require actual account/product approval. Chunk retry is not proof of restart resumability.

**Phase gate / rollback:** consent, quotas/costs, private delivery and real upload/delete acceptance pass. Keep payment proofs separate and store durable object identities rather than permanent expiring URLs where repaired. Disable new intake while retaining compatible reads and reconciliation. Never fall back to unsigned uploads.

### P08 — Centrally owned, isolated live broadcasts and archives

**ENH-08-01 — Model provider ownership and league defaults.** At league setup allow only approved channel/collection choices: centrally owned YouTube connection, one playlist per league, optional authorized Facebook Page, branding and scoped operators. Proposed `contracts/src/broadcast.ts`, server-only broadcast policy/provider adapters, additive schema for provider connection references, match sessions, destinations, jobs and archive references. **Accept:** tenant can operate only assigned match resources; playlists are organization, not ownership/privacy boundaries; credentials remain encrypted/server-side.

**ENH-08-02 — Make broadcast lifecycle truthful.** Extend `apps/web/src/components/matches/stream-start-modal.tsx`, `lib/match-management.ts`, admin broadcast controls and actual worker deployment. Separate “Attach existing broadcast” from “Prepare broadcast”; track desired versus provider-observed provisioning/input/preview/live/interrupted/ending/processing/replay-ready/failed states. No provider call inside a DB transaction. Use bounded retries, uncertain-result reconciliation, exclusive ingest leases/fencing and audit. **Accept:** expired OAuth, duplicates, lost response, input loss and provider refusal cannot falsely show live or cross-wire two matches.

**ENH-08-03 — Integrate supported playback and replay catalogue.** Extend `components/live/stream-selector.tsx`, public live/match pages and native `WatchLiveButton.tsx`; proposed league video catalogue and read adapters. Store exact provider video IDs per match/session/part, permitted embed configuration, thumbnail, duration and availability. Add Live / Upcoming / Replays / Highlights states; placeholders and external-view fallback when unavailable. Tighten hostname allowlists, preserve tenant/publication/consent checks. **Accept:** logged-out mobile/desktop live/replay on real domains; private/deleted/restricted/missing/processing video isn't called available.

**ENH-08-04 — Retain originals and rehearse provider operations.** Configure authorized OBS/local or managed recording, storage budget/retention, long-match segmentation, recovery and archive inventory. Manual Studio/Live Producer remains a supported fallback while OAuth/app review is blocked. **Accept:** operator can prepare two isolated matches, interrupt/recover/end them, verify replay and recover an original recording; no unapproved scraping/downloading.

**Provider boundaries:** each YouTube broadcast is a video; use separate ingest/output bindings per concurrent match and never share secrets across tenants. Current docs report 10 active streams per channel and 3 per key; recheck actual capacity/quotas before rollout, do not hard-code these as permanent guarantees. Streams under 12 hours can be archived by YouTube; longer ones may not be captured. Meta's published policy removes new Live recordings after 30 days. Provider approval, eligibility, video restrictions and playback aren't guaranteed by code. RTMP is ingest, not browser playback; current WebRTC service is beta, not a completed public player.

**Phase gate / rollback:** manual workflow, tenant isolation, recording/replay, rights and provider limits pass first. YouTube/Facebook embeds retain provider rules/branding/ads; never crop/mask/cover their player. Supported player parameters are allowed, but `modestbranding` is ineffective. Truly white-label/private video requires a separately approved managed ingest/HLS/CDN player with playback authorization and costs; social unlisted URLs are shareable, not tenant-private.

### P09 — Accurate React broadcast scoreboards and cricket animations

**ENH-09-01 — Build the OBS presentation route.** New proposed `apps/web/src/app/broadcast/overlay/[broadcastId]/page.tsx`, `components/broadcast/scoreboard-overlay.tsx`, `lib/broadcast-overlay.ts`, and versioned overlay contracts. Feed canonical scoring snapshots/events into an allowlisted transparent 1920×1080 presentation. Show team/league logos, runs/wickets/overs/target, striker/non-striker and bowler figures, recent balls and interruption state. Published information or narrowly scoped revocable read authorization only; no provider keys, PII or score writes. **Accept:** correct match/tenant/config after reconnect, privacy withdrawal, session rotation and read-only capability misuse.

**ENH-09-02 — Define event-to-animation semantics.** Extend canonical delivery/lifecycle event contracts and existing scoring outbox, not a second client-generated scoring feed. Use event ID, match/tenant, scoring revision, event time, action/correction identity and allowlisted confirmed facts. Separate graphics/config revisions. **Accept:** saved server command alone triggers official display; unsent offline actions and typed edits do not. Current active batter/bowler is server-confirmed before player-introduction claims.

**ENH-09-03 — Add bounded accurate celebrations.** Proposed `components/broadcast/event-animations.tsx`, shared pure presentation policy, native/local viewer equivalents only as appropriate. Four/six/wicket, new batter/bowler, milestone, innings break and result; short queued presentations with Full/Reduced/Off controls, stable scoreboard, no flashing. Distinguish bat boundaries from byes/overthrows and bowler-credited wickets from run-outs. **Accept:** duplicates don't repeat; undo/correction cancels queued wrong events; reconnect fast-forwards to snapshot without replaying an old celebration backlog; no fabricated milestones/award claims.

**ENH-09-04 — Calibrate latency and original-video composition.** Frontend/operator controls for pre-encoding graphics offset and separate viewer-panel spoiler delay; never delay official persistence. Compose camera/audio + React Browser Source in OBS before provider ingest. Player/team photos/logos use approved media/consent. **Accept:** recorded graphics match the event timeline on reference devices; stale scores are visible to operators; replay uses burned-in historical graphics, not current live state. Frame-accurate third-party playback is not promised.

**Phase gate / rollback:** official score remains legible during effects and under reduced motion. Disable effects while retaining score updates. Existing `components/live/live-overlay.tsx` is a below-player UI, not an OBS graphic; do not confuse these. Optional synchronized replay panels need recorded timestamps and video timeline mapping; defer until proven. Do not use a static scoreboard alone as a Facebook Live camera substitute or cover embedded provider UI with SaaS graphics.

### P10 — Moderated fan chat and interactive viewing

**ENH-10-01 — Define fan/moderator authority and retention.** Reuse `fan-follows.ts`, fan blocks/reporting, poll/reaction policies, and P02 fan onboarding. Add explicit per-match/league moderator capabilities, chat posting eligibility, text/link/length limits, slow mode, bans/mutes, retention/deletion, minor safety and appeal/support policy. **Accept:** no guest posting or public message exposure unless deliberately approved; global fan identity alone is not operational authority.

**ENH-10-02 — Implement durable tenant-scoped chat.** Proposed `contracts/src/chat.ts`, `packages/database/src/schema/match-chat.ts`, server command/read policy, migration and API adapters under existing mobile/web conventions. Select the real-time transport owner in an ADR before implementation; reuse authenticated infrastructure if safe, do not invent an unowned extra service. Persist message identity/server sequence/moderation state, cursor history and dedup keys; derive actor/room authority server-side. **Accept:** duplicate/reconnect/restart delivery, pagination, blocked/expired users, XSS/link abuse and cross-tenant room attacks fail safely; rate limits work across replicas or their limitation blocks scale.

**ENH-10-03 — Add fan/moderation interfaces.** Proposed `apps/web/src/components/live/match-chat.tsx`, mobile counterpart and owner moderation screen. Show provider video plus side/below chat on desktop and tabs/collapsible panel on mobile; keyboard/screen-reader usable. Support replies, permitted player/team references, emoji, pinned announcements, report/mute/block, delete/timeout and moderator audit. **Accept:** no auto-scroll trap or inaccessible incoming-message flood; preserve user position, unread state, moderator actions and slow-mode feedback.

**ENH-10-04 — Integrate existing interactions and selected comments.** Reuse saved reactions, socket emoji, tournament polls, follows and private no-stakes predictions instead of replacing them. Keep SaaS chat separate from YouTube/Facebook chat initially. Featured comments in OBS require explicit moderation, policy/privacy approval, sanitized text, revocation and a delay; fan claims never become official scoring/commentary. **Accept:** chat outage does not block scoring/video; reactions never change results; optional celebration effects respect viewer settings; past matches do not show unrelated current chat.

**Phase gate / rollback:** accountable moderation coverage, abuse drills and tenant isolation pass before chat is enabled. Disable posting independently while retaining permitted viewing/report handling. No unrestricted DMs, paid gifts, automatic provider-chat mirroring or gambling features. Advanced timestamp-synchronized historical chat is separate scope.

### P11 — Acceptance, operations, and controlled release

**ENH-11-01 — Execute real staging acceptance.** Extend `tests/e2e/specs/` and approved local/staging DB fixtures; verify web/admin/native/worker contracts, real SQL constraints/locking/RLS, provider webhook delivery, cross-account caches and two-tenant live sessions. Existing credential-skipped tests don't count as executed. **Accept:** evidence for section 7 critical scenarios, identified environment and recorded limitations; no production fixture injection.

**ENH-11-02 — Prove daylight/mobile/performance.** Reference low-end Android, iOS, mobile browsers, tablet, desktop, TalkBack/VoiceOver, large text, English/approved locales, RTL, weak network and 30-minute scorer/broadcast sessions. Capture real screens and measurements; avoid PII in evidence. Load-test agreed viewers/messages/deliveries/uploads and capacity controls with provider permission. **Accept:** usable sunlight test, stable touch controls, agreed latency/performance and no hidden data/state loss.

**ENH-11-03 — Deploy and operate safely.** Update root `RELEASE_CHECKLIST.md`, `docs/ROLLBACK_RUNBOOK.md`, `docs/RELEASE_EVIDENCE.md`, `supabase/MIGRATION_STATUS.md` only against actual evidence. Record previous-good SHA, schema expansion order, flags, worker/service deployments, queue/dead-letter runbook, dashboards, alert owners, restore drill and provider reconciliation. **Accept:** reviewed go/no-go, limited canary and rollback rehearsal. A web deployment alone cannot mark Nest/mobile/background jobs shipped.

**ENH-11-04 — Close and hand over honestly.** Link each task's reviewed commit/evidence to canonical items. Reassess deferred managed streaming, full native organizer enrollment, advanced delegation, revenue sharing, clip automation and synchronized replay features separately. **Accept:** no open critical gate hidden behind a checkbox, explicit owner/backlog for remaining work and support-ready operator guide.

**Phase gate / rollback:** deploy compatible schema first, code/workers next, flags last. Code rollback or flag disable must preserve additive data, queued commands/jobs, media metadata and audit. No automatic reverse migrations, broad resets or destructive recovery copied blindly from an old runbook.

## 7. Mandatory acceptance matrix

| Area          | Required cases                                                                                                                               | Evidence type                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Onboarding    | Fresh/delayed webhook, draft, review, information reply, approve, reject/restart, manual create, slug conflict                               | UI + API + real transactional race                |
| Authority     | Every role/action, own/foreign tenant/resource, suspended account, expired/revoked membership, reassignment                                  | Policy + endpoint + real DB negative tests        |
| Scoring       | Runs/extras/dismissals, target/overs/short XI, corrections/undo, duplicate/lost ACK, queue conflict, handover                                | Serialization + canonical service + device replay |
| Privacy       | Minor/adult boundaries, consent withdrawal, public/PDF/socket/native/overlay parity, cross-account offline cache                             | SQL equivalence + public read/browser tests       |
| Frontend      | 320/360/390/430/768/1024/1440px, zoom/text scaling, keyboard/focus, announcements, reduced motion, themes/locales/RTL                        | Rendered browser and physical native devices      |
| Notifications | Real Expo fixtures, missing/partial receipts, transient errors, token change, quiet hours, consent round-trip, duplicate/crash               | Contract + durable job + provider acceptance      |
| Media         | Wrong tenant/asset, forged metadata, malformed/oversize files, revoked authority, webhook ordering, private derivatives, deletion/orphans    | API + provider + storage/access proof             |
| Broadcasts    | Two simultaneous isolated matches, token expiry, encoder interruption, duplicates, long parts, unavailable/deleted replay, original recovery | Real operator/provider sessions                   |
| Graphics      | Batter/bowler accuracy, byes vs boundaries, run-out attribution, undo, duplicate events, reconnect, latency offset, reduced effects          | Event fixtures + OBS recording comparison         |
| Chat          | Spoofing, room isolation, XSS/spam, block/report/timeout, restart/history, pagination, slow mode and moderation audit                        | API/socket + moderator/device drills              |
| Operations    | Multi-instance fanout, job poison/retry, resource quotas, tracing, budget alerts, restore/canary/rollback                                    | Staging drills and operator evidence              |

Performance requirements are agreed SLOs, not fabricated guarantees. Measure command acknowledgement separately from socket fanout and video playback; do not count queued as accepted, accepted as delivered, or provider-live as replay-ready. Log correlation IDs and aggregate metrics, never stream keys/tokens/private message bodies by default.

## 8. Daily execution, model handoff, and verification

### 8.1 Start-of-task checklist

1. Read this document, canonical item, actual source and applicable repository/skill instructions.
2. Run read-only Git status/diff checks; identify ownership and exact edit allowlist. Verify Node/pnpm versions and package scripts. Recheck external docs for APIs/policy/limits used that day.
3. Select the earliest unblocked `ENH-*` task; split multi-day tasks into named slices without renumbering the parent. Do not assume a calendar label means a dependency passed.
4. Capture a failing behavioral reproduction; agree contract/migration changes before parallel UI work.
5. Implement the smallest end-to-end slice; run focused tests, then appropriate wider gates sequentially when resource contention causes flakes.
6. Update the ledger with exact results, skipped tests, blockers, migration/provider state and next step. Review diff for secrets, generated artifacts and unrelated changes.

#### Daily startup on a development machine

The commands below are instructions, not an automatic script. Run them in the repository root, inspect each result, and stop on errors. **First merge the approved roadmap/setup PR into `main`; fetching an unmerged PR does not update `main`.** The setup commit aligns UI/marketing React types with web/admin and declares notification-service's direct `socket.io` dependency. This reduces the known fresh-machine failures; it does not guarantee every environment or external service is ready.

1. Inspect and fetch without disturbing local edits:

   ```powershell
   git status --short --branch
   git fetch origin
   ```

   If files are modified, staged, or untracked, stop and identify ownership. Finish/commit reviewed work on its own branch before switching. Do not auto-stash, reset, discard, or pull over unexplained work.

2. Only with a clean working tree, update `main` and create the day's task branch:

   ```powershell
   git switch main
   git pull --ff-only origin main
   git switch -c feat/ENH-00-01-YYYY-MM-DD
   ```

   Replace the task/date with the actual approved slice. If fast-forward is refused, inspect divergence; do not force-reset or improvise a merge. To resume an existing branch, inspect its upstream and divergence rather than creating another branch with the same name. Respect any active session ownership agreement.

3. Verify the supported runtime and install exactly the committed dependency graph:

   ```powershell
   node --version
   corepack pnpm --version
   corepack pnpm install --frozen-lockfile
   ```

   The initial machine used Node `24.19.0` and pinned pnpm `9.15.0`; recheck current project/runtime requirements. Do not accept pnpm's upgrade advertisement as a request to change versions. If frozen installation fails, diagnose manifest/lockfile/environment drift instead of deleting or regenerating the lockfile blindly.

4. On this Windows machine Turbo needs the existing pnpm shim on the current shell's PATH. Verify it and apply only to this shell:

   ```powershell
   $shimDir = Join-Path $env:USERPROFILE ".corepack-bin"
   if (Test-Path (Join-Path $shimDir "pnpm.CMD")) {
       $env:PATH = "$shimDir;$env:PATH"
   }
   corepack pnpm type-check
   corepack pnpm test:roadmap
   ```

   If no pnpm binary/shim exists and Turbo refuses to run, follow approved user-directory Corepack setup; do not attempt an elevated/system installation or permanently alter PATH without approval. Local service/env requirements remain separate from dependency installation. Never copy production secrets into a new machine or commit `.env` files.

5. Read the latest execution ledger and claim the earliest unblocked task. Verify the dev script and environment before starting only the required application/services. The root `dev` script may start many services; do not assume it is the smallest or fully configured option.
6. Before stopping: record the task/slice, changed files, exact checks, skipped/external acceptance, blockers, commit(s), and next action. Push the reviewed task branch and open/update its PR when authorized. A dirty working tree is not a handoff; explicitly describe any intentionally uncommitted work.

#### Copy-paste prompt for any model

```text
Read docs/ENHANCEMENT_ROADMAP_2026-10-20.md, the linked canonical plan/ADR,
the latest execution ledger, and applicable repository instructions.
Inspect branch/upstream/status/diff first. Preserve unrelated work.
Select the earliest approved, unblocked ENH task or resume its recorded slice.
State the task ID, prerequisites, exact files to edit, and acceptance checks.
Implement one small frontend/backend/native-compatible vertical slice.
Keep server-authoritative scoring, tenant isolation, scoped roles and provider
policies intact. No production/DB/provider mutations or unrelated upgrades.
Run focused tests and relevant gates; record actual results and limitations.
Update the handoff ledger with evidence, rollback, blockers and next task.
Do not mark deployment/device/provider acceptance complete without evidence.
Commit/push only reviewed paths to the approved branch when authorized.
```

### 8.2 Required task record

Copy this record into the execution ledger below when claiming a task. Do not mark an entire parent verified after completing one slice.

```text
Task / slice ID:
Canonical reference:
Status: proposed | approved | implementing | blocked | source-done | locally-verified | staging-verified | production-verified
Owner/model session:
Started / last updated / completed (YYYY-MM-DD):
Baseline SHA / branch / dirty files preserved:
Prerequisites and owner decisions:
Read-first files:
Exact write allowlist:
Frontend changes:
Backend / migration / worker changes:
Native / synchronization changes:
Contract and security invariants:
Acceptance cases / failing reproduction:
Commands actually run / exit codes / results:
Skipped tests and environment limitations:
Migration state: not needed | file-only | locally applied | staging applied | production applied (with evidence)
Provider configuration/approvals and secret references (never secret values):
Feature flags / deployment order / rollback:
Reviewed commit(s) / evidence path:
Unresolved blockers / next smallest task:
```

### 8.3 Definition of done

- Agreed behavior works through frontend, backend and applicable native/worker paths, including negative cases.
- Server authority, tenant scoping, lifecycle, consent, idempotency and concurrency rules are tested where relevant.
- Loading/empty/error/offline/conflict states and accessible responsive behavior are implemented.
- Required schema changes have reviewed constraints/indexes/grants/RLS and honest apply status. API providers and workers are not assumed deployed with web code.
- Local tests are recorded; external acceptance is either proven or keeps the task at a lower evidence status.
- Relevant operator/user docs and rollback are updated; reviewed changes are isolated from unrelated work.
- Missing production/provider evidence is never hidden by “all tests pass.”

### 8.4 Commands and environment safety

Commands below are a guide, **not evidence they ran for this document**. Run from repository root after inspecting scripts:

```powershell
git status --short
git diff --stat
corepack pnpm --version
corepack pnpm type-check
corepack pnpm test:roadmap
corepack pnpm test:release
corepack pnpm test
corepack pnpm build
```

Use `corepack pnpm --filter <verified-package-name> <verified-script>` for scoped work; inspect package scripts before guessing. For reproducible dependency installation use the pinned pnpm version and `corepack pnpm install --frozen-lockfile`; intentional manifest changes require reviewed lockfile updates, not silent upgrades. If Turbo cannot find pnpm on Windows, add the existing approved shim directory to that shell's PATH; verify it first, do not modify system installation or permanent PATH without authorization.

Run only the changed Markdown files through Prettier for documentation edits. Native/admin test setup may need a separately approved task. Preserve failed-run evidence; rerunning a flaky test is not proof the cause disappeared.

Database work: inspect the actual schema workflow and CLI version/help; use approved local/staging targets only. New objects need sensible types, tenant-consistent constraints, foreign-key/query indexes, bounded queries, explicit grants and RLS for exposed schemas. Privileged app checks still apply. Views/functions and pooled prepared statements need explicit security/connection review. Rebuild `@mtk/database` outputs when package `dist` resolution requires it. Never use production `db reset`, implicit `--db` checks, ledger fabrication, or automatic migration retries. Recheck Supabase changelog for relevant TLS/Data API/runtime changes before device/deployment acceptance.

### 8.5 Git/publication discipline

- This document creation does not implement features, authorize production operations, or stage the four existing dependency changes.
- Before committing, inspect current branch/ownership; choose a dedicated approved branch or worktree. Do not pull/rebase over unexplained dirty work.
- Stage explicit reviewed paths only. Documentation and implementation should have separate coherent commits with task IDs.
- Push only the approved branch/remote when requested; prefer a PR. Do not infer permission to push directly to `main` or force-push.
- Preserve additive schema on code rollback; treat restores/data deletion as separate owner-approved operations.

### 8.6 Execution ledger

| Date       | Task / slice                                     | Status                                                    | Owner                                                              | Commit / evidence / blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Next action                                                                                                                                 |
| ---------- | ------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-20 | Roadmap documentation                            | Document created; implementation not started              | Documentation session                                              | Source baseline `9322d9d`; no feature/DB/provider changes                                                                                                                                                                                                                                                                                                                                                                                                                            | Review decisions, then claim `ENH-00-01`                                                                                                    |
| 2026-10-20 | `ENH-01-01` minor-consent SQL/policy equivalence | source-done, locally-verified; staging acceptance pending | Session on `feat/ENH-01-01-minor-consent-equivalence`              | Finding CONFIRMED: Batch-132 SQL gate inverted (minors published unconditionally, consent-less adults hidden) + no future-consent guard. Fix: `<=` adult side incl. 18th birthday, `consent <= now()`. Evidence: twin contract + boundary matrix tests; live gate test added (opt-in, not run: no DB env). Gates: type-check 19/19 (`@mtk/web` uncached OK); web suite 3,273 pass / 10 skip / 0 fail; no DB/provider/secret access                                                   | Staged acceptance: run `minor-consent-gate.live.test.ts` with `LIVE_DB_ACCEPTANCE=1` against approved staging; then push/PR when authorized |
| 2026-10-20 | `ENH-00-01` reconcile current state              | done (record produced)                                    | Same session                                                       | [P00 baseline record](P00_BASELINE_AND_DECISIONS_2026-10-20.md): baseline `fd1ace5`, Node 24.19/pnpm 9.15 frozen install, gates recap (type-check 19/19, web 3,273/0 fail, roadmap 6/6, release 93/93), migration parity FULLY GREEN, deploy topology + CI billing lock, session ownership, environment limits. No adoption/reset of other sessions' work                                                                                                                            | Re-verify baseline at each new branch; keep feature-branch + PR flow                                                                        |
| 2026-10-20 | `ENH-00-02` decision register                    | done for approved items; blocked items listed explicitly  | Same session, transcribing PRODUCT OWNER instructions (2026-10-20) | D-01..D-08 approved (both onboarding paths; manual WhatsApp +92 303 8111297 non-bypass; super-admin channel / per-match broadcasts; OBS-composed graphics, no provider-brand masking; system archives with YT/FB retention caveats; Cloudinary media plane + Supabase payment proofs; embed playback; hybrid architecture). BLOCKED register: fan entry spec, language matrix, quotas/budget, moderation/consent owner, revenue sharing, prod identity verification, CI billing lock | Unblock dependents in owner order; do not treat chat transcription as production verification                                               |

| 2026-10-20 | `ENH-01-02` service worker protected caching | source-done, locally-verified | Same session | Finding CONFIRMED: `sw.js` cached every `type:"basic"` navigation incl. protected HTML with no sign-out purge. Fix: v2 worker never stores navigations (offline shell only), generation bump + activate purge, `PURGE_NAVIGATION_CACHE` message re-primes `/offline`; `AuthCacheGuard` inside `ClerkProvider` posts it on sign-out/account switch (`sw-purge-policy` pure decision). Evidence: behavioral worker-realm tests (install/activate/fetch/message) 10/10; type-check clean. Commit `73c2f73` | Optional live re-check on staging after deploy; worker ships with no opt-in required |
| 2026-10-20 | `ENH-01-03` application/membership invariants | source-done, locally-verified | Same session | Findings CONFIRMED: withdraw/decide consumed the pre-lock status snapshot (race could overwrite `withdrawn` to `approved`, CHECK-legal); decide checked raw `status` not effective membership (expired owner could decide); submit ignored registrationOpen/window and team-tournament tenant pairing. Fix: locked status reread + conditional updates, `membershipGrantsAccess`, deadline flag/tenant gate. Evidence: 6 falsifier tests red then green; suite 28/28 incl. replies; type-check clean. Commit `7ae6340`. CHECK constraints verified, migration untouched | Optional racing-transaction staging probe (`LIVE_DB_ACCEPTANCE`) when DB env is available |
| 2026-10-20 | `ENH-01-04` unsafe delivery/replay containment | source-done, locally-verified | Same session | Findings CONFIRMED: mobile queue skipped conflicted heads (causal tail flushed past unresolved 409); in-memory rate-limit `success: remaining>=0` never refused; Nest gateway let clients join arbitrary `user:*`/`tenant:*` rooms and HTTP writers had no auth (no repo callers, so quarantined fail-closed behind `NOTIFICATION_SERVICE_TOKEN`, constant-time compare); generic repo accepted `tenantId`/`id` writes (latent, no callers, refused via `write-guards`). Evidence: barrier store tests, fake-timer rate-limit tests, jest gateway/controller suites, repo-guard tests green; client hook sends no identity. Commits `960235a`, `d2bbf2b`, `7a1b4c5`, `c0d1fae` | Authenticated WS room derivation (Clerk JWT) remains for P06 decision delivery; token provisioning for deploy owner before writers un-quarantine |
| 2026-10-20 | `ENH-02-01` fresh-account navigation repair | done, locally-verified | Session on `feat/ENH-01-01-minor-consent-equivalence` | Commit `3f986bf`. Absent user rows now read as provisioning (never denied); `reconcileSessionUser()` is one bounded insert-only recovery that re-materializes the verified webhook write set under the account row lock (webhook-identical fan semantics, never updates an existing row); pure `resolveNoTenantLanding` sends a live application to its status screen and other fans to explore-or-organize; unknown state claims nothing. Failing-first dashboard-layout tests: delayed webhook clears after one capped attempt/render, denied stays denied, no redirect loops | Optional live webhook-delay probe (`LIVE_DB_ACCEPTANCE`) when DB env exists |
| 2026-10-20 | `ENH-02-02` applicant console truth + persisted replies | done, locally-verified | Same session | Commit `d6d2227`. Start-new after a terminal decision resets identity/version (next save is a true CREATE, `expectedVersion` null — was a guaranteed stale refusal); Refresh-status control re-reads saved status/reviewer note; submitted stays server-read-only; admin review machine verified compliant (PATCH refuses stale/duplicate/illegal transitions via state+version predicates; console state-filters and disables busy rows — no admin change needed). NEW surface `league_application_replies` (local migration `20261020120000`, own schema + shared league reply policy): thread opens ONLY in `needs_information`, owner-only via one locked guard predicate, additive (no state move, no version bump), audited `LEAGUE_APPLICATION_REPLY`; thread returned by `getMyLeagueApplication`, composer/history in the form, admin GET + console display. Gates: database 470/470 (+5 skipped), web 3321/3321 (+10 skipped), type-check database+web clean | Optional staging probe of concurrent reply/decision; thread is read-only history after any decision by design |
| 2026-10-20 | `ENH-02-03` provisioning normalization + fan entry | done, locally-verified | Same session | Commit `469013d`. Admin manual tenant create previously inserted a bare row (no lock, cap, membership, subscription, audit); now mirrors the approval provisioning chain exactly: owner user row locked first, one-league cap re-checked under the lock, tenant + free subscription + `league_owner` membership + branding + `ADMIN_TENANT_CREATE` audit in one transaction, honest 404/409 refusals (no-owner/owner-inactive/already-owns/slug-taken). Tenant detail API returns an exact camelCase DTO with members from authoritative `user_tenant_roles`; tenant-detail.tsx consumes it exactly (the old snake_case interface read `undefined` for `is_active`/`created_at`/`tenant_branding[0]` and a never-sent `users` array); PATCH accepts canonical camelCase with snake fallback and enum-validates plan. Approved fan-only command `joinLeagueAsFan`: role=fan ceiling, no staff-invite reuse, idempotent, race-truthful. Evidence: fan-join 7/7 failing-first, actions+guards 106/106, type-check web+admin+database clean | Admin app has no test harness (type-check + review evidence only); optional staging dual-create race probe |
| 2026-10-20 | `ENH-02-04` privacy-conscious WhatsApp support | done, locally-verified | Same session | Commit `42bc7dd`. `platform-support.ts` contract: `https://wa.me/923038111297` displayed `+92 303 8111297`; draft built ONLY from the allowlisted saved facts the user already sees (league name/URL/plan, application reference, displayed status label), bounded 80/field and 600/draft, ONE `encodeURIComponent` pass (Unicode + query-hostile character tests); hostile extra fields (email/token/OTP/reviewer note/payment docs) cannot enter the draft by construction. `PlatformContact`: preview disclosure before opening, wa.me opens for a MANUAL send (copy denies automatic sending), copy-number fallback with failure path. Integrated: dashboard recovery notice (provisioning branch), league setup page, application console (apply/status with full saved context), and replaced billing's hardcoded wrong-format `03038111297` anchor. Gates: 12/12 contract tests failing-first + layout attachment test; touched suites 64/64; type-check clean | Native Settings adoption per roadmap; no live WhatsApp mutation performed |

| 2026-10-20 | `ENH-03-01` portable contracts package | source-done, locally-verified; web-adapter-adopted; native wiring pending (ENH-03-02/03-03 scope) | Session on `feat/ENH-03-01-portable-contracts` (Batch 179) | New `packages/contracts` (@mtk/contracts 0.1.0, zod-only runtime dep, hygiene test enforces no Next/DOM/node/db/supabase imports so native can always build it). `status.ts`: COMPLETE lifecycle vocabulary straight from the pg enums - match_status carries TEN values; the mobile union had silently dropped `forfeited`/`postponed` (first confirmed divergence the package fixes). Published-value mirrors + gates single-sourced: `packages/database/src/lib/publication-policy.ts` now re-exports from contracts (SQL gate and consumers cannot drift). `scoring.ts`: `recordBallCommandSchema` MOVED verbatim from web (web imports + re-exports; zero schema-behavior change), `SCORING_COMMAND_VERSION=1`, portable acknowledgement envelope; runs ceiling 0..7 pinned (ENH-03-02's UI-8-vs-server-7 boundary resolved on the wire). `public-reads.ts`: PUB-06 allowlists as pure wire types (ISO timestamps), `PUBLIC_PROJECTION_VERSION=1`. `pagination.ts`: portable cursor (URI-safe JSON, NO node Buffer), fail-loud malformed/foreign-version decode - never silent page-one rewind. `errors.ts`: 10 contractual refusal codes incl. `conflict_stale_revision`/`conflict_handover_epoch`. `capabilities.ts`: v1 surface sheet (public/member/organizer/admin, subset ladder pinned). Web + database take `workspace:*`; root/web tsconfig paths resolve contracts from source; contracts `type-check` emits dist so the turbo `^type-check` chain materializes it for dist-resolving dependents. Gates this slice: contracts build + suite green; full battery + database/web suites in the Batch 179 battery. | Native adopters: mobile scoring serializer/offline-flush validate through `recordBallCommandSchema` and read public projections via the wire types (ENH-03-02/03-03); master-plan §16 checkbox stays UNticked until adapter acceptance on both surfaces |

### 8.7 Documentation-only verification — 2026-10-20

- `corepack pnpm test:roadmap`: **6/6 passed**; canonical checklist counts/classification remain unchanged.
- `corepack pnpm test:release`: **93/93 passed**; these are release-tooling tests, not production acceptance evidence.
- Scoped Prettier check: passed for this roadmap.
- Read-only document validation: **44 unique task definitions across 12 phases**; local document links resolve and the master-plan backlink exists.
- `git diff --check`: passed; the existing lockfile produced its pre-existing line-ending warning, not a documentation failure.
- No application build, device test, database query/migration, deployment, provider mutation, commit, or push was performed to create this document. Existing application/dependency changes were preserved.

## 9. Research references and revalidation rules

Research was consulted on **2026-10-20**. Guidance from earlier years is labelled as established standards, not invented 2026 trends. Revalidate account limits, pricing, permissions, API versions, and policies at implementation time. No source establishes a universal “best UI” ranking or proves this repository's runtime acceptance.

### Accessibility/design/performance

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — testable accessibility requirements.
- [Material 3 Expressive launch, May 2025](https://blog.google/products-and-platforms/platforms/android/material-3-expressive-android-wearos-launch/) — hierarchy/containment inspiration, not a new 2026 requirement.
- [Apple Liquid Glass introduction, June 2025](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) and [2026 design-kit update](https://developer.apple.com/news/?id=e2lxw9l1) — platform developments, not grounds to copy translucent operational UI.
- [Android accessibility](https://developer.android.com/guide/topics/ui/accessibility/apps) and [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).
- [Reduced motion](https://web.dev/articles/prefers-reduced-motion) and [Core Web Vitals](https://web.dev/articles/vitals).

### Cloudinary/media

- [Upload signatures](https://cloudinary.com/documentation/authentication_signatures), [response signatures](https://cloudinary.com/documentation/response_signatures), [webhook signatures](https://cloudinary.com/documentation/notification_signatures).
- [Access controls](https://cloudinary.com/documentation/control_access_to_media), [upload/chunking guide](https://cloudinary.com/documentation/upload_images), [deletion](https://cloudinary.com/documentation/delete_assets).

### Broadcasts/provider constraints

- [YouTube broadcasts/streams](https://developers.google.com/youtube/data/live/broadcasts-and-streams), [broadcast lifecycle](https://developers.google.com/youtube/data/live/life-of-a-broadcast), [server OAuth](https://developers.google.com/youtube/data/guides/auth/server-side-web-apps).
- [YouTube player parameters](https://developers.google.com/youtube/player_parameters), [required player behavior](https://developers.google.com/youtube/terms/required-minimum-functionality), [developer policies](https://developers.google.com/youtube/terms/developer-policies).
- [Encoder/concurrency guidance](https://support.google.com/youtube/answer/2474026), [archive limits](https://support.google.com/youtube/answer/6247592), [quota costs](https://developers.google.com/youtube/v3/determine_quota_cost). Verify actual project allocation; avoid hard-coded historical per-call assumptions.
- [Meta embedded player](https://developers.facebook.com/docs/plugins/embedded-video-player/), [Live API](https://developers.facebook.com/docs/live-video-api/), [developer policy](https://developers.facebook.com/devpolicy/), [Live recording retention](https://about.fb.com/news/2025/02/updating-our-facebook-live-video-storage-policy/).
- [OBS Browser Source](https://obsproject.com/kb/browser-source) — compose original video graphics, not HTML over provider embeds.
- [YouTube payments](https://support.google.com/youtube/answer/72866) — channel payments are not automatic tenant revenue splits.

### Platform/provider operational contracts

- [Expo push tickets/receipts](https://docs.expo.dev/push-notifications/sending-notifications/) — real provider fixtures, not tests reproducing a mistaken response shape.
- [Supabase changelog](https://supabase.com/changelog), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Data API security](https://supabase.com/docs/guides/api/securing-your-api) — verify current grants, exposed-schema behavior and release compatibility; no database access was performed to create this roadmap.

**Recommended next action:** approve section 3 decisions, claim `ENH-00-01`, reproduce the critical findings, then ship the smallest safe onboarding/WhatsApp improvement. Keep every later model anchored to task IDs, exact source, acceptance evidence and current ownership—not chat memory.
