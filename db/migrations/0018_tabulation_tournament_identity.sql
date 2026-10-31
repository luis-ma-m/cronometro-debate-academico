-- F4: bind every debate mapping to the originating local Tabulation tournament.
ALTER TABLE tabulation_debate_assignments
  ADD COLUMN IF NOT EXISTS tab_tournament_id text NOT NULL DEFAULT '';

COMMENT ON COLUMN tabulation_debate_assignments.tab_tournament_id IS
  'Originating Tabulation-local tournament identity; acta writes must match this together with local round and debate IDs.';
