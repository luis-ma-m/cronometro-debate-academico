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

  it("does not destroy or import current spreadsheet data", async () => {
    const sql = await readFile(resolve("db/migrations/0001_initial_schema.sql"), "utf8");
    expect(sql).not.toMatch(/\\bDROP\\s+TABLE\\b/i);
    expect(sql).not.toMatch(/\\bTRUNCATE\\b/i);
    expect(sql).not.toMatch(/\\bDELETE\\s+FROM\\b/i);
  });
});
