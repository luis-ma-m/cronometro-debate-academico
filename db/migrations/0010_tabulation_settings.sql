-- Versioned, auditable Tabulation rules for the manager's current singleton tournament.
-- Never overwrite or delete previous settings versions.
CREATE TABLE IF NOT EXISTS tabulation_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  schema_version integer NOT NULL DEFAULT 2 CHECK (schema_version >= 1),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  updated_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tabulation_settings_versions (
  tournament_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  operation_id text NOT NULL UNIQUE,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, revision)
);
CREATE INDEX IF NOT EXISTS tabulation_settings_versions_created_idx
  ON tabulation_settings_versions (tournament_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tabulation_settings_operations (
  operation_id text PRIMARY KEY,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tabulation_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
