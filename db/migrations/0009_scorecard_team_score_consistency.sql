-- A scorecard must contain exactly one team-score row for each of its
-- two assigned teams and no scores for unrelated teams.

CREATE OR REPLACE FUNCTION enforce_scorecard_team_score_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE favor_team text; contra_team text;
BEGIN
  SELECT team_favor_id, team_contra_id INTO favor_team, contra_team
  FROM scorecards WHERE id = NEW.scorecard_id;
  IF favor_team IS NULL OR contra_team IS NULL
     OR NEW.team_id NOT IN (favor_team, contra_team)
     OR favor_team = contra_team THEN
    RAISE EXCEPTION 'team score must belong to one of the two scorecard teams'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scorecard_team_score_membership_check ON scorecard_team_scores;
CREATE TRIGGER scorecard_team_score_membership_check
BEFORE INSERT OR UPDATE ON scorecard_team_scores
FOR EACH ROW EXECUTE FUNCTION enforce_scorecard_team_score_membership();

CREATE OR REPLACE FUNCTION enforce_scorecard_has_both_team_scores()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_scorecard_id text;
  favor_team text;
  contra_team text;
  score_count integer;
  favor_count integer;
  contra_count integer;
BEGIN
  IF TG_TABLE_NAME = 'scorecard_team_scores' THEN
    target_scorecard_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.scorecard_id ELSE NEW.scorecard_id END;
  ELSE
    target_scorecard_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  END IF;
  SELECT team_favor_id, team_contra_id INTO favor_team, contra_team
  FROM scorecards WHERE id = target_scorecard_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*),
         count(*) FILTER (WHERE team_id = favor_team),
         count(*) FILTER (WHERE team_id = contra_team)
  INTO score_count, favor_count, contra_count
  FROM scorecard_team_scores WHERE scorecard_id = target_scorecard_id;

  IF favor_team IS NULL OR contra_team IS NULL OR favor_team = contra_team
     OR score_count <> 2 OR favor_count <> 1 OR contra_count <> 1 THEN
    RAISE EXCEPTION 'scorecard must contain exactly one score for each assigned team'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS scorecards_both_team_scores_check ON scorecards;
CREATE CONSTRAINT TRIGGER scorecards_both_team_scores_check
AFTER INSERT OR UPDATE OR DELETE ON scorecards
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_scorecard_has_both_team_scores();

DROP TRIGGER IF EXISTS scorecard_team_scores_both_teams_check ON scorecard_team_scores;
CREATE CONSTRAINT TRIGGER scorecard_team_scores_both_teams_check
AFTER INSERT OR UPDATE OR DELETE ON scorecard_team_scores
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_scorecard_has_both_team_scores();
