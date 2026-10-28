import { assignVenues, balanceSides } from './pairing';
import { createRng, hashSeed, shuffle } from './random';
import { makeTabId, normalizeInstitution, qualifyingRounds, type TabGroup, type TabRound, type TabTeam, type TabTournament } from './types';

export function groupName(index: number): string {
  return 'Grupo ' + String.fromCharCode(65 + (index % 26)) + (index >= 26 ? String(Math.floor(index / 26)) : '');
}

/**
 * Seeded group draw with balanced sizes that keeps teams of the same institution apart whenever the sizes allow it.
 * Larger institutions are placed first so they get the most freedom.
 */
export function drawGroups(teams: TabTeam[], groupCount: number, seed: number): TabGroup[] {
  const rng = createRng(seed);
  const count = Math.max(1, Math.min(groupCount, teams.length || 1));
  const groups: TabGroup[] = Array.from({ length: count }, (_, index) => ({ id: makeTabId('grupo'), name: groupName(index), teamIds: [] }));
  const byInstitution = new Map<string, TabTeam[]>();
  for (const team of shuffle(teams, rng)) {
    const key = normalizeInstitution(team.institution) || 'sin-institucion:' + team.id;
    byInstitution.set(key, [...(byInstitution.get(key) ?? []), team]);
  }
  const institutionOrder = shuffle([...byInstitution.keys()], rng).sort((x, y) => byInstitution.get(y)!.length - byInstitution.get(x)!.length);
  const institutionOf = new Map(teams.map((team) => [team.id, normalizeInstitution(team.institution)]));
  for (const key of institutionOrder) {
    for (const team of byInstitution.get(key)!) {
      const smallest = Math.min(...groups.map((group) => group.teamIds.length));
      const sameSize = groups.filter((group) => group.teamIds.length === smallest);
      const institution = normalizeInstitution(team.institution);
      const free = sameSize.filter((group) => !institution || !group.teamIds.some((id) => institutionOf.get(id) === institution));
      const candidates = free.length ? free : sameSize;
      candidates[Math.floor(rng() * candidates.length)].teamIds.push(team.id);
    }
  }
  return groups;
}

/** Circle-method round robin; with an odd number of teams one team rests in each round. */
export function roundRobinRounds(teamIds: string[]): Array<Array<[string, string]>> {
  const bye = '\u0000bye';
  const list = teamIds.length % 2 ? [...teamIds, bye] : [...teamIds];
  const rounds: Array<Array<[string, string]>> = [];
  for (let r = 0; r < list.length - 1; r++) {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < list.length / 2; i++) {
      const home = list[i];
      const away = list[list.length - 1 - i];
      if (home !== bye && away !== bye) pairs.push([home, away]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!);
  }
  return rounds;
}

/** Teams of a group that rest in a given round (odd groups). */
export function restingTeams(tournament: Pick<TabTournament, 'groups'>, round: TabRound): string[] {
  const playing = new Set(round.debates.flatMap((debate) => debate.teamIds));
  return tournament.groups.flatMap((group) => group.teamIds.filter((id) => !playing.has(id)));
}

export function groupOfTeam(tournament: Pick<TabTournament, 'groups'>, teamId: string): TabGroup | undefined {
  return tournament.groups.find((group) => group.teamIds.includes(teamId));
}

export interface GeneratedStage { rounds: TabRound[]; issues: string[]; warnings: string[] }

/** All group-stage rounds at once: round k gathers the k-th fixture of every group. */
export function generateGroupStage(tournament: TabTournament, seed: number, now = Date.now()): GeneratedStage {
  const issues: string[] = [];
  const warnings: string[] = [];
  if (tournament.settings.stage !== 'groups') issues.push('El torneo está configurado con sistema suizo.');
  if (!tournament.groups.length) issues.push('Sortea o crea los grupos antes de generar las jornadas.');
  if (qualifyingRounds(tournament).length) issues.push('Las jornadas de grupos ya están generadas.');
  const known = new Set(tournament.teams.map((team) => team.id));
  for (const group of tournament.groups) {
    if (group.teamIds.filter((id) => known.has(id)).length < 2) issues.push(group.name + ' necesita al menos dos equipos.');
  }
  if (issues.length) return { rounds: [], issues, warnings };

  const schedules = tournament.groups.map((group) => roundRobinRounds(group.teamIds.filter((id) => known.has(id))));
  const roundCount = Math.max(...schedules.map((schedule) => schedule.length));
  const history = new Map<string, { favor: number; contra: number }>();
  const rng = createRng(hashSeed(seed, 'sides'));
  const firstNumber = Math.max(0, ...tournament.rounds.map((round) => round.number)) + 1;
  const sideMode = tournament.settings.qualifyingSideMode;
  const rounds: TabRound[] = [];
  for (let index = 0; index < roundCount; index++) {
    const pairs = schedules.flatMap((schedule) => schedule[index] ?? []);
    const favors = sideMode === 'balanced' ? balanceSides(pairs, history, rng) : [];
    const debates = assignVenues(tournament, pairs.map(([a, b], position) => ({
      id: makeTabId('debate'), venueId: '', teamIds: [a, b] as [string, string], favorTeamId: favors[position], judgeIds: [], chairId: '',
    })));
    if (debates.some((debate) => !debate.venueId)) warnings.push('Jornada ' + (index + 1) + ': no hay salas activas suficientes.');
    rounds.push({
      id: makeTabId('ronda'),
      number: firstNumber + index,
      name: 'Jornada ' + (index + 1),
      kind: 'qualifying',
      sideMode,
      panelSize: tournament.settings.qualifyingPanelSize,
      seed: hashSeed(seed, index),
      silent: false,
      debates,
      createdAt: now,
    });
  }
  return { rounds, issues, warnings };
}
