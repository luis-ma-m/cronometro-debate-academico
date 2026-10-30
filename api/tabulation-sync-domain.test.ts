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
    { id: "team-a", active: true },
    { id: "team-b", active: true },
    { id: "team-c", active: true },
    { id: "team-off", active: false },
  ],
  judges: [
    { id: "judge-a", active: true },
    { id: "judge-b", active: true },
    { id: "judge-c", active: true },
    { id: "judge-off", active: false },
  ],
  minimumJudgesPerRoom: 1,
};

const validPayload = (): PublishedRoundPayload => ({
  format: "ledu-tabulacion-outbox",
  version: 1,
  createdAt: 1_800_000_000_100,
  tournamentId: context.canonicalTournamentId,
  basePanelRevision: context.currentRevision,
  basePanelUpdatedAt: context.currentUpdatedAt,
  tabTournamentName: "Torneo de prueba",
  panelTournamentName: "Torneo de prueba",
  roundName: "Ronda 1",
  debates: [{
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

  it("rejects malformed proposals without throwing incidental runtime errors", () => {
    expect(() => validatePublishedRoundPayload(null, context)).toThrow(SyncDomainValidationError);
    expect(() => validatePublishedRoundPayload({ ...validPayload(), debates: [null] }, context)).toThrow(/elemento no es válido/);
    expect(() => validatePublishedRoundPayload({ ...validPayload(), debates: [] }, context)).toThrow(/al menos un debate/);
  });
});
