-- Once a debate has a scorecard, its effective phase snapshot and judge set
-- become historical facts. The API avoids rewriting unchanged relations; these
-- guards also protect the invariant from direct SQL or future code paths.

CREATE OR REPLACE FUNCTION prevent_scored_assignment_judge_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_key text;
BEGIN
  assignment_key := CASE WHEN TG_OP = 'DELETE' THEN OLD.assignment_id ELSE NEW.assignment_id END;
  IF EXISTS (SELECT 1 FROM scorecards sc WHERE sc.assignment_id = assignment_key) THEN
    RAISE EXCEPTION 'judges of a scored assignment are immutable until its scorecard is removed'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS scored_assignment_judges_immutable ON assignment_judges;
CREATE TRIGGER scored_assignment_judges_immutable
BEFORE INSERT OR UPDATE OR DELETE ON assignment_judges
FOR EACH ROW EXECUTE FUNCTION prevent_scored_assignment_judge_changes();

CREATE OR REPLACE FUNCTION prevent_scored_assignment_phase_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_key text;
BEGIN
  assignment_key := CASE WHEN TG_OP = 'DELETE' THEN OLD.assignment_id ELSE NEW.assignment_id END;
  IF EXISTS (SELECT 1 FROM scorecards sc WHERE sc.assignment_id = assignment_key) THEN
    RAISE EXCEPTION 'phase snapshots of a scored assignment are immutable until its scorecard is removed'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS scored_assignment_phases_immutable ON assignment_phases;
CREATE TRIGGER scored_assignment_phases_immutable
BEFORE INSERT OR UPDATE OR DELETE ON assignment_phases
FOR EACH ROW EXECUTE FUNCTION prevent_scored_assignment_phase_changes();
