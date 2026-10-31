-- Database-backed rate limiting for public S8 resolution.
-- Resolution must remain available when Redis/authentication services are unavailable.
CREATE TABLE IF NOT EXISTS acta_short_link_resolution_limits (
  ip_hash char(64) PRIMARY KEY CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0)
);
CREATE INDEX IF NOT EXISTS acta_short_link_resolution_limits_window_idx
  ON acta_short_link_resolution_limits (window_started_at);
