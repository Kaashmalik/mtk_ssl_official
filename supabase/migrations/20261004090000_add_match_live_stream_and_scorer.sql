-- Live streaming + scorer assignment for matches
-- Additive only: adds columns, enum types, and indexes. Safe to re-run.

DO $$ BEGIN
  CREATE TYPE stream_source AS ENUM ('facebook', 'youtube', 'rtmp', 'webrtc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE stream_status AS ENUM ('idle', 'live', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS live_stream_url text,
  ADD COLUMN IF NOT EXISTS stream_source text,
  ADD COLUMN IF NOT EXISTS stream_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS scorer_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Convert the text columns onto the enum types (no-op if already converted).
-- The default must be dropped first: a text default cannot be cast implicitly.
ALTER TABLE matches
  ALTER COLUMN stream_status DROP DEFAULT;

ALTER TABLE matches
  ALTER COLUMN stream_source TYPE stream_source USING NULLIF(stream_source, '')::stream_source;

ALTER TABLE matches
  ALTER COLUMN stream_status TYPE stream_status USING stream_status::stream_status;

ALTER TABLE matches
  ALTER COLUMN stream_status SET DEFAULT 'idle'::stream_status;

CREATE INDEX IF NOT EXISTS idx_matches_scorer_id ON matches(scorer_id);
CREATE INDEX IF NOT EXISTS idx_matches_stream_status ON matches(stream_status) WHERE stream_status = 'live';