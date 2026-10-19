-- Move room and team uniqueness to normalized claim tables so a full
-- tournament save can atomically swap assignments without transient conflicts.

CREATE TABLE IF NOT EXISTS round_room_claims (
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  physical_room_id text NOT NULL REFERENCES physical_rooms(id) ON DELETE RESTRICT,
  assignment_id text NOT NULL UNIQUE REFERENCES room_assignments(id) ON DELETE CASCADE,
  PRIMARY KEY (round_id, physical_room_id)
);

INSERT INTO round_room_claims(round_id, physical_room_id, assignment_id)
SELECT round_id, physical_room_id, id FROM room_assignments;

ALTER TABLE room_assignments
  DROP CONSTRAINT IF EXISTS room_assignments_round_id_physical_room_id_key;
DROP INDEX IF EXISTS room_assignments_team_favor_once_per_round;
DROP INDEX IF EXISTS room_assignments_team_contra_once_per_round;
DROP INDEX IF EXISTS room_assignments_team_favor_round_uq;
DROP INDEX IF EXISTS room_assignments_team_contra_round_uq;

CREATE OR REPLACE FUNCTION sync_round_room_claims()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM round_room_claims WHERE assignment_id = OLD.id;
    RETURN OLD;
  END IF;
  DELETE FROM round_room_claims WHERE assignment_id = NEW.id;
  INSERT INTO round_room_claims(round_id, physical_room_id, assignment_id)
  VALUES(NEW.round_id, NEW.physical_room_id, NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS room_assignments_sync_room_claim ON room_assignments;
CREATE TRIGGER room_assignments_sync_room_claim
AFTER INSERT OR UPDATE OF round_id, physical_room_id OR DELETE
ON room_assignments FOR EACH ROW EXECUTE FUNCTION sync_round_room_claims();
