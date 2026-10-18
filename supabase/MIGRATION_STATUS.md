# Migration Status & Drift Notes

> Written after the Oct 6 hardening pass. Read before running `supabase db push`,
> `db reset`, or adding a migration.

> **19 October 2026 (Batch 141) - `scorecard_correction_requests` applied remotely**
> (original file, original stamp `20261018220000`; same proven path; table
> + 2 enums + 4 indexes + resolution CHECK + RLS verified in the same
> session). REG-05 member-raised scorecard
> correction requests; records never mutations; additive, no data/grant
> changes to existing objects.

> **18 October 2026 (Batch 138) - `match_availability` applied remotely**
> (same proven path: original file, original stamp `20261018210000`,
> applied with the comment-strip-BEFORE-chunking splitter, table/indexes/
> RLS/grants verified in the same session). REG-05 member-recorded match
> availability; one row per (match,user) updated in place, status CHECK,
> RLS forced, grants to ssl/service_role only; additive, no data/grant
> changes to existing objects.

> **18 October 2026 (Batch 136) - `creation_request_keys` applied remotely**
> (same proven path: original file, original stamp `20261018200000`,
> applied with the comment-strip-BEFORE-chunking splitter, column and
> partial-unique index verified in the same session). tournaments.
> creation_request_key + per-tenant partial unique for COMP-03 idempotent
> creation recovery; additive, no data/grant changes.

> **18 October 2026 (Batch 135) - `brand_studio` applied remotely**
> (same proven path: original file, original stamp `20261018190000`,
> applied with the comment-strip-BEFORE-chunking splitter, columns and
> constraints verified in the same session). tenant_branding +
> draft/published/previous_published/published_at + two JSON-shape CHECKs
> for the PREM-02 Brand Studio slice; additive, no data/grant changes.

> **18 October 2026 (Batch 134) - `captain_role` applied remotely** (same
> proven path: original file, original stamp `20261018180000`, applied
> statement-by-statement, verified in the same session). `user_role` enum
> + 'captain' (AFTER team_manager) for the REG-05 captain invitation
> journeys; additive, no data/grant changes. Apply-tooling note: strip
> comment lines BEFORE semicolon chunking — chunk-skip half-applied the
> migration (COMMENT ran, ALTER TYPE skipped) and the post-apply enum
> verification caught it.

> **18 October 2026 (Batch 132) - `minor_consent` applied remotely**
> (same proven path: original file, original stamp `20261018170000`,
> applied statement-by-statement, shape-verified in the same session).
> `players` + `guardian_name`, `guardian_consent_at`,
> `guardian_consent_recorded_by` (PUB-06 + REG-06 slice, consent-on-
> publication): cohesion CHECK `players_guardian_consent_cohesion_check`
> (consent all-or-nothing), no new grants (players RLS forced, service-role
> writes only), withdrawal clears all three columns together. Verified
> remotely: 3 columns typed, CHECK present, RLS still forced.

> **18 October 2026 (Batch 127) - `award_disputes` applied remotely** (same
> proven path: original file, original stamp `20261018160000`, history row
> inserted, shape-verified in the same session). New table
> `tournament_award_disputes` (PUB-04): CHECK-pinned reason enum
> `award_dispute_reason` (`incorrect_winner|winner_ineligible|process_error|other`),
> status enum `award_dispute_status` (`open|upheld|dismissed`) with a
> resolution-provenance CHECK (open = no reviewer/resolved_at;
> decided = both), composite FK to `tournaments(id, tenant_id)` (created the
> idempotent anchor `tournaments_id_tenant_key`, missing until now),
> PARTIAL unique `tournament_award_disputes_one_open_per_member_key (award_id,
> raised_by) WHERE status='open'` (= one OPEN dispute per member per award, a
> DB guarantee; decided disputes never block a fresh challenge), open-only
> helper indexes, RLS enable/force=true, grants only ssl/service_role, no
> DELETE. Verified remotely: all columns typed with the enums, constraints
> present, anchors + enums + RLS confirmed. Gotcha repeated: audience-facing
> SQL COMMENT strings must be self-escaped in the migration file itself
> (a PowerShell-style quote artifact from drafting broke one apply — fixed
> to standard `''` escaping before retry).

> **18 October 2026 (Batch 124) - LOCAL-ONLY chain backfilled + applied
> remotely (the Batch 123 discovery generalized):** a full local-vs-remote
> migration diff found production FIVE migrations behind, all previously
> recorded "local-only" and now applied in dependency order with original
> version stamps + history rows: `20261017090000_playing_xi_declaration`
> (Batch 80 - match_playing_xis, matches.xi_required/xi_approved_at; the
> Batch 123 live suite's own success had masked this - no live match-eager
> reader exercised the table), `20261017093925_scoring_revisions` (Batch
> 85), `20261017140000_tournament_awards` (Batch 88 - the B121 live pass
> was VACUOUSLY green here because zero published tournaments meant the
> awards reader never executed), `20261018090000_scorer_handover_epoch`
> (Batch 83; file carried a UTF-8 BOM that must be stripped before
> sql.unsafe - recorded as a gotcha), and
> `20261018150000_wicketkeeper_designation` (this batch: per-XI-row
> `wicketkeeper boolean NOT NULL DEFAULT false` + partial unique
> `match_playing_xis_active_keeper_key (match_id, team_id) WHERE
> wicketkeeper AND superseded_at IS NULL` = at most one designated keeper
> per active side; legacy rows read false - no keeper invented for
> history). Verified remotely: keeper unique present, XI RLS
> enable/force=t/t, all four matches columns present, zero
> anon/authenticated/PUBLIC grants on both tables. NOT applied:
> `20261017130000_league_applications.sql` - Session B's (REG group, the
> reg01-league-application branch owns REG/COMP); recorded here so nobody
> mistakes it for drift under A's chain.

> **18 October 2026 (Batch 123) - `hub_listing` applied remotely via the
> `DATABASE_URL` fallback — applying the ORIGINAL file
> `supabase/migrations/20261017103000_hub_listing.sql` (Batch 86 slice,
> recorded "LOCAL-ONLY" at the time). Discovered LIVE by the Batch 123
> staged-acceptance suite: `readListedHubLeagues()` failed against
> production with `column "hub_listed_at" does not exist` (42703) — the
> exact drift staged acceptance exists to catch. Idempotent migration:
> `hub_listing_status` enum (`unlisted|listed`), `tenants.hub_listing_status`
> NOT NULL DEFAULT 'unlisted', nullable `hub_listed_at`, column comments.
> History row `20261017103000` `'{}'::text[]` inserted (original ts, A's
> window, clear of Session B's chain). Verified remotely: enum labels
> `unlisted,listed`, both columns with correct shapes/defaults, listing
> counts 1 league currently `unlisted` (fail-closed default proven by the
> empty hub directory on live data). Live evidence: the PUB-02 hub family
> (`public-hub.live.test.ts`) 2/2 PASS post-apply.

> **18 October 2026 (Batch 117) - `fan_blocks` APPLIED remotely via the
> `DATABASE_URL` fallback.** File:
> `supabase/migrations/20261018140000_fan_blocks.sql` (FAN-01 anti-abuse
> slice): additive - one new table, three CHECKs (fixed reason set
> `report_abuse|reaction_abuse|other`, fixed status set `active|lifted`,
> lift-provenance pairing: active = no lift reviewer, lifted = reviewer AND
> time required), one PARTIAL unique index
> `(tenant_id, blocked_user_id) WHERE status = 'active'` (one active block
> per fan per league; a re-block while active is an idempotent no-op at the
> writer), history index, RLS enabled AND forced with grants only to
> `ssl`/`service_role` (fail-closed; all access via server-side writers).
> Blocks are LEAGUE-SCOPED anti-abuse signals only - enforcement lives in
> the engagement writers (reactions + reports), fail-closed; follows are
> NOT gated in this slice (recorded boundary); never an input to scoring,
> standings or awards. Writer: `lib/fan-block-records.ts`
> (`match:update`-gated block/lift/probe/list; lift under FOR UPDATE with
> reviewer provenance + `FAN_BLOCK`/`FAN_BLOCK_LIFT` audits). History row
> `20261018140000` `'{}'::text[]` - A's Oct-18 window, after Batch 116's
> `20261018130000`, clear of Session B's chain. Verified remotely: 9 columns
> as authored, all 3 checks present, partial unique + history indexes,
> `relrowsecurity/relforcerowsecurity = t/t`, history `18130000` +
> `18140000`. Contract tests: `fan-reaction-policy.test.ts` (database) +
> `fan-block-records.test.ts` / `fan-report-wiring.test.ts` /
> `fan-reactions.test.ts` (web enforcement).

> **18 October 2026 (Batch 116) - `fan_reaction_reports` APPLIED remotely via the
> `DATABASE_URL` fallback.** File:
> `supabase/migrations/20261018130000_fan_reaction_reports.sql` (FAN-01 reports
> slice): additive - one new table, three CHECKs (fixed reason set, fixed
> status set, review-provenance pairing: open = no reviewer, decided = reviewer
> AND time required), one PARTIAL unique index
> `(match_id, reported_by) WHERE status = 'open'` (one open report per fan per
> match; re-reporting while open is an idempotent no-op at the writer), one
> queue index `(tenant_id, status, created_at)`, RLS enabled AND forced with
> grants only to `ssl`/`service_role` (fail-closed; all access via the
> server-side writers). Reports are moderation signals only - no scoring,
> standings or award path reads them. Writer:
> `lib/fan-report-records.ts` (fan gate + publication policy + flood floor +
> partial-unique replay safety; owner decision via FOR UPDATE lock +
> `REACTION_REPORT_DECIDE` audit). History row `20261018130000` `'{}'::text[]`
> - A's Oct-18 window, after Batch 114's `20261018120000`, clear of Session
> B's chain. Verified remotely: 9 columns as authored, all 3 checks present,
> partial unique + queue indexes, `relrowsecurity/relforcerowsecurity = t/t`,
> history `18120000` + `18130000`. Contract tests:
> `fan-reaction-policy.test.ts` (database) + `fan-report-records.test.ts` /
> `fan-report-wiring.test.ts` (web).

> **18 October 2026 (Batch 114) - `users_display_time_zone` APPLIED remotely via the
> `DATABASE_URL` fallback.** File:
> `supabase/migrations/20261018120000_users_display_time_zone.sql` (UX-03):
> purely additive - `ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone text`,
> nullable, no default, no RLS/grant changes (the users table's existing
> policy set governs). Null = unset; every display formatter falls back to an
> explicit UTC label and never imputes the server's zone. Writer:
> `lib/account-preferences.setMyDisplayTimeZone` (Clerk session + account
> activity gates, row lock, `DISPLAY_TIMEZONE` audit row, Intl-validated with
> `isValidTimeZone` - the single implementation moved from
> `lib/notification-dispatch` to the pure `lib/time-policy`, re-exported for
> stability). History row `20261018120000` `'{}'::text[]` - A's Oct-18
> window, after Batch 103's `20261018110000`, clear of Session B's chain.
> Verified remotely: column `time_zone:text:nullable=YES:default=null`,
> history `18100000` + `18110000` + `18120000`. Contract test:
> `packages/database/src/__tests__/user-display-timezone-schema.test.ts`.

> **18 October 2026 (Batch 103) - `tournament_polls` APPLIED remotely via the
> `DATABASE_URL` fallback.** File:
> `supabase/migrations/20261018110000_tournament_polls.sql` (FAN-01 moderated
> polls): `tournament_polls` (owner-authored question + jsonb options array,
> `tournament_polls_options_shape_check` pins array type + 2-10 arity -
> element shape CANNOT be a CHECK (no set-returning functions in CHECK), so
> it is enforced by the pure policy + writer) + `tournament_poll_votes` (one
> active vote per fan per poll via `tournament_poll_votes_poll_fan_uidx`,
> switching updates in place, `option_index >= 0` only - the upper bound is
> per-poll dynamic and writer-enforced). Draft/open/closed lifecycle; closed
> is terminal. RLS enabled+forced on both; grants to `ssl`/`service_role`
> ONLY, SELECT/INSERT/UPDATE - no DELETE (owner questions/options are
> records; votes are retained engagement), no anon/authenticated grants.
> Engagement only: votes never feed scoring, standings, awards or any
> official decision. History row `20261018110000` `'{}'::text[]` - A's
> Oct-18 window, clear of Session B's chain (ends `20261018090000`).
> Verified remotely: tables, CHECKs, unique + per-poll indexes, RLS
> enabled+forced, grant rows, history `18100000` + `18110000`.

> **18 October 2026 (Batch 102) - `tournament_champion` APPLIED remotely via the
> `DATABASE_URL` fallback.** File:
> `supabase/migrations/20261018100000_tournament_champion.sql` adds
> `tournaments.champion_team_id` (FAN-03 hall of fame): nullable FK to
> `teams` ON DELETE SET NULL, written EXACTLY ONCE by the
> `TOURNAMENT_ADVANCE` completion claim from the decided final's winnerId -
> never re-derived at read time. **No backfill** - legacy completed
> tournaments read champion-less rather than guess which old fixture was the
> final (guesses are not records); partial index
> `tournaments_champion_idx` on `(tenant_id) WHERE champion_team_id IS NOT
> NULL` serves the bounded newest-first hall-of-fame read. History row
> `20261018100000` `'{}'::text[]` - A's Oct-18 window, clear of Session B's
> chain (ends `20261018090000`). Verified remotely: uuid column, FK
> `tournaments_champion_team_id_fkey` (ondelete=set-null), index definition,
> history `17190000` + `18100000`.

> **17 October 2026 (Batch 98) - `fan_reactions` APPLIED remotely via the
> `DATABASE_URL` fallback.** File:
> `supabase/migrations/20261017190000_fan_reactions.sql` creates
> `fan_reactions` (FAN-01 first slice): moderated fan reactions on published
> matches from a FIXED platform-chosen set (DB CHECK
> `fan_reactions_type_check` pins `four/six/wicket/clap/fire` - no free text
> surface exists, so nothing offensive can be stored), one active reaction per
> type per fan per match (`fan_reactions_member_uidx`), and a
> `fan_reactions_match_idx` for the public counts read. Reactions are
> engagement signals ONLY - no scoring, standings or award path reads them.
> Anti-abuse (flood floor) lives in the shared pure policy + locked writer,
> not in this file. Fail-closed posture: RLS enabled+forced, all grants
> revoked from PUBLIC/anon/authenticated, ssl/service_role SELECT/INSERT/DELETE
> only - DELETE is granted (unlike prizes/preferences) because toggling OFF
> removes the fan's own row: reactions stay user-deletable engagement, not
> records. History row inserted as version `20261017190000`, name
> `fan_reactions`, `'{}'::text[]` - A's window, right after Batch 97's
> `20261017180000`; the parallel chain remains intentionally unapplied.
> Verified remotely: all 6 columns, type CHECK, both indexes, RLS
> enabled+forced, 0 client grants, history `17160000` + `17170000` +
> `17180000` + `17190000`.

> **17 October 2026 (Batch 97) - `notification_preferences` APPLIED remotely via
> the `DATABASE_URL` fallback.** File:
> `supabase/migrations/20261017180000_notification_preferences.sql` creates
> `notification_preferences` (FAN-02 slice): per-member per-league consent and
> quiet hours — `in_app_enabled` boolean (default true; absence of a row keeps
> the historical default), `quiet_start_minute`/`quiet_end_minute` smallint
> (wall-clock minutes of day, [start, end), both-set-or-both-null +
> range/boundary CHECKs), `time_zone` text (IANA, null = UTC, length-bounded),
> `UPDATE`d-only lifecycle (no DELETE grant anywhere). Unique
> `notification_preferences_member_uidx (tenant_id, user_id)`. Quiet hours gate
> INTERRUPTING channels only (email/push/sms — none wired yet, reported
> honestly as `channel_unwired` by the shared policy); the in-app bell never
> enters a quiet window. Fail-closed posture: RLS enabled+forced, all grants
> revoked from PUBLIC/anon/authenticated, ssl/service_role only. History row
> inserted as version `20261017180000`, name `notification_preferences`,
> `'{}'::text[]` — A's window, right after Batch 94's `20261017170000`; the
> parallel chain remains intentionally unapplied. Verified remotely: all 9
> columns, 3 CHECKs, unique index, RLS enabled+forced, 0 client grants,
> history `17160000` + `17170000` + `17180000`.

> **17 October 2026 (Batch 94) - `prize_supersede` APPLIED remotely via the
> `DATABASE_URL` fallback.** File:
> `supabase/migrations/20261017170000_prize_supersede.sql` adds to
> `tournament_prizes` (PUB-05 corrections): `superseded_at` timestamptz +
> `superseded_by_prize_id` uuid FK self-reference (ON DELETE SET NULL), the
> `tournament_prizes_supersede_cohesion_check` CHECK (both null or both
> present), and the `tournament_prizes_superseded_idx` index. Additive +
> idempotent; no new grants (the Batch 92 table-level RLS/revoke already
> covers new columns; still no DELETE anywhere). Approved prizes are never
> rewritten — a correction supersedes the frozen row with a new draft and
> keeps the history. History row inserted as version `20261017170000`, name
> `prize_supersede`, `'{}'::text[]` — A's window, right after Batch 92's
> `20261017160000`; the parallel chain remains intentionally unapplied.
> Verified remotely: both columns present, all 5 CHECKs (4 original +
> cohesion), index present, RLS enabled+forced, 0 anon/authenticated grants,
> history `17160000` + `17170000`.

> **17 October 2026 (Batch 92) - `tournament_prizes` APPLIED remotely via the
> `DATABASE_URL` fallback.** File:
> `supabase/migrations/20261017160000_tournament_prizes.sql` creates the
> `tournament_prize_status` enum and `public.tournament_prizes` (PUB-05 first
> slice: league-declared prizes with configurable free-text categories,
> optional amount/currency/sponsor, one-way draft -> approved lifecycle, and a
> league-RECORDED payout record the platform never verifies). Additive and
> idempotent; DB CHECKs enforce approval provenance, payout-requires-approval,
> payout-attribution cohesion and non-negative amounts. RLS enabled + forced,
> all access revoked from PUBLIC/anon/authenticated, grants only for internal
> `ssl`/`service_role`, NO DELETE grant. History row inserted as version
> `20261017160000`, name `tournament_prizes`, `'{}'::text[]` — inside A's
> window (101000-195959), after Batch 90's `20261017150000`; the parallel
> chain (20261017090000-20261018090000) remains intentionally unapplied.
> Verified remotely in one fold: 17 columns, all four CHECK constraints,
> RLS enabled+forced, 0 anon/authenticated grants, history rows `20261017150000`
> + `20261017160000`. Enforcement is application-side (pure `prize-policy` +
> `tournament:update`-gated audited writers in `lib/prize-records.ts`).

> **17 October 2026 (Batch 90) - `competition_locks` APPLIED remotely via the
> `DATABASE_URL` fallback.** File:
> `supabase/migrations/20261017150000_competition_locks.sql` adds
> `tournaments.competition_locked_at` + `competition_locked_by` (COMP-07
> explicit fixture freeze; nullable, additive, idempotent `ADD COLUMN IF NOT
> EXISTS`). **No backfill by design:** engagement is explicit-only, so every
> pre-existing competition stays unlocked — the recorded truth about what
> leagues actually decided. Apply path deviates from `supabase db push` (the
> parallel-session chain 20261017090000-20261018090000 below is intentionally
> still unapplied); the exact local SQL was executed via the repo `postgres`
> driver and the history row was inserted as version `20261017150000`,
> name `competition_locks`, `'{}'::text[]`. The timestamp was first applied as
> `20261017200000` and then MOVED to `20261017150000`: `20261017200000+` is
> Session B's reserved range (`PARALLEL_SESSION_DIVISION.md`), while
> `101000-195959` is A's window and `150000` was unused. Verified remotely in
> one fold: both columns present, history row at the new version and absent at
> the old, `tournaments` empty (0 rows) so the lock column reports 0 locked.
> Enforcement is application-side (shared pure `competition-locks` module +
> `manageMatch` transaction gate + audited `setCompetitionLock` writer).

> **17 October 2026 (Batch 88) - `tournament_awards` LOCAL ONLY, unapplied.**
> File: `supabase/migrations/20261017140000_tournament_awards.sql` creates the
> `award_category` enum and `public.tournament_awards` (PUB-04 official awards,
> first slice). Additive and idempotent: exactly-one-winner DB CHECK,
> `superseded_at` correction history, partial unique at-most-one-active per
> (tournament, category), RLS enabled + forced with all access revoked from
> PUBLIC/anon/authenticated, grants only for internal `ssl`/`service_role`
> roles, and NO DELETE grant anywhere (correction provenance never deletes
> history). Enforcement is application-side (shared `award-policy` + the
> `tournament:update`-gated audited writer); no fan-vote data exists in the
> table. No remote apply, no `DATABASE_URL` execution, no history row —
> acceptance requires real PostgreSQL application/RLS review. Timestamp sits in
> A's allocated range (101000-195959) and is order-independent of B's
> `league_applications` (all-new table, additive chain). Apply the complete
> reviewed chain before any coordinated release.

> **17 October 2026 (Batch 86) - `hub_listing` LOCAL ONLY, unapplied.**
> File: `supabase/migrations/20261017103000_hub_listing.sql` adds the guarded
> `hub_listing_status` enum ('unlisted'/'listed') plus
> `tenants.hub_listing_status NOT NULL DEFAULT 'unlisted'` and
> `hub_listed_at timestamptz` (PUB-02 owner opt-in for cross-league hub
> discoverability). Additive and idempotent: every existing league stays
> unlisted and unchanged. Enforcement is application-side (shared
> `public-hub-policy` + the audited owner-only listing writer); no remote
> apply, no `DATABASE_URL` execution, no history row — acceptance requires
> real PostgreSQL application/RLS review. This file's timestamp precedes the
> Batch 85 revision file; both, together with the XI and handover migrations
> below, remain pending. Apply the complete reviewed chain before any
> coordinated release.

> **17 October 2026 (Batch 85) - `scoring_revisions` LOCAL ONLY, unapplied.**
> CLI-created file `supabase/migrations/20261017093925_scoring_revisions.sql`
> adds `matches.scoring_revision integer NOT NULL DEFAULT 0` plus a nonnegative
> CHECK. Canonical scoring owns increments, committed under the match lock with
> tenant/match/revision CAS and an atomic audit; accepted retries/no-ops do not
> increment. No remote apply or database acceptance ran. The XI and handover
> migrations below also remain pending. This timestamp precedes the existing
> handover file; the column addition is independent of it. Apply the complete
> reviewed chain before the coordinated release, drain old writers and verify
> real stale-write/rollback/locking behavior. Do not roll back by re-enabling
> an old unfenced writer against live scoring. Gate remains default-off.

> **17 October 2026 (Batch 84) - no schema change or remote apply.** Web
> session-token wiring consumes the Batch 83 handover epoch on all five write
> paths; serializable expected errors and retained original queue epochs do
> not change database enforcement. Both `scorer_handover_epoch` and
> `playing_xi_declaration` remain LOCAL ONLY/unapplied. Deterministic session
> tests are not PostgreSQL/concurrency/RLS or deployment acceptance. The
> `LEAGUE_MEMBERSHIP_CONTROLS_READY` release gate remains default-off.

> **18 October 2026 (Batch 83) - `scorer_handover_epoch` LOCAL ONLY, unapplied.**
> File: `supabase/migrations/20261018090000_scorer_handover_epoch.sql` (adds
> `matches.scorer_handover_epoch integer NOT NULL DEFAULT 0`; the SCORE-11
> writer-fencing token bumped by every real scorer slot change and echoed by
> canonical scoring writes once it exceeds 0 — additive/idempotent, no
> backfill, legacy rows default 0 and keep pre-fencing behavior). NOT applied
> to the remote project — no MCP apply, no `DATABASE_URL` execution, no history
> row; acceptance still requires real PostgreSQL application. Enforcement is
> application-side (shared `scorerFencingDecision` policy at the canonical
> scoring boundary before any lock; the assignment writer bumps the epoch under
> the match lock and audits before/after). Until applied, the canonical service
> can only fence on deployments where the column exists; tokenless legacy
> behavior is preserved while the epoch is 0. The Batch 80
> `playing_xi_declaration` migration below remains pending apply alongside
> this one.
>
> **17 October 2026 (Batch 80 + 81) - `playing_xi_declaration` LOCAL ONLY, unapplied.**
> File: `supabase/migrations/20261017090000_playing_xi_declaration.sql`
> (arms the COMP-06 declared-XI gate: `matches.xi_required boolean NOT NULL
> DEFAULT false`, `matches.xi_approved_at timestamptz`, new
> `match_playing_xis` immutable per-side XI rows with composite same-league
> FKs — adds `teams_id_tenant_key` and reuses the Batch 63
> `matches_id_tenant_key` — partial active-row uniques, ENABLE+FORCE RLS,
> grants only to `ssl`/`service_role`, no delete grant; additive/idempotent,
> legacy rows stay false so existing eligibility/readiness semantics survive
> without backfill). NOT applied to the remote project — no MCP apply, no
> `DATABASE_URL` execution, no history row; acceptance still requires real
> PostgreSQL application plus lock/concurrency/RLS verification. Enforcement
> is application-side (shared playing-XI policy at the canonical delivery
> boundary; locked/audited declaration + approval writers; blocking readiness
> check). Batch 81 adds no schema: only the match-page UI surfaces (playing-XI
> card, viewer-authority sizing reads, readiness passthrough); the migration
> remains the only pending apply for this ID.
>
> **17 October 2026 (Batch 82) - no schema change.** SCORE-10 substitutions
> slice rides entirely on the Batch 80 XI schema (supersede + insert on
> `match_playing_xis`, `matches` untouched); nothing new to apply, and the
> `playing_xi_declaration` migration above stays the only pending apply.

> **17 October 2026 (Batch 77) - `consented_career_linkage` APPLIED to the
> remote Supabase project (`anxstufkbqnjkxgksfkn`).** Adds
> `users.public_career_consent_at timestamptz` (null = never granted) + a
> column comment; verified player records are DERIVED (`players.user_id` →
> active `users` row), so no verification state is stored. **Note on the
> apply path:** the Supabase MCP tools were unavailable from this session's
> tool catalog, so the migration was applied through the repo's own
> `postgres` driver using the project's `DATABASE_URL`, executing exactly
> `supabase/migrations/20261016210000_consented_career_linkage.sql` (whole
> file, single connection) and inserting the
> `supabase_migrations.schema_migrations` history row ('20261016210000',
> 'consented_career_linkage') the MCP would have written. Post-apply SQL
> verified the column (`timestamp with time zone`) and the 8-row migration
> history. Code retirement-wise: consent gates only cross-league merges
> (PUB-02 hub must call `mergeConsentedCareer` and fail closed on null);
> per-league publication predicates are untouched.

> **16 October 2026 (Batch 76) - `retire_legacy_user_authorization` APPLIED to the
> remote Supabase project (`anxstufkbqnjkxgksfkn`) via the Supabase MCP
> `apply_migration`.** ISO-06: adds `users_role_platform_only`
> `CHECK (role IN ('super_admin','fan'))` (blocks legacy writers from putting
> league roles on `users.role`; pre-flight verified 0 league-role rows, so no
> violation) + column comments marking `users.role` as a platform-role-only
> carrier and `users.tenant_ids` as a deprecated write-disabled fallback.
> Authoritative league membership remains `user_tenant_roles` (SCORE-09
> status/expiry). Code retirement in the same batch: `createTenant` no longer
> writes the `tenant_ids` array, and the admin console counts tenant users
> from membership rows. Post-apply SQL verified the constraint definition and
> remote data (1 super_admin user, membership row present).

> **16 October 2026 (Batch 73) - `umpire_assignment_approval` APPLIED to the remote Supabase project (`anxstufkbqnjkxgksfkn`) via the Supabase MCP `apply_migration`.** Local file: `supabase/migrations/20261016190000_umpire_assignment_approval.sql` (adds `matches.umpire_approval_required boolean NOT NULL DEFAULT false` and `matches.umpire_approved_at timestamptz` + column comments; additive/idempotent, no RLS/grant changes, member-umpire and free-text-only matches stay false so existing readiness semantics survive without backfill). Post-apply SQL verified all six umpire columns together. Consent enforcement is application-side (locked, conditional, audited `approveUmpireAssignmentInMatch` with a SCORE-09 effective-membership re-check, also retrofitted to the scorer-consent writer); real-DB acceptance remains staged. Batch 62's release-evidence requirements remain unmet.

> **16 October 2026 (Batch 72) - `member_umpires` APPLIED to the remote Supabase project (`anxstufkbqnjkxgksfkn`) via the Supabase MCP `apply_migration`.**
> Local file: `supabase/migrations/20261016180000_member_umpires.sql` (adds
> `matches.umpire1_id` / `matches.umpire2_id` uuid REFERENCES users(id) ON
> DELETE SET NULL + column comments; additive/idempotent, no RLS/grant
> changes, free-text `umpire_1/2` untouched for external officials).
> Post-apply SQL verified both columns. Assignment enforcement is
> application-side (locked writer, effective-member candidate check);
> real-DB acceptance remains staged.

> **16 October 2026 (Batch 71) - `scorer_assignment_approval` APPLIED to the
> remote Supabase project (`anxstufkbqnjkxgksfkn`) via the Supabase MCP
> `apply_migration`.** Local file:
> `supabase/migrations/20261016170000_scorer_assignment_approval.sql` (adds
> `matches.scorer_approval_required boolean NOT NULL DEFAULT false` and
> `matches.scorer_approved_at timestamptz` + column comments; additive/
> idempotent, no RLS/grant/FK changes, legacy rows default false so existing
> readiness semantics survive without backfill). Post-apply SQL verified both
> columns. Enforcement is application-side (locked, conditional, audited
> `approveScorerAssignmentInMatch`); conditional-update/lock-race acceptance
> remains a staging gate. Batch 62's release-evidence requirements remain
> unmet.

> **16 October 2026 (Batch 68) - `invite_membership_expiry` APPLIED to the remote
> Supabase project (`anxstufkbqnjkxgksfkn`) via the Supabase MCP
> `apply_migration`.** Local file: `supabase/migrations/20261016150000_invite_membership_expiry.sql`
> (adds nullable `user_invites.membership_expires_at` + a chronological CHECK +
> column COMMENT; additive/idempotent, no RLS/grant changes, no FK). Post-apply
> verification via MCP SQL: column exists (`timestamp with time zone`, NULL
> allowed). Security/performance advisors show only the pre-existing baseline
> (including the long-standing `user_invites` RLS-without-policies INFO and the
> `invited_by`/`team_id` unindexed-FK INFO findings that pre-date this change);
> the new column introduces no new lint. Redemption-side enforcement is
> application-level (locked, audited `claimInvite`); real-DB acceptance of the
> bound-application race still needs staging, and Batch 62's release-evidence
> requirements remain unmet.

> **16 October 2026 (later) — BOTH Batch 63/65 migrations APPLIED to the remote
> Supabase project (`anxstufkbqnjkxgksfkn`, ap-southeast-1, ACTIVE_HEALTHY) via
> the Supabase MCP `apply_migration`**, byte-equal to the repository files.
> Remote migration history records them under server-assigned versions
> `20261016130058` / `20261016130103` (same names: `scoring_transactional_outbox`,
> `membership_expiry_delegation`) — version numbers differ from the local
> filenames by design of the history table; treat the NAME as the identifier.
> Post-apply verification (all via MCP SQL): `scoring_outbox` exists with
> ENABLE+FORCE RLS, policy `scoring_outbox_internal_ssl`, grantees only
> postgres/service_role/ssl (anon+authenticated revoked), envelope FK/{check}
> indexes present; `user_tenant_roles` has both new columns, the
> `expires_at > created_at` CHECK, and the partial index. Security + performance
> advisors report no lints on the new objects. Server-side enforcement
> (membership-effectiveness rollout) still depends on deploying the updated
> services; Batch 62's release-evidence requirements remain unmet.

> **15 October 2026 (evening) - FULL REBUILD & RECONCILIATION COMPLETE.**
> The database was wiped from the SQL editor (schema and data dropped, migration
> history left stale), then **rebuilt from the repository's canonical chain**:
> all migrations `001` → `20261013180000` were applied in filename order, plus
> two new reconciliation migrations created by this pass (see below). The
> sections below the horizontal rule are historical and describe the era **before**
> this rebuild; their "unapplied" statements no longer hold.

### Batch 65 bounded memberships (16 October 2026)

`20261016120000_membership_expiry_delegation.sql` is a **local migration only**,
not applied anywhere. It adds nullable `expires_at` and `delegated_by_user_id`
(ON DELETE SET NULL provenance) to `user_tenant_roles`, a chronological CHECK,
and a partial index; RLS, grants and existing rows are unchanged and the
migration is additive/idempotent. Enforcement is application-level (shared
membership-effectiveness policy + canonical scoring boundary + web admin);
database-level RLS/serializability acceptance of expiry races still requires a
real disposable database. No remote database was queried or written; Batch 62's
release-evidence requirements remain unmet.

### Batch 64 idempotent consumers (16 October 2026)

Source-only change; no schema, migration, RLS/grant or database-data change.
Commentary consumers and the scoring bridge now use Redis SET NX claims keyed by
the stable outbox event identity to deduplicate at-least-once redelivery, with
fail-open behavior (surfaced) on Redis outages and claim release on processing
failure. Claims are caches, not authorization: the bridge's forwards still pass
the publication/league boundary recheck, and no endpoint grants access by claim
possession. No migration was applied anywhere; no remote database was queried or
written, and Batch 62's release-evidence requirements remain unmet.

### Batch 63 scoring transactional outbox (16 October 2026)

`20261016102316_scoring_transactional_outbox.sql` is a **local migration only**,
not applied anywhere. It adds an internal `scoring_outbox` delivery journal and a
`matches_id_tenant_key` unique index (composite `(id, tenant_id)` FK target for
the journal). All privileges are revoked from `PUBLIC`/`anon`/`authenticated`
with grants only for `service_role`/`ssl`, RLS enabled and forced, and no DELETE
grant anywhere — pending rows are retained, not purged. Schema tests assert the
Drizzle definition and SQL file agree on FK parentage, dedupe identity, envelope
CHECKs, grants and additive/atomic structure. The migration chain has not been
executed against any real PostgreSQL database from this session; real apply,
rollback and RLS acceptance remain open. No remote database was queried or
written; release evidence requirements from Batch 62 are unchanged and unmet.

### Batch 62 release evidence and separate schema acceptance (16 October 2026)

Production deployment no longer invokes `drizzle-kit migrate` against the canonical
Supabase SQL files or suppresses a migration failure before printing success. A reviewed
schema rollout is separate; candidate-bound real-Postgres migration-chain evidence is
required by the new default-off release checker, along with isolation/concurrency and
other retained acceptance. No schema, migration history, grants or data were queried or
changed. Accessible MCP projects could not be linked unambiguously to this repository;
no unrelated project's database was inspected. Local Docker/PostgreSQL remain absent.
Historical rebuild evidence below was not re-certified; no acceptance/approval claimed.

### Batch 61 canonical public live-read boundary (16 October 2026)

Canonical public snapshot/history reads now use exact-league publication/active-league
checks in the same repeatable-read read-only transaction as their data. History verifies
the innings hierarchy and uses an explicit field allowlist; Redis does not authorize
publication. Socket/commentary/reaction forwarding rechecks the boundary and uses scoped
rooms. Custom-domain web public resolution now applies the active-league predicate too.
No schema/migration, RLS/grant, remote database operation, build or deployment ran.
These application tests do not certify deployed RLS, race/withdrawal behavior, cross-node
room eviction, provider delivery or browser acceptance. The historical rebuild remains
historical evidence only; the release gate stays default-off.

### Batch 60 registered-squad validation (16 October 2026)

Canonical scoring now reads/locks existing `league_registrations` rows with exact
tenant/tournament/team predicates, deterministic order and a three-row corruption
bound. Shared code validates approved declared squads and rejects known non-approved
registration states; the web selector/readiness model agrees. No schema, migration,
RLS/grant, remote database inspection/write or deployment change occurred. Existing
row locks do not serialize absent-row inserts; real two-session status/squad races,
legacy fallback migration and rollback behavior still need disposable-DB acceptance.
The historical rebuild evidence below is unchanged and was not revalidated here.

### Batch 59 source-quality gate (16 October 2026)

Web TypeScript checking now passes without the historical error baseline. This batch
changes page signatures, test-adapter typing/imports and pure voice-input normalization;
no schema/migration, database operation, RLS/grant or deployment change occurred. A green
type check does not independently validate the historical rebuild or release isolation.

### Batch 58 application-only member directory (16 October 2026)

Owner-only member readers add literal name/email search, league role/access filters,
membership-ID keyset pagination and exact-membership detail reads. Every read retains
an exact tenant predicate and a bounded explicit field projection; no new public API
or private-contact permission is granted. No schema/migration, database inspection/write,
RLS/grant, provider or deployment change ran. Real PostgreSQL query plans, isolation,
concurrent changes between pages and authenticated browser journeys remain unverified.

### Batch 57 application-only leaderboard qualification (16 October 2026)

Published league leaderboards now apply user-selected minimum innings/balls to the
same grouped season-stat rows via aggregate `HAVING`, before ordering and the top-10
limit. Tenant/publication predicates are retained. No schema, migration, RLS/grants,
remote database inspection/write, or deployment ran. Format-specific records are not
claimed: existing season aggregates have no match-format dimension. Real PostgreSQL
aggregate/plan verification and public-browser acceptance remain open.

### Batch 56 application-only follow-up (16 October 2026)

Member assignment reads now detect and disclose capped results rather than implying
that omitted assignments do not exist. They remain exact-league, account-filtered,
bounded application reads with resource-ID ordering. The member removal writer,
its locks, version checks, assignment guards and audit behavior are unchanged.
No database inspection, write, migration application, RLS/grant change or deployment
was performed in this batch. The rebuild evidence below is historical; it was not
independently revalidated by this source-only work. Real-DB and browser acceptance
remain required, and the release gate stays default-off.

### Rebuild summary (15 October 2026)

| Check | Result |
|---|---|
| Migrations applied (all, in order) | 45 = 43 repo files + `025`, `026` below |
| Drizzle tables defined | 50 |
| Tables present in `public` | **50 — exact match** |
| Missing tables / columns / enums vs Drizzle | **0 / 0 / 0** |
| RLS enabled | 56 policies-checked tables → **all** public tables enabled |
| Legacy DB-only tables | **0** — the 6 documented tables were dropped (no code readers, no view deps, empty) |
| Advisors (security / performance) | **0 findings** |
| Recorded migration history | rewritten to exactly the 45 repo filename prefixes — `db push` now reports **no drift** |
| Super admin | `kaash0542@gmail.com` (`role='super_admin'`, active) — DB row and `005_seed_super_admin.sql` both updated |
| `auth.users` | **empty** — create the Supabase Auth user `kaash0542@gmail.com` (invite) so login works; `is_super_admin()`/`current_tenant_id()` match by email fallback |

### Bugs fixed in repository migrations during the rebuild

1. **`001_enable_uuid_v7_and_helpers.sql` — `uuid_generate_v7()` was doubly
   broken**: `integer & bit` (bit-string literals `x'0F'` etc.) aborted every
   `INSERT`, and the `decode()` input used the 16-char zero-padded timestamp
   (36 hex = 18 bytes) instead of the 12-char `unix_ts_ms`, so `::uuid` would
   also fail. Rewritten: 12-hex 48-bit ms timestamp + integer masks, producing
   valid, time-ordered v7 UUIDs. (`all_migrations_combined.sql` patched too.)
2. `009_fantasy_cricket.sql` — default `fantasy_points_rules` rows referenced a
   phantom all-zero tenant (FK violation on a fresh DB). Now seeded only when
   that tenant exists. The app never reads this table.
3. `018_create_impersonation_sessions.sql` — grants assumed a custom `ssl` role
   (existed only on the pre-wipe project). A guarded `CREATE ROLE ssl NOLOGIN`
   block now runs before first use (used by 8 later migrations).
4. `022_add_starter_plan_and_payment_tables.sql` — `ALTER TYPE tenant_plan` ran
   unconditionally (type is a fresh-install legacy artifact; now guarded), and
   two policies referenced `users.clerk_id` (Clerk era). They now use
   `users.id = auth.uid()`, matching the Supabase-Auth design of `001`'s helpers.
5. `024_revoke_sensitive_table_grants.sql` — hardening ran before
   `20260623_add_user_tenant_roles.sql` creates the table; `REVOKE`/`GRANT`/
   `COMMENT`/`DROP POLICY ... ON user_tenant_roles` and the policy-creation
   block are now `to_regclass`-guarded, and the file is re-applied at the end of
   the chain (final hardening pass).
6. `20260623_add_user_tenant_roles.sql` — backfill joined
   `users.clerk_id = tenants.owner_id::text`; now joins `users.id = owner_id`.

### New migrations created by this pass

- **`025_sync_drizzle_schema.sql`** — adds application columns no earlier
  migration creates: `users(clerk_id, display_name, avatar_url, last_login_at)`,
  `teams(short_name, description, city, banner_url, primary_color,
  secondary_color, founded_year, max_squad_size, created_by)`,
  `matches(total_overs, man_of_match_id, umpire_1, umpire_2, third_umpire,
  match_referee, created_by)`, with `users_clerk_id_key` unique index. Idempotent.
- **`026_align_app_types.sql`** — creates the 11 enums the 001–024 chain never
  created (`user_role`, `tenant_plan`, `match_format`, `match_type`,
  `match_status`, `toss_decision`, `wicket_type`, `innings_status`,
  `tournament_format`, `tournament_status`, `ground_type`; `stream_source`/
  `stream_status` stay owned by `20261004090000`), drops legacy text CHECK
  constraints (the enums now own those domains — e.g. the old
  `users_role_check` permitted only `user/admin/super_admin`, not even `fan`),
  and converts the live columns to the Drizzle-declared enum types
  (`users.role`, `tenants.plan`, `matches.{match_format,match_type,status,
  toss_decision}`, `match_innings.status`, `match_balls.wicket_type`,
  `tournaments.{format,status}`, `venues.ground_type`), recreating the two
  super-admin policies on `subscription_requests` around the `users.role` change.

### Bookkeeping notes

- `all_migrations_combined.sql` was **regenerated** from the 45 migration files
  (the previous copy dated 2026-05-25 predated 18 migrations and carried the
  broken `uuid_generate_v7()` body).
- `combined_pending_migrations.sql` was **removed** — it was a stale generated
  bundle of not-yet-applied migrations; nothing is pending anymore.
- Recorded history rows were rewritten with `created_by = 'mcp'` and no
  `statements` payload, so the CLI matches by version prefix; re-running
  `supabase db push` is expected to be a no-op.
- `seed.sql` was **not** applied (batch environment kept the database clean of
  fixture rows; run it deliberately when fixture data is wanted — it is
  idempotent, uses `.invalid` emails, per the historical notes below).

### Still true (unchanged)

- **No edge functions exist in the repository** (`supabase/functions` is
  absent); there is nothing to deploy on that front.
- `LEAGUE_MEMBERSHIP_CONTROLS_READY` stays unset/false until the *real-DB
  acceptance* gates are exercised (two-session races, RLS, grants, staging
  acceptance). The rebuild proves the schema was applied; it does **not**
  certify runtime behavior. Gates below still stand as written.

---

## Historical verdict (October 6–7): schema was in sync

| Check | Result |
|---|---|
| Drizzle tables defined | 49 |
| Tables present in `public` | 55 |
| **Drizzle tables missing from the database** | **0** |
| Tables in DB but absent from Drizzle | 6 (legacy, see below) |

The last gap was `user_tenant_roles` — defined in the Drizzle schema and read by
`rbac-server.ts` on every tenant-scoped permission check, but never created in
the database. Closed by `20261004210000_create_user_tenant_roles.sql`.

## Trap 1: repo filenames do not match recorded versions

Migrations applied through the Supabase MCP `apply_migration` tool are recorded
under a **tool-generated version**, not the filename's timestamp prefix:

| Repo filename | Recorded in `supabase_migrations` |
|---|---|
| `20261004200000_harden_public_surface_privileges` | `20261006192804` |
| `20261004210000_create_user_tenant_roles` | `20261006192834` |
| `20261004220000_revoke_invoice_fn_from_anon` | `20261006192905` |
| `20261004230000_authoritative_tenant_roles_remove_superadmin_backdoor` | `20261006193705` |
| `20261004240000_ensure_tenant_owner_has_role` | `20261007021xxx` (tool-generated) |
| `20261004250000_fix_matview_trigger_definer` | `20261007022xxx` (tool-generated) |

**Consequence:** the CLI compares the numeric prefix of each repo filename against
`supabase_migrations.versions`. These six will read as *pending* and be replayed.

**This is currently survivable** because all six are written idempotently
(`IF NOT EXISTS`, `DROP ... IF EXISTS`, `CREATE OR REPLACE FUNCTION`,
`ON CONFLICT DO NOTHING`), so a replay is a no-op rather than an error. Verify that
property holds before adding a migration that is not idempotent.

## Trap 3: a trigger can silently break an RLS-granted write

`player_season_stats` grants `FOR ALL` to `authenticated`, but the
`trigger_refresh_player_all_time_stats` trigger called an invoker-rights function
that could not `REFRESH MATERIALIZED VIEW`. The policy advertised a write that the
database then refused. Fixed in `20261004250000`.

**When auditing RLS, always include a control case that *should* succeed.** The
tenant-isolation policies all looked correct; only attempting an allowed write
revealed the trigger. A read-only audit cannot find this class of bug.

Related: `refresh_player_all_time_stats()` rebuilds the whole matview per writing
statement. See the migration header before extending it.

## Trap 2: the legacy 001–0xx files were renamed after being applied

The database records `001_uuid_helpers`, `002_enums`, `003_core_tables`,
`004_rls_policies`, … while the repo contains `001_enable_uuid_v7_and_helpers.sql`,
`002_create_tables.sql`, `003_create_rls_policies.sql`, …

The numeric prefixes happen to line up, but the **names differ**, so name-based
comparison also reports them as pending.

**Do not run `supabase db push` or `db reset` against this project** without first
reconciling, and never run `db reset` against a database that holds data — it
drops and replays everything.

For a fresh, disposable database, replaying `supabase/migrations/*.sql` in
filename order is correct.

## Legacy tables (in DB, not in Drizzle)

`ai_commentary`, `ball_events`, `live_scorecards`, `notification_preferences`,
`player_statistics`, `tournament_standings`

These exist only from raw SQL migrations. The app cannot reach them through
Drizzle. They are candidates for either a schema definition or removal — but
confirm nothing reads them via raw SQL first.

## Data state — corrected Oct 7 2026

An earlier version of this file claimed the database was empty. **That was wrong.**
It already held real data. Verified contents before the seed was applied:

| Table | Pre-existing rows | Notes |
|---|---|---|
| `tenants` | 2 | `ssl` = "Shakir Super League" (**enterprise**) — the real league; `system-default` sentinel with an all-zero `owner_id` |
| `users` | 2 | `kaash0542@gmail.com` (`role = 'super_admin'`), `kashif@maliktech.pk` (`role = 'fan'`) |
| `tenant_branding` | 1 | branding for `ssl` |
| `commission_rates` | 4 | reference data |
| `fantasy_points_rules` | 11 | reference data |
| everything else | 0 | |

### Consequences that were previously stated wrongly

- `kaash0542@gmail.com` **already** holds `role = 'super_admin'`. Removing the
  hardcoded-email backdoor in
  `20261004230000_...remove_superadmin_backdoor.sql` therefore locked **nobody**
  out; no manual `UPDATE` grant was needed. Verified by calling `is_super_admin()`
  under a simulated session.
- The Playwright specs are **not** blocked by missing data. They are blocked
  because **no user has a `clerk_id`**, so Clerk cannot authenticate anyone and no
  browser session can exist.

### Live bug this exposed: locked-out tenant owner

`tenants.owner_id` and `user_tenant_roles` were independent sources of truth.
`current_tenant_id()` reads the junction table, so a tenant whose `owner_id` had
no role row produced an owner locked out of their own league — every RLS policy
evaluated the tenant to `{}` and denied. Live on `ssl`:

```
owner_id -> kashif@maliktech.pk
users.role = 'fan', users.tenant_ids = '{}', user_tenant_roles = 0 rows
=> current_tenant_id() = '{}' => sees nothing in the league they own
```

Fixed by `20261004240000_ensure_tenant_owner_has_role.sql`: idempotent backfill plus
a trigger on `INSERT` / `UPDATE OF owner_id`. It only **adds** a missing row
(`ON CONFLICT DO NOTHING`) and never modifies or demotes an existing role.
Placeholder owners (all-zero sentinel) are skipped — they have no `users` row and
the FK would reject the insert. `EXECUTE` on the function is revoked from
`PUBLIC`/`anon`/`authenticated`, since it is `SECURITY DEFINER`.

## Seed data

`supabase/seed.sql` — idempotent (fixed UUIDs + `ON CONFLICT DO NOTHING`),
safe to re-run. Applied via `execute_sql`, deliberately **not** `apply_migration`,
so seed rows never enter migration history.

Fixture emails use the reserved `.invalid` TLD (RFC 2606) and carry **no**
  `clerk_id`, so they cannot authenticate and cannot be confused with real users.

It seeds three extra tenants (free / starter / pro) plus a live match whose innings
aggregates are **derived from** its ball rows, and deliberately places
`lahore-lions` at exactly `free.maxTeams` (4) and `free.maxPlayers` (40) so the
quota boundary can be exercised.

## Batch 7 rollout gates — unapplied membership controls (12 October 2026)

`20261012100136_league_membership_controls.sql` is a **local migration only**.
Its SQL/schema contract tests do not prove database execution. Docker is absent
in the development environment; no Supabase reset, remote migration, authentication
change or deployment was performed for this batch.

### Before applying or releasing

1. Reconcile recorded migration versions with repository filenames using the
   drift notes above. Inspect the actual tables, enum, indexes, triggers, function
   definitions/owners and role grants. Do not blindly run `db push`, `db reset`,
   repair migration history or regenerate a production schema from Drizzle.
2. Review users, global account activity, tenant owners, legacy arrays and every
   existing explicit role. The backfill preserves existing rows and adds absent
   referenced memberships; it cannot distinguish historical revocations from an
   obsolete legacy array. Approve the proposed additions before execution.
   Global owner/admin roles are not blindly copied to unrelated leagues.
3. Resolve existing `super_admin` membership rows and anomalous owner mappings.
   Such platform membership rows are denied by the new operational guards;
   ordinary member CRUD cannot repair them. Preserve at least one authorized
   active owner per active league through a reviewed administrative procedure.
4. Audit direct Data API consumers (especially mobile), table **and column**
   grants, inherited privileges and RLS policies. The migration revokes direct
   account/member mutations for `anon`/`authenticated`; an inherited or separate
   column-level grant must not bypass the trusted command path. Privileged server
   connections bypass RLS and still need application authorization.
5. Review the existing `auth.uid()`/JWT-email identity bridge and trusted function
   ownership. This migration does not map Clerk string subjects to application
   UUIDs or certify recipient identity. Do not enable client Data API access on
   the assumption that this batch implements third-party authentication.
6. Take a verified backup and execute the migration on a disposable, appropriately
   anonymized staging database first. It is intentionally not a rerunnable SQL
   script: new columns/function/trigger creation must match recorded history.
   Confirm active/suspended constraints, version increments from every writer,
   backfill results and empty tenant scope for absent/suspended memberships.
7. Exercise real two-session locking/concurrency, stale-version rejection, audit
   rollback on failure, revoked scoring record/replay/undo/innings/match completion,
   invitation suspension rejection and RLS permissions. Confirm no deadlocks in
   existing writers and no direct account/role privilege escalation.
8. Exercise authenticated browser/mobile journeys: Ali active/assigned in A,
   suspended in B, absent in C; unchanged global account/other-league records;
   retained rejected offline work; owner protection; primary-versus-host tenant
   behavior; save failure/conflict, dialog and keyboard/responsive behavior.

### Coordinated release and rollback

- Keep repository VPS deployment disabled (leave
  `LEAGUE_MEMBERSHIP_CONTROLS_READY` unset/false). Inspect external hosting Git
  integrations separately; this repository gate does not control them.
- After the above gates pass, arrange a controlled maintenance window. Apply the
  reviewed migration once and verify schema/history/owners/grants. Deploy matching
  database/UI workspace artifacts, web and scoring service together; confirm the
  matching server-only `SCORING_SERVICE_TOKEN` configuration and reload stale
  clients. Old member action signatures intentionally do not remain privileged.
- Enable `LEAGUE_MEMBERSHIP_CONTROLS_READY=true` only after migration acceptance
  and coordinated release readiness. The existing VPS script's warning-only
  Drizzle migration step is **not** proof this Supabase SQL was applied. Record
  the deployed migration version, application SHAs and acceptance evidence here.
- Do not roll back to binaries that ignore membership status while treating
  suspended users as revoked. Disable sensitive traffic or deploy a reviewed
  forward fix; do not delete suspension/audit records or restore legacy fallback
  as an access-recovery shortcut. A database rollback requires its own reviewed
  backup/restore procedure, not an automatic down migration.

**Still open:** all real-database/deployed acceptance, complete provider-verified
OTP and delivery lifecycle, expiry/scoped multiple grants, delegated
resource-scoped grants and privileged MFA (ownership transfer itself is now
source-complete in Batch 12, pending real-DB proof), unknown/removed host
handling and complete private CRUD/socket/export coverage.

## Batch 9 migration — invitation dispatch state (13 October 2026)

`20261013090000_invitation_delivery_state.sql` is a **local migration only**, not
applied. It adds three additive columns to `user_invites`:

| Column | Purpose |
|---|---|
| `email_state` | Last recorded dispatch outcome (`unconfigured`/`provider_accepted`/`failed`/`unknown`); provider acceptance is not delivery |
| `email_attempted_at` | Instant of the last attempt; drives the resend cooldown |
| `email_attempt_count` | Attempt counter (create + resends) |

Unlike the Batch 7 migration this one **is** idempotent
(`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` before re-adding the
check), so a replay is a no-op. It is nevertheless subject to the same rollout
rules: reconcile history, back up, apply on a disposable staging database first,
then release the matching web artifact. It changes no grants or RLS policies and
does not alter existing rows. The dependency is purely additive — code that omits
the new columns keeps working, so the migration can be applied ahead of the web
deploy without breaking the previous binary.

## Batch 10 migration — backup scorer (13 October 2026)

`20261013120000_match_backup_scorer.sql` is a **local migration only**, not
applied. It adds `matches.backup_scorer_id` (nullable `uuid` FK to `users`,
`ON DELETE SET NULL`), a `matches_backup_scorer_distinct_check` constraint that
forbids the same person in both scorer slots, and an index on the new column.

Additive and idempotent (`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`
before re-adding, `CREATE INDEX IF NOT EXISTS`), so a replay is a no-op. It changes
no grants or RLS policies and does not alter existing rows. The check constraint
only rejects rows where both slots are set to the same user; existing matches have
`backup_scorer_id = NULL`, so the constraint validates immediately without a
backfill. Apply ahead of the web deploy is safe — a binary that omits the column
keeps working.

## Batch 11 migration — invitation delivery events (13 October 2026)

`20261013150000_invitation_delivery_events.sql` is a **local migration only**, not
applied. It widens `user_invites_email_state_check` to also permit `delivered`,
`bounced` and `complained`, which are written only from the signature-verified
Resend webhook.

Idempotent (`DROP CONSTRAINT IF EXISTS` before re-adding) and additive: it does
not touch rows, grants or policies, and it only **relaxes** the constraint, so
existing values still validate and a binary that never writes the new states keeps
working. Apply ahead of the web deploy is safe. Operational note: the webhook
route fails closed (503) until `RESEND_WEBHOOK_SECRET` is configured, so an
unconfigured deployment simply records no delivery events.

## Batch 12 migration — two-party ownership transfer (13 October 2026)

`20261013180000_ownership_transfers.sql` is a **local migration only**, not
applied. It creates the `ownership_transfers` table (one row per ownership
handover) with its status/`from_user_id <> to_user_id`/version/`demoted_role`
check constraints, a partial unique index
(`WHERE status = 'pending'`) that allows at most one open request per league, a
recipient lookup index, and RLS.

Additive and idempotent (`CREATE TABLE IF NOT EXISTS`,
`DROP CONSTRAINT IF EXISTS` before re-adding, `CREATE INDEX IF NOT EXISTS`), so a
replay is a no-op. It creates a new table and does not alter `tenants`,
`user_tenant_roles` or any existing row, so it is safe to apply ahead of the web
deploy — a binary that never writes this table keeps working. Access control
follows the `user_invites` precedent: RLS is enabled and forced, all access is
revoked from `anon`/`authenticated`, and only `service_role` (and the `ssl`
role where present) is granted. Application writes go through server actions
that run as the service role.

Operational note: nothing enforces the handover invariant except the Batch 12
application transaction plus this table's constraints. The `tenants.owner_id`
re-point, the recipient promotion and the outgoing-owner demotion all occur in
one transaction, so the migration must be applied together with (or before) the
web code that depends on it.

## Batch 13 integration review (13 October 2026)

No new migration was created or applied. The canonical scoring writer now
recognizes `matches.backup_scorer_id` after current membership/account/league
authorization; web dashboard shortcuts and member-removal checks also include
the backup slot. The Batch 10 schema migration is a prerequisite for the release.

All five previous local migrations remain unapplied here. Do not enable the VPS
release gate based only on passing mocked tests. Deploy matching database
workspace artifacts, web and scoring service together after actual schema/grant
and staging verification. Assignment/removal races, real writer handover/fencing
and ownership-resolution authorization findings recorded in the Batch 13 roadmap
entry remain open; no remote state was inspected or certified by this batch.

## Batch 14 ownership authorization (15 October 2026)

No new migration, remote database inspection or database write occurred. The
Batch 12 application transaction now rechecks current account/session mappings,
both active acceptance accounts and recipient privilege drift under ordered
locks; cancellation reauthorizes the caller's current access. Exact-tenant
conditional resolution writes include status/version/party predicates. Final
acceptance uses `expires_at > clock_timestamp()` so transaction-start time does
not extend consent; issuance expiry cleanup also checks the database wall clock.

The Batch 13 ownership source findings have fixes, but real PostgreSQL lock,
clock, rollback, accept/cancel races and RLS acceptance remain unverified. All
five previous migrations remain unapplied here; the deployment gate stays
default-off. Assignment/removal concurrency and writer fencing remain open.

## Batch 15 assignment/removal serialization (15 October 2026)

No new migration, remote database inspection/write or deployment occurred.
Scorer assignment now locks exact-tenant match -> sorted accounts -> league ->
sorted memberships, rechecks current authority and writes its before/after audit
in one READ COMMITTED transaction. Membership removal uses READ COMMITTED and
non-locking assignment checks after its shared account locks. Do not add a match
lock after those accounts: that would invert assignment/scoring's lock order.
Generic match metadata edits reject scorer-slot fields so they cannot bypass
this application protocol. Team-manager assignment races are outside this fix.

Source and scheduling-double regressions close the recorded source gap, not
the real PostgreSQL acceptance gate. Repeat both two-session assignment/removal
orders for both slots, opposite-slot conflicts, account/membership revocation,
scoring/unassignment and audit rollback on a reconciled local/staging schema.
All five prior migrations remain unapplied; the deployment gate stays default-
off. Pending-member assignments, stale-operator CAS and writer fencing remain open.

## Batch 16 lifecycle and session authorization (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. Toss/start use an exact-league READ COMMITTED transaction
with match -> account -> league -> membership -> sorted-team locks, current
assignment/session checks and atomic audits. Member role/status/removal commands
also compare the current locked Clerk mapping; role/status isolation is explicit.

Web end-match writes now proxy to canonical completion. The service validates
optional Player of the Match against an exact-league match-team player and
atomically audits result/award changes using the existing `man_of_match_id` and
`audit_logs` schema. Deploy matching web/service code and workspace artifacts;
old service code would ignore the optional award. Verify scoring-service audit
INSERT grants, real audit rollback, revocation/completion races and replay in
staging. Tests are mocked; no actual PostgreSQL behavior is certified here.

All five prior migrations remain unapplied; the deployment gate remains
default-off. Broader match CRUD/read/stream context, historical deletion policy,
team-manager races and reliable lifecycle event fan-out remain open.

## Batch 17 match management and active-league reads (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. Match metadata/cancel/stream commands now use READ
COMMITTED with existing match -> actor -> league -> membership -> sorted-team
-> tournament -> venue locks as needed, current owner/session checks and atomic
audits. Creation inserts a new match, without locking an existing match after
the actor. Reads/pickers and dashboard auxiliaries are explicitly tenant-scoped.

`deleteMatch` now cancels an unstarted scheduled fixture instead of hard-deleting
and cascading. It refuses lifecycle/scoring evidence, including legacy manual
scorecards; the row and assignments are retained. This is not a database-wide
history guarantee: existing team/player cascades and non-participating manual
scorecard writers remain to be audited. Reconcile those writers and lock order
before certifying concurrent edit/cancel/scoring/resource-delete behavior.

All five prior migrations remain unapplied and the release gate stays default-
off. Verify actual grants, audit INSERT/rollback, schema compatibility, real
two-session races, history-query performance/indexes and RLS in staging. Mocked
tests do not establish these database properties or deployed lifecycle fan-out.

## Batch 18 scorecard hierarchy and roster archival (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. The unused manual `saveScorecard` action is now a denied
compatibility stub, not a second direct scorecard writer. Existing rows remain;
there is no replacement manual import/correction endpoint. Full/innings scorecard
reads validate the current league and parent hierarchy, including correlated
innings scope for full batting/bowling reads.

Team/player deletion wrappers now perform owner-authorized archival using
READ COMMITTED and account -> league -> membership -> team -> player locks.
Player team-link drift is rejected after locks. Unfinished fixtures are checked
with plain reads after resources, never match locks that would reverse the
canonical scoring order. Team/player flags and archive audits are atomic;
identities, roster links and historical score data are not deleted. Other/admin
deletion paths and non-participating writers remain outside this guarantee.

All five prior migrations remain unapplied and the release gate stays default-
off. Verify real grants/audit rollback/RLS, hierarchy query execution/indexes,
and two-session archive/create/scoring/revocation acceptance before rollout.
Mocked call-order/SQL/render tests do not establish those database properties.
Archive is not a restore/purge/quota-release workflow; existing lists/quotas can
retain archived records. No broader team/player CRUD certification is claimed.

## Batch 19 — team/player and roster writer protocol (15 October 2026)

No new migration, remote SQL operation or deployment. `createTeam`, `updateTeam`,
`createPlayer`, `updatePlayer` and add/remove roster actions now use exact-active-
league READ COMMITTED transactions with current account/Clerk/membership and
owner/assigned-manager checks. Lock account -> league -> membership -> sorted
teams -> player. Both creates take an exclusive league lock before reading the
current plan/count and inserting; other operations share the league lock. Team
locks serialize participating roster joins and squad-capacity changes; player
team drift is rejected after locking. All records, including archived rows,
still consume quota/capacity. This is not a database-wide constraint.

Current toss/live/innings-break reads after resource locks block roster team/
status eligibility amendments during play; they do not take match locks after
accounts/resources. Scheduled fixtures remain amendable under this roster rule.
Audit/row writes are atomic; audits omit contact/profile/DOB values. Identity,
membership and historical score rows are not deleted. This adds no immutable XI,
restore, quota release, direct transfer, CAS or alternate scoring writer.

All five prior migrations remain unapplied; release gate stays default-off.
Before rollout, verify real two-session create limits, join/capacity races, player
team drift, roster versus toss/start/scoring/archive/revocation, deadlocks and
audit-failure rollback. Inspect actual grants, query plans, constraints and RLS;
mocked SQL/count/call-order tests do not prove these properties. Other/admin
writers and tournament/venue cascade paths still require protocol review.
Team/player read actions and core dashboard routes now use exact-active-league
context, scoped joins, explicit field projections, bounded pickers and current-
authority controls. Ordinary reads exclude contact/DOB/physical/biography/global
identity/creator fields; owner-only edit reads separate private profile data.
Team summaries use scoped database-side counts rather than per-row queries.
Archived rows remain historical; no restore/purge/quota release is introduced.
These are request-local authorization/projection checks, not read-versus-
revocation locks or database-wide privacy constraints. Team analytics and player
ID-card list/detail routes also now resolve the exact active league and tenant-
filter every child query.

All five prior migrations remain unapplied; release gate stays default-off.
Before rollout, verify real RLS/grants, scoped query plans/indexes, picker/list
performance and concurrent read/write behavior. Inspect actual constraints and
RLS; mocked SQL/projection/call-order tests do not prove these properties. Team
analytics, player ID-card list/detail paths were scoped in the Batch 20 follow-up;
the tournament delete path is now an archival (Batch 22) and fan-follow
mutations/reads are scoped to the exact active league and account UUID (Batch 23);
remaining tournament lifecycle/list/detail writers, venue/admin writers and
public/anonymous follow/publication paths remain the next source slice.

Registration review writers (create/approve/reject/withdraw/confirm-fee) now use
exact-active-league READ COMMITTED transactions with current account/Clerk/
membership and league checks. Lock order is account -> league -> membership ->
tournament -> team -> registration; tournament locks always precede registration
locks so approval cannot deadlock a concurrent registration. Approval locks the
tournament row and re-checks `maxTeams` capacity before linking the team; fee
confirmation inserts the payment and flips the fee state atomically. Creation
verifies a same-league active team, an open window/status, active tenant-scoped
squad members, the team squad limit and `(team, tournament)` uniqueness. Audits
omit squad lists, notes, fee references and account UUIDs; no refunds, slot
release, waitlist, restore or quota release is added. Review reads use explicit
projections (no payment reference or registered-by/approved-by UUIDs) and bounded
pages.

Tournament removal is now a locked, audited cancel/archival instead of a hard
delete. `deleteTournament` resolves the exact active league, checks
`tournament:delete` and, under READ COMMITTED, locks account -> league ->
membership -> tournament, re-checks the owner after the wait, refuses `live` and
already-archived tournaments and sets status `cancelled` with registration closed.
It never cascades: registrations, team links and match links are preserved (the
prior FK `DELETE`/`SET NULL` behaviour no longer runs) and it takes no match locks.
This is not a purge, refund, slot-release or restore workflow.

This is still not a database-wide constraint. Verify real two-session
create/approve capacity races, tournament/registration and tournament/archive
lock ordering, cascade absence, fee/status CAS and audit-failure rollback, plus
actual grants, query plans and RLS; mocked call-order tests do not prove these
properties.

Fan-follow writes/reads now resolve the exact active league, require the
`fan:follow` permission on an active membership, map the Clerk identity to the
account UUID and assert the target entity exists in that league; the client tenant
must equal the active league. This fixes a bug where the Clerk string was stored/
matched against the `fan_follows.user_id` UUID column, so team/player follow state
always read false. Inserts are idempotent via the `(userId, type, id)` unique index
(`onConflictDoNothing`); counts/state/list are tenant-scoped. This is not yet a
public/anonymous or cross-league follow experience and adds no owner-review audit,
rate limit or notification fan-out. Verify real RLS, the unique constraint, grants,
indexes and two-session follow races.

## Batch 24 — stats and scoring dashboard read scope (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. `dashboard/stats`, `dashboard/stats/compare` and
`dashboard/scoring` no longer use the primary-membership fallback (`getMyTenant`)
or redirect to league setup on an authorization failure. A new
`lib/league-reads.ts` resolves the exact active league, checks `stats:read` (both
stats routes) or `match:read` (scoring console) via `requirePermissionServer`,
maps Clerk → active account, then requires an active same-league membership whose
role holds the permission plus an active `tenants` row. A global role, tenant array
or primary membership never grants access.

Leaderboard reads inner-join `players` and `teams` with the same active-league
predicate as the scorecard filter, group by player, are bounded (1–50) with a
deterministic tiebreak and let query failures propagate instead of rendering an
empty board. The comparison roster is league-scoped and bounded (1–200);
`readPlayerComparison` scopes the player and every batting/bowling/fielding child
read to the active league and rejects a non-UUID id before SQL (previously the
child scorecard reads filtered by `playerId` only). The scoring console filters
and bounds matches (100 rows, +1 fetch to flag truncation) with SQL ordering and
resolves team names with a league-scoped `inArray` instead of an unscoped batch
lookup.

All five prior migrations remain unapplied; release gate stays default-off. These
are request-local authorization and projection checks — not read-versus-revocation
locks, database RLS or a public/anonymous experience. They are not certified for
export, cache or socket scoping. Before rollout, verify real RLS/grants and scoped
query plans/indexes on these read paths; mocked SQL/call-order and render tests do
not prove those database properties. Next source slice: remaining tournament
lifecycle/list/detail writers and venue/admin writers, then public/anonymous
follow, publication and notification boundaries.

## Batch 25 — tournament dashboard read scope (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. The tournament dashboard list and creator no longer use the
primary-membership fallback (`getMyTenant`) or redirect to league setup on an
authorization failure. A new `lib/tournament-reads.ts` provides
`readTournamentList(tenantId)`, and the Batch 24 context helper is renamed
`requireActiveLeagueContext` for reuse as a page-level gate. The list resolves the
exact active league with `tournament:read`, the creator with `tournament:create`;
both reject a global role, tenant array or primary membership.

The list is bounded (200 rows, +1 fetch to flag truncation) and orders
deterministically. Registered-team and match counts are aggregated with grouped
queries that carry the same tenant predicate as the list, so a foreign team or match
link cannot inflate a tournament's totals; the previous whole-league N+1 reads ran
child counts by `tournamentId` only. Resolution and query failures now propagate
instead of being swallowed into a fake empty list. The creator no longer receives a
primary-membership `tenantId` (it was unused; the create action resolves the league
server-side).

All five prior migrations remain unapplied; release gate stays default-off. These
are request-local authorization/projection checks — not database RLS, read-versus-
revocation locks or a public/anonymous experience, and not certified for export or
cache scoping. Before rollout, verify real RLS/grants and index support for the
grouped count queries; mocked SQL/call-order and render tests do not prove those
database properties. Next source slice: remaining tournament registration lifecycle
writers and venue/admin writers, then public/anonymous follow, publication and
notification boundaries.

## Batch 26 — locked tournament registration lifecycle (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. `openRegistration`/`closeRegistration` no longer call
`tournamentRepo.updateById`; a new `setTournamentRegistration` in
`lib/tournament-lifecycle.ts` performs the write in a READ COMMITTED transaction that
locks account → league → membership → tournament, rechecks the current owner after
the wait and writes an atomic minimal audit
(`TOURNAMENT_REGISTRATION_OPEN`/`TOURNAMENT_REGISTRATION_CLOSE`). The action wrappers
validate the id shape before the transaction.

Guards: an archived (`cancelled`) tournament can neither open nor close
registration; registration only opens for a `draft`/`registration` tournament
(refusing `live`/`completed`); closing keeps the current status and only clears
`registrationOpen`. The audit row and the status write share the transaction, so a
failing audit aborts the update. The permission gate (`tournament:manage_registrations`)
runs before the transaction and the owner role is rechecked under the lock. This is
not a purge, refund, slot-release or restore workflow.

All five prior migrations remain unapplied; release gate stays default-off. Before
rollout, verify real two-session open/close ordering against archive and registration
writes, audit rollback, lock deadlock freedom and RLS; mocked call-order/SQL tests do
not prove those database properties. Next source slice: remaining tournament
create/update writers and venue/admin writers, then public/anonymous follow,
publication and notification boundaries.

## Batch 27 — locked, audited tournament create/update (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. `createTournament`/`updateTournament` no longer call
`tournamentRepo.insert`/`updateWithLock`; a new `lib/tournament-writes.ts` performs
both in READ COMMITTED transactions that lock account → league → membership (and, for
update, the tournament row), recheck the current owner after the wait and write an
atomic minimal audit (`TOURNAMENT_CREATE`/`TOURNAMENT_UPDATE`). It shares
`lockOwnerContext` with the Batch 26 lifecycle writers, so all tournament writers use
one lock order.

Per-league unique slug: create and a renamed slug pre-check a `(tenant_id, slug)`
duplicate and map a PostgreSQL unique-violation (`23505`) race to the same friendly
error instead of a raw 500 — the unique constraint added by
`uniqueTenantSlug: UNIQUE (tenant_id, slug)` is the real guarantee. The update write
keeps the existing locked date/seed-order validation and legacy-rules preservation
inside its `prepare` callback. `persistenceValues` is now generic so a create input
keeps its required `name`/`format` through validation.

All five prior migrations remain unapplied; release gate stays default-off. Before
rollout, verify real two-session create/update/archive/registration lock ordering,
unique-index behaviour under concurrency, audit rollback, lock deadlock freedom and
RLS; mocked call-order/SQL tests do not prove those database properties. Next source
slice: remaining venue writers, settings/billing and other dashboard destinations,
then public/anonymous follow, publication and notification boundaries.

## Batch 28 — exact-league settings, billing and invoices (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. The settings, billing, invoices and invoice-detail pages no
longer resolve the league inline with `getMyTenant` + `getUserRoleForTenant` and
silently redirect to the dashboard on denial; they use the shared fail-closed
`requireActiveLeagueContext("settings:manage")` gate and read through new
`lib/league-settings-reads.ts`, which predicates every query on the resolved
`tenantId` and returns explicit projections (identity/branding, bounded invoice
history, a single invoice, bounded white-label requests). A missing/inactive league
or an insufficient role throws to the error boundary rather than redirecting.
`lib/invoices.ts` is removed (its `getMyInvoices` returned `[]` when no tenant was
found); the white-label writer shares the same active-league resolution and its
unused read action is replaced by the scoped reader. Note `getMyTenant` was already
membership-verified and request-tenant-first, so this is a protocol/fail-closed/
projection change rather than a cross-tenant fix.

This tightens `TEN-*`/`ISO-04` application-level scoping but does not change any RLS
policy or grant: these reads run as the application connection, so real isolation
still depends on the deployed policies and grants in the five unapplied migrations
(notably `20261012100136_league_membership_controls.sql`). All five prior migrations
remain unapplied; release gate stays default-off. Before rollout, verify real
per-tenant `tenant_branding`, `invoices` and `white_label_requests` visibility under
RLS and grants, and cross-league denial for a multi-league account; mocked readers do
not prove those database properties. Next source slice: tournament-detail
mutation-control gating and the remaining venue writers, then public/anonymous follow,
publication and notification boundaries.

## Batch 29 — permission-gated tournament-detail controls (15 October 2026)

No schema change, migration application, remote database inspection/write or
deployment occurred. `dashboard/tournaments/[id]/page.tsx` now resolves the exact
active league with `requireActiveLeagueContext("tournament:read")`, 404s a tournament
whose `tenantId` is not that league, and renders each mutation control only for a role
that holds its permission: edit (`tournament:update`), archive (`tournament:delete`),
registration open/close (`tournament:manage_registrations`) and the self-service
registration CTA (`registration:create`). The controls were previously rendered for
every viewer whose role held `tournament:read`, so a fan/player/coach/scorer (and a
team manager, for the league-administration controls) saw buttons whose actions then
denied. The underlying actions are unchanged and still re-check on write. This entry
also corrects the Batch 28 notes: `getMyTenant` was already membership-verified and
request-tenant-first, so Batch 28 was a protocol/fail-closed/projection change rather
than a cross-tenant fix.

This is application-level control-visibility alignment; it does not change any RLS
policy or grant, and per-role page rendering under a mocked context is not proof of
authenticated-browser or database-level authorization. All five prior migrations remain
unapplied; release gate stays default-off. Before rollout, verify page rendering and
action denial for each role against the deployed policies and grants. Next source
slice: the remaining venue writers and the registrations/new swallow-and-redirect, then
public/anonymous follow, publication and notification boundaries.

## Batch 30 — self-service registration form resolves the active league (15 October 2026)

No schema change, migration application, remote database inspection/write or deployment
occurred. `dashboard/registrations/new/page.tsx` no longer wraps the team, tournament and
player list actions in a `try/catch` that redirected to `/dashboard/league/setup` (even on
an authorization denial) and rendered empty pickers; it now resolves the exact active
league with `requireRegistrationReadContext("registration:create")` and reads bounded,
tenant-scoped pickers through the new `readRegistrationFormOptions(tenantId)` in
`lib/registration-reads.ts` (over-fetch 101/101/201, truncate to 100/100/200; teams
narrowed to `isActive`). An anonymous visit goes to `/`, and read or authorization
failures propagate to the error boundary instead of a silent redirect or an empty form.

This is an application-level read-scoping change; it does not change any RLS policy or
grant, and a mocked reader/database is not proof of authenticated-browser or
database-level authorization. All five prior migrations remain unapplied; release gate
stays default-off. Before rollout, verify each picker returns only the active league's
rows under the deployed policies and grants. Next source slice: the remaining venue
writers, then public/anonymous follow, publication and notification boundaries.

## Batch 31 — league venue (grounds/facilities) management (15 October 2026)

No schema change, migration application, remote database inspection/write or deployment
occurred. The existing `venues` table is now administered from the dashboard. RBAC adds
`venue:read` (every league role) and `venue:manage` (`super_admin`, `league_owner`), and the
sidebar/header expose a gated **Venues** item. `lib/venue-reads.ts` reads the exact active
league only — a bounded list (over-fetch 201, truncate to 200), a single venue and
active-venue options (over-fetch 201, truncate to 200) — rejecting a `super_admin`
membership and never falling back to an owned/default tenant. `lib/venue-writes.ts` creates,
updates and archives/restores a venue in one `read committed` transaction that locks account
→ league → membership → the venue row, rechecks the current authority after the wait, and
writes its audit in the same transaction; the per-league `UNIQUE(tenantId, name)` is
surfaced as one friendly error (pre-check plus `23505`). Archiving toggles `isActive` and
never deletes, because `matches.venueId` is `ON DELETE SET NULL`, so historical match links
survive.

This is an application-level scoping and write-path change; it does not change any RLS
policy or grant, and a mocked reader/database is not proof of PostgreSQL locking,
unique-constraint behavior or authenticated-browser/database-level authorization. All five
prior migrations remain unapplied; release gate stays default-off.

**Verification:** web 2,031 / 63 files, database 128 / 8 files, scoring service 193 / 8
suites; 2,352 passing tests (+38 over Batch 30). `tsc --noEmit` still reports only its
pre-existing unrelated errors. Before rollout, verify the venue readers return only the
active league's rows under the deployed policies and grants, and exercise the archive/restore
compare-and-set and duplicate-name mapping against real PostgreSQL. Next source slice: the
remaining catch-redirect cleanups, then public/anonymous follow, publication and notification
boundaries.

## Batch 32 — registration review queue reports access/read failures (15 October 2026)

No schema change, migration application, remote database inspection/write or deployment
occurred. `app/dashboard/registrations/page.tsx` previously wrapped
`requireRegistrationReadContext("registration:manage")` in a `try/catch` that redirected to
`/dashboard` on **any** error, so a tenant/membership/database failure looked like an ordinary
non-owner visit. It now calls the new non-throwing `resolveRegistrationReviewAccess()` in
`lib/registration-reads.ts`: this returns the review context only when the viewer holds
`registration:manage` in the exact active league, and `null` when they are not a league owner
(no active league, no active membership, a `super_admin`-only membership, or a missing
permission). Tenant, actor, membership and league lookups are not swallowed, so an
infrastructure failure throws and reaches the route's `error.tsx`. The queue read
(`readRegistrations`) was already uncaught.

This is an application-level failure-propagation change; it does not change any RLS policy or
grant, and a mocked reader/database is not proof of authenticated-browser or database-level
authorization. All five prior migrations remain unapplied; release gate stays default-off.

**Verification:** web 2,037 / 64 files, database 128 / 8 files, scoring service 193 / 8
suites; 2,358 passing tests (+6 over Batch 31). `tsc --noEmit` still reports only its
pre-existing unrelated errors. Before rollout, verify the review-queue access decision and its
error boundary against real PostgreSQL and an authenticated browser. Next source slice:
public/anonymous follow, publication and notification boundaries.

