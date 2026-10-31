-- F4: ensure a saved chair reference always points to a manager judge.
ALTER TABLE tabulation_debate_assignments
  ADD CONSTRAINT tabulation_debate_assignments_chair_judge_fk
  FOREIGN KEY (chair_judge_id) REFERENCES judges(id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT tabulation_debate_assignments_chair_judge_fk
  ON tabulation_debate_assignments IS
  'The chair stored for an official Tabulation debate must remain a manager judge.';
