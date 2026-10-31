import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { presetSettings } from "../src/tabulation/presets.js";
import { ballots, result } from "../src/tabulation/test-fixtures.js";
import { previewTabulationActa, saveTabulationActa } from "./tabulation-acta-write.js";

const ids = {
  tournament: "00000000-0000-4000-8000-000000000001",
  assignment: "00000000-0000-4000-8000-000000000002",
  source: "00000000-0000-4000-8000-000000000003",
};
const baseUpdatedAt = 1_800_000_000_000;
const metadata = [
  { teamId: "team-a", swing: false, breakEligible: true },
  { teamId: "team-b", swing: false, breakEligible: true },
];
const entityIdMap = {
  teams: { a: "team-a", b: "team-b" },
  judges: { j1: "judge-1", j2: "judge-2", j3: "judge-3" },
  speakers: {},
  venues: {},
};
const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const client = { query, release: vi.fn() };
  return { query, client };
});
vi.mock("./db.js", () => ({ getPool: () => ({ connect: async () => mocks.client }) }));

function input(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "acta-operation-0001",
    assignmentId: ids.assignment,
    source: {
      sourceMode: "judges",
      acta: {
        tournamentId: "local-tournament",
        basePanelRevision: 3,
        basePanelUpdatedAt: baseUpdatedAt,
        roundId: "local-round",
        debateId: "local-debate",
        result: result(ballots("a", "b", [[70, 60], [72, 61], [68, 59]], ["j1", "j2", "j3"])),
      },
    },
    expectedCurrentSourceId: null,
    confirmReplace: false,
    expectedSettingsRevision: 4,
    ...overrides,
  };
}

describe("authoritative transactional Tabulation acta persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const statement = String(sql).replace(/\\s+/g, " ").trim();
      if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") return { rows: [] };
      if (statement.startsWith("SELECT b.tournament_id")) return { rows: [{
        tournament_id: ids.tournament, tabulation_round_id: "local-round", tabulation_debate_id: "local-debate",
        manager_round_id: "manager-round", assignment_id: ids.assignment, chair_judge_id: "judge-1",
        sides_provisional: false, round_number: 1, round_kind: "qualifying", team_favor_id: "team-a",
        team_contra_id: "team-b", side_mode: "balanced", team_metadata: metadata, entity_id_map: entityIdMap,
        canonical_tournament_id: ids.tournament, revision: 3, updated_at_ms: baseUpdatedAt, current_source_id: null,
      }] };
      if (statement.startsWith("SELECT t.id, t.name")) return { rows: [
        { id: "team-a", name: "A", active: true, institution: "UMA", incompatible_judge_ids: [] },
        { id: "team-b", name: "B", active: true, institution: "UGR", incompatible_judge_ids: [] },
      ] };
      if (statement.startsWith("SELECT j.id, j.name")) return { rows: [
        { id: "judge-1", name: "J1", active: true, institution: "UMA", incompatible_judge_ids: [] },
        { id: "judge-2", name: "J2", active: true, institution: "UGR", incompatible_judge_ids: [] },
        { id: "judge-3", name: "J3", active: true, institution: "UMA", incompatible_judge_ids: [] },
      ] };
      if (statement.startsWith("SELECT s.id, s.team_id")) return { rows: [] };
      if (statement.startsWith("SELECT schema_version, revision, settings")) return { rows: [{ schema_version: 2, revision: 4, settings: presetSettings("ledu-groups") }] };
      if (statement.startsWith("SELECT scope, response FROM idempotency_keys")) return { rows: [] };
      if (statement.startsWith("INSERT INTO tabulation_acta_sources")) return { rows: [{ id: ids.source, created_at: new Date(baseUpdatedAt) }] };
      if (statement.startsWith("SELECT count(*)::int AS total_versions")) return { rows: [{ total_versions: 1, rewrite_count: 0 }] };
      if (statement.startsWith("INSERT INTO audit_events")) return { rows: [] };
      if (statement.startsWith("INSERT INTO idempotency_keys")) return { rows: [] };
      throw new Error("Unexpected query: " + statement + " params=" + JSON.stringify(params));
    });
  });

  it("previews the proposed acta against current server rules without persisting it", async () => {
    const preview = await previewTabulationActa({ assignmentId: ids.assignment, source: input().source });
    expect(preview).toMatchObject({
      assignmentId: ids.assignment, tournamentId: ids.tournament,
      roundId: "manager-round", debateId: "local-debate",
      basePanelRevision: 3, basePanelUpdatedAt: baseUpdatedAt, settingsRevision: 4,
      currentSourceId: null, requiresReplacementConfirmation: false,
      sourceMode: "judges",
    });
    expect(preview.proposedSource).toMatchObject({
      sourceMode: "judges",
      acta: { tournamentId: ids.tournament, roundId: "manager-round", debateId: "local-debate", basePanelRevision: 3 },
    });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).startsWith("INSERT INTO"))).toBe(false);
    expect(mocks.query).toHaveBeenCalledWith("COMMIT");
  });

  it("validates using persisted rules, team metadata, assignment judges and reviewed identity mapping", async () => {
    const response = await saveTabulationActa(input());
    expect(response).toMatchObject({
      assignmentId: ids.assignment, tournamentId: ids.tournament, sourceId: ids.source,
      currentVersionId: ids.source, sourceMode: "judges", rewriteCount: 0, totalVersions: 1,
      replacedSourceId: null, operationId: "acta-operation-0001",
    });
    const insert = mocks.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO tabulation_acta_sources"));
    expect(insert).toBeTruthy();
    expect(String(insert?.[0])).toContain("supersedes_source_id");
    const teamContextQuery = mocks.query.mock.calls.find(([sql]) => String(sql).startsWith("SELECT t.id, t.name"));
    const judgeContextQuery = mocks.query.mock.calls.find(([sql]) => String(sql).startsWith("SELECT j.id, j.name"));
    expect(String(teamContextQuery?.[0])).toContain("team_judge_incompatibilities");
    expect(String(judgeContextQuery?.[0])).toContain("judge_incompatibilities");
    expect(String(teamContextQuery?.[0])).not.toContain("t.incompatible_judge_ids");
    const stored = JSON.parse(String((insert?.[1] as unknown[])[6])) as Record<string, unknown>;
    expect(stored).toMatchObject({ sourceMode: "judges", acta: { tournamentId: ids.tournament, roundId: "manager-round", debateId: "local-debate" } });
    expect(mocks.query).toHaveBeenCalledWith("COMMIT");
  });

  it("recovers a committed operation before requiring the assignment context again", async () => {
    const request = input();
    const scopePayload = {
      source: request.source,
      expectedCurrentSourceId: null,
      confirmReplace: false,
      expectedSettingsRevision: 4,
    };
    const scope = "tabulation-save-acta:" + ids.assignment + ":"
      + createHash("sha256").update(JSON.stringify(scopePayload)).digest("hex");
    const response = { sourceId: ids.source, assignmentId: ids.assignment, operationId: "acta-operation-0001" };
    mocks.query.mockImplementation(async (sql: string) => {
      const statement = String(sql).replace(/\\s+/g, " ").trim();
      if (statement === "BEGIN" || statement === "COMMIT") return { rows: [] };
      if (statement.startsWith("SELECT scope, response FROM idempotency_keys")) return { rows: [{ scope, response }] };
      throw new Error("An idempotent retry must not need the assignment context: " + statement);
    });
    await expect(saveTabulationActa(request)).resolves.toEqual(response);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).startsWith("SELECT b.tournament_id"))).toBe(false);
  });

  it("rejects a save if Tabulation rules changed after the preview", async () => {
    await expect(saveTabulationActa(input({ expectedSettingsRevision: 3 })))
      .rejects.toMatchObject({ code: "ACTA_RULES_REVISION_CONFLICT", status: 409 });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO tabulation_acta_sources"))).toBe(false);
  });

  it("refuses to overwrite an official source without explicit compare-and-confirm", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      const statement = String(sql).replace(/\\s+/g, " ").trim();
      if (statement === "BEGIN" || statement === "ROLLBACK") return { rows: [] };
      if (statement.startsWith("SELECT b.tournament_id")) return { rows: [{
        tournament_id: ids.tournament, tabulation_round_id: "local-round", tabulation_debate_id: "local-debate",
        manager_round_id: "manager-round", assignment_id: ids.assignment, chair_judge_id: "judge-1",
        sides_provisional: false, round_number: 1, round_kind: "qualifying", team_favor_id: "team-a",
        team_contra_id: "team-b", side_mode: "balanced", team_metadata: metadata, entity_id_map: entityIdMap,
        canonical_tournament_id: ids.tournament, revision: 3, updated_at_ms: baseUpdatedAt, current_source_id: ids.source,
      }] };
      if (statement.startsWith("SELECT t.id, t.name")) return { rows: [
        { id: "team-a", name: "A", active: true, institution: "UMA", incompatible_judge_ids: [] },
        { id: "team-b", name: "B", active: true, institution: "UGR", incompatible_judge_ids: [] },
      ] };
      if (statement.startsWith("SELECT j.id, j.name")) return { rows: [
        { id: "judge-1", name: "J1", active: true, institution: "UMA", incompatible_judge_ids: [] },
        { id: "judge-2", name: "J2", active: true, institution: "UGR", incompatible_judge_ids: [] },
        { id: "judge-3", name: "J3", active: true, institution: "UMA", incompatible_judge_ids: [] },
      ] };
      if (statement.startsWith("SELECT s.id, s.team_id")) return { rows: [] };
      if (statement.startsWith("SELECT schema_version, revision, settings")) return { rows: [{ schema_version: 2, revision: 4, settings: presetSettings("ledu-groups") }] };
      if (statement.startsWith("SELECT scope, response FROM idempotency_keys")) return { rows: [] };
      throw new Error("Unexpected query: " + statement);
    });
    await expect(saveTabulationActa(input({ expectedCurrentSourceId: ids.source, confirmReplace: false })))
      .rejects.toMatchObject({ code: "ACTA_REPLACEMENT_CONFIRMATION_REQUIRED", status: 409 });
    expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO tabulation_acta_sources"), expect.anything());
  });
});
