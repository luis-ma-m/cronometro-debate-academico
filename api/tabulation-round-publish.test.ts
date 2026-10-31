import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSyncPayloadHash } from "./sync-operation-validation.js";
import { publishTabulationRound } from "./tabulation-round-publish.js";

const tournamentId = "00000000-0000-4000-8000-000000000001";
const baseUpdatedAt = 1_800_000_000_000;
const stored = { scope: "", response: null as unknown };
const query = vi.fn();
const client = { query, release: vi.fn() };

vi.mock("./db.js", () => ({
  getPool: () => ({ connect: async () => client }),
}));

function payload() {
  return {
    format: "ledu-tabulacion-outbox",
    version: 1,
    createdAt: baseUpdatedAt,
    tournamentId,
    basePanelRevision: 7,
    basePanelUpdatedAt: baseUpdatedAt,
    tabTournamentName: "Torneo de prueba",
    panelTournamentName: "Torneo de prueba",
    roundName: "Ronda 1",
    roundNumber: 1,
    roundKind: "qualifying",
    debates: [{
      physicalRoomId: "room-a",
      venueName: "Sala A",
      teamFavorId: "team-a",
      teamContraId: "team-b",
      judgeIds: ["judge-a"],
      chairId: "judge-a",
      sidesProvisional: false,
    }],
  };
}

async function operation(overrides: Record<string, unknown> = {}) {
  const body = payload();
  return {
    protocolVersion: 1,
    operationId: "publish-operation-0001",
    tournamentId,
    entityType: "round",
    entityId: "tab-round-1",
    operation: "publish-round",
    baseRevision: 7,
    payload: body,
    payloadHash: await createSyncPayloadHash(body),
    ...overrides,
  };
}

describe("transactional Tabulation round publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored.scope = "";
    stored.response = null;
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const statement = String(sql).replace(/\s+/g, " ").trim();
      if (statement.startsWith("SELECT ti.tournament_id")) return { rows: [{
        tournament_id: tournamentId, revision: 7, updated_at_ms: baseUpdatedAt, minimum_judges_per_room: 1,
      }] };
      if (statement.startsWith("SELECT scope, response FROM idempotency_keys")) {
        return { rows: stored.response && params[0] === "publish-operation-0001" ? [{ scope: stored.scope, response: stored.response }] : [] };
      }
      if (statement.startsWith("SELECT id, active FROM physical_rooms")) return { rows: [{ id: "room-a", active: true }] };
      if (statement.startsWith("SELECT t.id, t.name")) return { rows: [
        { id: "team-a", name: "Equipo A", active: true, institution: "Universidad A", incompatible_judge_ids: [] },
        { id: "team-b", name: "Equipo B", active: true, institution: "Universidad B", incompatible_judge_ids: [] },
      ] };
      if (statement.startsWith("SELECT j.id, j.name")) return { rows: [
        { id: "judge-a", name: "Juez A", active: true, institution: "Universidad J", incompatible_judge_ids: [] },
      ] };
      if (statement.startsWith("SELECT COALESCE(MAX(number)")) return { rows: [{ next_number: 1 }] };
      if (statement.startsWith("SELECT id FROM rounds")) return { rows: [] };
      if (statement.startsWith("INSERT INTO idempotency_keys")) {
        stored.scope = String(params[1]);
        stored.response = JSON.parse(String(params[2]));
      }
      return { rows: [], rowCount: 1 };
    });
  });

  it("commits the round, assignments, audit trail, revision and idempotent ACK atomically", async () => {
    const result = await publishTabulationRound(await operation());
    expect(result).toMatchObject({
      tournamentId, roundId: "tab-round-1", roundNumber: 1, roundName: "Ronda 1",
      roundKind: "qualifying", revision: 8, operationId: "publish-operation-0001",
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO rounds"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO room_assignments"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO assignment_judges"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO audit_events"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql) === "COMMIT")).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql) === "ROLLBACK")).toBe(false);
    const replay = await publishTabulationRound(await operation());
    expect(replay).toEqual(result);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO rounds"))).toHaveLength(1);
  });

  it("returns a revision conflict without writing when the snapshot is stale", async () => {
    query.mockImplementation(async (sql: string) => {
      const statement = String(sql).replace(/\s+/g, " ").trim();
      if (statement.startsWith("SELECT ti.tournament_id")) return { rows: [{
        tournament_id: tournamentId, revision: 8, updated_at_ms: baseUpdatedAt + 1, minimum_judges_per_room: 1,
      }] };
      return { rows: [] };
    });
    await expect(publishTabulationRound(await operation())).rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO rounds"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql) === "ROLLBACK")).toBe(true);
  });

  it("preserves authorization errors instead of misreporting them as database outages", async () => {
    const op = await operation({ tournamentId: "00000000-0000-4000-8000-000000000002" });
    await expect(publishTabulationRound(op)).rejects.toMatchObject({ code: "TOURNAMENT_MISMATCH", status: 409 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO rounds"))).toBe(false);
  });
});
