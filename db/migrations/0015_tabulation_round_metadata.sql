-- F3/F4: persist Tabulation-only rules that affect outcomes and debate context.
-- These snapshots are written only through authenticated, explicit round publication.
CREATE TABLE IF NOT EXISTS tabulation_round_metadata (
  tournament_id uuid NOT NULL REFERENCES tournament_identity(tournament_id) ON DELETE RESTRICT,
  manager_round_id text NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  side_mode text NOT NULL CHECK (side_mode IN ('draw', 'balanced')),
  team_metadata jsonb NOT NULL CHECK (jsonb_typeof(team_metadata) = 'array' AND pg_column_size(team_metadata) <= 262144),
  updated_by text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, manager_round_id)
);

ALTER TABLE tabulation_debate_assignments
  ADD COLUMN IF NOT EXISTS chair_judge_id text,
  ADD COLUMN IF NOT EXISTS sides_provisional boolean NOT NULL DEFAULT false;

COMMENT ON TABLE tabulation_round_metadata IS
  'Authoritative per-round snapshot of Tabulation-only side mode and team swing/break/fallen metadata. Acta validation must read this snapshot, never client-supplied flags.';
