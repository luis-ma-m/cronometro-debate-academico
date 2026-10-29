import { describe, expect, it } from 'vitest';
import { confirmDraft, createRoundDraft } from './draft';
import { computeTournamentOutcomes } from './results';
import { createSampleTournament, simulateRoundResults } from './sample';
import { buildSpeakerStandings } from './standings';

describe('ADUMA sample', () => {
  it('has twenty teams, enough judges for panels of three and ten rooms', () => {
    const tournament = createSampleTournament('aduma', 1, 7);
    expect([tournament.teams.length, tournament.judges.length, tournament.venues.length]).toEqual([20, 30, 10]);
    expect(new Set(tournament.teams.map((team) => team.name)).size).toBe(20);
  });

  it('simulates complete joint actas, skipping debates against a fallen team', () => {
    let tournament = createSampleTournament('aduma', 1, 7);
    tournament.teams[19].fallenFromRound = 1;
    const { draft } = createRoundDraft(tournament, 3, 1);
    tournament = confirmDraft({ ...tournament, draftRound: draft! }, draft!.round.id).tournament;
    const { tournament: played, skipped } = simulateRoundResults(tournament, draft!.round.id, 9);
    expect(skipped).toBe(0);
    const outcomes = computeTournamentOutcomes(played);
    const round = played.rounds[0];
    expect(round.debates.every((debate) => outcomes.get(debate.id)!.status === 'complete')).toBe(true);
    expect(round.debates.filter((debate) => debate.result)).toHaveLength(9);
    expect(buildSpeakerStandings(played).find((ranking) => ranking.key === 'all')!.rows.length).toBeGreaterThan(30);
  });
});
