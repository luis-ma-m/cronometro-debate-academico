import { createRng, hashSeed, shuffle } from './random';
import { computeTournamentOutcomes, roundIsComplete, type DebateOutcome } from './results';
import { buildTeamStandings } from './standings';
import { makeTabId, qualifyingRounds, sameInstitution, type TabDebate, type TabRound, type TabTournament } from './types';

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

/** Sequential venues over the active catalogue; an empty id means there are not enough venues. */
export function assignVenues(tournament: Pick<TabTournament, 'venues'>, debates: TabDebate[]): TabDebate[] {
  const venues = tournament.venues.filter((venue) => venue.active);
  return debates.map((debate, index) => ({ ...debate, venueId: venues[index]?.id ?? '' }));
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

/** Pairing order: current standings, exact ties drawn with the round seed, swing teams last. */
export function swissOrder(tournament: TabTournament, seed: number, outcomes?: Map<string, DebateOutcome>): string[] {
  const active = tournament.teams.filter((team) => team.active);
  const swing = active.filter((team) => team.swing).map((team) => team.id);
  const regular = active.filter((team) => !team.swing).map((team) => team.id);
  if (!qualifyingRounds(tournament).length) return [...shuffle(regular, createRng(seed)), ...swing];
  const standings = buildTeamStandings(tournament, { outcomes }).filter((row) => regular.includes(row.teamId));
  const ordered = [...standings].sort((x, y) => x.rank - y.rank || hashSeed(seed, x.teamId) - hashSeed(seed, y.teamId)).map((row) => row.teamId);
  return [...ordered, ...regular.filter((id) => !ordered.includes(id)), ...swing];
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
  else if (active.length % 2) issues.push('Hay ' + active.length + ' equipos activos: el número debe ser par. Añade un equipo swing o desactiva uno.');
  if (issues.length) return { round: null, issues, warnings };

  const order = swissOrder(tournament, seed, outcomes);
  const result = pairInOrder(order, pairingContext(tournament));
  if (result.rematches) warnings.push(result.rematches + ' enfrentamiento(s) repetido(s) inevitable(s).');
  if (result.institutionClashes) warnings.push(result.institutionClashes + ' debate(s) entre equipos de la misma institución.');
  const sideMode = settings.qualifyingSideMode;
  const favors = sideMode === 'balanced' ? balanceSides(result.pairs, sideHistory(previous), createRng(hashSeed(seed, 'sides'))) : [];
  const debates = assignVenues(tournament, result.pairs.map(([a, b], index) => ({
    id: makeTabId('debate'), venueId: '', teamIds: [a, b] as [string, string], favorTeamId: favors[index], judgeIds: [], chairId: '',
  })));
  if (debates.some((debate) => !debate.venueId)) warnings.push('No hay salas activas suficientes para todos los debates.');
  const round: TabRound = {
    id: makeTabId('ronda'),
    number: Math.max(0, ...tournament.rounds.map((item) => item.number)) + 1,
    name: 'Ronda ' + (previous.length + 1),
    kind: 'qualifying',
    sideMode,
    panelSize: settings.qualifyingPanelSize,
    seed,
    silent: false,
    debates,
    createdAt: now,
  };
  return { round, issues, warnings };
}
