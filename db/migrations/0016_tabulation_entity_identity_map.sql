-- F4: preserve the reviewed local→manager entity identity map with the round snapshot.
ALTER TABLE tabulation_round_metadata
  ADD COLUMN IF NOT EXISTS entity_id_map jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(entity_id_map) = 'object' AND pg_column_size(entity_id_map) <= 262144);

COMMENT ON COLUMN tabulation_round_metadata.entity_id_map IS
  'Reviewed Tabulation-local to manager entity IDs for teams, judges, speakers and venues; acta endpoints verify every target against assignment membership.';
