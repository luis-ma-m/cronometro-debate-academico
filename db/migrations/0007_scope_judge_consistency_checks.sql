-- Scope deferred judge consistency checks to the affected scorecard instead
-- of rescanning all scorecards for every row-level trigger invocation.

CREATE OR REPLACE FUNCTION enforce_scorecard_judges_match_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_scorecard_id text;
  target_assignment_id text;
  assigned_judges text[];
  recorded_judges text[];
BEGIN
  IF TG_TABLE_NAME = 'assignment_judges' THEN
    target_assignment_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.assignment_id ELSE NEW.assignment_id END;
    SELECT id INTO target_scorecard_id FROM scorecards WHERE assignment_id = target_assignment_id;
  ELSIF TG_TABLE_NAME = 'scorecard_judges' THEN
    target_scorecard_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.scorecard_id ELSE NEW.scorecard_id END;
  ELSE
    target_scorecard_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  END IF;

  IF target_scorecard_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT assignment_id INTO target_assignment_id
  FROM scorecards WHERE id = target_scorecard_id;
  IF target_assignment_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(judge_id ORDER BY judge_id) INTO assigned_judges
  FROM assignment_judges WHERE assignment_id = target_assignment_id;
  SELECT array_agg(judge_id ORDER BY judge_id) INTO recorded_judges
  FROM scorecard_judges WHERE scorecard_id = target_scorecard_id;

  IF COALESCE(assigned_judges, ARRAY[]::text[]) IS DISTINCT FROM
     COALESCE(recorded_judges, ARRAY[]::text[]) THEN
    RAISE EXCEPTION 'scorecard judges must exactly match assignment judges'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
