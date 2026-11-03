-- Durable, idempotent journal for module-originated synchronization commands.
-- Append-only operation identity; status is mutable only for retry/conflict/ack transitions.
CREATE TABLE IF NOT EXISTS sync_operations (
  operation_id varchar(128) PRIMARY KEY CHECK (operation_id ~ '^[a-zA-Z0-9_-]{8,128}$'),
  tournament_id uuid NOT NULL REFERENCES tournament_identity(tournament_id) ON DELETE RESTRICT,
  entity_type varchar(64) NOT NULL CHECK (entity_type ~ '^[a-z][a-zA-Z0-9_-]{0,63}$'),
  entity_id varchar(128) NOT NULL CHECK (length(btrim(entity_id)) BETWEEN 1 AND 128),
  operation_type varchar(32) NOT NULL CHECK (operation_type IN ('publish-round','replace-acta','manager-snapshot','tabulation-state')),
  base_revision bigint NOT NULL CHECK (base_revision >= 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 1048576),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','committed','conflict','rejected')),
  result jsonb,
  error_code varchar(64),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  CHECK ((status = 'committed') = (committed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sync_operations_tournament_created_idx
  ON sync_operations (tournament_id, created_at, operation_id);
CREATE INDEX IF NOT EXISTS sync_operations_tournament_status_idx
  ON sync_operations (tournament_id, status, created_at);
