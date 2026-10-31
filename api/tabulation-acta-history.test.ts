import { describe, expect, it } from "vitest";
import { ApiError } from "./core.js";
import { readTabulationActaHistory, readTabulationActaVersion, type ActaHistoryQueryable } from "./tabulation-acta-history.js";

const tournamentId = "123e4567-e89b-42d3-a456-426614174000";

function fakeDb(overrides: {
  assignment?: boolean;
  total?: number;
  rewrites?: number;
  head?: string | null;
  history?: Array<Record<string, unknown>>;
} = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const db: ActaHistoryQueryable = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM room_assignments")) return { rows: overrides.assignment === false ? [] : [{ id: "assignment-1" }] };
      if (sql.includes("FROM tournament_identity")) return { rows: [{ tournament_id: tournamentId }] };
      if (sql.includes("count(*) FILTER")) return { rows: [{ total_versions: overrides.total ?? 0, rewrite_count: overrides.rewrites ?? 0 }] };
      if (sql.includes("FROM tabulation_acta_heads")) return { rows: overrides.head ? [{ source_id: overrides.head }] : [] };
      if (sql.includes("FROM tabulation_acta_sources")) return { rows: overrides.history ?? [] };
      throw new Error("Unexpected SQL query: " + sql);
    },
  };
  return { db, calls };
}

describe("readTabulationActaHistory", () => {
  it("returns an empty history without inventing a synchronized acta", async () => {
    const { db } = fakeDb();
    await expect(readTabulationActaHistory(db, "assignment-1")).resolves.toEqual({
      tournamentId, assignmentId: "assignment-1", currentVersionId: null,
      totalVersions: 0, rewriteCount: 0, truncated: false, versions: [],
    });
  });

  it("returns current version metadata and the server-derived rewrite count", async () => {
    const { db, calls } = fakeDb({
      total: 2, rewrites: 1, head: "source-2",
      history: [{
        id: "source-2", source_mode: "elimination", elimination_result: { winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-a"] }, round_kind: "qualifying", base_revision: 12,
        source_hash: "a".repeat(64), operation_id: "operation-0002",
        supersedes_source_id: "source-1", created_by: "admin", created_at: new Date("2026-10-30T12:00:00Z"),
      }],
    });
    const history = await readTabulationActaHistory(db, "assignment-1");
    expect(history.currentVersionId).toBe("source-2");
    expect(history.rewriteCount).toBe(1);
    expect(history.versions[0]).toMatchObject({
      id: "source-2", sourceMode: "elimination", eliminationResult: { winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-a"] }, roundKind: "qualifying", baseRevision: 12,
      sourceHash: "a".repeat(64), operationId: "operation-0002",
      supersedesSourceId: "source-1", createdAt: new Date("2026-10-30T12:00:00Z").getTime(),
    });
    expect(calls.some((call) => call.sql.includes("UPDATE") || call.sql.includes("INSERT") || call.sql.includes("DELETE"))).toBe(false);
  });

  it("caps the returned history at 100 while preserving the total and rewrite count", async () => {
    const historyRows = Array.from({ length: 101 }, (_, index) => ({
      id: "source-" + index, source_mode: "judges", round_kind: "qualifying", base_revision: 1,
      source_hash: "b".repeat(64), operation_id: "operation-" + index,
      supersedes_source_id: index ? "source-" + (index - 1) : null, created_by: "admin", created_at: new Date(index * 1000),
    }));
    const { db } = fakeDb({ total: 125, rewrites: 124, history: historyRows });
    const history = await readTabulationActaHistory(db, "assignment-1");
    expect(history.versions).toHaveLength(100);
    expect(history.totalVersions).toBe(125);
    expect(history.rewriteCount).toBe(124);
    expect(history.truncated).toBe(true);
  });


  it("loads a full immutable payload only when a specific version is opened", async () => {
    const db: ActaHistoryQueryable = {
      async query(sql) {
        if (sql.includes("FROM tabulation_acta_sources s JOIN tournament_identity")) return { rows: [{
          id: "source-2", assignment_id: "assignment-1", tournament_id: tournamentId,
          source_mode: "elimination", elimination_result: { winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-a"] }, round_kind: "elimination", base_revision: 9,
          source_hash: "c".repeat(64), source_payload: { ballots: [{ judgeId: "judge-1" }] },
          rules_snapshot: { presetId: "ledu-groups" }, operation_id: "operation-detail",
          supersedes_source_id: "source-1", created_by: "admin", created_at: new Date("2026-10-30T13:00:00Z"),
        }] };
        throw new Error("Unexpected SQL query: " + sql);
      },
    };
    const detail = await readTabulationActaVersion(db, "assignment-1", "source-2");
    expect(detail.sourcePayload).toEqual({ ballots: [{ judgeId: "judge-1" }] });
    expect(detail.eliminationResult).toEqual({ winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-a"] });
    expect(detail.rulesSnapshot).toEqual({ presetId: "ledu-groups" });
    expect(detail.supersedesSourceId).toBe("source-1");
  });

  it("does not expose a version belonging to another assignment or tournament", async () => {
    const db: ActaHistoryQueryable = { async query() { return { rows: [] }; } };
    await expect(readTabulationActaVersion(db, "assignment-1", "source-elsewhere"))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("does not return an empty history for an unknown assignment", async () => {
    const { db } = fakeDb({ assignment: false });
    await expect(readTabulationActaHistory(db, "missing")).rejects.toMatchObject({
      code: "NOT_FOUND", status: 404,
    } satisfies Partial<ApiError>);
  });

  it("rejects impossible aggregate counts as database-integrity failures", async () => {
    const { db } = fakeDb({ total: 1, rewrites: 2 });
    await expect(readTabulationActaHistory(db, "assignment-1")).rejects.toMatchObject({
      code: "DATABASE_INTEGRITY", status: 500,
    });
  });
});
