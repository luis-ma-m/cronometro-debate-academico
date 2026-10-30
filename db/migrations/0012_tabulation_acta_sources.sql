-- Append-only source history for Tabulation actas.
-- The manager scorecard remains a projection; this table preserves the full
-- source payload and rules snapshot, including judge ballots and joint actas.
CREATE TABLE IF NOT EXISTS tabulation_acta_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournament_identity(tournament_id) ON DELETE RESTRICT,
  assignment_id text NOT NULL REFERENCES room_assignments(id) ON DELETE RESTRICT,
  scorecard_id text REFERENCES scorecards(id) ON DELETE RESTRICT,
  source_mode text NOT NULL CHECK (source_mode IN ('judges', 'joint')),
  round_kind text NOT NULL CHECK (round_kind IN ('qualifying', 'elimination')),
  base_revision bigint NOT NULL CHECK (base_revision >= 0),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  source_payload jsonb NOT NULL
    CHECK (jsonb_typeof(source_payload) = 'object' AND pg_column_size(source_payload) <= 1048576),
  rules_snapshot jsonb NOT NULL CHECK (jsonb_typeof(rules_snapshot) = 'object'),
  operation_id text NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 8 AND 128),
  supersedes_source_id uuid,
  created_by text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tabulation_acta_source_assignment_id_uq UNIQUE (assignment_id, id),
  CONSTRAINT tabulation_acta_source_supersedes_fk
    FOREIGN KEY (assignment_id, supersedes_source_id)
    REFERENCES tabulation_acta_sources(assignment_id, id) ON DELETE RESTRICT,
  CONSTRAINT tabulation_acta_source_not_self_superseding_ck
    CHECK (supersedes_source_id IS NULL OR supersedes_source_id <> id),
  CONSTRAINT tabulation_acta_elimination_no_scorecard_ck
    CHECK (round_kind <> 'elimination' OR scorecard_id IS NULL)
);

-- A source version can be superseded only once: no branching history.
CREATE UNIQUE INDEX IF NOT EXISTS tabulation_acta_sources_supersedes_uq
  ON tabulation_acta_sources (supersedes_source_id)
  WHERE supersedes_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tabulation_acta_sources_assignment_history_idx
  ON tabulation_acta_sources (assignment_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS tabulation_acta_sources_tournament_idx
  ON tabulation_acta_sources (tournament_id, created_at DESC);

-- The head is a mutable pointer; source rows themselves are immutable.
CREATE TABLE IF NOT EXISTS tabulation_acta_heads (
  assignment_id text PRIMARY KEY REFERENCES room_assignments(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tabulation_acta_head_source_fk
    FOREIGN KEY (assignment_id, source_id)
    REFERENCES tabulation_acta_sources(assignment_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION enforce_tabulation_acta_source_scorecard_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scorecard_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM scorecards sc
    WHERE sc.id = NEW.scorecard_id AND sc.assignment_id = NEW.assignment_id
  ) THEN
    RAISE EXCEPTION 'Tabulation acta source scorecard must belong to its assignment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tabulation_acta_source_scorecard_assignment_check ON tabulation_acta_sources;
CREATE TRIGGER tabulation_acta_source_scorecard_assignment_check
BEFORE INSERT OR UPDATE OF assignment_id, scorecard_id ON tabulation_acta_sources
FOR EACH ROW EXECUTE FUNCTION enforce_tabulation_acta_source_scorecard_assignment();

CREATE OR REPLACE FUNCTION prevent_tabulation_acta_source_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabulation acta source history is append-only'
    USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS tabulation_acta_sources_immutable ON tabulation_acta_sources;
CREATE TRIGGER tabulation_acta_sources_immutable
BEFORE UPDATE OR DELETE ON tabulation_acta_sources
FOR EACH ROW EXECUTE FUNCTION prevent_tabulation_acta_source_mutation();
