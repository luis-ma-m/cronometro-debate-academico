import { createRng, hashSeed, shuffle } from './random';
import { computeTournamentOutcomes, roundIsComplete, type DebateOutcome } from './results';
import { buildTeamStandings } from './standings';
import { isFallenAt, makeTabId, nextRoundNumber, qualifyingRounds, sameInstitution, type TabDebate, type TabRound, type TabTeam, type TabTournament } from './types';

export interface PairingContext {
  timesMet(a: string, b: string): number;
  sameInstitution(a: string, b: string): boolean;
  avoidSameInstitution: boolean;
}

export interface PairingResult { pairs: Array<[string, string]>; rematches: number; institutionClashes: number }

const COMPONENTS = 5;

/**
 * Exact dynamic programme over the ranking order. A pair (p, i) with p < i costs, compared lexicographically:
 * [rematch, same institution, i − p − 1, rank(p)·rank(i), n − p if it is not one of the ideal 1–2, 3–4… pairs].
 * The third term keeps changes local, the fourth gives the weaker opponent to the better-ranked team when two
 * local fixes tie (UC3M art. 27: 15.º–16.º already met → 13.º–16.º and 14.º–15.º), and the fifth resolves any
 * remaining tie as low in the table as possible. Pairs are limited to a band of `width` positions.
 */
function pairWithinBand(order: string[], width: number, context: PairingContext): { pairs: Array<[number, number]>; cost: number[] } | null {
  const n = order.length;
  const size = 1 << width;
  const full = size - 1;
  const pairCost = Array.from({ length: COMPONENTS }, () => new Float64Array(n * n));
  for (let p = 0; p < n; p++) {
    for (let i = p + 1; i < n && i - p <= width; i++) {
      const index = p * n + i;
      pairCost[0][index] = context.timesMet(order[p], order[i]) > 0 ? 1 : 0;
      pairCost[1][index] = context.avoidSameInstitution && context.sameInstitution(order[p], order[i]) ? 1 : 0;
      pairCost[2][index] = i - p - 1;
      pairCost[3][index] = (p + 1) * (i + 1);
      pairCost[4][index] = p % 2 === 0 && i === p + 1 ? 0 : n - p;
    }
  }
  let current = Array.from({ length: COMPONENTS }, () => new Float64Array(size).fill(Infinity));
  for (const component of current) component[0] = 0;
  const parentMask = new Int32Array(n * size).fill(-1);
  const parentChoice = new Int8Array(n * size);
  const candidate = new Float64Array(COMPONENTS);

  for (let i = 0; i < n; i++) {
    const next = Array.from({ length: COMPONENTS }, () => new Float64Array(size).fill(Infinity));
    const relax = (fromMask: number, toMask: number, pairIndex: number, choice: number) => {
      for (let k = 0; k < COMPONENTS; k++) candidate[k] = current[k][fromMask] + (pairIndex >= 0 ? pairCost[k][pairIndex] : 0);
      for (let k = 0; k < COMPONENTS; k++) {
        if (candidate[k] < next[k][toMask]) break;
        if (candidate[k] > next[k][toMask]) return;
        if (k === COMPONENTS - 1) return;
      }
      for (let k = 0; k < COMPONENTS; k++) next[k][toMask] = candidate[k];
      parentMask[i * size + toMask] = fromMask;
      parentChoice[i * size + toMask] = choice;
    };
    for (let mask = 0; mask < size; mask++) {
      if (current[0][mask] === Infinity) continue;
      // Bit d of the mask is position i − 1 − d; bit width − 1 leaves the band after this step.
      if (!((mask >> (width - 1)) & 1)) relax(mask, ((mask << 1) | 1) & full, -1, -1);
      for (let d = 0; d < width; d++) {
        if (!((mask >> d) & 1)) continue;
        const p = i - 1 - d;
        if (p < 0) continue;
        const cleared = mask & ~(1 << d);
        if ((cleared >> (width - 1)) & 1) continue;
        relax(mask, (cleared << 1) & full, p * n + i, d);
      }
    }
    current = next;
  }
  if (current[0][0] === Infinity) return null;
  const pairs: Array<[number, number]> = [];
  let mask = 0;
  for (let i = n - 1; i >= 0; i--) {
    const index = i * size + mask;
    const choice = parentChoice[index];
    if (choice >= 0) pairs.push([i - 1 - choice, i]);
    mask = parentMask[index];
  }
  return { pairs: pairs.sort((x, y) => x[0] - y[0]), cost: current.map((component) => component[0]) };
}

function lexLess(x: number[], y: number[]): boolean {
  for (let k = 0; k < x.length; k++) {
    if (x[k] !== y[k]) return x[k] < y[k];
  }
  return false;
}

/** Pairs teams given in ranking order (or a shuffled order for a random round); the first team of each pair ranks higher. */
export function pairInOrder(order: string[], context: PairingContext): PairingResult {
  const n = order.length;
  if (n % 2) throw new Error('Se necesita un número par de equipos para emparejar.');
  if (!n) return { pairs: [], rematches: 0, institutionClashes: 0 };
  const widths = n <= 12 ? [n] : [8, 12];
  let best: { pairs: Array<[number, number]>; cost: number[] } | null = null;
  for (const width of widths) {
    const result = pairWithinBand(order, Math.min(width, n), context);
    if (result && (!best || lexLess(result.cost, best.cost))) best = result;
    if (best && best.cost[0] === 0 && best.cost[1] === 0) break;
  }
  if (!best) throw new Error('No se ha podido calcular el emparejamiento.');
  return {
    pairs: best.pairs.map(([p, i]) => [order[p], order[i]]),
    rematches: best.cost[0],
    institutionClashes: best.cost[1],
  };
}

const pairKey = (x: string, y: string) => (x < y ? x + '|' + y : y + '|' + x);

/** Number of times each pair of teams has met in qualifying rounds (with or without result). */
export function teamMeetings(tournament: TabTournament): Map<string, number> {
  const meetings = new Map<string, number>();
  for (const round of qualifyingRounds(tournament)) {
    for (const debate of round.debates) {
      const [a, b] = debate.teamIds;
      if (a && b) meetings.set(pairKey(a, b), (meetings.get(pairKey(a, b)) ?? 0) + 1);
    }
  }
  return meetings;
}

export function haveMet(meetings: Map<string, number>, a: string, b: string): number {
  return meetings.get(pairKey(a, b)) ?? 0;
}

export function sideHistory(rounds: TabRound[]): Map<string, { favor: number; contra: number }> {
  const history = new Map<string, { favor: number; contra: number }>();
  for (const round of rounds) {
    for (const debate of round.debates) {
      if (!debate.favorTeamId) continue;
      for (const teamId of debate.teamIds) {
        const entry = history.get(teamId) ?? { favor: 0, contra: 0 };
        if (teamId === debate.favorTeamId) entry.favor++;
        else entry.contra++;
        history.set(teamId, entry);
      }
    }
  }
  return history;
}

/** The team that has defended "A favor" fewer times takes it; ties are drawn. Updates `history` in place. */
export function balanceSides(pairs: Array<[string, string]>, history: Map<string, { favor: number; contra: number }>, rng: () => number): string[] {
  return pairs.map(([a, b]) => {
    const ha = history.get(a) ?? { favor: 0, contra: 0 };
    const hb = history.get(b) ?? { favor: 0, contra: 0 };
    const favor = ha.favor !== hb.favor ? (ha.favor < hb.favor ? a : b)
      : ha.contra !== hb.contra ? (ha.contra > hb.contra ? a : b)
        : rng() < 0.5 ? a : b;
    const contra = favor === a ? b : a;
    history.set(favor, { favor: (history.get(favor)?.favor ?? 0) + 1, contra: history.get(favor)?.contra ?? 0 });
    history.set(contra, { favor: history.get(contra)?.favor ?? 0, contra: (history.get(contra)?.contra ?? 0) + 1 });
    return favor;
  });
}

/** Seeded draw of sides for the debates that do not have one yet. */
export function drawSides(round: TabRound, seed: number): TabRound {
  const rng = createRng(seed);
  return {
    ...round,
    debates: round.debates.map((debate) => debate.favorTeamId ? debate : { ...debate, favorTeamId: debate.teamIds[rng() < 0.5 ? 0 : 1] }),
  };
}

/**
 * Sequential venues over the active catalogue; an empty id means there are not enough venues. With a round number,
 * debates against a fallen team are not played and get no venue.
 */
export function assignVenues(tournament: Pick<TabTournament, 'venues'> & { teams?: TabTeam[] }, debates: TabDebate[], roundNumber?: number): TabDebate[] {
  const venues = tournament.venues.filter((venue) => venue.active);
  const fallen = roundNumber === undefined ? new Set<string>() : fallenTeamIds(tournament.teams ?? [], roundNumber);
  let next = 0;
  return debates.map((debate) => ({ ...debate, venueId: debate.teamIds.some((id) => fallen.has(id)) ? '' : venues[next++]?.id ?? '' }));
}

export function fallenTeamIds(teams: TabTeam[], roundNumber: number): Set<string> {
  return new Set(teams.filter((team) => isFallenAt(team, roundNumber)).map((team) => team.id));
}

export const REST_TEAM_NAME = 'Descanso';

/**
 * Filler for an odd number of teams: fallen from round 1, so its rival always wins with the round's average items,
 * and a swing team, so it never appears in the standings or the break.
 */
export function addRestTeam(tournament: TabTournament): TabTournament {
  const names = new Set(tournament.teams.map((team) => team.name));
  let name = REST_TEAM_NAME;
  for (let n = 2; names.has(name); n++) name = REST_TEAM_NAME + ' ' + n;
  const rest: TabTeam = { id: makeTabId('equipo'), name, institution: '', active: true, swing: true, breakEligible: false, incompatibleJudgeIds: [], fallenFromRound: 1 };
  return { ...tournament, teams: [...tournament.teams, rest] };
}

export function pairingContext(tournament: TabTournament): PairingContext {
  const meetings = teamMeetings(tournament);
  const institutions = new Map(tournament.teams.map((team) => [team.id, team.institution]));
  return {
    timesMet: (a, b) => haveMet(meetings, a, b),
    sameInstitution: (a, b) => sameInstitution(institutions.get(a), institutions.get(b)),
    avoidSameInstitution: tournament.settings.avoidSameInstitution,
  };
}

export interface GeneratedRound { round: TabRound | null; issues: string[]; warnings: string[] }

/** Pairing order: current standings, exact ties drawn with the round seed; swing teams and then fallen teams last. */
export function swissOrder(tournament: TabTournament, seed: number, outcomes?: Map<string, DebateOutcome>, roundNumber = nextRoundNumber(tournament)): string[] {
  const active = tournament.teams.filter((team) => team.active);
  const fallen = fallenTeamIds(active, roundNumber);
  const pick = (test: (team: TabTeam) => boolean) => active.filter(test).map((team) => team.id);
  const regular = pick((team) => !team.swing && !fallen.has(team.id));
  const swing = pick((team) => team.swing && !fallen.has(team.id));
  const down = pick((team) => fallen.has(team.id));
  if (!qualifyingRounds(tournament).length) return [...shuffle(regular, createRng(seed)), ...swing, ...down];
  const ranked = buildTeamStandings(tournament, { outcomes })
    .sort((x, y) => x.rank - y.rank || hashSeed(seed, x.teamId) - hashSeed(seed, y.teamId))
    .map((row) => row.teamId);
  const inRankOrder = (ids: string[]) => [...ranked.filter((id) => ids.includes(id)), ...ids.filter((id) => !ranked.includes(id))];
  return [...inRankOrder(regular), ...swing, ...inRankOrder(down)];
}

export function generateSwissRound(tournament: TabTournament, seed: number, now = Date.now()): GeneratedRound {
  const issues: string[] = [];
  const warnings: string[] = [];
  const { settings } = tournament;
  const outcomes = computeTournamentOutcomes(tournament);
  const previous = qualifyingRounds(tournament);
  if (settings.stage !== 'swiss') issues.push('El torneo está configurado con liguilla de grupos.');
  if (tournament.rounds.some((round) => round.kind === 'elimination')) issues.push('Las eliminatorias ya han comenzado.');
  if (previous.length >= settings.swissRounds) issues.push('Ya se han generado las ' + settings.swissRounds + ' rondas clasificatorias.');
  const pending = previous.filter((round) => !roundIsComplete(round, outcomes));
  if (pending.length) issues.push('Completa antes las actas de: ' + pending.map((round) => round.name).join(', ') + '.');
  const active = tournament.teams.filter((team) => team.active);
  if (active.length < 2) issues.push('Se necesitan al menos dos equipos activos.');
  else if (active.length % 2) issues.push('Hay ' + active.length + ' equipos activos y el número debe ser par: añade un equipo «' + REST_TEAM_NAME + '» (o un swing) o desactiva uno.');
  if (issues.length) return { round: null, issues, warnings };

  const roundNumber = nextRoundNumber(tournament);
  const order = swissOrder(tournament, seed, outcomes, roundNumber);
  const fallen = fallenTeamIds(active, roundNumber);
  const againstFallen = (pair: readonly string[]) => pair.some((id) => fallen.has(id));
  // Fallen teams meet each other first, even if they already met, so no real team gets free items from them.
  const fallenOrder = order.filter((id) => fallen.has(id));
  const fallenPairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < fallenOrder.length; i += 2) fallenPairs.push([fallenOrder[i], fallenOrder[i + 1]]);
  const result = pairInOrder(order.filter((id) => !fallenPairs.some((pair) => pair.includes(id))), pairingContext(tournament));
  if (result.rematches) warnings.push(result.rematches + ' enfrentamiento(s) repetido(s) inevitable(s).');
  if (result.institutionClashes) warnings.push(result.institutionClashes + ' debate(s) entre equipos de la misma institución.');
  let pairs = [...result.pairs, ...fallenPairs];
  if (settings.blindQualifying) {
    // Closed rounds (ADUMA art. 29): neither the room order nor the team listed first may reveal the ranking.
    const rng = createRng(hashSeed(seed, 'blind'));
    pairs = shuffle(pairs, rng).map(([a, b]): [string, string] => (rng() < 0.5 ? [a, b] : [b, a]));
  }
  pairs = [...pairs.filter((pair) => !againstFallen(pair)), ...pairs.filter(againstFallen)];
  const sideMode = settings.qualifyingSideMode;
  const favors = sideMode === 'balanced' ? balanceSides(pairs, sideHistory(previous), createRng(hashSeed(seed, 'sides'))) : [];
  const debates = assignVenues(tournament, pairs.map(([a, b], index) => ({
    id: makeTabId('debate'), venueId: '', teamIds: [a, b] as [string, string], favorTeamId: favors[index], judgeIds: [], chairId: '',
  })), roundNumber);
  if (debates.some((debate) => !debate.venueId && !againstFallen(debate.teamIds))) warnings.push('No hay salas activas suficientes para todos los debates.');
  const round: TabRound = {
    id: makeTabId('ronda'),
    number: roundNumber,
    name: 'Ronda ' + (previous.length + 1),
    kind: 'qualifying',
    sideMode,
    panelSize: settings.qualifyingPanelSize,
    seed,
    silent: settings.blindQualifying,
    debates,
    createdAt: now,
  };
  return { round, issues, warnings };
}
