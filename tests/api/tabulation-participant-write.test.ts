import { describe, expect, it } from "vitest";
import { createTabulationParticipantUpdate } from "../../server/tabulation-participant-write";
import type { Tournament } from "../../src/domain";

const current = {
  remoteId: "tournament-1", tournamentName: "Torneo", revision: 7, updatedAt: 100,
  teams: [], speakers: [], judges: [], physicalRooms: [], rounds: [{ id: "round-1" }],
  rooms: [{ id: "room-1" }], formats: [], activeRoundId: "round-1", activationRevision: 3,
  activatedAt: 90, scoring: { categories: [] }, institutions: ["Institución antigua"],
} as unknown as Tournament;
const snapshot = {
  schemaVersion: 1, tournamentId: "tournament-1", revision: 7, updatedAt: 120,
  teams: [{ identity: { kind: "team", canonicalId: "team-canonical", source: "tabulation", sourceId: "team-local" }, name: "Equipo A", institution: "Universidad A", active: true, incompatibleJudgeIds: ["judge-canonical"] }],
  speakers: [{ identity: { kind: "speaker", canonicalId: "speaker-canonical", source: "tabulation", sourceId: "speaker-local" }, teamId: "team-canonical", name: "Orador A" }],
  judges: [{ identity: { kind: "judge", canonicalId: "judge-canonical", source: "tabulation", sourceId: "judge-local" }, name: "Jueza A", institution: "Universidad B", active: true, incompatibleJudgeIds: [] }],
  physicalRooms: [{ identity: { kind: "physical-room", canonicalId: "venue-canonical", source: "tabulation", sourceId: "venue-local" }, name: "Sala A", active: true }],
};

describe("Tabulation participant write boundary", () => {
  it("derives a participant-only update and preserves manager operational state", () => {
    const result = createTabulationParticipantUpdate(current, 7, snapshot);
    expect(result.tournament.teams).toMatchObject([{ id: "team-canonical", name: "Equipo A" }]);
    expect(result.tournament.speakers).toMatchObject([{ id: "speaker-canonical", teamId: "team-canonical" }]);
    expect(result.tournament.judges).toMatchObject([{ id: "judge-canonical", name: "Jueza A" }]);
    expect(result.tournament.physicalRooms).toMatchObject([{ id: "venue-canonical", name: "Sala A" }]);
    expect(result.tournament.rooms).toBe(current.rooms);
    expect(result.tournament.rounds).toBe(current.rounds);
    expect(result.tournament.scoring).toBe(current.scoring);
  });

  it("rejects a snapshot from another tournament", () => {
    expect(() => createTabulationParticipantUpdate(current, 7, { ...snapshot, tournamentId: "other" }))
      .toThrow("pertenece a otro torneo");
  });

  it("rejects stale revisions before deriving an update", () => {
    expect(() => createTabulationParticipantUpdate(current, 6, snapshot))
      .toThrow("cambió en otro dispositivo");
  });

  it("rejects malformed snapshots", () => {
    expect(() => createTabulationParticipantUpdate(current, 7, { ...snapshot, teams: "not-an-array" }))
      .toThrow("no son válidas");
  });
});
