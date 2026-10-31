-- F4: make elimination outcomes an explicit source type.
-- 0012 is already part of the migration history; extend it append-only.
ALTER TABLE tabulation_acta_sources
  DROP CONSTRAINT IF EXISTS tabulation_acta_sources_source_mode_check;

ALTER TABLE tabulation_acta_sources
  ADD CONSTRAINT tabulation_acta_sources_source_mode_check
  CHECK (source_mode IN ('judges', 'joint', 'elimination'));

ALTER TABLE tabulation_acta_sources
  ADD COLUMN IF NOT EXISTS elimination_result jsonb;

ALTER TABLE tabulation_acta_sources
  ADD CONSTRAINT tabulation_acta_sources_elimination_result_ck
  CHECK (
    (source_mode = 'elimination'
      AND round_kind = 'elimination'
      AND elimination_result IS NOT NULL
      AND jsonb_typeof(elimination_result) = 'object')
    OR
    (source_mode <> 'elimination' AND elimination_result IS NULL)
  );

COMMENT ON COLUMN tabulation_acta_sources.elimination_result IS
  'Explicit knockout outcome: winnerTeamId, loserTeamId and advancingTeamIds. Source ballots remain in source_payload.';
