import { assignVenues } from './pairing';
import { computeTournamentOutcomes, roundIsComplete, type DebateOutcome } from './results';
import { buildGroupStandings, buildTeamStandings, type TeamStanding } from './standings';
import { eliminationRounds, isFallenAt, makeTabId, nextRoundNumber, qualifyingRounds, type TabRound, type TabTournament } from './types';

export function eliminationRoundName(debateCount: number): string {
  if (debateCount === 1) return 'Final';
  if (debateCount === 2) return 'Semifinales';
  if (debateCount === 4) return 'Cuartos de final';
  if (debateCount === 8) return 'Octavos de final';
  if (debateCount === 16) return 'Dieciseisavos de final';
  return 'Eliminatoria de ' + debateCount * 2;
}

const isPowerOfTwo = (value: number) => value >= 2 && (value & (value - 1)) === 0;

/** Bracket order of seeds so that 1 and 2 can only meet in the final: 8 → [1, 8, 4, 5, 2, 7, 3, 6]. */
export function standardSeedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const doubled = order.length * 2;
    order = order.flatMap((seed) => [seed, doubled + 1 - seed]);
  }
  return order;
}

export interface Qualifier { teamId: string; seed: number; groupIndex: number | null; groupPosition: number | null }
export interface BreakPreview { qualifiers: Qualifier[]; issues: string[]; warnings: string[] }

function cutIssue(rows: TeamStanding[], size: number, label: string): string | null {
  const last = rows[size - 1];
  const next = rows[size];
  if (!last || !next || last.rank !== next.rank) return null;
  return label + 'empate sin resolver en el corte entre ' + last.name + ' y ' + next.name + '. Desempátalo en Clasificación.';
}

export function computeBreak(tournament: TabTournament, outcomes = computeTournamentOutcomes(tournament)): BreakPreview {
  const { settings } = tournament;
  const issues: string[] = [];
  const warnings: string[] = [];
  const rounds = qualifyingRounds(tournament);
  if (!rounds.length || rounds.some((round) => !roundIsComplete(round, outcomes))) issues.push('La fase clasificatoria no ha terminado: faltan rondas o actas.');
  else if (settings.stage === 'swiss' && rounds.length < settings.swissRounds) issues.push('Solo se han disputado ' + rounds.length + ' de ' + settings.swissRounds + ' rondas suizas.');
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const breakRound = nextRoundNumber(tournament);
  // A fallen team never breaks: the next team in the standings takes its place.
  const eligible = (row: TeamStanding) => {
    const team = teams.get(row.teamId);
    return Boolean(team?.active && team.breakEligible && !isFallenAt(team, breakRound));
  };
  const qualifiers: Qualifier[] = [];

  if (settings.stage === 'swiss') {
    const rows = buildTeamStandings(tournament, { outcomes }).filter(eligible);
    const size = settings.breakSize;
    if (!isPowerOfTwo(size)) issues.push('El corte debe ser 2, 4, 8, 16 o 32 equipos.');
    if (rows.length < size) issues.push('Solo hay ' + rows.length + ' equipos elegibles para un corte de ' + size + '.');
    const tie = cutIssue(rows, size, '');
    if (tie) issues.push(tie.charAt(0).toUpperCase() + tie.slice(1));
    rows.slice(0, size).forEach((row, index) => qualifiers.push({ teamId: row.teamId, seed: index + 1, groupIndex: null, groupPosition: null }));
  } else {
    const advance = settings.groupAdvance;
    const byPosition: string[][] = Array.from({ length: advance }, () => []);
    const positions = new Map<string, { groupIndex: number; groupPosition: number }>();
    buildGroupStandings(tournament, { outcomes }).forEach(({ group, rows }, groupIndex) => {
      const eligibleRows = rows.filter(eligible);
      if (eligibleRows.length < advance) issues.push(group.name + ' no tiene ' + advance + ' equipos elegibles.');
      const tie = cutIssue(eligibleRows, advance, group.name + ': ');
      if (tie) issues.push(tie);
      eligibleRows.slice(0, advance).forEach((row, position) => {
        byPosition[position].push(row.teamId);
        positions.set(row.teamId, { groupIndex, groupPosition: position + 1 });
      });
    });
    // Same group position first (all winners, then all runners-up), ordered by their overall record.
    for (const ids of byPosition) {
      if (!ids.length) continue;
      for (const row of buildTeamStandings(tournament, { outcomes, teamIds: ids })) {
        const meta = positions.get(row.teamId)!;
        qualifiers.push({ teamId: row.teamId, seed: qualifiers.length + 1, ...meta });
      }
    }
    if (!isPowerOfTwo(qualifiers.length)) issues.push('Se clasifican ' + qualifiers.length + ' equipos: el cuadro necesita 2, 4, 8, 16 o 32.');
  }
  return { qualifiers, issues, warnings };
}

/** A custom bracket order counts only when it is a permutation of 1…size. */
function isSeedOrder(order: number[] | undefined, size: number): order is number[] {
  return Boolean(order && order.length === size && [...order].sort((x, y) => x - y).every((seed, index) => seed === index + 1));
}

/**
 * First elimination pairs in bracket order. Two teams per group with an even number of groups use the cross
 * template 1ºA–2ºB, 1ºC–2ºD | 1ºB–2ºA, 1ºD–2ºC, which keeps group mates in opposite halves; otherwise seeds
 * follow `bracketSeedOrder` when it fits the break (ADUMA art. 31: 1–8, 3–6, 2–7, 4–5) or the standard order
 * (1v8, 4v5, 2v7, 3v6).
 */
export function firstEliminationPairs(tournament: TabTournament, qualifiers: Qualifier[]): Array<[string, string]> {
  const { settings } = tournament;
  const groupCount = tournament.groups.length;
  if (settings.stage === 'groups' && settings.groupAdvance === 2 && groupCount >= 2 && groupCount % 2 === 0) {
    const find = (groupIndex: number, position: number) => qualifiers.find((item) => item.groupIndex === groupIndex && item.groupPosition === position)?.teamId;
    const top: Array<[string, string]> = [];
    const bottom: Array<[string, string]> = [];
    for (let k = 0; k < groupCount; k += 2) {
      const first = [find(k, 1), find(k + 1, 2)];
      const second = [find(k + 1, 1), find(k, 2)];
      if (first.every(Boolean) && second.every(Boolean)) {
        top.push(first as [string, string]);
        bottom.push(second as [string, string]);
      }
    }
    if (top.length * 4 === qualifiers.length) return [...top, ...bottom];
  }
  const seeds = [...qualifiers].sort((x, y) => x.seed - y.seed).map((item) => item.teamId);
  const order = isSeedOrder(settings.bracketSeedOrder, seeds.length) ? settings.bracketSeedOrder : standardSeedOrder(seeds.length);
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < order.length; i += 2) pairs.push([seeds[order[i] - 1], seeds[order[i + 1] - 1]]);
  return pairs;
}

export function buildEliminationRound(tournament: TabTournament, pairs: Array<[string, string]>, seed: number, now = Date.now()): TabRound {
  const number = nextRoundNumber(tournament);
  return {
    id: makeTabId('ronda'),
    number,
    name: eliminationRoundName(pairs.length),
    kind: 'elimination',
    sideMode: 'draw',
    panelSize: tournament.settings.eliminationPanelSize,
    seed,
    silent: false,
    debates: assignVenues(tournament, pairs.map(([a, b], index) => ({
      id: makeTabId('debate'), venueId: '', teamIds: [a, b] as [string, string], judgeIds: [], chairId: '', bracketSlot: index,
    })), number),
    createdAt: now,
  };
}

export interface GeneratedElimination { round: TabRound | null; breakSeeds: string[]; champion: string | null; issues: string[] }

export function generateFirstElimination(tournament: TabTournament, seed: number, now = Date.now()): GeneratedElimination {
  if (eliminationRounds(tournament).length) return { round: null, breakSeeds: tournament.breakSeeds, champion: null, issues: ['Las eliminatorias ya han comenzado.'] };
  const preview = computeBreak(tournament);
  if (preview.issues.length) return { round: null, breakSeeds: [], champion: null, issues: preview.issues };
  const pairs = firstEliminationPairs(tournament, preview.qualifiers);
  return {
    round: buildEliminationRound(tournament, pairs, seed, now),
    breakSeeds: [...preview.qualifiers].sort((x, y) => x.seed - y.seed).map((item) => item.teamId),
    champion: null,
    issues: [],
  };
}

function bracketWinners(round: TabRound, outcomes: Map<string, DebateOutcome>): string[] {
  return [...round.debates]
    .sort((x, y) => (x.bracketSlot ?? 0) - (y.bracketSlot ?? 0))
    .map((debate) => outcomes.get(debate.id)?.winnerTeamId ?? '');
}

/** Winner of the final, if it has been decided. */
export function tournamentChampion(tournament: TabTournament, outcomes = computeTournamentOutcomes(tournament)): string | null {
  const last = eliminationRounds(tournament).at(-1);
  if (!last || last.debates.length !== 1 || !roundIsComplete(last, outcomes)) return null;
  return outcomes.get(last.debates[0].id)?.winnerTeamId ?? null;
}

export function generateNextElimination(tournament: TabTournament, seed: number, now = Date.now()): GeneratedElimination {
  const outcomes = computeTournamentOutcomes(tournament);
  const last = eliminationRounds(tournament).at(-1);
  if (!last) return { round: null, breakSeeds: tournament.breakSeeds, champion: null, issues: ['Todavía no hay eliminatorias.'] };
  if (!roundIsComplete(last, outcomes)) return { round: null, breakSeeds: tournament.breakSeeds, champion: null, issues: ['Completa antes las actas de ' + last.name + '.'] };
  const winners = bracketWinners(last, outcomes);
  if (winners.length === 1) return { round: null, breakSeeds: tournament.breakSeeds, champion: winners[0], issues: [] };
  if (winners.length % 2) return { round: null, breakSeeds: tournament.breakSeeds, champion: null, issues: ['El número de ganadores no permite otra eliminatoria.'] };
  const pairs: Array<[string, string]> = [];
  if (tournament.settings.bracketMode === 'reseed') {
    const seedOf = (id: string) => {
      const index = tournament.breakSeeds.indexOf(id);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    const sorted = [...winners].sort((x, y) => seedOf(x) - seedOf(y));
    for (let i = 0; i < sorted.length / 2; i++) pairs.push([sorted[i], sorted[sorted.length - 1 - i]]);
  } else {
    for (let i = 0; i < winners.length; i += 2) pairs.push([winners[i], winners[i + 1]]);
  }
  return { round: buildEliminationRound(tournament, pairs, seed, now), breakSeeds: tournament.breakSeeds, champion: null, issues: [] };
}
