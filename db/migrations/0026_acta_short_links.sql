-- Server-resolved WhatsApp acta links: immutable snapshots addressed by eight Crockford Base32 characters.
CREATE TABLE IF NOT EXISTS acta_short_links (
  id varchar(8) PRIMARY KEY CHECK (id ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  tournament_id text NOT NULL CHECK (length(tournament_id) BETWEEN 1 AND 128),
  debate_id text NOT NULL CHECK (length(debate_id) BETWEEN 1 AND 200),
  snapshot jsonb NOT NULL,
  snapshot_sha256 char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key char(64) NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (tournament_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS acta_short_links_tournament_created_idx ON acta_short_links (tournament_id, created_at DESC);
CREATE INDEX IF NOT EXISTS acta_short_links_expiry_idx ON acta_short_links (expires_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS acta_short_link_events (
  id bigserial PRIMARY KEY,
  link_id varchar(8) NOT NULL REFERENCES acta_short_links(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created','expiry_updated','revoked')),
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS acta_short_link_events_link_time_idx ON acta_short_link_events (link_id, occurred_at DESC);
