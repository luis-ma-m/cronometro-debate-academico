import { describe, expect, it } from 'vitest';
import { confirmDraft, createRoundDraft } from './draft';
import { tournamentProgress } from './progress';
import { computeTournamentOutcomes } from './results';
import { makeTournament, playRound } from './test-fixtures';
import type { TabTournament } from './types';

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => prefix + String(i + 1).padStart(2, '0'));
const strength = (teamId: string) => 55 - Number(teamId.slice(1));
const summary = (tournament: TabTournament) => tournamentProgress(tournament, computeTournamentOutcomes(tournament)).map((step) => step.label + ':' + step.state + (step.detail ? ' (' + step.detail + ')' : ''));

function confirmNext(tournament: TabTournament, seed: number): TabTournament {
  const { draft } = createRoundDraft(tournament, seed, 1);
  return confirmDraft({ ...tournament, draftRound: draft! }, draft!.round.id).tournament;
}

describe('tournament progress', () => {
  it('shows the four Swiss rounds and the bracket of eight, with the next step', () => {
    const tournament = makeTournament('aduma', ids('t', 20), ids('j', 30), 10);
    expect(summary(tournament)).toEqual([
      'Ronda 1:next (Siguiente)', 'Ronda 2:pending', 'Ronda 3:pending', 'Ronda 4:pending', 'Cuartos:pending', 'Semifinales:pending', 'Final:pending',
    ]);
  });

  it('follows drafts, actas still missing (not counting debates that are not held) and finished rounds', () => {
    let tournament = makeTournament('aduma', ids('t', 20), ids('j', 30), 10);
    tournament.teams[19].fallenFromRound = 1;
    const { draft } = createRoundDraft(tournament, 3, 1);
    expect(summary({ ...tournament, draftRound: draft! })[0]).toBe('Ronda 1:draft (Borrador)');
    tournament = confirmNext(tournament, 3);
    expect(summary(tournament)[0]).toBe('Ronda 1:active (Actas 0/9)');
    const round = tournament.rounds[0];
    tournament = playRound(tournament, round.id, strength);
    expect(summary(tournament).slice(0, 2)).toEqual(['Ronda 1:done (Completa)', 'Ronda 2:next (Siguiente)']);
  });

  it('names the champion when the final is decided', () => {
    let tournament = makeTournament('aduma', ids('t', 20), ids('j', 30), 10);
    for (let round = 1; round <= 7; round++) {
      tournament = confirmNext(tournament, round);
      tournament = playRound(tournament, tournament.rounds.at(-1)!.id, strength);
    }
    expect(summary(tournament).at(-1)).toBe('Final:done (Campeón: Equipo t01)');
  });

  it('summarises a group stage in one step', () => {
    const tournament = makeTournament('ledu-groups', ids('t', 16), ids('j', 12), 8);
    expect(summary(tournament)[0]).toBe('Liguilla:next (Siguiente)');
    expect(summary(tournament).slice(1)).toEqual(['Cuartos:pending', 'Semifinales:pending', 'Final:pending']);
  });
});
