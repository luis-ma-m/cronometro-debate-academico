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

});
