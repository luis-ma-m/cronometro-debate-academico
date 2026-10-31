-- F4: include the originating local tournament in the mapping's natural key.
ALTER TABLE tabulation_debate_assignments
  DROP CONSTRAINT tabulation_debate_assignments_pkey;

ALTER TABLE tabulation_debate_assignments
  ADD CONSTRAINT tabulation_debate_assignments_pkey
  PRIMARY KEY (tournament_id, tab_tournament_id, tabulation_round_id, tabulation_debate_id);

COMMENT ON CONSTRAINT tabulation_debate_assignments_pkey
  ON tabulation_debate_assignments IS
  'A local round/debate identity is unique only within its originating Tabulation tournament and manager tournament.';
