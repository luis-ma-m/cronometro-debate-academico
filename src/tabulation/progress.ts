import { tournamentChampion } from './bracket';
import type { DebateOutcome } from './results';
import { eliminationRounds, isFallenAt, qualifyingRounds, type TabRound, type TabTournament } from './types';

export type StepState = 'done' | 'active' | 'draft' | 'next' | 'pending';
export interface ProgressStep { key: string; label: string; state: StepState; detail: string }

function stageName(debates: number): string {
  if (debates === 1) return 'Final';
  if (debates === 2) return 'Semifinales';
  if (debates === 4) return 'Cuartos';
  if (debates === 8) return 'Octavos';
  if (debates === 16) return 'Dieciseisavos';
  return 'Eliminatoria de ' + debates * 2;
}

/**
 * Where the tournament stands, step by step: every qualifying round (or the whole group stage) and every
 * elimination round. Debates against a fallen team need no acta and are not counted.
 */
export function tournamentProgress(tournament: TabTournament, outcomes: Map<string, DebateOutcome>): ProgressStep[] {
  const { settings } = tournament;
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const held = (round: TabRound) => round.debates.filter((debate) => !debate.teamIds.some((id) => isFallenAt(teams.get(id), round.number)));
  const counts = (round: TabRound) => {
    const debates = held(round);
    return { complete: debates.filter((debate) => outcomes.get(debate.id)?.status === 'complete').length, total: debates.length };
  };
  const finished = (round: TabRound) => {
    const { complete, total } = counts(round);
    return complete === total;
  };
  const draft = tournament.draftRound;
  const allFinished = tournament.rounds.every(finished);
  const steps: ProgressStep[] = [];
  let nextGiven = false;
  /** The first step not generated yet is the next one, if nothing before it is pending. */
  const missing = (key: string, label: string, isDraft: boolean): ProgressStep => {
    if (isDraft) {
      nextGiven = true;
      return { key, label, state: 'draft', detail: 'Borrador' };
    }
    if (!nextGiven && !draft && allFinished) {
      nextGiven = true;
      return { key, label, state: 'next', detail: 'Siguiente' };
    }
    nextGiven = true;
    return { key, label, state: 'pending', detail: '' };
  };
  const existing = (key: string, label: string, round: TabRound): ProgressStep => {
    const { complete, total } = counts(round);
    return complete === total ? { key, label, state: 'done', detail: 'Completa' } : { key, label, state: 'active', detail: 'Actas ' + complete + '/' + total };
  };

  const qualifying = qualifyingRounds(tournament);
  if (settings.stage === 'groups') {
    if (!qualifying.length) steps.push(missing('groups', 'Liguilla', false));
    else {
      const done = qualifying.filter(finished).length;
      steps.push(done === qualifying.length
        ? { key: 'groups', label: 'Liguilla', state: 'done', detail: 'Completa' }
        : { key: 'groups', label: 'Liguilla', state: 'active', detail: 'Jornadas ' + done + '/' + qualifying.length });
    }
  } else {
    for (let index = 0; index < settings.swissRounds; index++) {
      const round = qualifying[index];
      const label = 'Ronda ' + (index + 1);
      steps.push(round ? existing('q' + index, label, round) : missing('q' + index, label, draft?.kind === 'swiss' && index === qualifying.length));
    }
  }

  const eliminations = eliminationRounds(tournament);
  const qualifiers = settings.stage === 'groups' ? settings.groupCount * settings.groupAdvance : settings.breakSize;
  const champion = tournamentChampion(tournament, outcomes);
  let debates = Math.max(1, Math.floor(qualifiers / 2));
  for (let index = 0; ; index++) {
    const round = eliminations[index];
    const label = stageName(round ? round.debates.length : debates);
    const step = round ? existing('e' + index, label, round) : missing('e' + index, label, draft?.kind === 'elimination' && index === eliminations.length);
    if (step.state === 'done' && debates === 1 && champion) step.detail = 'Campeón: ' + (teams.get(champion)?.name ?? '');
    steps.push(step);
    if (debates === 1) break;
    debates = Math.floor(debates / 2);
  }
  return steps;
}
