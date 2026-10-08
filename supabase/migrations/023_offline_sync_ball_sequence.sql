-- =============================================================================
-- 023: Offline sync support on match_balls
--
--   * ball_sequence : monotonic per-(match_id, innings_id) delivery ordinal.
--     Assigned server-side, independent of (over_number, ball_number)
--     coordinates. Replaces (over_number, ball_number) as the uniqueness key so
--     wide/no-ball extras can no longer collide with the next legal delivery.
--   * client_op_id  : client-supplied op id for idempotent bulk replay. The
--     partial unique index is the actual dedupe enforcement point (insert then
--     catch the unique violation), NOT a check-then-insert guard.
--
-- SAFETY GATE: the old UNIQUE(match_id, innings_id, over_number, ball_number)
-- is dropped ONLY after the backfill is proven consistent (no NULLs, no
-- duplicates within an innings, contiguous 1..n). If any existing ball_sequence
-- data is present it is validated, never silently re-numbered; any
-- inconsistency aborts the whole migration via RAISE EXCEPTION.
--
-- Transactionality: destructive/data-changing steps (backfill, gate, constraint
-- drop) live inside a single atomic DO statement, so a RAISE aborts them in ANY
-- runner. The installed Supabase CLI (v2.58.5) additionally wraps each
-- migration file in a transaction (verified on scratch: an aborted migration
-- leaves no column residue), so the entire file is atomic under `supabase db
-- push` / `supabase db reset`.
-- =============================================================================

-- 0) Global sequence used ONLY as a transition safety net so legacy writers
--    that do not yet send ball_sequence get a value instead of a collision at
--    NULL. The scoring engine always overrides it with real contiguous
--    per-innings values (MAX+1). setval() below parks the sequence past the
--    backfilled range.
CREATE SEQUENCE IF NOT EXISTS match_balls_ball_sequence_seq;

-- 1) Columns ---------------------------------------------------------------
-- Ball_sequence is added NULLABLE on purpose: a NOT NULL DEFAULT nextval() at
-- ADD COLUMN time would immediately stamp every existing row with a global
-- sequence number and defeat the "has this table been sequenced already?"
-- detection on a non-empty table. The default + NOT NULL are applied only
-- AFTER the gated backfill has proven the key consistent.
ALTER TABLE match_balls
  ADD COLUMN IF NOT EXISTS ball_sequence integer,
  ADD COLUMN IF NOT EXISTS client_op_id text;

-- 2) Backfill / validate gated on existing data ----------------------------
DO $migration$
DECLARE
  any_existing  boolean;
  inconsistent  bigint := 0;
  cname         text;
BEGIN
  -- (a) Has anything been written with a real sequence before this migration?
  --     NULL = untouched pre-migration rows (or an empty table). After 023 has
  --     run once, ball_sequence is NOT NULL, so a re-run takes the
  --     validate-never-renumber path below.
  SELECT EXISTS (
    SELECT 1 FROM match_balls WHERE ball_sequence IS NOT NULL
  ) INTO any_existing;

  IF NOT any_existing THEN
    -- Fresh authoritative backfill: contiguous 1..n per (match_id, innings_id),
    -- deterministic ordering: delivery order = created_at, then (over_number,
    -- ball_number) to disambiguate same-millisecond ties (id is a UUID v7 and
    -- is only the final tie-breaker). Only NULL rows are touched.
    UPDATE match_balls m
       SET ball_sequence = x.rn
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY match_id, innings_id
                 ORDER BY created_at ASC, over_number ASC, ball_number ASC, id ASC
               ) AS rn
          FROM match_balls
      ) x
     WHERE m.id = x.id
       AND m.ball_sequence IS NULL;
  END IF;

  -- (b) HARD GATE. Prove the key is safe BEFORE touching the old unique
  --     constraint. Any NULL, duplicate, not-1-based, or gapped partition
  --     aborts with the count; nothing is dropped, nothing is re-numbered.
  WITH agg AS (
    SELECT match_id, innings_id,
           COUNT(*)                      AS cnt,
           COUNT(ball_sequence)          AS not_null_ct,
           COUNT(DISTINCT ball_sequence) AS distinct_ct,
           MIN(ball_sequence)            AS mn,
           MAX(ball_sequence)            AS mx
      FROM match_balls
     GROUP BY match_id, innings_id
  )
  SELECT COUNT(*) INTO inconsistent
    FROM agg
   WHERE cnt <> not_null_ct      -- NULLs left behind
      OR cnt <> distinct_ct      -- duplicate sequence in one innings
      OR mx  <> cnt              -- gap at the top
      OR mn  <> 1;               -- not 1-based / gap at the bottom

  IF inconsistent > 0 THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: match_balls.ball_sequence inconsistent in % innings (NULL, duplicate, or non-contiguous 1..n per innings). Inspect, fix manually, then re-run; existing data was NOT modified.',
      inconsistent;
  END IF;

  -- (c) Park the transition sequence past the backfilled range so a legacy
  --     writer cannot draw a value that collides with backfilled rows.
  PERFORM setval(
    'match_balls_ball_sequence_seq',
    GREATEST((SELECT COALESCE(MAX(ball_sequence), 0) FROM match_balls), 0) + 1,
    false
  );

  -- (d) Drop the deprecated unique constraint regardless of its generated
  --     name (it was created as an anonymous inline constraint in 002).
  --     Set-equality on the resolved attnums (@> and <@ are order-independent
  --     array-contains on real pg_attribute attnums), so the exact 4-column
  --     constraint is matched no matter how the columns are ordered in the
  --     constraint definition.
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'match_balls'::regclass
     AND contype   = 'u'
     AND conkey    @> ARRAY(
           SELECT attnum FROM pg_attribute
             WHERE attrelid = 'match_balls'::regclass
               AND attname IN ('match_id', 'innings_id', 'over_number', 'ball_number')
         )::smallint[]
     AND conkey    <@ ARRAY(
           SELECT attnum FROM pg_attribute
             WHERE attrelid = 'match_balls'::regclass
               AND attname IN ('match_id', 'innings_id', 'over_number', 'ball_number')
         )::smallint[];

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE match_balls DROP CONSTRAINT %I', cname);
  END IF;
END
$migration$;

-- 3) Finalise the column (safe to run even in a non-transactional runner: the
--    gate already proved there are no NULLs, so SET NOT NULL succeeds; on an
--    aborted gate it fails loudly instead of silently corrupting).
ALTER TABLE match_balls
  ALTER COLUMN ball_sequence SET DEFAULT nextval('match_balls_ball_sequence_seq'),
  ALTER COLUMN ball_sequence SET NOT NULL;

-- 4) New uniqueness + dedupe enforcement ----------------------------------
-- Unique indexes (not named constraints) so the whole migration is idempotent:
-- re-running after the first apply is a no-op. Unique indexes enforce the same
-- integrity and are valid targets for ON CONFLICT inference.
CREATE UNIQUE INDEX IF NOT EXISTS uqx_match_balls_innings_sequence
  ON match_balls (match_id, innings_id, ball_sequence);

-- Partial unique index is THE idempotency enforcement mechanism: the engine
-- inserts, catches the unique violation, and fetches the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS uqx_match_balls_client_op
  ON match_balls (match_id, client_op_id)
  WHERE client_op_id IS NOT NULL;

-- 5) Read-path index on the (now non-unique) coordinate columns. Already
--    exists as idx_match_balls_over since 002 — kept untouched on purpose for
--    scorecard / wagon-wheel / timeline reads that filter by over+ball.
--    (No DDL here; nothing to change.)