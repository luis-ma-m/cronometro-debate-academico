import { describe, expect, it } from "vitest";
import type { Room, Tournament } from "../src/domain";
import {
  ApiError,
  defaultPhases,
  deriveRoomStatus,
  initialTimer,
  objectsFromRows,
  publicRoomPayload,
  rowsToValues,
  transitionTimer,
  validateTournamentInput,
} from "./core";

function makeTournament(): Tournament {
  const phases = defaultPhases();
  const now = 1_800_000_000_000;
  const room: Room = {
    id: "a1",
    name: "Sala A1",
    roundId: "r1",
    teamFavorId: "t1",
    teamContraId: "t2",
    judgeIds: ["j1"],
    status: "ready",
    phases,
    timer: initialTimer(phases),
    notes: "Nota interna no pública",
    updatedAt: now,
  };
  return {
    tournamentName: "Torneo de prueba",
    rounds: [{ id: "r1", number: 1, name: "Ronda 1", active: true }],
    teams: [
      { id: "t1", name: "Equipo A", institution: "Universidad A", active: true },
      { id: "t2", name: "Equipo B", institution: "Universidad B", active: true },
    ],
    judges: [{ id: "j1", name: "Juez 1", institution: "LEDU", active: true }],
    rooms: [room],
    formatPhases: phases,
    minimumJudgesPerRoom: 1,
    revision: 1,
    updatedAt: now,
  };
}

describe("Vercel API core", () => {
  it("retains the 12-phase LEDU reference preset for 41 minutes", () => {
    const phases = defaultPhases();
    expect(phases).toHaveLength(12);
    expect(phases.reduce((total, phase) => total + phase.durationSeconds, 0)).toBe(41 * 60);
  });

  it("parses tabular Sheets values by header and ignores fully empty rows", () => {
    expect(objectsFromRows([
      ["id", "name", "active"],
      ["t1", "Equipo A", true],
      ["", "", ""],
    ])).toEqual([{ id: "t1", name: "Equipo A", active: true }]);
  });

  it("clears stale cells when a table is rewritten with fewer rows", () => {
    expect(rowsToValues("Equipos", [{ id: "t1", name: "A", institution: "", active: true }], 2)).toEqual([
      ["t1", "A", "", true],
      ["", "", "", ""],
    ]);
  });

  it("validates assignments and rejects two rooms using the same team in a round", () => {
    const tournament = makeTournament();
    tournament.rooms.push({
      ...tournament.rooms[0],
      id: "a2",
      name: "Sala A2",
      teamFavorId: "t1",
      teamContraId: "",
      judgeIds: [],
    });
    expect(() => validateTournamentInput(tournament)).toThrowError(ApiError);
    expect(() => validateTournamentInput(tournament)).toThrow("dos salas de la misma ronda");
  });

  it("rejects duplicate judge assignment across simultaneous rooms", () => {
    const tournament = makeTournament();
    tournament.teams.push({ id: "t3", name: "Equipo C", institution: "", active: true });
    tournament.rooms.push({
      ...tournament.rooms[0],
      id: "a2",
      name: "Sala A2",
      teamFavorId: "t3",
      teamContraId: "",
      judgeIds: ["j1"],
    });
    expect(() => validateTournamentInput(tournament)).toThrow("juez está asignado a dos salas");
  });

  it("preserves timer revision and timestamp-based state transitions", () => {
    const phases = defaultPhases();
    const started = transitionTimer(initialTimer(phases), phases, "start", 1000);
    const paused = transitionTimer(started, phases, "pause", 6000);
    const resumed = transitionTimer(paused, phases, "start", 9000);
    expect(started.status).toBe("running");
    expect(paused.status).toBe("paused");
    expect(paused.remainingSeconds).toBe(235);
    expect(resumed.status).toBe("running");
    expect(resumed.revision).toBe(3);
    expect(resumed.lastResumedAt).toBe(9000);
  });

  it("never returns internal room notes in a public room payload", () => {
    const tournament = makeTournament();
    const payload = publicRoomPayload(tournament, "A1");
    expect(payload.room.id).toBe("a1");
    expect(payload.room).not.toHaveProperty("notes");
    expect(payload.teamFavor).toBe("Equipo A");
    expect(payload.judges).toEqual(["Juez 1"]);
  });

  it("derives room readiness using the configured judge minimum", () => {
    const tournament = makeTournament();
    expect(deriveRoomStatus(tournament.rooms[0], 2)).toBe("unassigned");
    tournament.rooms[0].judgeIds.push("j2");
    expect(deriveRoomStatus(tournament.rooms[0], 2)).toBe("ready");
  });
});
