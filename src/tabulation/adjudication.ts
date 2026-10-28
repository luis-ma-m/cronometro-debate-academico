import type { Judge, Room, Team } from '../domain';
import { findAssignmentConflicts } from '../incompatibilities';
import { teamMeetings, haveMet } from './pairing';
import { createRng, hashSeed } from './random';
import { buildTeamStandings } from './standings';
import { sameInstitution, type TabDebate, type TabJudge, type TabRound, type TabTeam, type TabTournament } from './types';

/** Integer cost tiers: a forbidden seat is always worse than an empty one, which is worse than any soft preference. */
export const ALLOCATION_COST = { FORBIDDEN: 1e9, EMPTY: 1e6, NON_CHAIR: 1e4, SEEN_TEAM: 1e3 } as const;

/**
 * Minimum-cost assignment (Hungarian algorithm with potentials) for a rows × cols matrix with rows ≤ cols.
 * Returns the column chosen for each row. Costs must be finite.
 */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  if (!n) return [];
  const m = cost[0].length;
  if (m < n) throw new Error('La matriz de asignación necesita al menos tantas columnas como filas.');
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const owner = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let row = 1; row <= n; row++) {
    owner[0] = row;
    let column = 0;
    const minimum = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[column] = true;
      const current = owner[column];
      let delta = Infinity;
      let nextColumn = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const reduced = cost[current - 1][j - 1] - u[current] - v[j];
        if (reduced < minimum[j]) { minimum[j] = reduced; way[j] = column; }
        if (minimum[j] < delta) { delta = minimum[j]; nextColumn = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[owner[j]] += delta; v[j] -= delta; } else minimum[j] -= delta;
      }
      column = nextColumn;
    } while (owner[column] !== 0);
    do {
      const previous = way[column];
      owner[column] = owner[previous];
      column = previous;
    } while (column);
  }
  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (owner[j]) result[owner[j] - 1] = j - 1;
  return result;
}

export function judgeTeamConflict(judge: TabJudge, team: TabTeam): string | null {
  if (sameInstitution(judge.institution, team.institution)) return 'misma institución que ' + team.name;
  if (team.incompatibleJudgeIds.includes(judge.id)) return 'incompatible con ' + team.name;
  return null;
}

export function judgesConflict(a: TabJudge, b: TabJudge): boolean {
  return a.incompatibleJudgeIds.includes(b.id) || b.incompatibleJudgeIds.includes(a.id);
}

export function availableJudges(tournament: TabTournament, round: TabRound): TabJudge[] {
  return tournament.judges.filter((judge) => judge.active && !judge.unavailableRoundIds.includes(round.id));
}

/** Best chair among the panel: judges allowed to chair first, then by rating. */
export function pickChair(judgeIds: string[], judges: Map<string, TabJudge>): string {
  const panel = judgeIds.map((id) => judges.get(id)).filter((judge): judge is TabJudge => Boolean(judge));
  panel.sort((x, y) => Number(y.canChair) - Number(x.canChair) || y.rating - x.rating || x.name.localeCompare(y.name, 'es'));
  return panel[0]?.id ?? '';
}

export interface AllocationResult { debates: TabDebate[]; warnings: string[] }

/**
 * Fills the panels of a round. Panels stay odd: when judges are scarce the least important debates drop to a
 * smaller odd panel, and a seat that can only be filled with a conflicted judge is left empty. With
 * `replace: false` existing (manual) judges are kept and only empty seats are filled.
 */
export function allocateJudges(tournament: TabTournament, roundId: string, options: { replace: boolean; seed?: number }): AllocationResult {
  const round = tournament.rounds.find((item) => item.id === roundId);
  if (!round) return { debates: [], warnings: ['La ronda no existe.'] };
  const warnings: string[] = [];
  const rng = createRng(options.seed ?? hashSeed(round.seed, 'jueces', Date.now()));
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const judges = new Map(tournament.judges.map((judge) => [judge.id, judge]));
  const panelSize = Math.max(1, round.panelSize % 2 ? round.panelSize : round.panelSize + 1);
  if (panelSize !== round.panelSize) warnings.push('Los paneles deben ser impares: se usa un panel de ' + panelSize + '.');

  const debates = round.debates.map((debate) => ({ ...debate, judgeIds: options.replace ? [] : [...debate.judgeIds] }));
  const used = new Set(debates.flatMap((debate) => debate.judgeIds));
  let pool = availableJudges(tournament, round).filter((judge) => !used.has(judge.id));

  // Teams each judge has already seen in other rounds.
  const seen = new Map<string, Set<string>>();
  for (const other of tournament.rounds) {
    if (other.id === round.id) continue;
    for (const debate of other.debates) {
      for (const judgeId of debate.judgeIds) {
        const set = seen.get(judgeId) ?? new Set<string>();
        debate.teamIds.forEach((teamId) => set.add(teamId));
        seen.set(judgeId, set);
      }
    }
  }

  // Importance: eliminations matter most; in qualifying rounds, debates between teams with more wins.
  const wins = new Map(buildTeamStandings(tournament, { upToRoundNumber: round.number - 1 }).map((row) => [row.teamId, row.wins]));
  const rawImportance = debates.map((debate) => round.kind === 'elimination' ? 1 : debate.teamIds.reduce((total, id) => total + (wins.get(id) ?? 0), 0));
  const maxImportance = Math.max(1, ...rawImportance);
  const importance = rawImportance.map((value) => round.kind === 'elimination' ? 1 : value / maxImportance);

  // Odd targets that fit the available judges, shrinking the least important debates first.
  const target = debates.map((debate) => Math.max(panelSize, debate.judgeIds.length % 2 ? debate.judgeIds.length : debate.judgeIds.length + 1));
  const needed = () => target.reduce((total, size, index) => total + Math.max(0, size - debates[index].judgeIds.length), 0);
  const byImportance = debates.map((_, index) => index).sort((x, y) => importance[x] - importance[y]);
  let shrunk = false;
  while (needed() > pool.length) {
    const index = byImportance.find((i) => target[i] - 2 >= Math.max(1, debates[i].judgeIds.length));
    if (index === undefined) break;
    target[index] -= 2;
    shrunk = true;
  }
  if (shrunk) warnings.push('No hay jueces suficientes: algunos debates tendrán un panel menor.');

  const added: string[][] = debates.map(() => []);
  const blocked = new Set<number>();
  for (;;) {
    const rows = debates.map((_, index) => index)
      .filter((index) => !blocked.has(index) && debates[index].judgeIds.length < target[index])
      .sort((x, y) => importance[y] - importance[x]);
    if (!rows.length || !pool.length) break;
    const matrix = rows.map((index) => {
      const debate = debates[index];
      const panel = debate.judgeIds.map((id) => judges.get(id)).filter((judge): judge is TabJudge => Boolean(judge));
      const chairSeat = panel.length === 0;
      const judgeCosts = pool.map((judge) => {
        const debateTeams = debate.teamIds.map((id) => teams.get(id)).filter((team): team is TabTeam => Boolean(team));
        if (debateTeams.some((team) => judgeTeamConflict(judge, team)) || panel.some((other) => judgesConflict(judge, other))) return ALLOCATION_COST.FORBIDDEN;
        const seenCount = debate.teamIds.filter((id) => seen.get(judge.id)?.has(id)).length;
        const quality = Math.round((5 - Math.min(5, Math.max(1, judge.rating))) * importance[index] * 100);
        return (chairSeat && !judge.canChair ? ALLOCATION_COST.NON_CHAIR : 0) + seenCount * ALLOCATION_COST.SEEN_TEAM + quality + rng();
      });
      return [...judgeCosts, ...rows.map(() => ALLOCATION_COST.EMPTY)];
    });
    const assignment = hungarian(matrix);
    let progress = false;
    rows.forEach((index, row) => {
      const column = assignment[row];
      if (column < 0 || column >= pool.length || matrix[row][column] >= ALLOCATION_COST.FORBIDDEN) {
        // Stop filling this debate once every remaining judge conflicts with it.
        if (matrix[row].slice(0, pool.length).every((value) => value >= ALLOCATION_COST.FORBIDDEN)) blocked.add(index);
        return;
      }
      const judge = pool[column];
      debates[index].judgeIds.push(judge.id);
      added[index].push(judge.id);
      progress = true;
    });
    const taken = new Set(added.flat());
    pool = pool.filter((judge) => !taken.has(judge.id));
    if (!progress) break;
  }

  debates.forEach((debate, index) => {
    // Keep panels odd: drop the last judge added by the allocator when a seat could not be filled.
    if (debate.judgeIds.length % 2 === 0 && added[index].length) {
      const removed = added[index].pop()!;
      debate.judgeIds = debate.judgeIds.filter((id) => id !== removed);
    }
    if (!debate.judgeIds.includes(debate.chairId)) debate.chairId = pickChair(debate.judgeIds, judges);
    const label = tournament.venues.find((venue) => venue.id === debate.venueId)?.name ?? 'Un debate';
    if (!debate.judgeIds.length) warnings.push(label + ': sin jueces disponibles sin conflicto.');
    else if (debate.judgeIds.length < target[index]) warnings.push(label + ': panel incompleto (' + debate.judgeIds.length + ' de ' + target[index] + ').');
    else if (debate.judgeIds.length % 2 === 0) warnings.push(label + ': el panel es par.');
    if (debate.judgeIds.length && !judges.get(debate.chairId)?.canChair) warnings.push(label + ': el juez principal no está marcado como apto para presidir.');
  });
  return { debates, warnings: [...new Set(warnings)] };
}

/** Problems of a round's draw, keyed by debate id, using the same conflict rules as the panel. */
export function roundIssues(tournament: TabTournament, round: TabRound): Map<string, string[]> {
  const issues = new Map<string, string[]>(round.debates.map((debate) => [debate.id, []]));
  const add = (debateId: string, message: string) => issues.get(debateId)?.push(message);
  const venues = new Map(tournament.venues.map((venue) => [venue.id, venue]));
  const teamNames = new Map(tournament.teams.map((team) => [team.id, team.name]));
  const judgeNames = new Map(tournament.judges.map((judge) => [judge.id, judge.name]));
  const venueUse = new Map<string, number>();
  const teamUse = new Map<string, number>();
  const judgeUse = new Map<string, number>();
  for (const debate of round.debates) {
    if (debate.venueId) venueUse.set(debate.venueId, (venueUse.get(debate.venueId) ?? 0) + 1);
    debate.teamIds.forEach((id) => id && teamUse.set(id, (teamUse.get(id) ?? 0) + 1));
    debate.judgeIds.forEach((id) => judgeUse.set(id, (judgeUse.get(id) ?? 0) + 1));
  }
  const meetings = teamMeetings({ ...tournament, rounds: tournament.rounds.filter((item) => item.kind === 'qualifying' && item.number < round.number) });
  for (const debate of round.debates) {
    const [a, b] = debate.teamIds;
    if (!debate.venueId || !venues.has(debate.venueId)) add(debate.id, 'Sin sala asignada.');
    else if ((venueUse.get(debate.venueId) ?? 0) > 1) add(debate.id, 'La sala se repite en esta ronda.');
    if (!a || !b) add(debate.id, 'Faltan equipos.');
    else if (a === b) add(debate.id, 'Un equipo no puede debatir contra sí mismo.');
    for (const id of debate.teamIds) if (id && (teamUse.get(id) ?? 0) > 1) add(debate.id, (teamNames.get(id) ?? 'Un equipo') + ' aparece en dos debates.');
    for (const id of debate.judgeIds) if ((judgeUse.get(id) ?? 0) > 1) add(debate.id, (judgeNames.get(id) ?? 'Un juez') + ' está en dos paneles.');
    if (round.kind === 'qualifying' && a && b && haveMet(meetings, a, b)) add(debate.id, 'Estos equipos ya se enfrentaron.');
    if (!debate.judgeIds.length) add(debate.id, 'Sin jueces.');
    else if (debate.judgeIds.length % 2 === 0) add(debate.id, 'Panel par: el reglamento exige un número impar de jueces.');
    if (debate.judgeIds.length && !debate.judgeIds.includes(debate.chairId)) add(debate.id, 'Falta el juez principal.');
  }
  // Same rules (institution, team–judge, judge–judge) and wording as the panel's assignment validation.
  const conflicts = findAssignmentConflicts({
    teams: tournament.teams as unknown as Team[],
    judges: tournament.judges as unknown as Judge[],
    rooms: round.debates.map((debate) => ({
      id: debate.id, name: venues.get(debate.venueId)?.name ?? 'Debate', teamFavorId: debate.teamIds[0], teamContraId: debate.teamIds[1], judgeIds: debate.judgeIds,
    })) as unknown as Room[],
  });
  for (const conflict of conflicts) add(conflict.roomId, conflict.message);
  for (const [id, list] of issues) issues.set(id, [...new Set(list)]);
  return issues;
}
