import { describe, expect, it } from "vitest";
import {
  SyncDomainValidationError,
  validatePublishedRoundPayload,
  type PublishedRoundDomainContext,
  type PublishedRoundPayload,
} from "./tabulation-sync-domain.js";

const context: PublishedRoundDomainContext = {
  canonicalTournamentId: "00000000-0000-4000-8000-000000000001",
  currentRevision: 7,
  currentUpdatedAt: 1_800_000_000_000,
  physicalRooms: [
    { id: "room-a", active: true },
    { id: "room-b", active: true },
    { id: "room-off", active: false },
  ],
  teams: [
    { id: "team-a", active: true, name: "Equipo A", institution: "Universidad A", incompatibleJudgeIds: [] },
    { id: "team-b", active: true, name: "Equipo B", institution: "Universidad B", incompatibleJudgeIds: [] },
    { id: "team-c", active: true, name: "Equipo C", institution: "Universidad C", incompatibleJudgeIds: [] },
    { id: "team-off", active: false, name: "Equipo inactivo", institution: "Universidad D", incompatibleJudgeIds: [] },
  ],
  judges: [
    { id: "judge-a", active: true, name: "Juez A", institution: "Universidad J", incompatibleJudgeIds: [] },
    { id: "judge-b", active: true, name: "Juez B", institution: "Universidad K", incompatibleJudgeIds: [] },
    { id: "judge-c", active: true, name: "Juez C", institution: "Universidad L", incompatibleJudgeIds: [] },
    { id: "judge-off", active: false, name: "Juez inactivo", institution: "Universidad M", incompatibleJudgeIds: [] },
  ],
  minimumJudgesPerRoom: 1,
};

const validPayload = (): PublishedRoundPayload => ({
  format: "ledu-tabulacion-outbox",
  version: 1,
  tabTournamentId: "tab-tournament-1",
  tabulationRoundId: "tab-round-local-1",
  createdAt: 1_800_000_000_100,
  tournamentId: context.canonicalTournamentId,
  basePanelRevision: context.currentRevision,
  basePanelUpdatedAt: context.currentUpdatedAt,
  tabTournamentName: "Torneo de prueba",
  panelTournamentName: "Torneo de prueba",
  roundName: "Ronda 1",
  roundNumber: 1,
  roundKind: "qualifying",
  sideMode: "balanced",
  teamMetadata: [
    { teamId: "team-a", swing: false, breakEligible: true },
    { teamId: "team-b", swing: false, breakEligible: true },
    { teamId: "team-c", swing: false, breakEligible: true },
  ],
  debates: [{
    tabulationDebateId: "tab-debate-1",
    physicalRoomId: "room-a",
    venueName: "Sala A",
    teamFavorId: "team-a",
    teamContraId: "team-b",
    judgeIds: ["judge-a"],
    chairId: "judge-a",
    sidesProvisional: false,
  }],
});

describe("published round domain validation", () => {
  it("accepts a valid proposal matching the current canonical tournament and revision", () => {
    expect(validatePublishedRoundPayload(validPayload(), context)).toEqual(validPayload());
    expect(validatePublishedRoundPayload({ ...validPayload(), roundKind: "elimination", roundNumber: 2 }, context)).toMatchObject({ roundKind: "elimination", roundNumber: 2 });
  });

  it("rejects a proposal from another tournament or a stale manager revision", () => {
    const payload = validPayload();
    expect(() => validatePublishedRoundPayload({
      ...payload,
      tournamentId: "00000000-0000-4000-8000-000000000002",
    }, context)).toThrow(/identidad canónica/);
    expect(() => validatePublishedRoundPayload({
      ...payload,
      basePanelRevision: context.currentRevision - 1,
    }, context)).toThrow(/revisión base/);
  });

  it("requires a unique stable local debate identity", () => {
    const payload = validPayload();
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [{ ...payload.debates[0], tabulationDebateId: "" }],
    }, context)).toThrow(/identificador local del debate no es válido/);
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [payload.debates[0], { ...payload.debates[0], physicalRoomId: "room-b", venueName: "Sala B", teamFavorId: "team-c", tabulationDebateId: "tab-debate-1" }],
    }, context)).toThrow(/identificador local del debate está duplicado/);
  });

  it("rejects unknown, inactive and duplicate physical rooms", () => {
    const payload = validPayload();
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [{ ...payload.debates[0], physicalRoomId: "missing" }],
    }, context)).toThrow(/sala física no existe/);
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [{ ...payload.debates[0], physicalRoomId: "room-off" }],
    }, context)).toThrow(/sala física inactiva/);
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [payload.debates[0], { ...payload.debates[0], teamFavorId: "team-c", teamContraId: "team-b" }],
    }, context)).toThrow(/misma sala aparece/);
  });

  it("rejects self-debates, repeated teams and inactive teams", () => {
    const payload = validPayload();
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [{ ...payload.debates[0], teamContraId: "team-a" }],
    }, context)).toThrow(/contra sí mismo/);
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [
        payload.debates[0],
        { ...payload.debates[0], physicalRoomId: "room-b", venueName: "Sala B", teamFavorId: "team-a", teamContraId: "team-c" },
      ],
    }, context)).toThrow(/equipo aparece en más de un debate/);
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [{ ...payload.debates[0], teamContraId: "team-off" }],
    }, context)).toThrow(/equipo inactivo/);
  });

  it("rejects unknown, inactive, repeated or multiply assigned judges", () => {
    const payload = validPayload();
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [{ ...payload.debates[0], judgeIds: ["missing"], chairId: "missing" }],
    }, context)).toThrow(/juez que no existe/);
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [{ ...payload.debates[0], judgeIds: ["judge-off"], chairId: "judge-off" }],
    }, context)).toThrow(/juez inactivo/);
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [{ ...payload.debates[0], judgeIds: ["judge-a", "judge-a"] }],
    }, context)).toThrow(/jueces duplicados/);
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [
        payload.debates[0],
        { ...payload.debates[0], physicalRoomId: "room-b", venueName: "Sala B", teamFavorId: "team-c", teamContraId: "team-off", judgeIds: ["judge-a"] },
      ],
    }, context)).toThrow(/juez aparece asignado en más de un debate/);
  });

  it("requires the chair to be assigned and the configured minimum panel size", () => {
    const payload = validPayload();
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [{ ...payload.debates[0], chairId: "judge-b" }],
    }, context)).toThrow(/presidencia debe ser uno de los jueces/);
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [{ ...payload.debates[0], judgeIds: [], chairId: "" }],
    }, context)).toThrow(/mínimo de jueces/);
  });


  it("rejects institutional, team-judge and judge-judge conflicts", () => {
    const payload = validPayload();
    const institutionContext = {
      ...context,
      judges: context.judges.map((judge) => judge.id === "judge-a"
        ? { ...judge, institution: "Universidad A" }
        : judge),
    };
    expect(() => validatePublishedRoundPayload(payload, institutionContext)).toThrow(/comparten institución/);

    const teamConflictContext = {
      ...context,
      teams: context.teams.map((team) => team.id === "team-a"
        ? { ...team, incompatibleJudgeIds: ["judge-a"] }
        : team),
    };
    expect(() => validatePublishedRoundPayload(payload, teamConflictContext)).toThrow(/incompatible con el equipo/);

    const judgeConflictContext = {
      ...context,
      judges: context.judges.map((judge) => judge.id === "judge-b"
        ? { ...judge, incompatibleJudgeIds: ["judge-a"] }
        : judge),
    };
    expect(() => validatePublishedRoundPayload({
      ...payload,
      debates: [{ ...payload.debates[0], judgeIds: ["judge-a", "judge-b"], chairId: "judge-a" }],
    }, judgeConflictContext)).toThrow(/jueces incompatibles/);
  });

  it("rejects missing, invalid or out-of-range round metadata and oversized names", () => {
    const payload = validPayload();
    expect(() => validatePublishedRoundPayload({ ...payload, roundNumber: 0 }, context)).toThrow(/entero positivo/);
    expect(() => validatePublishedRoundPayload({ ...payload, roundKind: "unknown" }, context)).toThrow(/tipo de ronda/);
    expect(() => validatePublishedRoundPayload({ ...payload, roundNumber: 1.5 }, context)).toThrow(/rango admitido/);
    expect(() => validatePublishedRoundPayload({ ...payload, roundNumber: 2_147_483_648 }, context)).toThrow(/rango admitido/);
    expect(() => validatePublishedRoundPayload({ ...payload, roundName: "R".repeat(201) }, context)).toThrow(/200 caracteres/);
    expect(() => validatePublishedRoundPayload({ ...payload, debates: [{ ...payload.debates[0], venueName: "S".repeat(201) }] }, context)).toThrow(/nombre de la sala/);
  });

  it("rejects malformed proposals without throwing incidental runtime errors", () => {
    expect(() => validatePublishedRoundPayload(null, context)).toThrow(SyncDomainValidationError);
    expect(() => validatePublishedRoundPayload({ ...validPayload(), debates: [null] }, context)).toThrow(/elemento no es válido/);
    expect(() => validatePublishedRoundPayload({ ...validPayload(), debates: [] }, context)).toThrow(/al menos un debate/);
  });
});
