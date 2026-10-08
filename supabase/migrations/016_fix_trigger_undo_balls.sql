-- Fix apply_scoring_event trigger function to update current_over and current_ball on ball_undone event type
CREATE OR REPLACE FUNCTION apply_scoring_event()
RETURNS TRIGGER AS $$
DECLARE
  proj RECORD;
  ball_runs INTEGER;
  ball_wickets INTEGER;
  ball_balls INTEGER;
  ball_extras INTEGER;
  new_total_balls INTEGER;
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
    
    new_total_balls := GREATEST(0, proj.total_balls - ball_balls);
    
    UPDATE scorecard_projections SET
      total_runs = GREATEST(0, total_runs - ball_runs),
      total_wickets = GREATEST(0, total_wickets - ball_wickets),
      total_balls = new_total_balls,
      current_over = new_total_balls / 6,
      current_ball = new_total_balls % 6,
      last_event_sequence = NEW.sequence_number,
      updated_at = NOW()
    WHERE innings_id = NEW.aggregate_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
