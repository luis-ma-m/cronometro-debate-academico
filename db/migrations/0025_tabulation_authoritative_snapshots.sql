-- Authoritative Tabulation aggregate, independent from the Management singleton.
CREATE TABLE IF NOT EXISTS tabulation_tournaments (
  tab_tournament_id text PRIMARY KEY CHECK (length(btrim(tab_tournament_id)) BETWEEN 1 AND 200),
  tournament_name text NOT NULL CHECK (length(btrim(tournament_name)) BETWEEN 1 AND 200),
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  revision bigint NOT NULL CHECK (revision >= 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 4194304),
  snapshot_sha256 char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  published_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tabulation_tournaments_updated_idx ON tabulation_tournaments(updated_at DESC);

CREATE TABLE IF NOT EXISTS tabulation_publication_operations (
  operation_id varchar(128) PRIMARY KEY CHECK (operation_id ~ '^[a-zA-Z0-9_-]{8,128}$'),
  tab_tournament_id text NOT NULL CHECK (length(btrim(tab_tournament_id)) BETWEEN 1 AND 200),
  base_revision bigint NOT NULL CHECK (base_revision >= 0),
  committed_revision bigint NOT NULL CHECK (committed_revision >= 1),
  snapshot_sha256 char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Records which authoritative Tabulation revision was last imported into the
-- Management singleton, without coupling the two tournament identity domains.
CREATE TABLE IF NOT EXISTS tabulation_manager_imports (
  manager_tournament_id text PRIMARY KEY CHECK (length(btrim(manager_tournament_id)) BETWEEN 1 AND 200),
  tab_tournament_id text NOT NULL CHECK (length(btrim(tab_tournament_id)) BETWEEN 1 AND 200),
  imported_revision bigint NOT NULL CHECK (imported_revision >= 1),
  snapshot_sha256 char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  imported_by text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tabulation_manager_imports_tab_idx ON tabulation_manager_imports(tab_tournament_id);
