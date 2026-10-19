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
});
