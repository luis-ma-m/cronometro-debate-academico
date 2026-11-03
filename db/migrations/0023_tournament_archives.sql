-- Preserve every retired singleton tournament as a recoverable snapshot.
-- Active data is not deleted: immutable acta sources and mappings keep their historical FKs.
CREATE TABLE IF NOT EXISTS tournament_archives (
  archive_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation >= 1),
  tournament_name text NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256 char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  replaced_by_tournament_id uuid NOT NULL,
  operation_id varchar(128) NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 8 AND 128),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restored_by text,
  CONSTRAINT tournament_archives_generation_uq UNIQUE (tournament_id, generation)
);
CREATE INDEX IF NOT EXISTS tournament_archives_created_idx
  ON tournament_archives (created_at DESC);

-- Mapping is scoped to a particular active-tournament generation.
CREATE TABLE IF NOT EXISTS tabulation_entity_identity_maps (
  tournament_id uuid NOT NULL,
  tab_tournament_id text NOT NULL CHECK (length(btrim(tab_tournament_id)) BETWEEN 1 AND 200),
  entity_kind text NOT NULL CHECK (entity_kind IN ('team','speaker','judge','physical-room')),
  local_id text NOT NULL CHECK (length(btrim(local_id)) BETWEEN 1 AND 200),
  canonical_id text NOT NULL CHECK (length(btrim(canonical_id)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, tab_tournament_id, entity_kind, local_id),
  UNIQUE (tournament_id, entity_kind, canonical_id)
);
CREATE INDEX IF NOT EXISTS tabulation_identity_map_local_idx
  ON tabulation_entity_identity_maps (tab_tournament_id, entity_kind, local_id);
