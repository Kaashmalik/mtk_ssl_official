# Roadmap tick decisions — evidence-gated finalization (2026-10-19, Batch 158)

Verdicts below are the ONE-SHOT finalization of Phase 2/3 roadmap
ticks. Standard applied: a line is TICKED only with committed,
repeatable evidence (test counts or executed drills); a line with any
un-delivered clause is DEFERRED with the exact blocker named. Blocker
naming is not failure — it is the honest remainder.

## TICKED (delivered, evidence attached)

- **REG-03** tournament applications (B147, `cae9278`): journey 16
  tests; owner decisions with provenance; withdrawal needs no decider.
- **REG-04** registration eligibility (B148, `34bf34c`): policy 7
  tests + writer (cross-tenant refused under lock, forward-only
  payment, terminal replay pure read).
- **REG-05** invitations/availability/profile/corrections (B138/141/
  142, `f046efc`/`5d8096c`/`22b2e68`): 115-test invitation suite +
  availability + display name + corrections.
- **REG-06** squad/transfer/account-less/minors (B149, `f8bdd04`):
  policy 9 tests + writer.
- **REG-07** races/duplicates/scope: covered by existing suites
  (manager scope, own-application approval denial, deadline/open
  windows, capacity lock, duplicate rejection + partial unique index).
- **REG-02**: roster/registration hardening covered (roster suites 68,
  registration-management 25, no-unscoped-queries).
- **COMP-05** group standings (B150, `9b211e6`): migration applied
  remotely; standings rule v2, 12 tests.
- **COMP-06** playing XI + approvals + readiness (existing suites).
- **COMP-07** forfeit/postpone/reschedule (B153, `ecc8c2c`): policy 5
  + journey 10 + wiring 5; migration applied remotely.
- **SCORE-10** cricket-rules fold (B154, `5f61bab`): rules policy 6
  tests + SoT closure wiring 5 tests; XI policy/substitution existing.
- **SCORE-11** handover fencing/epochs/revisions (B83/84 suites);
  device part stays deferred with UX-04.
- **SCORE-12** transactional outbox + aligned dispatcher (B151+152,
  `ecc8c2c`): policy 7 + producer + shared backoff + dead-letter.
- **FAN-01/02/03** moderation, follows/notifications, cards/recaps
  (existing suites, 25 + 10 + docs).
- **UX-03** i18n/RTL/timezones/durable drafts (B139/140/145 suites).
- **BASE-04** **COMPLETE** (B156 `7717a9b` + B157 `4485aff` +
  B158): deployed-schema gate real (name-aware reconcile,
  verification-first ledger rows) AND fresh-rebuild PROOF (80/80
  migrations, `docs/FRESH_REBUILD_PROOF.md`) — the last BASE-04
  clause "prove a fresh local/staging database" is executed, not
  claimed.
- **REL-01** two-league isolation EXECUTED (B158): RLS matrix —
  cross-tenant reads 0 for members under hosted-parity JWT GUCs, anon
  denied, service_role bypasses, duplicate application refused by the
  partial unique index (`docs/LOCAL_ACCEPTANCE_EVIDENCE.md`,
  `scripts/rel01-rls-isolation.cjs`).
- **REL-05 (drill half)** backup→restore EXECUTED (B158): remote
  `pg_dump` → virgin `postgresql:17` restore → per-table counts match
  (`scripts/rel05-restore-drill.cjs`). Owner-side half (secret
  rotation, lost-account recovery) stays owner-gated.

## DEFERRED (named blocker; unblocked the moment inputs exist)

- **SCORE-08** mobile BFF identity: shared normalized delivery
  contract IS delivered (`@mtk/database/lib/live-scoring-state`
  zod, decoded on the untrusted path); blocker = approved mobile
  identity/transport (platform decision + device evidence).
- **SCORE-14** performance verification: needs staging infra + load
  profile sign-off.
- **REL-02** browser/E2E journeys: needs two-tenant staging with real
  auth + browsers (the DB-level two-league isolation is now proven;
  the browser layer needs the app deployed against it).
- **REL-03** socket fan-out under load: needs the deployment's Redis/
  socket stack under a real load profile.
- **REL-04** storage/upload verification: needs provider bucket +
  credentials.
- **REL-06** providers/emails: needs provider accounts/keys.
- **UX-04** poor-network device journeys: needs real devices.
- **BASE-05/06** sandboxes + secret rotation: needs owner-provisioned
  staging + participation.
- **REL-07** owner approvals: human sign-off on checklist docs.

## Known recorded follow-ups (scope notes, not blockers to ticks)

- SCORE-10: declared-XI count fed into all-out closure; SoT-side
  batter/strike tracking (client-owned today).
- SCORE-12: producer wiring into every scoring write path.
- REG-03: threaded replies to `needs_information`.
- FAN-02: provider delivery tracking (`channel_unwired` state is
  recorded, honest).
- Ledger: REG-01 `20261017130000` (league_applications) is Session
  B's; B158's restore drill additionally showed it is NOT deployed
  remotely — the `--db` gate stays red until Session B applies and
  ledgerers it.

## Session commit map (B136–B158)

B136 3c2005e · B137 5b58ba0 · B138 f046efc · B139 81b0093 ·
B140 8a54f47 · B141 5d8096c · B142 22b2e68 · B143 3b3bc13 ·
B144 26924cb · B145 c66d4c4 · B146 13fe30c · B147 cae9278 ·
B148 34bf34c · B149 f8bdd04 · B150 9b211e6 · B151+152+153 ecc8c2c ·
B154 5f61bab · B156 7717a9b · B157 4485aff · B158 (this commit)
