-- Establish a stable remote identity for the manager's current tournament.
-- The manager is currently a singleton; this does not pretend to provide multi-tournament storage.
-- The UUID is created once and survives renames, edits, reloads and deployments.
CREATE TABLE IF NOT EXISTS tournament_identity (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tournament_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tournament_identity(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE tournament_settings
  ADD COLUMN IF NOT EXISTS tournament_id uuid;

UPDATE tournament_settings
SET tournament_id = (SELECT tournament_id FROM tournament_identity WHERE id = 1)
WHERE tournament_id IS NULL;

ALTER TABLE tournament_settings
  ALTER COLUMN tournament_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournament_settings_tournament_identity_fk'
  ) THEN
    ALTER TABLE tournament_settings
      ADD CONSTRAINT tournament_settings_tournament_identity_fk
      FOREIGN KEY (tournament_id) REFERENCES tournament_identity(tournament_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE tabulation_settings
  ADD COLUMN IF NOT EXISTS tournament_id uuid;

UPDATE tabulation_settings
SET tournament_id = (SELECT tournament_id FROM tournament_identity WHERE id = 1)
WHERE tournament_id IS NULL;

ALTER TABLE tabulation_settings
  ALTER COLUMN tournament_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tabulation_settings_tournament_identity_fk'
  ) THEN
    ALTER TABLE tabulation_settings
      ADD CONSTRAINT tabulation_settings_tournament_identity_fk
      FOREIGN KEY (tournament_id) REFERENCES tournament_identity(tournament_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Migrate the legacy sentinel key to the canonical UUID without dropping history.
UPDATE tabulation_settings_versions
SET tournament_id = (SELECT tournament_id::text FROM tournament_identity WHERE id = 1)
WHERE tournament_id = 'default';

UPDATE tabulation_settings_operations
SET response = jsonb_set(
  response,
  '{tournamentId}',
  to_jsonb((SELECT tournament_id::text FROM tournament_identity WHERE id = 1)),
  true
)
WHERE response ->> 'tournamentId' = 'default';
