-- Integrity hardening for cross-row invariants.
-- Applied after 0001; does not import or delete application data.

-- A team can be on either side of a single debate in a round, but never in
-- two assignments regardless of whether it is favor or contra.
CREATE UNIQUE INDEX IF NOT EXISTS room_assignments_team_favor_round_uq
  ON room_assignments (round_id, team_favor_id) WHERE team_favor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS room_assignments_team_contra_round_uq
  ON room_assignments (round_id, team_contra_id) WHERE team_contra_id IS NOT NULL;

-- Store round_id on assignment_judges so PostgreSQL itself can enforce that a
-- judge is only assigned once per round. The trigger copies the authoritative
-- round from room_assignments and rejects mismatched client-supplied values.
ALTER TABLE assignment_judges ADD COLUMN IF NOT EXISTS round_id text;
UPDATE assignment_judges aj
SET round_id = ra.round_id
FROM room_assignments ra
WHERE ra.id = aj.assignment_id AND aj.round_id IS NULL;
ALTER TABLE assignment_judges ALTER COLUMN round_id SET NOT NULL;
ALTER TABLE assignment_judges
  ADD CONSTRAINT assignment_judges_round_fk
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS assignment_judges_one_room_per_round_uq
  ON assignment_judges (round_id, judge_id);

CREATE OR REPLACE FUNCTION sync_assignment_judge_round()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_round text;
BEGIN
  SELECT round_id INTO assignment_round
  FROM room_assignments WHERE id = NEW.assignment_id;
  IF assignment_round IS NULL THEN
    RAISE EXCEPTION 'assignment % does not exist', NEW.assignment_id
      USING ERRCODE = '23503';
  END IF;
  IF NEW.round_id IS NOT NULL AND NEW.round_id <> assignment_round THEN
    RAISE EXCEPTION 'judge assignment round does not match room assignment'
      USING ERRCODE = '23514';
  END IF;
  NEW.round_id := assignment_round;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS assignment_judges_sync_round ON assignment_judges;
CREATE TRIGGER assignment_judges_sync_round
BEFORE INSERT OR UPDATE OF assignment_id, round_id ON assignment_judges
FOR EACH ROW EXECUTE FUNCTION sync_assignment_judge_round();


-- A normalized claim table enforces team uniqueness across both sides,
-- including concurrent writes. It is the relational equivalent of a unique
-- (round_id, team_id) constraint regardless of side.
CREATE TABLE IF NOT EXISTS round_team_claims (
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  assignment_id text NOT NULL REFERENCES room_assignments(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('favor', 'contra')),
  PRIMARY KEY (round_id, team_id),
  UNIQUE (assignment_id, side)
);
INSERT INTO round_team_claims (round_id, team_id, assignment_id, side)
SELECT round_id, team_favor_id, id, 'favor'
FROM room_assignments WHERE team_favor_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO round_team_claims (round_id, team_id, assignment_id, side)
SELECT round_id, team_contra_id, id, 'contra'
FROM room_assignments WHERE team_contra_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION sync_round_team_claims()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM round_team_claims WHERE assignment_id = OLD.id;
    RETURN OLD;
  END IF;

  DELETE FROM round_team_claims WHERE assignment_id = NEW.id;
  IF NEW.team_favor_id IS NOT NULL THEN
    INSERT INTO round_team_claims (round_id, team_id, assignment_id, side)
    VALUES (NEW.round_id, NEW.team_favor_id, NEW.id, 'favor');
  END IF;
  IF NEW.team_contra_id IS NOT NULL THEN
    INSERT INTO round_team_claims (round_id, team_id, assignment_id, side)
    VALUES (NEW.round_id, NEW.team_contra_id, NEW.id, 'contra');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS room_assignments_team_once_per_round ON room_assignments;
CREATE TRIGGER room_assignments_team_once_per_round
AFTER INSERT OR UPDATE OF round_id, team_favor_id, team_contra_id OR DELETE
ON room_assignments FOR EACH ROW EXECUTE FUNCTION sync_round_team_claims();

-- Ensure the active-round pointer and the single-active-round marker cannot
-- silently disagree after a transaction.
CREATE OR REPLACE FUNCTION enforce_active_round_pointer()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pointed_round text;
BEGIN
  SELECT active_round_id INTO pointed_round FROM tournament_settings WHERE id = 1;
  IF pointed_round IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rounds WHERE id = pointed_round AND is_active = true
  ) THEN
    RAISE EXCEPTION 'active_round_id must point to the active round'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS rounds_active_pointer_check ON rounds;
CREATE CONSTRAINT TRIGGER rounds_active_pointer_check
AFTER INSERT OR UPDATE OF is_active ON rounds
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_active_round_pointer();
DROP TRIGGER IF EXISTS settings_active_pointer_check ON tournament_settings;
CREATE CONSTRAINT TRIGGER settings_active_pointer_check
AFTER INSERT OR UPDATE OF active_round_id ON tournament_settings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_active_round_pointer();

-- Keep scorecard round/teams consistent with its assignment at the database
-- boundary. The API still performs user-facing validation in its transaction.
CREATE OR REPLACE FUNCTION enforce_scorecard_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_round text; favor_team text; contra_team text;
BEGIN
  SELECT round_id, team_favor_id, team_contra_id
    INTO assignment_round, favor_team, contra_team
  FROM room_assignments WHERE id = NEW.assignment_id;
  IF assignment_round IS NULL THEN
    RAISE EXCEPTION 'scorecard assignment does not exist'
      USING ERRCODE = '23503';
  END IF;
  IF NEW.round_id <> assignment_round
     OR NEW.team_favor_id <> favor_team
     OR NEW.team_contra_id <> contra_team
     OR favor_team IS NULL OR contra_team IS NULL THEN
    RAISE EXCEPTION 'scorecard must match the assigned round and teams'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scorecards_assignment_consistency ON scorecards;
CREATE TRIGGER scorecards_assignment_consistency
BEFORE INSERT OR UPDATE OF assignment_id, round_id, team_favor_id, team_contra_id
ON scorecards FOR EACH ROW EXECUTE FUNCTION enforce_scorecard_assignment();

-- Scorecards cannot reference a judge outside the assignment or a speaker
-- whose team is not one of the two teams in the scorecard.
CREATE OR REPLACE FUNCTION enforce_scorecard_judge_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM scorecards sc
    JOIN assignment_judges aj
      ON aj.assignment_id = sc.assignment_id AND aj.judge_id = NEW.judge_id
    WHERE sc.id = NEW.scorecard_id
  ) THEN
    RAISE EXCEPTION 'scorecard judge must be assigned to its room'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scorecard_judges_assignment_check ON scorecard_judges;
CREATE TRIGGER scorecard_judges_assignment_check
BEFORE INSERT OR UPDATE ON scorecard_judges
FOR EACH ROW EXECUTE FUNCTION enforce_scorecard_judge_assignment();

CREATE OR REPLACE FUNCTION enforce_scorecard_speaker_team()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM scorecards sc
    JOIN speakers sp ON sp.id = NEW.speaker_id AND sp.team_id = NEW.team_id
    JOIN scorecard_team_scores ts ON ts.scorecard_id = sc.id AND ts.team_id = NEW.team_id
    WHERE sc.id = NEW.scorecard_id
  ) THEN
    RAISE EXCEPTION 'speaker must belong to one of the scorecard teams'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scorecard_speaker_team_check ON scorecard_speaker_scores;
CREATE TRIGGER scorecard_speaker_team_check
BEFORE INSERT OR UPDATE ON scorecard_speaker_scores
FOR EACH ROW EXECUTE FUNCTION enforce_scorecard_speaker_team();
