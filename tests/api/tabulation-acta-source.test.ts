import { describe, expect, it } from "vitest";
import { presetSettings } from "../../src/tabulation/presets.js";
import { makeTournament, debate, result, ballots } from "../../src/tabulation/test-fixtures.js";
import { validateTabulationActaSource } from "../../server/tabulation-acta-source.js";
import type { TabulationActaDomainContext } from "../../server/tabulation-acta-domain.js";

function fixture(kind: "qualifying" | "elimination" = "qualifying") {
  const tournament = makeTournament("ledu-groups", ["a", "b"], ["j1", "j2", "j3"], 1);
  const context: TabulationActaDomainContext = {
    canonicalTournamentId: "123e4567-e89b-42d3-a456-426614174000",
    currentRevision: 12,
    currentUpdatedAt: 1800000000000,
    settings: presetSettings("ledu-groups"),
    round: { id: "r1", number: 1, kind, sideMode: "balanced" },
    debate: debate("d1", "a", "b", ["j1", "j2", "j3"], undefined, { venueId: "v1", chairId: "j1" }),
    teams: tournament.teams,
    judges: tournament.judges,
    speakers: tournament.speakers,
  };
  const acta = {
    tournamentId: context.canonicalTournamentId,
    basePanelRevision: context.currentRevision,
    basePanelUpdatedAt: context.currentUpdatedAt,
    roundId: "r1",
    debateId: "d1",
    result: kind === "elimination"
      ? result([{ judgeId: "j1", totals: {}, speeches: {}, winnerTeamId: "a" }, { judgeId: "j2", totals: {}, speeches: {}, winnerTeamId: "a" }, { judgeId: "j3", totals: {}, speeches: {}, winnerTeamId: "b" }])
      : result(ballots("a", "b", [[70, 60], [72, 61], [68, 59]], ["j1", "j2", "j3"])),
  };
  return { context, acta };
}

describe("validateTabulationActaSource", () => {
  it("derives judges mode for a qualifying round and rejects client mode spoofing", () => {
    const { context, acta } = fixture();
    expect(validateTabulationActaSource({ sourceMode: "judges", acta }, context).sourceMode).toBe("judges");
    expect(() => validateTabulationActaSource({ sourceMode: "elimination", acta }, context)).toThrow("no coincide");
  });

  it("requires an explicit elimination result matching the validated ballot winner", () => {
    const { context, acta } = fixture("elimination");
    const source = validateTabulationActaSource({
      sourceMode: "elimination",
      acta,
      eliminationResult: { winnerTeamId: "a", loserTeamId: "b", advancingTeamIds: ["a"] },
    }, context);
    expect(source.eliminationResult).toEqual({
      winnerTeamId: "a", loserTeamId: "b", advancingTeamIds: ["a"],
    });
  });

  it("rejects an explicit knockout winner that contradicts the ballots", () => {
    const { context, acta } = fixture("elimination");
    expect(() => validateTabulationActaSource({
      sourceMode: "elimination",
      acta,
      eliminationResult: { winnerTeamId: "b", loserTeamId: "a", advancingTeamIds: ["b"] },
    }, context)).toThrow("no coincide");
  });

  it("does not accept elimination metadata on qualifying rounds", () => {
    const { context, acta } = fixture();
    expect(() => validateTabulationActaSource({
      sourceMode: "judges",
      acta,
      eliminationResult: { winnerTeamId: "a", loserTeamId: "b", advancingTeamIds: ["a"] },
    }, context)).toThrow("clasificatoria");
  });
});
