-- Keep historical tournament identities addressable after the singleton pointer advances.
CREATE TABLE IF NOT EXISTS tournament_identity_registry (
  tournament_id uuid PRIMARY KEY,
  generation bigint NOT NULL CHECK (generation >= 1),
  tournament_name text NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
INSERT INTO tournament_identity_registry(tournament_id, generation, tournament_name)
SELECT ti.tournament_id, ti.generation, ts.tournament_name
FROM tournament_identity ti JOIN tournament_settings ts ON ts.id = 1
ON CONFLICT (tournament_id) DO NOTHING;

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.conrelid::regclass AS table_name, c.conname
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.confrelid = 'tournament_identity'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.table_name, item.conname);
  END LOOP;
END $$;

ALTER TABLE tournament_settings ADD CONSTRAINT tournament_settings_registry_fk
  FOREIGN KEY (tournament_id) REFERENCES tournament_identity_registry(tournament_id) ON DELETE RESTRICT;
ALTER TABLE tabulation_settings ADD CONSTRAINT tabulation_settings_registry_fk
  FOREIGN KEY (tournament_id) REFERENCES tournament_identity_registry(tournament_id) ON DELETE RESTRICT;
ALTER TABLE tabulation_acta_sources ADD CONSTRAINT tabulation_acta_sources_registry_fk
  FOREIGN KEY (tournament_id) REFERENCES tournament_identity_registry(tournament_id) ON DELETE RESTRICT;
ALTER TABLE tabulation_debate_assignments ADD CONSTRAINT tabulation_debate_assignments_registry_fk
  FOREIGN KEY (tournament_id) REFERENCES tournament_identity_registry(tournament_id) ON DELETE RESTRICT;
ALTER TABLE tabulation_round_metadata ADD CONSTRAINT tabulation_round_metadata_registry_fk
  FOREIGN KEY (tournament_id) REFERENCES tournament_identity_registry(tournament_id) ON DELETE RESTRICT;
ALTER TABLE sync_operations ADD CONSTRAINT sync_operations_registry_fk
  FOREIGN KEY (tournament_id) REFERENCES tournament_identity_registry(tournament_id) ON DELETE RESTRICT;

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.conname FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid = 'tabulation_acta_sources'::regclass
      AND c.confrelid IN ('room_assignments'::regclass, 'scorecards'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE tabulation_acta_sources DROP CONSTRAINT %I', item.conname);
  END LOOP;
END $$;
