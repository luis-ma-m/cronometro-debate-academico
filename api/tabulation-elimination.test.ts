import { describe, expect, it } from "vitest";
import { validateTabulationEliminationOutcome } from "./tabulation-elimination.js";

describe("validateTabulationEliminationOutcome", () => {
  it("accepts a winner, loser and one advancing team", () => {
    expect(validateTabulationEliminationOutcome({
      winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-a"],
    }, ["team-a", "team-b"])).toEqual({
      winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-a"],
    });
  });

  it("allows an explicitly configured outcome with both teams advancing", () => {
    expect(validateTabulationEliminationOutcome({
      winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-a", "team-b"],
    }, ["team-a", "team-b"]).advancingTeamIds).toEqual(["team-a", "team-b"]);
  });

  it.each([
    [{ winnerTeamId: "team-a", loserTeamId: "team-a", advancingTeamIds: ["team-a"] }, "distintos"],
    [{ winnerTeamId: "outsider", loserTeamId: "team-b", advancingTeamIds: ["outsider"] }, "asignación"],
    [{ winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-b"] }, "incluir al ganador"],
    [{ winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-a", "team-a"] }, "lista única"],
    [{ winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-a", "outsider"] }, "lista única"],
    [{ winnerTeamId: "team-a", loserTeamId: "team-b" }, "lista única"],
    [{ winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-a"], ignored: true }, "ganador"],
  ])("rejects an invalid bracket result", (value, _expectedMessage) => {
    expect(() => validateTabulationEliminationOutcome(value, ["team-a", "team-b"])).toThrow();
  });

  it("rejects assignments that do not contain exactly two distinct teams", () => {
    expect(() => validateTabulationEliminationOutcome({
      winnerTeamId: "team-a", loserTeamId: "team-b", advancingTeamIds: ["team-a"],
    }, ["team-a"])).toThrow("exactamente a dos");
  });
});
