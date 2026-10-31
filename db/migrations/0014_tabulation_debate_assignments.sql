-- F3/F4: persist the exact Tabulation debate identity assigned by the manager.
-- This table is written atomically with round publication; it does not infer identity
-- from team order, room names, or array positions.
CREATE TABLE IF NOT EXISTS tabulation_debate_assignments (
  tournament_id uuid NOT NULL REFERENCES tournament_identity(tournament_id) ON DELETE RESTRICT,
  tabulation_round_id text NOT NULL,
  tabulation_debate_id text NOT NULL CHECK (length(tabulation_debate_id) BETWEEN 1 AND 128),
  manager_round_id text NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  assignment_id text NOT NULL UNIQUE REFERENCES room_assignments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, tabulation_round_id, tabulation_debate_id),
  CONSTRAINT tabulation_debate_assignment_manager_round_uq UNIQUE (manager_round_id, assignment_id)
);

CREATE INDEX IF NOT EXISTS tabulation_debate_assignments_assignment_idx
  ON tabulation_debate_assignments (assignment_id);

COMMENT ON TABLE tabulation_debate_assignments IS
  'Reviewed, immutable identity bridge from a Tabulation-local debate to its canonical manager assignment.';
