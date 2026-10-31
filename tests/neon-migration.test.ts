import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("Neon migration artifacts", () => {
  it("defines relational entities and concurrency-related tables", async () => {
    const sql = await readFile(resolve("db/migrations/0001_initial_schema.sql"), "utf8");
    for (const token of [
      "CREATE TABLE IF NOT EXISTS tournament_settings",
      "CREATE TABLE IF NOT EXISTS room_assignments",
      "UNIQUE (round_id, physical_room_id)",
      "CREATE TABLE IF NOT EXISTS assignment_judges",
      "CREATE TABLE IF NOT EXISTS assignment_phases",
      "CREATE TABLE IF NOT EXISTS scorecards",
      "CREATE TABLE IF NOT EXISTS audit_events",
      "CREATE TABLE IF NOT EXISTS idempotency_keys"
    ]) expect(sql).toContain(token);
  });

  it("does not include destructive data operations in the initial schema", async () => {
    const sql = await readFile(resolve("db/migrations/0001_initial_schema.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\s+.*SELECT\b/i);
  });

  it("adds database-enforced cross-row integrity constraints", async () => {
    const sql = await readFile(resolve("db/migrations/0002_integrity_constraints.sql"), "utf8");
    expect(sql).toContain("CREATE TRIGGER room_assignments_team_once_per_round");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS assignment_judges_one_room_per_round_uq");
    expect(sql).toContain("CREATE TRIGGER scorecards_assignment_consistency");
    expect(sql).toContain("CREATE TRIGGER scorecard_judges_assignment_check");
    expect(sql).toContain("CREATE TRIGGER scorecard_speaker_team_check");
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+(teams|judges|speakers|rounds|room_assignments|scorecards)\b/i);
  });

  it("adds a stable Tabulation debate-to-manager assignment bridge without destructive operations", async () => {
    const sql = await readFile(resolve("db/migrations/0014_tabulation_debate_assignments.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS tabulation_debate_assignments");
    expect(sql).toContain("PRIMARY KEY (tournament_id, tabulation_round_id, tabulation_debate_id)");
    expect(sql).toContain("REFERENCES rounds(id)");
    expect(sql).toContain("REFERENCES room_assignments(id)");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("persists Tabulation-only outcome metadata and assignment context without destructive operations", async () => {
    const sql = await readFile(resolve("db/migrations/0015_tabulation_round_metadata.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS tabulation_round_metadata");
    expect(sql).toContain("side_mode text NOT NULL CHECK (side_mode IN ('draw', 'balanced'))");
    expect(sql).toContain("team_metadata jsonb NOT NULL");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS chair_judge_id");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS sides_provisional");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("persists the reviewed Tabulation entity identity map", async () => {
    const sql = await readFile(resolve("db/migrations/0016_tabulation_entity_identity_map.sql"), "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS entity_id_map jsonb");
    expect(sql).toContain("jsonb_typeof(entity_id_map) = 'object'");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("constrains persisted Tabulation chairs to manager judges", async () => {
    const sql = await readFile(resolve("db/migrations/0017_tabulation_chair_judge_fk.sql"), "utf8");
    expect(sql).toContain("FOREIGN KEY (chair_judge_id) REFERENCES judges(id)");
    expect(sql).toContain("ON DELETE RESTRICT");
  });

  it("binds each manager assignment to the originating local Tabulation tournament", async () => {
    const sql = await readFile(resolve("db/migrations/0018_tabulation_tournament_identity.sql"), "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS tab_tournament_id text NOT NULL");
    expect(sql).toContain("tab_tournament_id");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("scopes the local debate identity key by its originating Tabulation tournament", async () => {
    const sql = await readFile(resolve("db/migrations/0019_tabulation_debate_mapping_scope.sql"), "utf8");
    expect(sql).toContain("DROP CONSTRAINT tabulation_debate_assignments_pkey");
    expect(sql).toContain("PRIMARY KEY (tournament_id, tab_tournament_id, tabulation_round_id, tabulation_debate_id)");
  });

  it("migration runner discovers ordered, versioned SQL migrations and verifies checksums", async () => {
    const runner = await readFile(resolve("scripts/migrate-db.mjs"), "utf8");
    expect(runner).toContain('readdir(directory)');
    expect(runner).toContain('file.slice(0, 4)');
    expect(runner).toContain('previous.checksum !== migration.checksum');
    expect(runner).toContain("pg_advisory_xact_lock");
    expect(runner).toContain('client.query("ROLLBACK")');
  });

  it("routes operational API persistence through PostgreSQL without a Sheets dependency", async () => {
    const api = await readFile(resolve("api/index.ts"), "utf8");
    const store = await readFile(resolve("api/postgres-store.ts"), "utf8");
    expect(api).toContain("loadPostgresSheetData");
    expect(api).toContain("writePostgresTables");
    expect(api).not.toMatch(/GOOGLE_SERVICE_ACCOUNT_JSON|sheets\\.googleapis\\.com|googleAccessToken|batchUpdateSpreadsheet/);
    expect(api).not.toContain("ledu:lock:spreadsheet");
    expect(store).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(store).toContain("WHERE id=$8 AND timer_revision=$9");
  });

  it("limits tournament writes to changed entity sets and batches relation inserts", async () => {
    const api = await readFile(resolve("api/index.ts"), "utf8");
    const store = await readFile(resolve("api/postgres-store.ts"), "utf8");
    expect(api).toContain("const candidateReplacements");
    expect(api).toContain("if (roomsChanged) replacements.Salas");
    expect(api).toContain("if (formatsChanged) replacements.Formatos");
    expect(store).toContain("function assignmentRelationsChanged");
    expect(store).toContain("const rebuildAssignmentRelations = assignmentRelationsChanged(data, replacements)");
    expect(store).toContain("async function insertMany");
    expect(store).not.toContain("Boolean(replacements.Equipos)");
    expect(store).toContain("await insertMany(client, \"assignment_phases\"");
  });

  it("persists timer audit and idempotency in the same write transaction", async () => {
    const api = await readFile(resolve("api/index.ts"), "utf8");
    const store = await readFile(resolve("api/postgres-store.ts"), "utf8");
    expect(api).toContain("readIdempotentResponse(idempotencyKey, idempotencyScope)");
    expect(api).toContain("idempotencyResponse: response");
    expect(store).toContain("INSERT INTO audit_events");
    expect(store).toContain("INSERT INTO idempotency_keys");
    expect(store).toContain('await client.query("COMMIT")');
    expect(store).toContain('await client.query("ROLLBACK")');
  });


  it("normalizes incompatibilities into foreign-key-backed relationships", async () => {
    const sql = await readFile(resolve("db/migrations/0003_normalize_incompatibilities.sql"), "utf8");
    const store = await readFile(resolve("api/postgres-store.ts"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS team_judge_incompatibilities");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS judge_incompatibilities");
    expect(sql).toContain("ALTER TABLE teams DROP COLUMN incompatible_judge_ids");
    expect(sql).toContain("ALTER TABLE judges DROP COLUMN incompatible_judge_ids");
    expect(sql).toContain("judge incompatibilities must be reciprocal");
    expect(store).toContain("FROM team_judge_incompatibilities");
    expect(store).toContain("FROM judge_incompatibilities");
    expect(store).toContain("persistIncompatibilities");
  });


  it("preserves the identity of assignments that already have scorecards", async () => {
    const sql = await readFile(resolve("db/migrations/0004_preserve_scored_assignment_identity.sql"), "utf8");
    expect(sql).toContain("prevent_scored_assignment_reassignment");
    expect(sql).toContain("NEW.team_favor_id IS DISTINCT FROM OLD.team_favor_id");
    expect(sql).toContain("NEW.physical_room_id IS DISTINCT FROM OLD.physical_room_id");
  });


  it("normalizes room claims so full saves can swap physical rooms atomically", async () => {
    const sql = await readFile(resolve("db/migrations/0005_normalize_assignment_claims.sql"), "utf8");
    const store = await readFile(resolve("api/postgres-store.ts"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS round_room_claims");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS room_assignments_round_id_physical_room_id_key");
    expect(sql).toContain("DROP INDEX IF EXISTS room_assignments_team_favor_round_uq");
    expect(store).toContain('DELETE FROM round_room_claims');
  });


  it("enforces exact judge consistency between assignment and scorecard", async () => {
    const sql = await readFile(resolve("db/migrations/0006_scorecard_judge_consistency.sql"), "utf8");
    expect(sql).toContain("scorecard judges must exactly match assignment judges");
    expect(sql).toContain("CREATE CONSTRAINT TRIGGER assignment_judges_scorecard_consistency");
    expect(sql).toContain("CREATE CONSTRAINT TRIGGER scorecard_judges_assignment_consistency");
    expect(sql).toContain("CREATE CONSTRAINT TRIGGER scorecards_judges_consistency");
  });


  it("limits deferred judge consistency checks to the affected scorecard", async () => {
    const sql = await readFile(resolve("db/migrations/0007_scope_judge_consistency_checks.sql"), "utf8");
    expect(sql).toContain("target_scorecard_id");
    expect(sql).toContain("FROM scorecards WHERE assignment_id = target_assignment_id");
    expect(sql).toContain("FROM scorecard_judges WHERE scorecard_id = target_scorecard_id");
  });


  it("does not trust client timestamps to decide whether scorecards need validation", async () => {
    const api = await readFile(resolve("api/index.ts"), "utf8");
    expect(api).toContain("function scorecardComparable(card: RoundScorecard)");
    expect(api).toContain("scorecardComparable(previousCard) !== scorecardComparable(card)");
    expect(api).not.toContain("previousCard.updatedAt !== card.updatedAt");
  });


  it("uses revision-scoped idempotency for configuration, scoring and activation writes", async () => {
    const api = await readFile(resolve("api/index.ts"), "utf8");
    const clientApi = await readFile(resolve("src/api.ts"), "utf8");
    const app = await readFile(resolve("src/App.tsx"), "utf8");
    expect(api).toContain('const idempotencyScope = "saveTournament:" + expectedRevision');
    expect(api).toContain('const idempotencyScope = "saveScoreConfig:" + expectedRevision');
    expect(api).toContain('const idempotencyScope = expectedActivationRevision === null ? "" : "activateRound:" + expectedActivationRevision');
    expect(api).toContain("idempotencyResponse: response");
    expect(clientApi).toContain("expectedActivationRevision?: number");
    expect(app).toContain("effectivePreview.activationRevision");
    expect(app).toContain("refreshedPreview.activationRevision > preview.activationRevision");
  });


  it("protects scored assignment judges and phase snapshots from mutation", async () => {
    const sql = await readFile(resolve("db/migrations/0008_preserve_scored_assignment_snapshots.sql"), "utf8");
    const store = await readFile(resolve("api/postgres-store.ts"), "utf8");
    expect(sql).toContain("scored_assignment_judges_immutable");
    expect(sql).toContain("scored_assignment_phases_immutable");
    expect(store).toContain("SCORED_ASSIGNMENT_PHASES_IMMUTABLE");
    expect(store).toContain("SCORED_ASSIGNMENT_JUDGES_IMMUTABLE");
  });


  it("requires exactly two team-score rows matching the scorecard teams", async () => {
    const sql = await readFile(resolve("db/migrations/0009_scorecard_team_score_consistency.sql"), "utf8");
    expect(sql).toContain("scorecard_team_score_membership_check");
    expect(sql).toContain("scorecards_both_team_scores_check");
    expect(sql).toContain("score_count <> 2");
    expect(sql).toContain("favor_count <> 1 OR contra_count <> 1");
  });

});
