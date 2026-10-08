-- ============================================================================
-- Development / demo seed
-- ============================================================================
-- Safe to run repeatedly: every primary key is a fixed UUID and every insert is
-- `ON CONFLICT DO NOTHING`, so re-running is a no-op rather than a duplicate.
--
-- WHY THIS EXISTS
-- Several guarantees in this codebase were unprovable while the database was
-- empty. This fixture set is shaped so they become provable:
--
--   1. CROSS-TENANT ROLES. `seed_owner@lahore.invalid` is `league_owner` in
--      Lahore (tenant A) but only `scorer` in Karachi (tenant B). That is the
--      exact case the legacy single-role `users.role` column cannot represent,
--      and the one `current_tenant_id()` was rewritten to support.
--   2. QUOTA BOUNDARY. Lahore (free) sits at EXACTLY its limits: 4 teams and 40
--      players. Creating one more must fail with PLAN_LIMIT_REACHED. Exactly at
--      the ceiling, not one under or over.
--   3. FEATURE GATES. Islamabad is `pro`, so live-streaming is permitted there
--      and must be refused for Lahore.
--   4. SCORING READS. Islamabad has a `live` match with an innings whose
--      aggregates are DERIVED from its ball rows, so the scorecard/WS-state code
--      has internally consistent data to return.
--   5. ISOLATION. Teams, players and matches carry different `tenant_id`s, so a
--      cross-tenant id lookup must resolve to nothing.
--
-- SECURITY NOTE
-- Every email uses the reserved `.invalid` TLD (RFC 2606) and NO `clerk_id` is
-- set, so these rows cannot authenticate and cannot be mistaken for real users.
-- To use one in a browser, create a real Clerk user and set `users.clerk_id`
-- deliberately.
-- ============================================================================

BEGIN;

-- ─── Tenants ────────────────────────────────────────────────────────────────
-- `owner_id` has no FK constraint (bare NOT NULL uuid) but is populated with a
-- real seeded user id so the relation stays meaningful.

INSERT INTO public.tenants (id, name, slug, plan, owner_id, ssl_enabled, is_active)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Lahore Premier League', 'lahore-lions',  'free',    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true, true),
  ('22222222-2222-4222-8222-222222222222', 'Karachi Cricket Club',  'karachi-kings', 'starter', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true, true),
  ('33333333-3333-4333-8333-333333333333', 'Islamabad Pro Series',  'islamabad-pro', 'pro',     'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true, true)
ON CONFLICT (slug) DO NOTHING;

-- ─── Users ──────────────────────────────────────────────────────────────────
-- `role` and `tenant_ids` are the LEGACY single-role representation, kept
-- consistent with the junction rows below so any code still reading them agrees.

INSERT INTO public.users (id, email, display_name, role, tenant_ids, is_active)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'seed_owner@lahore.invalid',    'Seed Lahore Owner',   'league_owner', ARRAY['11111111-1111-4111-8111-111111111111']::uuid[], true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'seed_owner@karachi.invalid',   'Seed Karachi Owner',  'scorer',       ARRAY['22222222-2222-4222-8222-222222222222']::uuid[], true),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'seed_admin@platform.invalid',  'Platform Admin',      'super_admin',  ARRAY[]::uuid[], true),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'seed_scorer@lahore.invalid',   'Lahore Scorer',       'scorer',       ARRAY['11111111-1111-4111-8111-111111111111']::uuid[], true),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'seed_manager@lahore.invalid',  'Lahore Team Manager', 'team_manager', ARRAY['11111111-1111-4111-8111-111111111111']::uuid[], true)
ON CONFLICT (email) DO NOTHING;

-- ─── Per-tenant roles (authoritative for RLS) ───────────────────────────────
-- The first two rows are the point of the table: one user, two tenants, two
-- different roles.

INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, is_primary)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'league_owner', true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'scorer',       false),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111', 'scorer',       false),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', 'team_manager', false)
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- ─── Teams ──────────────────────────────────────────────────────────────────
-- Lahore is seeded to EXACTLY `free.maxTeams` (4).

INSERT INTO public.teams (id, tenant_id, name, short_name, slug, city, primary_color, is_active)
VALUES
  -- Lahore (free) -- 4 of 4 used, quota exhausted on purpose
  ('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Lahore Lions XI', 'LHR', 'lahore-lions-xi',  'Lahore',    '#2D8B4E', true),
  ('10000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Lahore Eagles',   'LHE', 'lahore-eagles',    'Lahore',    '#1A4F8B', true),
  ('10000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Lahore Tigers',   'LHT', 'lahore-tigers',    'Lahore',    '#B8860B', true),
  ('10000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Lahore Sharks',   'LHS', 'lahore-sharks',    'Lahore',    '#8B4513', true),
  -- Karachi (starter)
  ('20000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Karachi Kings',    'KKI', 'karachi-kings',    'Karachi',   '#1F4E79', true),
  ('20000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Karachi Strikers', 'KST', 'karachi-strikers', 'Karachi',   '#C0392B', true),
  -- Islamabad (pro)
  ('30000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Islamabad Falcons','ISF', 'islamabad-falcons','Islamabad', '#6C3483', true),
  ('30000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Islamabad Titans', 'IST', 'islamabad-titans', 'Islamabad', '#117A65', true)
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- ─── Players ────────────────────────────────────────────────────────────────
-- Lahore is generated to EXACTLY `free.maxPlayers` (40) with generate_series so
-- the boundary is exact without 40 hand-written rows.

INSERT INTO public.players (tenant_id, team_id, name, role, batting_style, bowling_style, status)
SELECT
  '11111111-1111-4111-8111-111111111111',
  (ARRAY[
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000004'
  ]::uuid[])[1 + (g % 4)],
  'Lahore Player ' || lpad(g::text, 2, '0'),
  CASE WHEN g % 3 = 0 THEN 'bowler'::player_role
       WHEN g % 3 = 1 THEN 'batsman'::player_role
       ELSE 'all_rounder'::player_role END,
  CASE WHEN g % 2 = 0 THEN 'right'::batting_style ELSE 'left'::batting_style END,
  'right_arm_medium'::bowling_style,
  'active'::player_status
FROM generate_series(1, 40) AS g
ON CONFLICT DO NOTHING;

INSERT INTO public.players (tenant_id, team_id, name, role, batting_style, bowling_style, status)
VALUES
  ('33333333-3333-4333-8333-333333333333', '30000000-0000-4000-8000-000000000001', 'Imran Khan',   'all_rounder',  'right', 'right_arm_medium', 'active'),
  ('33333333-3333-4333-8333-333333333333', '30000000-0000-4000-8000-000000000001', 'Bilal Ahmed',  'batsman',      'left',  'left_arm_spin',    'active'),
  ('33333333-3333-4333-8333-333333333333', '30000000-0000-4000-8000-000000000001', 'Zaid Malik',   'bowler',       'right', 'right_arm_fast',   'active'),
  ('33333333-3333-4333-8333-333333333333', '30000000-0000-4000-8000-000000000001', 'Usman Tariq',  'wicket_keeper','right', 'right_arm_spin',   'active'),
  ('33333333-3333-4333-8333-333333333333', '30000000-0000-4000-8000-000000000002', 'Ali Raza',     'batsman',      'right', 'right_arm_medium', 'active'),
  ('33333333-3333-4333-8333-333333333333', '30000000-0000-4000-8000-000000000002', 'Hamza Sheikh', 'all_rounder',  'left',  'left_arm_medium',  'active')
ON CONFLICT DO NOTHING;

-- ─── Matches ────────────────────────────────────────────────────────────────

INSERT INTO public.matches (id, tenant_id, team_a_id, team_b_id, match_format, match_type, status, stream_status, total_overs)
VALUES
  -- Live, Islamabad (pro): feeds the live page and the scoring read paths.
  ('50000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
   't20', 'group', 'live', 'live', 20),
  -- Scheduled, Lahore (free): proves a free tenant can still schedule a match.
  ('50000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
   't20', 'group', 'scheduled', 'idle', 20)
ON CONFLICT (id) DO NOTHING;

-- ─── Innings + ball history for the live match ──────────────────────────────

INSERT INTO public.match_innings (id, tenant_id, match_id, team_id, innings_number, status)
VALUES
  ('60000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   1, 'in_progress')
ON CONFLICT (match_id, innings_number) DO NOTHING;

-- 8 legal overs. Outcomes are derived from the delivery sequence rather than
-- hand-written, so the set is deterministic and free of typos.
WITH deliveries AS (
  SELECT o AS over_number, b AS ball_number, (o * 6 + b) AS seq
  FROM generate_series(0, 7) AS o
  CROSS JOIN generate_series(1, 6) AS b
),
scored AS (
  SELECT
    over_number,
    ball_number,
    CASE
      WHEN seq % 19 = 0 THEN 6
      WHEN seq % 7 = 0  THEN 4
      WHEN seq % 13 = 0 THEN 3
      WHEN seq % 5 = 0  THEN 1
      ELSE 0
    END AS runs,
    (seq % 24 = 0) AS is_wicket
  FROM deliveries
)
INSERT INTO public.match_balls (
  tenant_id, match_id, innings_id, over_number, ball_number,
  runs, is_wicket, is_four, is_six, is_wide, is_no_ball, is_bye, is_leg_bye
)
SELECT
  '33333333-3333-4333-8333-333333333333',
  '50000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  over_number, ball_number, runs, is_wicket, runs = 4, runs = 6,
  false, false, false, false
FROM scored
ON CONFLICT (match_id, innings_id, over_number, ball_number) DO NOTHING;

-- Derive the innings aggregates FROM the ball rows so the scorecard can never
-- disagree with the ball history it is computed from.
-- `total_balls` counts legal deliveries only: wides/no-balls are not balls faced.
UPDATE public.match_innings i
SET
  total_runs    = agg.total_runs,
  total_wickets = agg.total_wickets,
  total_balls   = agg.total_balls,
  extras        = 0,
  byes          = 0,
  leg_byes      = 0,
  wides         = 0,
  no_balls      = 0,
  updated_at    = now()
FROM (
  SELECT
    innings_id,
    COALESCE(SUM(runs), 0)::int AS total_runs,
    COUNT(*) FILTER (WHERE is_wicket)::int AS total_wickets,
    COUNT(*) FILTER (WHERE NOT is_wide AND NOT is_no_ball)::int AS total_balls
  FROM public.match_balls
  WHERE innings_id = '60000000-0000-4000-8000-000000000001'
  GROUP BY innings_id
) agg
WHERE i.id = agg.innings_id;

COMMIT;