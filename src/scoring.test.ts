import { describe, expect, it } from "vitest";
import type { Room, Round, Speaker, Team, Judge } from "./domain";
import {
  DEFAULT_SCORE_CATEGORIES,
  emptyScoringConfig,
  parseScoringConfig,
  sumCategoryScores,
  validateScorecard,
  type RoundScorecard,
} from "./scoring";

function makeFixture() {
  const rounds: Round[] = [{ id: "r1", number: 1, name: "Clasificatoria 1", active: true, defaultFormatId: "f1", scoreType: "qualifying" }];
  const teams: Team[] = [
    { id: "t1", name: "Equipo A", institution: "", active: true, incompatibleJudgeIds: [] },
    { id: "t2", name: "Equipo B", institution: "", active: true, incompatibleJudgeIds: [] },
  ];
  const speakers: Speaker[] = [
    { id: "s1", teamId: "t1", name: "Ana" },
    { id: "s2", teamId: "t2", name: "Luis" },
  ];
  const judges: Judge[] = [{ id: "j1", name: "Juez", institution: "", active: true, incompatibleJudgeIds: [] }];
  const room = {
    id: "room1", name: "Sala 1", roundId: "r1", physicalRoomId: "p1", formatId: "f1",
    teamFavorId: "t1", teamContraId: "t2", judgeIds: ["j1"], status: "finished" as const,
    phases: [], timer: { status: "finished" as const, phaseIndex: 0, remainingSeconds: 0, startedAt: 1, lastResumedAt: 1, revision: 1, updatedAt: 1 },
    notes: "", updatedAt: 1,
  } as Room;
  const config = emptyScoringConfig();
  const categoryScores = Object.fromEntries(config.categories.map((category) => [category.id, 1]));
  const card: RoundScorecard = {
    id: "card1", roundId: "r1", roundName: "Clasificatoria 1", roomId: "room1", roomName: "Sala 1",
    teamFavorId: "t1", teamContraId: "t2", judges: [{ judgeId: "j1", judgeName: "Juez" }],
    teams: [
      { teamId: "t1", teamName: "Equipo A", categoryScores: { ...categoryScores }, total: sumCategoryScores(categoryScores, config.categories), minorFaults: 0, majorFaults: 0 },
      { teamId: "t2", teamName: "Equipo B", categoryScores: { ...categoryScores }, total: sumCategoryScores(categoryScores, config.categories), minorFaults: 1, majorFaults: 0 },
    ],
    speakers: [{ speakerId: "s1", speakerName: "Ana", teamId: "t1", position: "introductor", score: 8.5 }],
    createdAt: 1, updatedAt: 1,
  };
  return { rounds, teams, speakers, judges, room, config, card };
}

describe("Round scoring", () => {
  it("provides editable default categories and sums their values", () => {
    expect(DEFAULT_SCORE_CATEGORIES.map((category) => category.name)).toEqual(["Forma", "Evidencias", "Refutaciones"]);
    expect(sumCategoryScores({ form: 4, evidence: 2, rebuttal: 5 }, DEFAULT_SCORE_CATEGORIES)).toBe(11);
  });

  it("validates team totals, fault counts, judges and roster-bound speaker scores", () => {
    const fixture = makeFixture();
    const context = { rounds: fixture.rounds, rooms: [fixture.room], teams: fixture.teams, judges: fixture.judges, speakers: fixture.speakers };
    expect(validateScorecard(fixture.card, fixture.config.categories, context)).toEqual([]);
    fixture.card.speakers[0].score = 8.3;
    expect(validateScorecard(fixture.card, fixture.config.categories, context).join(" ")).toContain("intervalos de 0,5");
  });

  it("does not allow scoring an unfinished or elimination round", () => {
    const fixture = makeFixture();
    const context = { rounds: fixture.rounds, rooms: [fixture.room], teams: fixture.teams, judges: fixture.judges, speakers: fixture.speakers };
    fixture.room.timer.status = "running";
    expect(validateScorecard(fixture.card, fixture.config.categories, context).join(" ")).toContain("finalizados");
    fixture.room.timer.status = "finished";
    fixture.rounds[0].scoreType = "elimination";
    expect(validateScorecard(fixture.card, fixture.config.categories, context).join(" ")).toContain("eliminatorias");
  });

  it("requires both teams, and disallows scoring a speaker for the opposing side", () => {
    const fixture = makeFixture();
    const context = { rounds: fixture.rounds, rooms: [fixture.room], teams: fixture.teams, judges: fixture.judges, speakers: fixture.speakers };
    fixture.card.teams[1].teamId = "t1";
    expect(validateScorecard(fixture.card, fixture.config.categories, context).join(" ")).toContain("puntuación distinta");
    fixture.card.teams[1].teamId = "t2";
    fixture.card.speakers[0].teamId = "t2";
    expect(validateScorecard(fixture.card, fixture.config.categories, context).join(" ")).toContain("registro de su equipo");
  });

  it("parses legacy missing scoring settings without requiring a schema migration", () => {
    expect(parseScoringConfig(undefined).categories).toEqual(DEFAULT_SCORE_CATEGORIES);
    expect(parseScoringConfig({ categories: [], scorecards: [] }).scorecards).toEqual([]);
  });
});
