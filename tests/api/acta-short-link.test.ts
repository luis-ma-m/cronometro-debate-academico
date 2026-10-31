import { describe, expect, it } from "vitest";
import { validActaSnapshot } from "../../api/index.js";

const compactSnapshot = {
  version: 2,
  tournament: "",
  round: { number: 1, name: "Ronda 1", elimination: false },
  debate: "debate-ref",
  key: "context-key",
  venue: "Aula 1",
  teams: [
    { id: "A", name: "Equipo A", members: [{ id: "A0", name: "Oradora A" }] },
    { id: "B", name: "Equipo B", members: [{ id: "B0", name: "Orador B" }] },
  ],
  jury: ["Juez principal"],
  rules: {},
  desk: "",
};

describe("server short-link snapshot contract", () => {
  it("accepts compact A2 snapshots when rules are inherited from ADUMA defaults", () => {
    expect(validActaSnapshot(compactSnapshot)).toBe(true);
  });

  it("accepts actual string-valued rule enums", () => {
    expect(validActaSnapshot({
      ...compactSnapshot,
      rules: {
        rubric: [{ id: "item", name: "Ítem", section: "Fondo", description: "" }],
        warningConversion: "aduma",
        minorEscalation: "aduma",
        majorMode: "forfeit",
        itemMin: 0,
        itemMax: 5,
      },
    })).toBe(true);
  });

  it("rejects malformed nested members, duplicate identities and oversized structures", () => {
    expect(validActaSnapshot({
      ...compactSnapshot,
      teams: [{ ...compactSnapshot.teams[0], members: [null] }, compactSnapshot.teams[1]],
    })).toBe(false);
    expect(validActaSnapshot({
      ...compactSnapshot,
      teams: [compactSnapshot.teams[0], { ...compactSnapshot.teams[1], id: "A" }],
    })).toBe(false);
    expect(validActaSnapshot({
      ...compactSnapshot,
      jury: Array.from({ length: 21 }, () => "Juez"),
    })).toBe(false);
  });
});
