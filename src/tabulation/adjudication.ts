import type { Judge, Room, Team } from '../domain';
import { findAssignmentConflicts } from '../incompatibilities';
import { teamMeetings, haveMet } from './pairing';
import { createRng, hashSeed } from './random';
import { buildTeamStandings } from './standings';
import {
  isFallenAt,
  sameInstitution,
  type ConflictLevel,
  type TabDebate,
  type TabJudge,
  type TabJudgeConflict,
  type TabRound,
  type TabTeam,
  type TabTournament,
} from './types';

/**
 * Integer cost tiers. Each tier is larger than 64 debates' worth of every tier below it, so a single higher-tier
 * cost can never be traded for many lower-tier ones. Soft preferences: cannot chair 1e4, already saw the team 1e3,
 * rating × importance ≤ 400, random noise < 1.
 */
export const ALLOCATION_COST = {
  FORBIDDEN: 1e13,
  EMPTY_CHAIR: 1e11,
  OBJECTIVE: 1e9,
  EMPTY_WING: 1e8,
  SUBJECTIVE: 1e6,
  NON_CHAIR: 1e4,
  SEEN_TEAM: 1e3,
} as const;

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

export interface TeamConflict { level: ConflictLevel; reason: string; source: 'institution' | 'team' | 'listed' }

/**
 * Every reason why a judge should not judge a team. Sharing the institution and the team's own incompatibility
 * list are objective; listed conflicts (per team or per institution) carry their own level.
 */
export function teamConflicts(judge: TabJudge, team: TabTeam, listed: TabJudgeConflict[] = []): TeamConflict[] {
  const conflicts: TeamConflict[] = [];
  if (sameInstitution(judge.institution, team.institution)) conflicts.push({ level: 'objective', reason: 'misma institución que ' + team.name, source: 'institution' });
  if (team.incompatibleJudgeIds.includes(judge.id)) conflicts.push({ level: 'objective', reason: 'incompatible con ' + team.name, source: 'team' });
  for (const entry of listed) {
    if (entry.judgeId !== judge.id) continue;
    if (entry.teamId !== team.id && !(entry.institution && sameInstitution(entry.institution, team.institution))) continue;
    conflicts.push({
      level: entry.level,
      reason: 'incompatibilidad ' + (entry.level === 'objective' ? 'objetiva' : 'subjetiva') + ' con ' + team.name + (entry.note ? ' (' + entry.note + ')' : ''),
      source: 'listed',
    });
  }
  return conflicts;
}

export function judgeTeamConflict(judge: TabJudge, team: TabTeam, listed: TabJudgeConflict[] = []): string | null {
  return teamConflicts(judge, team, listed)[0]?.reason ?? null;
}

export function judgesConflict(a: TabJudge, b: TabJudge): boolean {
  return a.incompatibleJudgeIds.includes(b.id) || b.incompatibleJudgeIds.includes(a.id);
}

export function availableJudges(tournament: TabTournament, round: TabRound): TabJudge[] {
  return tournament.judges.filter((judge) => judge.active && !judge.unavailableRoundIds.includes(round.id));
}

/** Conflict penalty of a judge in a debate: 0 when clean, otherwise the tier of each conflict. */
function conflictPenalty(judge: TabJudge, debateTeams: TabTeam[], panel: TabJudge[], listed: TabJudgeConflict[]): number {
  let penalty = 0;
  for (const team of debateTeams) {
    for (const conflict of teamConflicts(judge, team, listed)) penalty += conflict.level === 'objective' ? ALLOCATION_COST.OBJECTIVE : ALLOCATION_COST.SUBJECTIVE;
  }
  if (panel.some((other) => other.id !== judge.id && judgesConflict(judge, other))) penalty += ALLOCATION_COST.OBJECTIVE;
  return penalty;
}

/** Best chair among the panel: judges allowed to chair first, then without conflicts, then by rating. */
export function pickChair(judgeIds: string[], judges: Map<string, TabJudge>, penaltyOf: (judge: TabJudge) => number = () => 0): string {
  const panel = judgeIds.map((id) => judges.get(id)).filter((judge): judge is TabJudge => Boolean(judge));
  panel.sort((x, y) => Number(y.canChair) - Number(x.canChair) || penaltyOf(x) - penaltyOf(y) || y.rating - x.rating || x.name.localeCompare(y.name, 'es'));
  return panel[0]?.id ?? '';
}

export interface AllocationResult { debates: TabDebate[]; warnings: string[] }

export function allocateJudges(tournament: TabTournament, roundId: string, options: { replace: boolean; seed?: number }): AllocationResult {
  const round = tournament.rounds.find((item) => item.id === roundId);
  if (!round) return { debates: [], warnings: ['La ronda no existe.'] };
  return allocateJudgesForRound(tournament, round, options);
}

/**
 * Fills the panels of a round (also of a draft not yet in the tournament).
 * - Classic presets keep odd panels and never seat an objective conflict.
 * - With `oddPanels: false` panels shrink one judge at a time (two judges are valid with a joint acta).
 * - With `conflictPolicy: 'lastResort'` an objective conflict is only seated as the single judge of a debate that
 *   would otherwise have none; subjective conflicts are avoided while there is an alternative.
 * - A swap pass afterwards moves conflicted judges to debates where they are clean.
 * - Debates against a fallen team need no judges. With `replace: false` existing (manual) judges are kept.
 */
export function allocateJudgesForRound(tournament: TabTournament, round: TabRound, options: { replace: boolean; seed?: number }): AllocationResult {
  const { settings } = tournament;
  const warnings: string[] = [];
  const rng = createRng(options.seed ?? hashSeed(round.seed, 'jueces', Date.now()));
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const judges = new Map(tournament.judges.map((judge) => [judge.id, judge]));
  const listed = tournament.judgeConflicts ?? [];
  const lastResort = settings.conflictPolicy === 'lastResort';
  const odd = settings.oddPanels;
  const panelSize = odd ? Math.max(1, round.panelSize % 2 ? round.panelSize : round.panelSize + 1) : Math.max(1, round.panelSize);
  if (panelSize !== round.panelSize) warnings.push('Los paneles deben ser impares: se usa un panel de ' + panelSize + '.');

  const debates = round.debates.map((debate) => ({ ...debate, judgeIds: options.replace ? [] : [...debate.judgeIds] }));
  const skip = debates.map((debate) => debate.teamIds.some((id) => isFallenAt(teams.get(id), round.number)));
  const used = new Set(debates.flatMap((debate) => debate.judgeIds));
  let pool = availableJudges(tournament, round).filter((judge) => !used.has(judge.id));
  const teamsOf = (debate: TabDebate) => debate.teamIds.map((id) => teams.get(id)).filter((team): team is TabTeam => Boolean(team));
  const panelOf = (debate: TabDebate) => debate.judgeIds.map((id) => judges.get(id)).filter((judge): judge is TabJudge => Boolean(judge));

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

  // Panel targets that fit the available judges, shrinking the least important debates first.
  const step = odd ? 2 : 1;
  const target = debates.map((debate, index) => {
    if (skip[index]) return debate.judgeIds.length;
    const current = debate.judgeIds.length;
    return Math.max(panelSize, odd ? (current % 2 ? current : current + 1) : current);
  });
  const needed = () => target.reduce((total, size, index) => total + Math.max(0, size - debates[index].judgeIds.length), 0);
  const byImportance = debates.map((_, index) => index).filter((index) => !skip[index]).sort((x, y) => importance[x] - importance[y]);
  let shrunk = false;
  while (needed() > pool.length) {
    // Shrink the largest panel first (least important on ties) so reductions spread evenly: 5×3 + 5×2, not 3/2/1.
    const candidates = byImportance.filter((i) => target[i] - step >= Math.max(1, debates[i].judgeIds.length));
    if (!candidates.length) break;
    const largest = Math.max(...candidates.map((i) => target[i]));
    const index = candidates.find((i) => target[i] === largest)!;
    target[index] -= step;
    shrunk = true;
  }
  if (shrunk) warnings.push('No hay jueces suficientes: algunos debates tendrán un panel menor.');

  const added: string[][] = debates.map(() => []);
  const blocked = new Set<number>();
  for (;;) {
    const rows = debates.map((_, index) => index)
      .filter((index) => !skip[index] && !blocked.has(index) && debates[index].judgeIds.length < target[index])
      .sort((x, y) => importance[y] - importance[x]);
    if (!rows.length || !pool.length) break;
    const matrix = rows.map((index) => {
      const debate = debates[index];
      const panel = panelOf(debate);
      const debateTeams = teamsOf(debate);
      const chairSeat = panel.length === 0;
      const judgeCosts = pool.map((judge) => {
        let conflictCost = 0;
        for (const team of debateTeams) {
          for (const conflict of teamConflicts(judge, team, listed)) {
            if (conflict.level === 'subjective') conflictCost += ALLOCATION_COST.SUBJECTIVE;
            else if (lastResort && chairSeat) conflictCost += ALLOCATION_COST.OBJECTIVE;
            else return ALLOCATION_COST.FORBIDDEN;
          }
        }
        if (panel.some((other) => judgesConflict(judge, other))) return ALLOCATION_COST.FORBIDDEN;
        const seenCount = debate.teamIds.filter((id) => seen.get(judge.id)?.has(id)).length;
        const quality = Math.round((5 - Math.min(5, Math.max(1, judge.rating))) * importance[index] * 100);
        return conflictCost + (chairSeat && !judge.canChair ? ALLOCATION_COST.NON_CHAIR : 0) + seenCount * ALLOCATION_COST.SEEN_TEAM + quality + rng();
      });
      return [...judgeCosts, ...rows.map(() => (chairSeat ? ALLOCATION_COST.EMPTY_CHAIR : ALLOCATION_COST.EMPTY_WING))];
    });
    const assignment = hungarian(matrix);
    let progress = false;
    rows.forEach((index, row) => {
      const column = assignment[row];
      if (column < 0 || column >= pool.length || matrix[row][column] >= ALLOCATION_COST.FORBIDDEN) {
        // Stop filling this debate once every remaining judge is forbidden for it.
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

  // Swap pass: a conflicted judge added by the allocator moves to another debate when that lowers the total penalty.
  const penaltyIn = (judge: TabJudge, index: number, without = '') =>
    conflictPenalty(judge, teamsOf(debates[index]), panelOf(debates[index]).filter((other) => other.id !== without), listed);
  for (let pass = 0; pass < 50; pass++) {
    let improved = false;
    for (let i = 0; i < debates.length && !improved; i++) {
      for (const judgeId of [...added[i]]) {
        const judge = judges.get(judgeId)!;
        const current = penaltyIn(judge, i, judgeId);
        if (!current) continue;
        for (let e = 0; e < debates.length && !improved; e++) {
          if (e === i || skip[e]) continue;
          for (const otherId of added[e]) {
            const other = judges.get(otherId)!;
            const before = current + penaltyIn(other, e, otherId);
            const after = penaltyIn(other, i, judgeId) + penaltyIn(judge, e, otherId);
            if (after >= before) continue;
            debates[i].judgeIds = debates[i].judgeIds.map((id) => (id === judgeId ? otherId : id));
            debates[e].judgeIds = debates[e].judgeIds.map((id) => (id === otherId ? judgeId : id));
            added[i] = added[i].map((id) => (id === judgeId ? otherId : id));
            added[e] = added[e].map((id) => (id === otherId ? judgeId : id));
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
    }
    if (!improved) break;
  }

  debates.forEach((debate, index) => {
    const label = tournament.venues.find((venue) => venue.id === debate.venueId)?.name ?? 'Un debate';
    if (skip[index]) {
      // Not held: nobody chairs a panel that was cleared.
      if (!debate.judgeIds.includes(debate.chairId)) debate.chairId = debate.judgeIds[0] ?? '';
      return;
    }
    // Classic presets keep panels odd: drop the last judge added when a seat could not be filled.
    if (odd && debate.judgeIds.length % 2 === 0 && added[index].length) {
      const removed = added[index].pop()!;
      debate.judgeIds = debate.judgeIds.filter((id) => id !== removed);
    }
    const debateTeams = teamsOf(debate);
    const panel = panelOf(debate);
    if (!debate.judgeIds.includes(debate.chairId)) debate.chairId = pickChair(debate.judgeIds, judges, (judge) => conflictPenalty(judge, debateTeams, panel, listed));
    if (!debate.judgeIds.length) warnings.push(label + ': sin jueces disponibles sin conflicto.');
    else if (debate.judgeIds.length < target[index]) warnings.push(label + ': panel incompleto (' + debate.judgeIds.length + ' de ' + target[index] + ').');
    else if (odd && debate.judgeIds.length % 2 === 0) warnings.push(label + ': el panel es par.');
    if (debate.judgeIds.length && !judges.get(debate.chairId)?.canChair) warnings.push(label + ': el juez principal no está marcado como apto para presidir.');
    for (const judge of panel) {
      if (!added[index].includes(judge.id)) continue;
      for (const team of debateTeams) {
        for (const conflict of teamConflicts(judge, team, listed)) {
          warnings.push(label + ': ' + judge.name + ' asignado con ' + (conflict.level === 'objective' ? 'incompatibilidad objetiva' : 'incompatibilidad subjetiva')
            + ' (' + conflict.reason + ') por falta de alternativas.');
        }
      }
    }
  });
  return { debates, warnings: [...new Set(warnings)] };
}

export interface RoundProblem { severity: 'error' | 'warning'; message: string }

/**
 * Problems of a round's draw, keyed by debate id. Errors make the round impossible to hold (a team twice, missing
 * teams, a judge in two rooms); everything else is a warning the organisers may accept.
 */
export function roundProblems(tournament: TabTournament, round: TabRound): Map<string, RoundProblem[]> {
  const problems = new Map<string, RoundProblem[]>(round.debates.map((debate) => [debate.id, []]));
  const add = (debateId: string, severity: RoundProblem['severity'], message: string) => problems.get(debateId)?.push({ severity, message });
  const { settings } = tournament;
  const venues = new Map(tournament.venues.map((venue) => [venue.id, venue]));
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const judges = new Map(tournament.judges.map((judge) => [judge.id, judge]));
  const listed = tournament.judgeConflicts ?? [];
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
    const fallen = debate.teamIds.some((id) => isFallenAt(teams.get(id), round.number));
    if (!fallen) {
      if (!debate.venueId || !venues.has(debate.venueId)) add(debate.id, 'warning', 'Sin sala asignada.');
      else if ((venueUse.get(debate.venueId) ?? 0) > 1) add(debate.id, 'error', 'La sala se repite en esta ronda.');
    } else if (debate.venueId || debate.judgeIds.length) {
      add(debate.id, 'warning', 'Este debate no se disputa (equipo caído): libera su sala y sus jueces para otros debates.');
    }
    if (!a || !b) add(debate.id, 'error', 'Faltan equipos.');
    else if (a === b) add(debate.id, 'error', 'Un equipo no puede debatir contra sí mismo.');
    for (const id of debate.teamIds) if (id && (teamUse.get(id) ?? 0) > 1) add(debate.id, 'error', (teams.get(id)?.name ?? 'Un equipo') + ' aparece en dos debates.');
    for (const id of debate.judgeIds) if ((judgeUse.get(id) ?? 0) > 1) add(debate.id, 'error', (judges.get(id)?.name ?? 'Un juez') + ' está en dos paneles.');
    if (round.kind === 'qualifying' && a && b && haveMet(meetings, a, b)) add(debate.id, 'warning', 'Estos equipos ya se enfrentaron.');
    if (fallen) continue;
    if (!debate.judgeIds.length) add(debate.id, 'warning', 'Sin jueces.');
    else if (settings.oddPanels && debate.judgeIds.length % 2 === 0) add(debate.id, 'warning', 'Panel par: el reglamento exige un número impar de jueces.');
    if (debate.judgeIds.length && !debate.judgeIds.includes(debate.chairId)) add(debate.id, 'warning', 'Falta el juez principal.');
    // With the hard policy the panel's own validation (below) already reports institution, team and judge–judge conflicts.
    const hardPolicy = settings.conflictPolicy === 'hard';
    if (!hardPolicy || listed.length) {
      for (const judgeId of debate.judgeIds) {
        const judge = judges.get(judgeId);
        if (!judge) continue;
        for (const team of debate.teamIds.map((id) => teams.get(id)).filter((item): item is TabTeam => Boolean(item))) {
          for (const conflict of teamConflicts(judge, team, listed)) {
            if (hardPolicy && conflict.source !== 'listed') continue;
            const hard = conflict.level === 'objective' && settings.conflictPolicy === 'hard';
            add(debate.id, hard ? 'error' : 'warning', judge.name + ': ' + (conflict.level === 'objective' ? 'incompatibilidad objetiva' : 'incompatibilidad subjetiva') + ' (' + conflict.reason + ').');
          }
        }
        for (const otherId of hardPolicy ? [] : debate.judgeIds) {
          const other = judges.get(otherId);
          if (other && other.id > judge.id && judgesConflict(judge, other)) add(debate.id, 'warning', judge.name + ' y ' + other.name + ' son incompatibles.');
        }
      }
    }
  }
  if (settings.conflictPolicy === 'hard') {
    // Same rules (institution, team–judge, judge–judge) and wording as the panel's assignment validation.
    const conflicts = findAssignmentConflicts({
      teams: tournament.teams as unknown as Team[],
      judges: tournament.judges as unknown as Judge[],
      rooms: round.debates.map((debate) => ({
        id: debate.id, name: venues.get(debate.venueId)?.name ?? 'Debate', teamFavorId: debate.teamIds[0], teamContraId: debate.teamIds[1], judgeIds: debate.judgeIds,
      })) as unknown as Room[],
    });
    for (const conflict of conflicts) add(conflict.roomId, 'error', conflict.message);
  }
  for (const [id, list] of problems) {
    const seenMessages = new Set<string>();
    problems.set(id, list.filter((problem) => !seenMessages.has(problem.message) && seenMessages.add(problem.message)));
  }
  return problems;
}

/** Messages of every problem of the round, keyed by debate id. */
export function roundIssues(tournament: TabTournament, round: TabRound): Map<string, string[]> {
  return new Map([...roundProblems(tournament, round)].map(([id, list]) => [id, list.map((problem) => problem.message)]));
}
