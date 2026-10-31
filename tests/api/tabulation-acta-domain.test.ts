import { describe, expect, it } from "vitest";
import { presetSettings } from "../../src/tabulation/presets.js";
import { makeTournament, debate, result, ballots } from "../../src/tabulation/test-fixtures.js";
import { validateTabulationActaResult, TabulationActaValidationError, type TabulationActaDomainContext } from "../../server/tabulation-acta-domain.js";
function fixture() {
  const tournament = makeTournament("ledu-groups", ["a", "b"], ["j1", "j2", "j3"], 1);
  const round = { id: "r1", number: 1, kind: "qualifying" as const, sideMode: "balanced" as const };
  const assigned = debate("d1", "a", "b", ["j1", "j2", "j3"], undefined, { venueId: "v1", chairId: "j1" });
  const context: TabulationActaDomainContext = { canonicalTournamentId: "123e4567-e89b-42d3-a456-426614174000",
    currentRevision: 12, currentUpdatedAt: 1800000000000, settings: presetSettings("ledu-groups"), round, debate: assigned,
    teams: tournament.teams, judges: tournament.judges, speakers: tournament.speakers };
  const payload = { tournamentId: context.canonicalTournamentId, basePanelRevision: 12, basePanelUpdatedAt: context.currentUpdatedAt,
    roundId: "r1", debateId: "d1", result: result(ballots("a", "b", [[70, 60], [72, 61], [68, 59]], ["j1", "j2", "j3"])) };
  return { context, payload };
}
describe("validateTabulationActaResult", () => {
  it("accepts a complete acta using the Tabulation outcome engine", () => {
    const { context, payload } = fixture();
    expect(validateTabulationActaResult(payload, context).result).toEqual(payload.result);
  });
  it("rejects identity, revision, timestamp and debate mismatches", () => {
    const { context, payload } = fixture();
    expect(() => validateTabulationActaResult({ ...payload, tournamentId: "other" }, context)).toThrow(TabulationActaValidationError);
    expect(() => validateTabulationActaResult({ ...payload, basePanelRevision: 11 }, context)).toThrow("obsoleta");
    expect(() => validateTabulationActaResult({ ...payload, debateId: "other" }, context)).toThrow("no corresponde");
  });
  it("rejects duplicate, unassigned and incomplete ballots", () => {
    const { context, payload } = fixture();
    expect(() => validateTabulationActaResult({ ...payload, result: { ...payload.result, ballots: [...payload.result.ballots, payload.result.ballots[0]] } }, context)).toThrow("más de una papeleta");
    expect(() => validateTabulationActaResult({ ...payload, result: { ...payload.result, ballots: payload.result.ballots.map((x) => ({ ...x, judgeId: "outsider" })) } }, context)).toThrow("no está asignado");
    expect(() => validateTabulationActaResult({ ...payload, result: { ...payload.result, ballots: payload.result.ballots.slice(0, 2) } }, context)).toThrow("Faltan actas");
  });
  it("rejects joint actas when individual ballots are configured", () => {
    const { context, payload } = fixture();
    expect(() => validateTabulationActaResult({ ...payload, result: { ...payload.result, joint: { winnerTeamId: "a", items: {}, speakers: {} } } }, context)).toThrow("no para acta conjunta");
  });
  it("validates elimination ballots as votes rather than scores", () => {
    const { context, payload } = fixture(), elimination = { ...context, round: { ...context.round, kind: "elimination" as const } };
    const resultPayload = result([{ judgeId: "j1", totals: {}, speeches: {}, winnerTeamId: "a" }, { judgeId: "j2", totals: {}, speeches: {}, winnerTeamId: "b" }, { judgeId: "j3", totals: {}, speeches: {}, winnerTeamId: "a" }]);
    expect(validateTabulationActaResult({ ...payload, result: resultPayload }, elimination).result).toEqual(resultPayload);
    expect(() => validateTabulationActaResult({ ...payload, result: { ...resultPayload, ballots: [{ judgeId: "j1", totals: { a: 1 }, speeches: {} }] } }, elimination)).toThrow("votar por uno");
  });
  it("rejects unknown ballot fields and intervention positions ignored by the outcome engine", () => {
    const { context, payload } = fixture();
    const ballot = payload.result.ballots[0];
    expect(() => validateTabulationActaResult({
      ...payload,
      result: { ...payload.result, ballots: [{ ...ballot, speeches: { a: { unexpected_role: 50 } } }] },
    }, context)).toThrow("posiciones o valores no válidos");
    expect(() => validateTabulationActaResult({
      ...payload,
      result: { ...payload.result, ballots: [{ ...ballot, unexpected: true }, ...payload.result.ballots.slice(1)] },
    }, context)).toThrow("campos desconocidos");
  });
  it("rejects joint acta rubric items outside the configured rubric", () => {
    const { context, payload } = fixture();
    const jointContext = { ...context, settings: presetSettings("aduma") };
    const jointResult = result([], {
      joint: {
        winnerTeamId: "a",
        items: { a: { unconfigured_item: 5 }, b: {} },
        quickTotals: { a: 40, b: 30 },
        speakers: { a: [], b: [] },
      },
    });
    expect(() => validateTabulationActaResult({ ...payload, result: jointResult }, jointContext))
      .toThrow("ítems desconocidos");
  });
  it("rejects invalid penalty counters and speaker ownership", () => {
    const { context, payload } = fixture();
    expect(() => validateTabulationActaResult({ ...payload, result: { ...payload.result, penalties: { a: { warnings: -1, minors: 0, majors: 0, disqualified: false } } } }, context)).toThrow("sanciones");
    expect(() => validateTabulationActaResult({ ...payload, result: { ...payload.result, lineup: { a: { introductor: "b-s1" } } } }, context)).toThrow("pertenecer");
  });
});
