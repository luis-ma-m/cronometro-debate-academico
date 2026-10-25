-- A scorecard must record exactly the judges assigned to its debate.
-- Deferred checks allow a transaction to replace the assignment and scorecard
-- judge sets together, while preventing a committed mismatch.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM scorecards sc
    WHERE COALESCE(
      (SELECT array_agg(aj.judge_id ORDER BY aj.judge_id) FROM assignment_judges aj WHERE aj.assignment_id=sc.assignment_id),
      ARRAY[]::text[]
    ) IS DISTINCT FROM COALESCE(
      (SELECT array_agg(sj.judge_id ORDER BY sj.judge_id) FROM scorecard_judges sj WHERE sj.scorecard_id=sc.id),
      ARRAY[]::text[]
    )
  ) THEN
    RAISE EXCEPTION 'existing scorecards do not match assigned judges; migration stopped'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_scorecard_judges_match_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM scorecards sc
    WHERE COALESCE(
      (SELECT array_agg(aj.judge_id ORDER BY aj.judge_id) FROM assignment_judges aj WHERE aj.assignment_id=sc.assignment_id),
      ARRAY[]::text[]
    ) IS DISTINCT FROM COALESCE(
      (SELECT array_agg(sj.judge_id ORDER BY sj.judge_id) FROM scorecard_judges sj WHERE sj.scorecard_id=sc.id),
      ARRAY[]::text[]
    )
  ) THEN
    RAISE EXCEPTION 'scorecard judges must exactly match assignment judges'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS assignment_judges_scorecard_consistency ON assignment_judges;
CREATE CONSTRAINT TRIGGER assignment_judges_scorecard_consistency
AFTER INSERT OR UPDATE OR DELETE ON assignment_judges
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_scorecard_judges_match_assignment();

DROP TRIGGER IF EXISTS scorecard_judges_assignment_consistency ON scorecard_judges;
CREATE CONSTRAINT TRIGGER scorecard_judges_assignment_consistency
AFTER INSERT OR UPDATE OR DELETE ON scorecard_judges
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_scorecard_judges_match_assignment();

DROP TRIGGER IF EXISTS scorecards_judges_consistency ON scorecards;
CREATE CONSTRAINT TRIGGER scorecards_judges_consistency
AFTER INSERT OR UPDATE OR DELETE ON scorecards
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_scorecard_judges_match_assignment();
