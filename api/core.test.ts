import { describe, expect, it } from "vitest";
import type { Room, Tournament } from "../src/domain.js";
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
} from "./core.js";

function makeTournament(): Tournament {
  const phases = defaultPhases();
  const now = 1_800_000_000_000;
  const room: Room = {
    id: "a1",
    name: "Sala A1",
    roundId: "r1",
    physicalRoomId: "physical-a1",
    formatId: "format-ledu",
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
    rounds: [{ id: "r1", number: 1, name: "Ronda 1", active: true, defaultFormatId: "format-ledu" }],
    teams: [
      { id: "t1", name: "Equipo A", institution: "Universidad A", active: true, incompatibleJudgeIds: [] },
      { id: "t2", name: "Equipo B", institution: "Universidad B", active: true, incompatibleJudgeIds: [] },
    ],
    judges: [{ id: "j1", name: "Juez 1", institution: "LEDU", active: true, incompatibleJudgeIds: [] }],
    rooms: [room],
    physicalRooms: [{ id: "physical-a1", slug: "sala-a1", name: "Sala A1", active: true, createdAt: now, updatedAt: now }],
    formats: [{ id: "format-ledu", name: "LEDU", phases, version: 1, createdAt: now, updatedAt: now }],
    activeRoundId: "r1",
    activationRevision: 1,
    activatedAt: now - 30_000,
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
    expect(rowsToValues("Equipos", [{ id: "t1", name: "A", institution: "", active: true, incompatibleJudgeIds: "[]" }], 2)).toEqual([
      ["t1", "A", "", true, "[]"],
      ["", "", "", "", ""],
    ]);
  });

  it("validates assignments and rejects two rooms using the same team in a round", () => {
    const tournament = makeTournament();
    tournament.physicalRooms.push({ id: "physical-a2", slug: "sala-a2", name: "Sala A2", active: true, createdAt: 1, updatedAt: 1 });
    tournament.rooms.push({
      ...tournament.rooms[0],
      id: "a2",
      physicalRoomId: "physical-a2",
      name: "Sala A2",
      teamFavorId: "t1",
      teamContraId: "",
      judgeIds: [],
    });
    expect(() => validateTournamentInput(tournament)).toThrowError(ApiError);
    expect(() => validateTournamentInput(tournament)).toThrow("dos salas de la misma ronda");
  });

  it("rejects duplicate team IDs", () => {
    const tournament = makeTournament();
    tournament.teams.push({ ...tournament.teams[0] });
    expect(() => validateTournamentInput(tournament)).toThrow("identificadores únicos");
  });

  it("rejects duplicate judge IDs", () => {
    const tournament = makeTournament();
    tournament.judges.push({ ...tournament.judges[0] });
    expect(() => validateTournamentInput(tournament)).toThrow("identificadores únicos");
  });

  it("rejects duplicate round IDs", () => {
    const tournament = makeTournament();
    tournament.rounds.push({ ...tournament.rounds[0] });
    expect(() => validateTournamentInput(tournament)).toThrow("identificadores únicos");
  });

  it("rejects assigning a judge to a team from the same institution", () => {
    const tournament = makeTournament();
    tournament.institutions = ["Universidad A", "Universidad B", "LEDU"];
    tournament.judges[0].institution = "Universidad A";
    expect(() => validateTournamentInput(tournament)).toThrow("comparten institución");
  });

  it("rejects institution values missing from the catalog", () => {
    const tournament = makeTournament();
    tournament.institutions = ["Universidad B", "LEDU"];
    expect(() => validateTournamentInput(tournament)).toThrow("no pertenece al catálogo");
  });

  it("rejects duplicate judge assignment across simultaneous rooms", () => {
    const tournament = makeTournament();
    tournament.teams.push({ id: "t3", name: "Equipo C", institution: "", active: true, incompatibleJudgeIds: [] });
    tournament.physicalRooms.push({ id: "physical-a2", slug: "sala-a2", name: "Sala A2", active: true, createdAt: 1, updatedAt: 1 });
    tournament.rooms.push({
      ...tournament.rooms[0],
      id: "a2",
      physicalRoomId: "physical-a2",
      name: "Sala A2",
      teamFavorId: "t3",
      teamContraId: "",
      judgeIds: ["j1"],
    });
    expect(() => validateTournamentInput(tournament)).toThrow("juez está asignado a dos salas");
  });


  it("rejects a team-judge incompatibility against either side of the debate", () => {
    const tournament = makeTournament();
    tournament.judges.push({ id: "j2", name: "Juez 2", institution: "", active: true, incompatibleJudgeIds: [] });
    for (const teamId of ["t1", "t2"]) {
      const changed = { ...tournament, teams: tournament.teams.map((team) => ({ ...team, incompatibleJudgeIds: team.id === teamId ? ["j2"] : [] })), rooms: tournament.rooms.map((room) => ({ ...room, judgeIds: ["j2"] })) };
      expect(() => validateTournamentInput(changed)).toThrow("es incompatible con el equipo");
    }
  });

  it("normalizes judge-judge relations as reciprocal and rejects co-assignment in one room", () => {
    const tournament = makeTournament();
    tournament.judges.push({ id: "j2", name: "Juez 2", institution: "LEDU", active: true, incompatibleJudgeIds: [] });
    tournament.rooms[0].judgeIds = [];
    tournament.judges[0].incompatibleJudgeIds = ["j2"];
    validateTournamentInput(tournament);
    expect(tournament.judges[1].incompatibleJudgeIds).toEqual(["j1"]);
    tournament.rooms[0].judgeIds = ["j2", "j1"];
    expect(() => validateTournamentInput(tournament)).toThrow("son incompatibles");
  });

  it("rejects dangling, duplicate and self-referential incompatibility IDs", () => {
    const dangling = makeTournament();
    dangling.teams[0].incompatibleJudgeIds = ["missing-judge"];
    expect(() => validateTournamentInput(dangling)).toThrow("juez inexistente");
    const duplicate = makeTournament();
    duplicate.judges.push({ id: "j2", name: "Juez 2", institution: "", active: true, incompatibleJudgeIds: [] });
    duplicate.teams[0].incompatibleJudgeIds = ["j1", "j1"];
    expect(() => validateTournamentInput(duplicate)).toThrow("duplicados");
    const self = makeTournament();
    self.judges[0].incompatibleJudgeIds = ["j1"];
    expect(() => validateTournamentInput(self)).toThrow("consigo mismo");
  });

  it("allows incompatible judges in separate rooms in the same round", () => {
    const tournament = makeTournament();
    tournament.judges.push({ id: "j2", name: "Juez 2", institution: "", active: true, incompatibleJudgeIds: ["j1"] });
    tournament.judges[0].incompatibleJudgeIds = ["j2"];
    tournament.teams.push({ id: "t3", name: "Equipo C", institution: "", active: true, incompatibleJudgeIds: [] });
    tournament.teams.push({ id: "t4", name: "Equipo D", institution: "", active: true, incompatibleJudgeIds: [] });
    tournament.physicalRooms.push({ id: "physical-a2", slug: "sala-a2", name: "Sala A2", active: true, createdAt: 1, updatedAt: 1 });
    tournament.rooms.push({ ...tournament.rooms[0], id: "a2", name: "Sala A2", physicalRoomId: "physical-a2", teamFavorId: "t3", teamContraId: "t4", judgeIds: ["j2"] });
    expect(() => validateTournamentInput(tournament)).not.toThrow();
  });


  it("rejects a team-judge incompatibility against either side", () => {
    for (const teamId of ["t1", "t2"]) {
      const tournament = makeTournament();
      tournament.teams.find((team) => team.id === teamId)!.incompatibleJudgeIds = ["j1"];
      expect(() => validateTournamentInput(tournament)).toThrow("es incompatible con el equipo");
    }
  });

  it("normalizes judge relations symmetrically and rejects an incompatible panel", () => {
    const tournament = makeTournament();
    tournament.judges.push({ id:"j2", name:"Juez 2", institution:"LEDU", active:true, incompatibleJudgeIds:[] });
    tournament.rooms[0].judgeIds = [];
    tournament.judges[0].incompatibleJudgeIds = ["j2"];
    validateTournamentInput(tournament);
    expect(tournament.judges[1].incompatibleJudgeIds).toEqual(["j1"]);
    tournament.rooms[0].judgeIds = ["j1","j2"];
    expect(() => validateTournamentInput(tournament)).toThrow("son incompatibles");
  });

  it("rejects dangling IDs, duplicate references and judge self-reference", () => {
    const dangling = makeTournament();
    dangling.teams[0].incompatibleJudgeIds = ["missing"];
    expect(() => validateTournamentInput(dangling)).toThrow("juez inexistente");
    const duplicate = makeTournament();
    duplicate.teams[0].incompatibleJudgeIds = ["j1","j1"];
    expect(() => validateTournamentInput(duplicate)).toThrow("duplicados");
    const self = makeTournament();
    self.judges[0].incompatibleJudgeIds = ["j1"];
    expect(() => validateTournamentInput(self)).toThrow("consigo mismo");
  });

  it("allows incompatible judges in separate rooms of the same round", () => {
    const tournament = makeTournament();
    tournament.judges.push({id:"j2",name:"Juez 2",institution:"",active:true,incompatibleJudgeIds:["j1"]});
    tournament.judges[0].incompatibleJudgeIds = ["j2"];
    tournament.teams.push({id:"t3",name:"Equipo C",institution:"",active:true,incompatibleJudgeIds:[]});
    tournament.teams.push({id:"t4",name:"Equipo D",institution:"",active:true,incompatibleJudgeIds:[]});
    tournament.physicalRooms.push({id:"physical-a2",slug:"sala-a2",name:"Sala A2",active:true,createdAt:1,updatedAt:1});
    tournament.rooms.push({...tournament.rooms[0],id:"a2",name:"Sala A2",physicalRoomId:"physical-a2",teamFavorId:"t3",teamContraId:"t4",judgeIds:["j2"]});
    expect(() => validateTournamentInput(tournament)).not.toThrow();
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
    const payload = publicRoomPayload(tournament, "sala-a1");
    expect(payload.room.id).toBe("a1");
    expect(payload.room).not.toHaveProperty("notes");
    expect(payload.teamFavor).toBe("Equipo A");
    expect(payload.judges).toEqual(["Juez 1"]);
  });

  it("treats a pre-created but empty room row as unassigned on its permanent public link", () => {
    const tournament = makeTournament();
    tournament.rooms[0] = {
      ...tournament.rooms[0],
      teamFavorId: "",
      teamContraId: "",
      judgeIds: [],
      status: "unassigned",
    };
    const payload = publicRoomPayload(tournament, "sala-a1");
    expect(payload.hasAssignment).toBe(false);
    expect(payload.teamFavor).toBe("");
    expect(payload.teamContra).toBe("");
    expect(payload.judges).toEqual([]);
  });

  it("derives room readiness using the configured judge minimum", () => {
    const tournament = makeTournament();
    expect(deriveRoomStatus(tournament.rooms[0], 2)).toBe("unassigned");
    tournament.rooms[0].judgeIds.push("j2");
    expect(deriveRoomStatus(tournament.rooms[0], 2)).toBe("ready");
  });
});
