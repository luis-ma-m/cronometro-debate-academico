-- LEDU Control initial relational schema.
-- Intentionally non-destructive: no spreadsheet data import or deletion.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tournament_name text NOT NULL DEFAULT 'Torneo LEDU' CHECK (length(tournament_name) BETWEEN 1 AND 200),
  active_round_id text,
  activation_revision bigint NOT NULL DEFAULT 0 CHECK (activation_revision >= 0),
  activated_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  minimum_judges_per_room integer NOT NULL DEFAULT 1 CHECK (minimum_judges_per_room BETWEEN 1 AND 25),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS institutions (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  institution_id text REFERENCES institutions(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  incompatible_judge_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_name_ci_uq ON teams (lower(name));

CREATE TABLE IF NOT EXISTS judges (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  institution_id text REFERENCES institutions(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  incompatible_judge_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS judges_name_ci_uq ON judges (lower(name));

CREATE TABLE IF NOT EXISTS speakers (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS speakers_team_name_ci_uq ON speakers (team_id, lower(name));

CREATE TABLE IF NOT EXISTS physical_rooms (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS format_presets (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS format_presets_name_ci_uq ON format_presets (lower(name));

CREATE TABLE IF NOT EXISTS format_phases (
  id text NOT NULL,
  format_id text NOT NULL REFERENCES format_presets(id) ON DELETE CASCADE,
  phase_order integer NOT NULL CHECK (phase_order >= 0),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  side text NOT NULL CHECK (side IN ('favor', 'contra')),
  speaker text NOT NULL CHECK (length(trim(speaker)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 1 AND 7200),
  phase_type text NOT NULL DEFAULT 'opening',
  warning_thresholds_seconds integer[] NOT NULL DEFAULT '{}',
  allow_overtime_display boolean NOT NULL DEFAULT true,
  PRIMARY KEY (format_id, id),
  UNIQUE (format_id, phase_order)
);

CREATE TABLE IF NOT EXISTS rounds (
  id text PRIMARY KEY,
  number integer NOT NULL UNIQUE CHECK (number >= 1),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  is_active boolean NOT NULL DEFAULT false,
  score_type text NOT NULL DEFAULT 'qualifying' CHECK (score_type IN ('qualifying', 'elimination')),
  default_format_id text REFERENCES format_presets(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rounds_single_active_uq ON rounds (is_active) WHERE is_active;

ALTER TABLE tournament_settings DROP CONSTRAINT IF EXISTS tournament_settings_active_round_fk;
ALTER TABLE tournament_settings ADD CONSTRAINT tournament_settings_active_round_fk
  FOREIGN KEY (active_round_id) REFERENCES rounds(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS room_assignments (
  id text PRIMARY KEY,
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  physical_room_id text NOT NULL REFERENCES physical_rooms(id) ON DELETE RESTRICT,
  format_id text REFERENCES format_presets(id) ON DELETE RESTRICT,
  team_favor_id text REFERENCES teams(id) ON DELETE RESTRICT,
  team_contra_id text REFERENCES teams(id) ON DELETE RESTRICT,
  notes text NOT NULL DEFAULT '',
  timer_status text NOT NULL DEFAULT 'idle' CHECK (timer_status IN ('idle', 'running', 'paused', 'finished')),
  phase_index integer NOT NULL DEFAULT 0 CHECK (phase_index >= 0),
  remaining_seconds integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  last_resumed_at timestamptz,
  timer_revision bigint NOT NULL DEFAULT 0 CHECK (timer_revision >= 0),
  timer_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_assignment_distinct_teams_ck CHECK (team_favor_id IS NULL OR team_contra_id IS NULL OR team_favor_id <> team_contra_id),
  UNIQUE (round_id, physical_room_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS room_assignments_team_favor_once_per_round
  ON room_assignments (round_id, team_favor_id) WHERE team_favor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS room_assignments_team_contra_once_per_round
  ON room_assignments (round_id, team_contra_id) WHERE team_contra_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS room_assignments_round_status_idx ON room_assignments (round_id, timer_status);
CREATE INDEX IF NOT EXISTS room_assignments_physical_room_idx ON room_assignments (physical_room_id, round_id);

CREATE TABLE IF NOT EXISTS assignment_judges (
  assignment_id text NOT NULL REFERENCES room_assignments(id) ON DELETE CASCADE,
  judge_id text NOT NULL REFERENCES judges(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, judge_id)
);
CREATE INDEX IF NOT EXISTS assignment_judges_judge_idx ON assignment_judges (judge_id, assignment_id);

CREATE TABLE IF NOT EXISTS assignment_phases (
  assignment_id text NOT NULL REFERENCES room_assignments(id) ON DELETE CASCADE,
  phase_id text NOT NULL,
  phase_order integer NOT NULL CHECK (phase_order >= 0),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  side text NOT NULL CHECK (side IN ('favor', 'contra')),
  speaker text NOT NULL CHECK (length(trim(speaker)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 1 AND 7200),
  phase_type text NOT NULL DEFAULT 'opening',
  warning_thresholds_seconds integer[] NOT NULL DEFAULT '{}',
  allow_overtime_display boolean NOT NULL DEFAULT true,
  PRIMARY KEY (assignment_id, phase_id),
  UNIQUE (assignment_id, phase_order)
);

CREATE TABLE IF NOT EXISTS score_categories (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  category_order integer NOT NULL CHECK (category_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS score_categories_name_ci_uq ON score_categories (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS score_categories_order_uq ON score_categories (category_order);

CREATE TABLE IF NOT EXISTS scorecards (
  id text PRIMARY KEY,
  assignment_id text NOT NULL UNIQUE REFERENCES room_assignments(id) ON DELETE RESTRICT,
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  team_favor_id text NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  team_contra_id text NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scorecard_distinct_teams_ck CHECK (team_favor_id <> team_contra_id)
);
CREATE INDEX IF NOT EXISTS scorecards_round_idx ON scorecards (round_id);

CREATE TABLE IF NOT EXISTS scorecard_team_scores (
  scorecard_id text NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  total numeric(10,2) NOT NULL CHECK (total >= 0),
  minor_faults integer NOT NULL DEFAULT 0 CHECK (minor_faults BETWEEN 0 AND 100),
  major_faults integer NOT NULL DEFAULT 0 CHECK (major_faults BETWEEN 0 AND 100),
  PRIMARY KEY (scorecard_id, team_id)
);

CREATE TABLE IF NOT EXISTS scorecard_category_scores (
  scorecard_id text NOT NULL,
  team_id text NOT NULL,
  category_id text NOT NULL REFERENCES score_categories(id) ON DELETE RESTRICT,
  score numeric(10,2) NOT NULL CHECK (score >= 0 AND score <= 1000),
  PRIMARY KEY (scorecard_id, team_id, category_id),
  FOREIGN KEY (scorecard_id, team_id) REFERENCES scorecard_team_scores(scorecard_id, team_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scorecard_judges (
  scorecard_id text NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  judge_id text NOT NULL REFERENCES judges(id) ON DELETE RESTRICT,
  PRIMARY KEY (scorecard_id, judge_id)
);

CREATE TABLE IF NOT EXISTS scorecard_speaker_scores (
  scorecard_id text NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  speaker_id text NOT NULL REFERENCES speakers(id) ON DELETE RESTRICT,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  position text NOT NULL CHECK (position IN ('introductor', 'first_rebuttal', 'second_rebuttal', 'concluder')),
  score numeric(3,1) NOT NULL CHECK (score >= 0 AND score <= 10 AND score * 2 = trunc(score * 2)),
  PRIMARY KEY (scorecard_id, team_id, position),
  FOREIGN KEY (scorecard_id, team_id) REFERENCES scorecard_team_scores(scorecard_id, team_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  assignment_id text REFERENCES room_assignments(id) ON DELETE SET NULL,
  round_id text REFERENCES rounds(id) ON DELETE SET NULL,
  phase_index integer,
  from_state jsonb,
  to_state jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_events_round_time_idx ON audit_events (round_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_assignment_time_idx ON audit_events (assignment_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  operation_key text PRIMARY KEY CHECK (length(operation_key) BETWEEN 8 AND 200),
  scope text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT idempotency_completion_ck CHECK ((completed_at IS NULL) = (response IS NULL))
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys (created_at);
