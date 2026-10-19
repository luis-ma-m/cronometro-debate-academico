-- Preserve historical scorecards by preventing reassignment of a scored debate.
-- The assignment row remains the stable identity referenced by the scorecard.

CREATE OR REPLACE FUNCTION prevent_scored_assignment_reassignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM scorecards sc WHERE sc.assignment_id = OLD.id)
     AND (
       NEW.round_id IS DISTINCT FROM OLD.round_id OR
       NEW.physical_room_id IS DISTINCT FROM OLD.physical_room_id OR
       NEW.team_favor_id IS DISTINCT FROM OLD.team_favor_id OR
       NEW.team_contra_id IS DISTINCT FROM OLD.team_contra_id
     ) THEN
    RAISE EXCEPTION 'a scored assignment cannot change its round, physical room or teams'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scored_assignment_identity_immutable ON room_assignments;
CREATE TRIGGER scored_assignment_identity_immutable
BEFORE UPDATE OF round_id, physical_room_id, team_favor_id, team_contra_id
ON room_assignments FOR EACH ROW EXECUTE FUNCTION prevent_scored_assignment_reassignment();
