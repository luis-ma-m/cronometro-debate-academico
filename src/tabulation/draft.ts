import { allocateJudgesForRound, pickChair, roundProblems, type RoundProblem } from './adjudication';
import { generateFirstElimination, generateNextElimination } from './bracket';
import { canonicalJson, cyrb53 } from './hash';
import { generateSwissRound } from './pairing';
import { hashSeed } from './random';
import {
  eliminationRounds, qualifyingRounds,
  type TabDebate, type TabJudge, type TabRound, type TabRoundDraft, type TabTeam, type TabTournament, type TabVenue,
} from './types';

/** Undo steps kept inside the draft editor (normalize keeps the same amount). */
const MAX_UNDO = 50;

export interface DraftCreation { draft: TabRoundDraft | null; issues: string[]; warnings: string[]; champion: string | null }

/**
 * Next round as an editable draft, not yet part of the tournament: a Swiss round while qualifying rounds remain,
 * then the break and each elimination round. Rooms and judges are filled automatically and everything derives from
 * `seed`, so the same seed reproduces the same draft.
 */
export function createRoundDraft(tournament: TabTournament, seed: number, now = Date.now()): DraftCreation {
  const { settings } = tournament;
  const qualifying = qualifyingRounds(tournament);
  const eliminations = eliminationRounds(tournament);
  const warnings: string[] = [];
  let round: TabRound;
  let kind: TabRoundDraft['kind'] = 'swiss';
  let breakSeeds: string[] | undefined;
  if (settings.stage === 'swiss' && !eliminations.length && qualifying.length < settings.swissRounds) {
    const generated = generateSwissRound(tournament, seed, now);
    if (!generated.round) return { draft: null, issues: generated.issues, warnings: generated.warnings, champion: null };
    round = generated.round;
    warnings.push(...generated.warnings);
  } else if (settings.stage === 'groups' && !qualifying.length) {
    return { draft: null, issues: ['La liguilla genera todas sus jornadas a la vez: usa «Generar jornadas».'], warnings, champion: null };
  } else {
    const generated = eliminations.length ? generateNextElimination(tournament, seed, now) : generateFirstElimination(tournament, seed, now);
    if (generated.champion) return { draft: null, issues: [], warnings, champion: generated.champion };
    if (!generated.round) return { draft: null, issues: generated.issues, warnings, champion: null };
    round = generated.round;
    kind = 'elimination';
    if (!eliminations.length) breakSeeds = generated.breakSeeds;
  }
  const allocation = allocateJudgesForRound(tournament, round, { replace: true, seed: hashSeed(seed, 'jueces') });
  round = { ...round, debates: allocation.debates };
  warnings.push(...allocation.warnings);
  const draft: TabRoundDraft = {
    round, generated: round, seed, kind, ...(breakSeeds ? { breakSeeds } : {}), fingerprint: draftFingerprint(tournament), createdAt: now, editHistory: [],
  };
  return { draft, issues: [], warnings: [...new Set(warnings)], champion: null };
}

/**
 * Hash of everything a draft depends on (teams, fallen teams, results, judges, conflicts, rooms, rules). Names and
 * notes are left out: renaming a team does not make a draft outdated.
 */
export function draftFingerprint(tournament: TabTournament): string {
  return cyrb53(canonicalJson({
    settings: tournament.settings,
    teams: tournament.teams.map((team) => [team.id, team.institution, team.active, team.swing, team.breakEligible, team.incompatibleJudgeIds, team.fallenFromRound ?? null]),
    judges: tournament.judges.map((judge) => [judge.id, judge.institution, judge.active, judge.rating, judge.canChair, judge.incompatibleJudgeIds, judge.unavailableRoundIds]),
    venues: tournament.venues.map((venue) => [venue.id, venue.active]),
    conflicts: (tournament.judgeConflicts ?? []).map((conflict) => [conflict.judgeId, conflict.teamId ?? null, conflict.institution ?? null, conflict.level]),
    groups: tournament.groups,
    rounds: tournament.rounds.map((round) => [round.id, round.number, round.kind, round.debates.map((debate) => [
      debate.teamIds, debate.judgeIds, debate.chairId, debate.favorTeamId ?? null, debate.bracketSlot ?? null,
      debate.result ? { ...debate.result, notes: undefined, updatedAt: undefined } : null,
    ])]),
    breakSeeds: tournament.breakSeeds,
    manualOrder: tournament.manualOrder,
  }));
}

export function draftIsStale(tournament: TabTournament, draft: TabRoundDraft): boolean {
  return draft.fingerprint !== draftFingerprint(tournament);
}

export interface RoundCheck { errors: string[]; warnings: string[]; byDebate: Map<string, RoundProblem[]> }

/** Problems of a draft or confirmed round. Errors block confirmation; warnings need the organisers' acceptance. */
export function checkRound(tournament: TabTournament, round: TabRound): RoundCheck {
  const look = lookup(tournament);
  const byDebate = roundProblems(tournament, round);
  const errors: string[] = [];
  const warnings: string[] = [];
  round.debates.forEach((debate, index) => {
    for (const problem of byDebate.get(debate.id) ?? []) (problem.severity === 'error' ? errors : warnings).push(debateLabel(look, debate, index) + ': ' + problem.message);
  });
  const placed = new Set(round.debates.flatMap((debate) => debate.teamIds).filter(Boolean));
  for (const id of placed) {
    const team = look.teams.get(id);
    if (!team) errors.push('Un debate incluye un equipo que ya no existe.');
    else if (!team.active) warnings.push(team.name + ' no está activo.');
  }
  if (round.kind === 'qualifying' && tournament.settings.stage === 'swiss') {
    for (const team of tournament.teams) if (team.active && !placed.has(team.id)) warnings.push(team.name + ' no tiene debate en esta ronda.');
  }
  for (const id of new Set(round.debates.flatMap((debate) => debate.judgeIds))) {
    const judge = look.judges.get(id);
    if (!judge) errors.push('Un panel incluye un juez que ya no existe.');
    else if (!judge.active) warnings.push(judge.name + ' no está disponible.');
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], byDebate };
}

export function draftProblems(tournament: TabTournament, draft: TabRoundDraft): RoundCheck {
  const check = checkRound(tournament, draft.round);
  if (draftIsStale(tournament, draft)) {
    check.warnings.unshift('Han cambiado datos (equipos, actas, jueces, salas o reglas) desde que se generó el borrador: revísalo o vuelve a generarlo.');
  }
  return check;
}

/** Manual change to a round. `seat` equal to the panel size adds a judge; an empty `judgeId` removes the seat. */
export type DraftEdit =
  | { kind: 'team'; debateId: string; slot: 0 | 1; teamId: string }
  | { kind: 'venue'; debateId: string; venueId: string }
  | { kind: 'judge'; debateId: string; seat: number; judgeId: string }
  | { kind: 'chair'; debateId: string; judgeId: string }
  | { kind: 'side'; debateId: string; favorTeamId: string }
  | { kind: 'allocate'; seed: number };

export interface RoundEdit { round: TabRound; change: string | null }

/**
 * Applies one manual change and describes it for the log. A team or judge already placed elsewhere swaps places,
 * so every team keeps exactly one debate and every judge one panel. Edits that change nothing or point to unknown
 * debates, teams or judges return the same round and a null change: they never throw.
 */
export function editRound(tournament: TabTournament, round: TabRound, edit: DraftEdit): RoundEdit {
  const unchanged: RoundEdit = { round, change: null };
  if (edit.kind === 'allocate') {
    const allocation = allocateJudgesForRound(tournament, round, { replace: true, seed: edit.seed });
    return { round: { ...round, debates: allocation.debates }, change: 'Jueces reasignados de forma automática (semilla ' + edit.seed + ').' };
  }
  const index = round.debates.findIndex((debate) => debate.id === edit.debateId);
  if (index < 0) return unchanged;
  const look = lookup(tournament);
  const debates: TabDebate[] = round.debates.map((debate) => ({ ...debate, teamIds: [...debate.teamIds], judgeIds: [...debate.judgeIds] }));
  const debate = debates[index];
  const label = (i: number) => debateLabel(look, round.debates[i], i);
  const team = (id: string) => quote(look.teams.get(id)?.name ?? 'equipo desconocido');
  const judge = (id: string) => quote(look.judges.get(id)?.name ?? 'juez desconocido');
  let change: string;

  switch (edit.kind) {
    case 'team': {
      const { slot, teamId } = edit;
      const old = debate.teamIds[slot];
      if ((slot !== 0 && slot !== 1) || old === teamId || !look.teams.has(teamId)) return unchanged;
      const otherIndex = debates.findIndex((item) => item.teamIds.includes(teamId));
      debate.teamIds[slot] = teamId;
      if (otherIndex === index) {
        // Same debate: only the order changes and each team keeps its side.
        debate.teamIds[1 - slot] = old;
        change = label(index) + ': se invierte el orden de ' + team(teamId) + ' y ' + team(old) + '.';
        break;
      }
      // The side stays with the seat.
      if (debate.favorTeamId === old) debate.favorTeamId = teamId;
      if (otherIndex >= 0) {
        const other = debates[otherIndex];
        other.teamIds[other.teamIds.indexOf(teamId)] = old;
        if (other.favorTeamId === teamId) other.favorTeamId = old;
        change = label(index) + ': ' + team(teamId) + ' entra por ' + team(old) + ', que pasa a ' + label(otherIndex) + '.';
      } else {
        change = label(index) + ': ' + team(teamId) + ' entra por ' + team(old) + ', que queda sin debate.';
      }
      break;
    }
    case 'venue': {
      const { venueId } = edit;
      const old = debate.venueId;
      if (old === venueId || (venueId && !look.venues.has(venueId))) return unchanged;
      const otherIndex = venueId ? debates.findIndex((item, i) => i !== index && item.venueId === venueId) : -1;
      debate.venueId = venueId;
      if (otherIndex >= 0) debates[otherIndex].venueId = old;
      change = teamsLabel(look, debate) + ': sala ' + venueName(look, old) + ' → ' + venueName(look, venueId)
        + (otherIndex >= 0 ? ' (intercambio con ' + teamsLabel(look, debates[otherIndex]) + ')' : '') + '.';
      break;
    }
    case 'judge': {
      const { seat, judgeId } = edit;
      if (!Number.isInteger(seat) || seat < 0 || seat > debate.judgeIds.length) return unchanged;
      const old = debate.judgeIds[seat] ?? '';
      if (!judgeId) {
        if (!old) return unchanged;
        debate.judgeIds.splice(seat, 1);
        const wasChair = debate.chairId === old;
        if (wasChair) debate.chairId = pickChair(debate.judgeIds, look.judges);
        change = label(index) + ': sale ' + judge(old) + (wasChair ? ' (era el principal; ahora lo es ' + (debate.chairId ? judge(debate.chairId) : 'nadie') + ')' : '') + '.';
        break;
      }
      if (!look.judges.has(judgeId) || debate.judgeIds.includes(judgeId)) return unchanged;
      const otherIndex = debates.findIndex((item) => item.judgeIds.includes(judgeId));
      if (old) {
        debate.judgeIds[seat] = judgeId;
        if (debate.chairId === old) debate.chairId = judgeId;
      } else {
        debate.judgeIds.push(judgeId);
      }
      if (otherIndex >= 0) {
        const other = debates[otherIndex];
        const otherSeat = other.judgeIds.indexOf(judgeId);
        const wasChair = other.chairId === judgeId;
        if (old) {
          other.judgeIds[otherSeat] = old;
          if (wasChair) other.chairId = old;
        } else {
          other.judgeIds.splice(otherSeat, 1);
          if (wasChair) other.chairId = pickChair(other.judgeIds, look.judges);
        }
      }
      if (!debate.judgeIds.includes(debate.chairId)) debate.chairId = pickChair(debate.judgeIds, look.judges);
      change = old
        ? label(index) + ': ' + judge(judgeId) + ' entra por ' + judge(old) + (otherIndex >= 0 ? ', que pasa a ' + label(otherIndex) : '') + '.'
        : label(index) + ': se añade ' + judge(judgeId) + (otherIndex >= 0 ? ', que sale de ' + label(otherIndex) : '') + '.';
      break;
    }
    case 'chair': {
      const old = debate.chairId;
      if (old === edit.judgeId || !debate.judgeIds.includes(edit.judgeId)) return unchanged;
      debate.chairId = edit.judgeId;
      change = label(index) + ': juez principal ' + (old ? judge(old) : 'ninguno') + ' → ' + judge(edit.judgeId) + '.';
      break;
    }
    case 'side': {
      const favor = edit.favorTeamId;
      const old = debate.favorTeamId ?? '';
      if (old === favor || (favor && !debate.teamIds.includes(favor))) return unchanged;
      if (favor) debate.favorTeamId = favor;
      else delete debate.favorTeamId;
      change = label(index) + ': a favor ' + (old ? team(old) : 'sin sortear') + ' → ' + (favor ? team(favor) : 'sin sortear') + '.';
      break;
    }
  }
  return { round: { ...round, debates }, change };
}

export interface DraftEditResult { draft: TabRoundDraft; change: string | null }

export function applyDraftEdit(tournament: TabTournament, draft: TabRoundDraft, edit: DraftEdit): DraftEditResult {
  const { round, change } = editRound(tournament, draft.round, edit);
  if (!change) return { draft, change: null };
  return { draft: { ...draft, round, editHistory: [...draft.editHistory, draft.round].slice(-MAX_UNDO) }, change };
}

export function undoDraftEdit(tournament: TabTournament, draft: TabRoundDraft): DraftEditResult {
  const previous = draft.editHistory.at(-1);
  if (!previous) return { draft, change: null };
  const changes = diffRounds(tournament, draft.round, previous);
  return {
    draft: { ...draft, round: previous, editHistory: draft.editHistory.slice(0, -1) },
    change: 'Deshacer: ' + (changes.join(' ') || 'sin cambios visibles.'),
  };
}

/** Human-readable differences between two versions of a round (debates matched by id). */
export function diffRounds(tournament: TabTournament, before: TabRound, after: TabRound): string[] {
  const look = lookup(tournament);
  const previous = new Map(before.debates.map((debate) => [debate.id, debate]));
  const sameSet = (x: string[], y: string[]) => [...x].sort().join('|') === [...y].sort().join('|');
  const judges = (debate: TabDebate) => debate.judgeIds.map((id) => quote(look.judges.get(id)?.name ?? 'juez desconocido')).join(', ') || 'sin jueces';
  const teamName = (id: string | undefined) => (id ? quote(look.teams.get(id)?.name ?? 'equipo desconocido') : 'sin sortear');
  const judgeName = (id: string) => (id ? quote(look.judges.get(id)?.name ?? 'juez desconocido') : 'ninguno');
  const lines: string[] = [];
  after.debates.forEach((debate, index) => {
    const old = previous.get(debate.id);
    const label = teamsLabel(look, debate);
    if (!old) {
      lines.push('Debate nuevo: ' + label + '.');
      return;
    }
    if (!sameSet(old.teamIds, debate.teamIds)) lines.push(debateLabel(look, debate, index) + ': ' + teamsLabel(look, old) + ' → ' + label + '.');
    else if (old.teamIds[0] !== debate.teamIds[0]) lines.push(label + ': orden de los equipos invertido.');
    if (old.venueId !== debate.venueId) lines.push(label + ': sala ' + venueName(look, old.venueId) + ' → ' + venueName(look, debate.venueId) + '.');
    if (!sameSet(old.judgeIds, debate.judgeIds)) lines.push(label + ': jurado ' + judges(old) + ' → ' + judges(debate) + '.');
    if (old.chairId !== debate.chairId) lines.push(label + ': juez principal ' + judgeName(old.chairId) + ' → ' + judgeName(debate.chairId) + '.');
    if ((old.favorTeamId ?? '') !== (debate.favorTeamId ?? '')) lines.push(label + ': a favor ' + teamName(old.favorTeamId) + ' → ' + teamName(debate.favorTeamId) + '.');
  });
  const current = new Set(after.debates.map((debate) => debate.id));
  for (const debate of before.debates) if (!current.has(debate.id)) lines.push('Debate eliminado: ' + teamsLabel(look, debate) + '.');
  return lines;
}

export interface DraftConfirmation { tournament: TabTournament; round: TabRound | null; errors: string[]; alreadyConfirmed: boolean }

/**
 * Adds the pending draft to the tournament. Idempotent: confirming a round that is already in the tournament only
 * clears the draft. Errors (a team twice, a judge in two rooms, unknown teams…) block it and change nothing.
 */
export function confirmDraft(tournament: TabTournament, draftRoundId: string): DraftConfirmation {
  const existing = tournament.rounds.find((round) => round.id === draftRoundId);
  if (existing) {
    const cleared = tournament.draftRound?.round.id === draftRoundId ? withoutDraft(tournament) : tournament;
    return { tournament: cleared, round: existing, errors: [], alreadyConfirmed: true };
  }
  const draft = tournament.draftRound;
  if (!draft || draft.round.id !== draftRoundId) {
    return { tournament, round: null, errors: ['Este borrador ya no es el pendiente: vuelve a abrir la pantalla de rondas.'], alreadyConfirmed: false };
  }
  const errors = [...checkRound(tournament, draft.round).errors];
  if (tournament.rounds.some((round) => round.number === draft.round.number)) {
    errors.push('Ya existe una ronda número ' + draft.round.number + ': descarta este borrador y genera otro.');
  }
  if (errors.length) return { tournament, round: null, errors, alreadyConfirmed: false };
  return {
    tournament: { ...withoutDraft(tournament), rounds: [...tournament.rounds, draft.round], ...(draft.breakSeeds ? { breakSeeds: draft.breakSeeds } : {}) },
    round: draft.round,
    errors: [],
    alreadyConfirmed: false,
  };
}

export function withoutDraft(tournament: TabTournament): TabTournament {
  const copy = { ...tournament };
  delete copy.draftRound;
  return copy;
}

export interface Reopening { tournament: TabTournament; errors: string[]; warnings: string[] }

/** Turns the last confirmed round back into a draft, provided it has no actas yet. */
export function reopenRound(tournament: TabTournament, roundId: string, now = Date.now()): Reopening {
  const round = tournament.rounds.find((item) => item.id === roundId);
  if (!round) return { tournament, errors: ['La ronda no existe.'], warnings: [] };
  const errors: string[] = [];
  if (tournament.draftRound) errors.push('Ya hay un borrador pendiente: confírmalo o descártalo antes.');
  if (tournament.rounds.some((item) => item.number > round.number)) errors.push('Solo se puede reabrir la última ronda.');
  const withActas = round.debates.filter((debate) => debate.result).length;
  if (withActas) errors.push(round.name + ' ya tiene actas registradas (' + withActas + '): bórralas antes de reabrirla.');
  if (errors.length) return { tournament, errors, warnings: [] };

  const rounds = tournament.rounds.filter((item) => item.id !== roundId);
  const holdsBreak = round.kind === 'elimination' && !rounds.some((item) => item.kind === 'elimination');
  const base: TabTournament = { ...tournament, rounds, ...(holdsBreak ? { breakSeeds: [] } : {}) };
  const draft: TabRoundDraft = {
    round,
    generated: round,
    seed: round.seed,
    kind: round.kind === 'elimination' ? 'elimination' : tournament.settings.stage === 'groups' ? 'groups' : 'swiss',
    ...(holdsBreak ? { breakSeeds: tournament.breakSeeds } : {}),
    fingerprint: draftFingerprint(base),
    createdAt: now,
    editHistory: [],
  };
  const warnings = round.pushedAt ? ['La ronda ya se había enviado al panel: vuelve a enviarla cuando la confirmes.'] : [];
  return { tournament: { ...base, draftRound: draft }, errors: [], warnings };
}

interface Look { teams: Map<string, TabTeam>; judges: Map<string, TabJudge>; venues: Map<string, TabVenue> }

function lookup(tournament: TabTournament): Look {
  return {
    teams: new Map(tournament.teams.map((team) => [team.id, team])),
    judges: new Map(tournament.judges.map((judge) => [judge.id, judge])),
    venues: new Map(tournament.venues.map((venue) => [venue.id, venue])),
  };
}

const quote = (text: string) => '«' + text + '»';

function venueName(look: Look, venueId: string): string {
  return venueId ? look.venues.get(venueId)?.name ?? 'sala desconocida' : 'ninguna';
}

/** The room name, or the debate's position when it has no room (e.g. against a fallen team). */
function debateLabel(look: Look, debate: TabDebate, index: number): string {
  return (debate.venueId && look.venues.get(debate.venueId)?.name) || 'Debate ' + (index + 1);
}

function teamsLabel(look: Look, debate: TabDebate): string {
  return debate.teamIds.map((id) => quote(look.teams.get(id)?.name ?? 'equipo desconocido')).join(' – ');
}

export interface RoundAudit { reproducible: boolean; differences: string[] }

/**
 * Generates a confirmed round again from its seed and the rounds before it, and compares the pairings. Any
 * difference comes from a manual change (it is in the log) or from an earlier acta edited afterwards.
 */
export function auditRound(tournament: TabTournament, roundId: string): RoundAudit {
  const round = tournament.rounds.find((item) => item.id === roundId);
  if (!round) return { reproducible: false, differences: ['La ronda no existe.'] };
  const before = withoutDraft({ ...tournament, rounds: tournament.rounds.filter((item) => item.number < round.number) });
  let generated: TabRound | null;
  let issues: string[];
  if (round.kind === 'elimination') {
    const result = eliminationRounds(before).length ? generateNextElimination(before, round.seed, round.createdAt) : generateFirstElimination(before, round.seed, round.createdAt);
    generated = result.round;
    issues = result.issues;
  } else if (tournament.settings.stage === 'swiss') {
    const result = generateSwissRound(before, round.seed, round.createdAt);
    generated = result.round;
    issues = result.issues;
  } else {
    return { reproducible: false, differences: ['Las jornadas de la liguilla salen del sorteo de grupos: no se generan ronda a ronda.'] };
  }
  if (!generated) return { reproducible: false, differences: ['No se puede volver a generar: ' + issues.join(' ')] };
  const look = lookup(tournament);
  const key = (debate: TabDebate) => [...debate.teamIds].sort().join('|');
  const label = (debate: TabDebate) => teamsLabel(look, debate);
  const actual = new Map(round.debates.map((debate) => [key(debate), debate]));
  const expected = new Map(generated.debates.map((debate) => [key(debate), debate]));
  const differences = [
    ...[...expected].filter(([pair]) => !actual.has(pair)).map(([, debate]) => 'El sorteo emparejaba ' + label(debate) + '.'),
    ...[...actual].filter(([pair]) => !expected.has(pair)).map(([, debate]) => 'Cambio respecto al sorteo: ' + label(debate) + '.'),
  ];
  return { reproducible: !differences.length, differences };
}
