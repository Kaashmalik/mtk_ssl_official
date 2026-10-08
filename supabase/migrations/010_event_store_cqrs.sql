-- CQRS Event Store Schema for Scoring
-- Immutable ball-by-ball log for audit trail and event sourcing

CREATE TYPE event_type AS ENUM (
  'ball_recorded',
  'ball_undone',
  'innings_started',
  'innings_completed',
  'match_started',
  'match_completed',
  'player_substituted',
  'penalty_awarded'
);

CREATE TABLE scoring_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  innings_id UUID,
  event_type event_type NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  aggregate_id UUID NOT NULL, -- match_id for match-level events, innings_id for innings
  sequence_number BIGINT NOT NULL, -- strict ordering within aggregate
  payload JSONB NOT NULL, -- immutable event data
  metadata JSONB, -- scorer info, device, timestamp precision
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (aggregate_id, sequence_number)
);

-- Partition by match for massive scale (10M+ events/month)
CREATE INDEX idx_scoring_events_match ON scoring_events(match_id, sequence_number);
CREATE INDEX idx_scoring_events_aggregate ON scoring_events(aggregate_id, sequence_number);
CREATE INDEX idx_scoring_events_type ON scoring_events(event_type, created_at);
CREATE INDEX idx_scoring_events_tenant ON scoring_events(tenant_id, created_at);

-- GIN index for JSONB payload queries (e.g., find all sixes)
CREATE INDEX idx_scoring_events_payload ON scoring_events USING GIN (payload jsonb_path_ops);

-- Projection / Read Model: materialized scorecard
CREATE TABLE scorecard_projections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  innings_id UUID NOT NULL,
  innings_number INTEGER NOT NULL,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  
  -- Aggregates (fast read model)
  total_runs INTEGER DEFAULT 0 NOT NULL,
  total_wickets INTEGER DEFAULT 0 NOT NULL,
  total_balls INTEGER DEFAULT 0 NOT NULL,
  total_extras INTEGER DEFAULT 0 NOT NULL,
  wides INTEGER DEFAULT 0 NOT NULL,
  no_balls INTEGER DEFAULT 0 NOT NULL,
  byes INTEGER DEFAULT 0 NOT NULL,
  leg_byes INTEGER DEFAULT 0 NOT NULL,
  
  -- Current state
  current_over INTEGER DEFAULT 0 NOT NULL,
  current_ball INTEGER DEFAULT 0 NOT NULL,
  
  -- Event store position (for consistency)
  last_event_sequence BIGINT NOT NULL DEFAULT 0,
  
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  UNIQUE (match_id, innings_id)
);

CREATE INDEX idx_scorecard_projections_match ON scorecard_projections(match_id);

-- Function: apply scoring event and update projection atomically
CREATE OR REPLACE FUNCTION apply_scoring_event()
RETURNS TRIGGER AS $$
DECLARE
  proj RECORD;
  ball_runs INTEGER;
  ball_wickets INTEGER;
  ball_balls INTEGER;
  ball_extras INTEGER;
BEGIN
  -- Skip if projection already at this sequence
  SELECT * INTO proj FROM scorecard_projections 
  WHERE innings_id = NEW.aggregate_id 
  FOR UPDATE SKIP LOCKED;
  
  IF proj IS NULL THEN
    RETURN NEW;
  END IF;
  
  IF NEW.sequence_number <= proj.last_event_sequence THEN
    RETURN NEW; -- already applied
  END IF;
  
  IF NEW.event_type = 'ball_recorded' THEN
    ball_runs := COALESCE((NEW.payload->>'runs')::INTEGER, 0);
    ball_wickets := CASE WHEN (NEW.payload->>'is_wicket')::BOOLEAN THEN 1 ELSE 0 END;
    ball_balls := CASE WHEN NOT COALESCE((NEW.payload->>'is_wide')::BOOLEAN, false) 
                        AND NOT COALESCE((NEW.payload->>'is_no_ball')::BOOLEAN, false) 
                       THEN 1 ELSE 0 END;
    ball_extras := ball_runs - COALESCE((NEW.payload->>'batsman_runs')::INTEGER, ball_runs);
    
    UPDATE scorecard_projections SET
      total_runs = total_runs + ball_runs,
      total_wickets = total_wickets + ball_wickets,
      total_balls = total_balls + ball_balls,
      total_extras = total_extras + GREATEST(ball_extras, 0),
      wides = wides + CASE WHEN (NEW.payload->>'is_wide')::BOOLEAN THEN 1 ELSE 0 END,
      no_balls = no_balls + CASE WHEN (NEW.payload->>'is_no_ball')::BOOLEAN THEN 1 ELSE 0 END,
      byes = byes + CASE WHEN (NEW.payload->>'is_bye')::BOOLEAN THEN ball_runs ELSE 0 END,
      leg_byes = leg_byes + CASE WHEN (NEW.payload->>'is_leg_bye')::BOOLEAN THEN ball_runs ELSE 0 END,
      current_over = (total_balls + ball_balls) / 6,
      current_ball = (total_balls + ball_balls) % 6,
      last_event_sequence = NEW.sequence_number,
      updated_at = NOW()
    WHERE innings_id = NEW.aggregate_id;
    
  ELSIF NEW.event_type = 'ball_undone' THEN
    ball_runs := COALESCE((NEW.payload->>'runs')::INTEGER, 0);
    ball_wickets := CASE WHEN (NEW.payload->>'is_wicket')::BOOLEAN THEN 1 ELSE 0 END;
    ball_balls := CASE WHEN NOT COALESCE((NEW.payload->>'is_wide')::BOOLEAN, false) 
                        AND NOT COALESCE((NEW.payload->>'is_no_ball')::BOOLEAN, false) 
                       THEN 1 ELSE 0 END;
    
    UPDATE scorecard_projections SET
      total_runs = GREATEST(0, total_runs - ball_runs),
      total_wickets = GREATEST(0, total_wickets - ball_wickets),
      total_balls = GREATEST(0, total_balls - ball_balls),
      last_event_sequence = NEW.sequence_number,
      updated_at = NOW()
    WHERE innings_id = NEW.aggregate_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_apply_scoring_event
  AFTER INSERT ON scoring_events
  FOR EACH ROW
  EXECUTE FUNCTION apply_scoring_event();

-- RLS
ALTER TABLE scoring_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_events ON scoring_events USING (tenant_id = current_setting('app.current_tenant')::UUID);
