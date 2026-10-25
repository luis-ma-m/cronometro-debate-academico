-- Normalize incompatibility relationships into foreign-key-backed join tables.
-- Existing array values are migrated in place before the legacy columns are removed.

CREATE TABLE IF NOT EXISTS team_judge_incompatibilities (
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  judge_id text NOT NULL REFERENCES judges(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, judge_id)
);
CREATE INDEX IF NOT EXISTS team_judge_incompatibilities_judge_idx
  ON team_judge_incompatibilities (judge_id, team_id);

CREATE TABLE IF NOT EXISTS judge_incompatibilities (
  judge_id text NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  incompatible_judge_id text NOT NULL REFERENCES judges(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (judge_id, incompatible_judge_id),
  CHECK (judge_id <> incompatible_judge_id)
);

INSERT INTO team_judge_incompatibilities(team_id, judge_id)
SELECT t.id, unnest(t.incompatible_judge_ids)
FROM teams t;

INSERT INTO judge_incompatibilities(judge_id, incompatible_judge_id)
SELECT j.id, unnest(j.incompatible_judge_ids)
FROM judges j;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM judge_incompatibilities a
    WHERE NOT EXISTS (
      SELECT 1 FROM judge_incompatibilities b
      WHERE b.judge_id = a.incompatible_judge_id
        AND b.incompatible_judge_id = a.judge_id
    )
  ) THEN
    RAISE EXCEPTION 'existing judge incompatibilities are not reciprocal; migration stopped without dropping legacy columns'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE teams DROP COLUMN incompatible_judge_ids;
ALTER TABLE judges DROP COLUMN incompatible_judge_ids;

CREATE OR REPLACE FUNCTION enforce_reciprocal_judge_incompatibilities()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM judge_incompatibilities a
    WHERE NOT EXISTS (
      SELECT 1 FROM judge_incompatibilities b
      WHERE b.judge_id = a.incompatible_judge_id
        AND b.incompatible_judge_id = a.judge_id
    )
  ) THEN
    RAISE EXCEPTION 'judge incompatibilities must be reciprocal'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS judge_incompatibilities_reciprocal_check ON judge_incompatibilities;
CREATE CONSTRAINT TRIGGER judge_incompatibilities_reciprocal_check
AFTER INSERT OR UPDATE OR DELETE ON judge_incompatibilities
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_reciprocal_judge_incompatibilities();
