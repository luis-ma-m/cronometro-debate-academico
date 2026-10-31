import { describe, expect, it } from "vitest";
import { canonicalizeTabulationActa } from "./tabulation-acta-identity.js";

const idMap = {
  teams: { localA: "remoteA", localB: "remoteB" },
  judges: { localJudge: "remoteJudge" },
  speakers: { localSpeaker: "remoteSpeaker" },
};
const targets = {
  tournamentId: "canonical-tournament",
  roundId: "manager-round",
  debateId: "manager-assignment",
  teamIds: ["remoteA", "remoteB"],
  judgeIds: ["remoteJudge"],
  speakerIds: ["remoteSpeaker"],
};

function acta() {
  return {
    tournamentId: "local-tournament",
    roundId: "local-round",
    debateId: "local-debate",
    basePanelRevision: 9,
    basePanelUpdatedAt: 1800000000000,
    result: {
      lineup: { localA: { introductor: "localSpeaker" } },
      ballots: [{ judgeId: "localJudge", totals: { localA: 70, localB: 60 }, speeches: { localA: {}, localB: {} } }],
      penalties: { localA: { warnings: 0, minors: 0, majors: 0, disqualified: false } },
      override: { winnerTeamId: "localA", reason: "prueba" },
      notes: "",
      updatedAt: 1800000000000,
    },
  };
}

describe("canonicalizeTabulationActa", () => {
  it("rewrites all identity references and takes scope from the manager lookup", () => {
    const mapped = canonicalizeTabulationActa(acta(), idMap, targets) as { tournamentId: string; roundId: string; debateId: string; result: Record<string, unknown> };
    expect(mapped).toMatchObject({
      tournamentId: "canonical-tournament", roundId: "manager-round", debateId: "manager-assignment",
      result: {
        lineup: { remoteA: { introductor: "remoteSpeaker" } },
        ballots: [{ judgeId: "remoteJudge", totals: { remoteA: 70, remoteB: 60 } }],
        penalties: { remoteA: { warnings: 0, minors: 0, majors: 0, disqualified: false } },
        override: { winnerTeamId: "remoteA", reason: "prueba" },
      },
    });
  });

  it("rejects missing reviewed identity rather than matching by name or falling back to local IDs", () => {
    const incomplete = { ...idMap, speakers: {} };
    expect(() => canonicalizeTabulationActa(acta(), incomplete, targets)).toThrow("correspondencia revisada");
  });

  it("rejects a map target outside the manager assignment", () => {
    const invalid = { ...idMap, teams: { ...idMap.teams, localA: "unassigned-team" } };
    expect(() => canonicalizeTabulationActa(acta(), invalid, targets)).toThrow("correspondencia revisada");
  });

  it("rejects two local entities mapped to the same remote entity", () => {
    const duplicate = { ...idMap, teams: { localA: "remoteA", localB: "remoteA" } };
    expect(() => canonicalizeTabulationActa(acta(), duplicate, targets)).toThrow("misma entidad remota");
  });

  it("maps joint acta teams and speaker references without losing rubric values", () => {
    const joint = {
      ...acta(),
      result: {
        lineup: { localA: { introductor: "localSpeaker" } },
        ballots: [],
        penalties: {},
        joint: {
          winnerTeamId: "localA",
          items: { localA: { argument: 7 }, localB: { argument: 6 } },
          speakers: { localA: [{ speakerId: "localSpeaker", score: 8, roles: ["introductor"] }], localB: [] },
        },
        notes: "",
        updatedAt: 1800000000000,
      },
    };
    const mapped = canonicalizeTabulationActa(joint, idMap, targets) as { result: { joint: Record<string, unknown> } };
    expect(mapped.result.joint).toEqual({
      winnerTeamId: "remoteA",
      items: { remoteA: { argument: 7 }, remoteB: { argument: 6 } },
      speakers: { remoteA: [{ speakerId: "remoteSpeaker", score: 8, roles: ["introductor"] }], remoteB: [] },
    });
  });
});
