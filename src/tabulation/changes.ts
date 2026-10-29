import { canonicalJson } from './hash';
import type { TabDebate, TabDebateResult, TabJudgeConflict, TabRound, TabRoundDraft, TabTournament } from './types';

/**
 * One change shown in the log. `key` identifies the entity and field (`team:<id>:name`) so consecutive edits of the
 * same field can be merged; `before` and `after` are short readable values ('' when absent).
 */
export interface Change { key: string; label: string; before?: string; after?: string; added?: boolean }

interface Names {
  team(id: string): string;
  judge(id: string): string;
  venue(id: string): string;
  round(id: string): string;
}

const yesNo = (value: unknown) => (value ? 'sí' : 'no');
const plain = (value: unknown) => (value === undefined || value === null ? '' : String(value));

function short(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return yesNo(value);
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 80 ? text.slice(0, 77) + '…' : text;
  }
  return String(value);
}

type Field<T> = [keyof T & string, string, (value: unknown, item: T) => string];

function diffEntities<T extends { id: string }>(changes: Change[], kind: string, before: T[], after: T[], options: {
  name: (item: T) => string;
  added: string;
  removed: string;
  fields: Array<Field<T>>;
}) {
  if (before === after) return;
  const old = new Map(before.map((item) => [item.id, item]));
  const current = new Set(after.map((item) => item.id));
  for (const item of after) {
    const previous = old.get(item.id);
    if (!previous) {
      changes.push({ key: kind + ':' + item.id, label: options.added, before: '', after: options.name(item), added: true });
      continue;
    }
    if (previous === item) continue;
    for (const [field, label, format] of options.fields) {
      const x = format(previous[field], previous);
      const y = format(item[field], item);
      if (x !== y) changes.push({ key: kind + ':' + item.id + ':' + field, label: options.name(previous) + ': ' + label, before: x, after: y });
    }
  }
  for (const item of before) {
    if (!current.has(item.id)) changes.push({ key: kind + ':' + item.id, label: options.removed, before: options.name(item), after: '' });
  }
}

function conflictText(conflict: TabJudgeConflict, names: Names): string {
  const target = conflict.teamId ? names.team(conflict.teamId) : conflict.institution ?? '';
  return names.judge(conflict.judgeId) + ' · ' + target + ' · ' + (conflict.level === 'objective' ? 'objetiva' : 'subjetiva') + (conflict.note ? ' (' + conflict.note + ')' : '');
}

function resultSummary(result: TabDebateResult | undefined, names: Names): string {
  if (!result) return 'sin acta';
  const parts: string[] = [];
  if (result.override) parts.push('decisión manual: gana ' + names.team(result.override.winnerTeamId) + (result.override.reason ? ' (' + result.override.reason + ')' : ''));
  if (result.joint) {
    const joint = result.joint;
    const totals = Object.keys({ ...joint.quickTotals, ...joint.items }).map((teamId) => {
      const items = Object.values(joint.items[teamId] ?? {}).filter((value) => typeof value === 'number');
      const total = items.length ? items.reduce((sum, value) => sum + value, 0) : joint.quickTotals?.[teamId];
      return names.team(teamId) + ' ' + plain(total);
    });
    parts.push((joint.winnerTeamId ? 'gana ' + names.team(joint.winnerTeamId) : 'sin ganador') + (totals.length ? ' (' + totals.join(', ') + ')' : ''));
  }
  for (const ballot of result.ballots) {
    const votes = ballot.winnerTeamId ? 'vota a ' + names.team(ballot.winnerTeamId) : Object.entries(ballot.totals).map(([teamId, total]) => names.team(teamId) + ' ' + total).join(', ');
    parts.push(names.judge(ballot.judgeId) + ': ' + votes);
  }
  const penalties = Object.entries(result.penalties)
    .filter(([, value]) => value.warnings || value.minors || value.majors || value.disqualified)
    .map(([teamId, value]) => names.team(teamId) + ' ' + value.warnings + 'A/' + value.minors + 'L/' + value.majors + 'G' + (value.disqualified ? ' descalificado' : ''));
  if (penalties.length) parts.push('faltas: ' + penalties.join(', '));
  return parts.join(' · ') || 'acta vacía';
}

function debateFields(names: Names): Array<Field<TabDebate>> {
  const list = (ids: unknown, name: (id: string) => string, separator: string) => (Array.isArray(ids) ? ids.map((id) => name(String(id))).join(separator) : '');
  return [
    ['teamIds', 'equipos', (ids) => list(ids, names.team, ' – ')],
    ['venueId', 'sala', (id) => (id ? names.venue(String(id)) : '')],
    ['judgeIds', 'jurado', (ids) => list(ids, names.judge, ', ')],
    ['chairId', 'principal', (id) => (id ? names.judge(String(id)) : '')],
    ['favorTeamId', 'a favor', (id) => (id ? names.team(String(id)) : '')],
    ['result', 'acta', (result) => resultSummary(result as TabDebateResult | undefined, names)],
  ];
}

function diffRound(changes: Change[], before: TabRound, after: TabRound, names: Names) {
  const label = (debate: TabDebate) => before.name + ' · ' + debate.teamIds.map(names.team).join(' – ');
  diffEntities(changes, 'debate', before.debates, after.debates, {
    name: label, added: 'Debate añadido en ' + after.name, removed: 'Debate eliminado de ' + before.name, fields: debateFields(names),
  });
  // Edits the summaries do not show (e.g. only the notes of an acta) are still recorded.
  const old = new Map(before.debates.map((debate) => [debate.id, debate]));
  for (const debate of after.debates) {
    const previous = old.get(debate.id);
    if (!previous || previous === debate || previous.result === debate.result) continue;
    if (resultSummary(previous.result, names) !== resultSummary(debate.result, names) || canonicalJson(previous.result) === canonicalJson(debate.result)) continue;
    changes.push({ key: 'debate:' + debate.id + ':detail', label: label(previous) + ': acta (detalle)', before: 'versión anterior', after: 'modificada' });
  }
}

function draftSummary(draft: TabRoundDraft | undefined): string {
  return draft ? 'borrador de ' + draft.round.name + ' (' + draft.round.debates.length + ' debates)' : '';
}

/** Readable list of what changed between two versions of a tournament (bookkeeping fields are ignored). */
export function describeChanges(before: TabTournament, after: TabTournament): Change[] {
  if (before === after) return [];
  const teams = new Map([...before.teams, ...after.teams].map((team) => [team.id, team.name]));
  const judges = new Map([...before.judges, ...after.judges].map((judge) => [judge.id, judge.name]));
  const venues = new Map([...before.venues, ...after.venues].map((venue) => [venue.id, venue.name]));
  const rounds = new Map([...before.rounds, ...after.rounds].map((round) => [round.id, round.name]));
  const names: Names = {
    team: (id) => teams.get(id) ?? 'equipo desconocido',
    judge: (id) => judges.get(id) ?? 'juez desconocido',
    venue: (id) => venues.get(id) ?? 'sala desconocida',
    round: (id) => rounds.get(id) ?? 'ronda desconocida',
  };
  const changes: Change[] = [];
  if (before.name !== after.name) changes.push({ key: 'name', label: 'Nombre del torneo', before: before.name, after: after.name });

  if (before.settings !== after.settings) {
    const keys = [...new Set([...Object.keys(before.settings), ...Object.keys(after.settings)])].sort() as Array<keyof TabTournament['settings']>;
    for (const key of keys) {
      if (canonicalJson(before.settings[key]) === canonicalJson(after.settings[key])) continue;
      changes.push({ key: 'settings:' + key, label: 'Reglas · ' + key, before: short(before.settings[key]), after: short(after.settings[key]) });
    }
  }

  const judgeList = (ids: unknown) => (Array.isArray(ids) ? ids.map((id) => names.judge(String(id))).join(', ') : '');
  diffEntities(changes, 'team', before.teams, after.teams, {
    name: (team) => team.name, added: 'Equipo añadido', removed: 'Equipo eliminado',
    fields: [
      ['name', 'nombre', plain], ['institution', 'institución', plain], ['active', 'activo', yesNo], ['swing', 'swing', yesNo],
      ['breakEligible', 'puede clasificarse', yesNo], ['fallenFromRound', 'caído desde la ronda', plain], ['incompatibleJudgeIds', 'jueces incompatibles', judgeList],
    ],
  });
  diffEntities(changes, 'speaker', before.speakers, after.speakers, {
    name: (speaker) => speaker.name, added: 'Orador añadido', removed: 'Orador eliminado',
    fields: [['name', 'nombre', plain], ['teamId', 'equipo', (id) => names.team(String(id))]],
  });
  diffEntities(changes, 'judge', before.judges, after.judges, {
    name: (judge) => judge.name, added: 'Juez añadido', removed: 'Juez eliminado',
    fields: [
      ['name', 'nombre', plain], ['institution', 'institución', plain], ['active', 'disponible', yesNo], ['rating', 'nivel', plain],
      ['canChair', 'puede presidir', yesNo], ['phone', 'móvil', plain], ['incompatibleJudgeIds', 'jueces incompatibles', judgeList],
      ['unavailableRoundIds', 'no disponible en', (ids) => (Array.isArray(ids) ? ids.map((id) => names.round(String(id))).join(', ') : '')],
    ],
  });
  diffEntities(changes, 'venue', before.venues, after.venues, {
    name: (venue) => venue.name, added: 'Sala añadida', removed: 'Sala eliminada', fields: [['name', 'nombre', plain], ['active', 'activa', yesNo]],
  });
  diffEntities(changes, 'conflict', before.judgeConflicts ?? [], after.judgeConflicts ?? [], {
    name: (conflict) => conflictText(conflict, names), added: 'Incompatibilidad añadida', removed: 'Incompatibilidad eliminada',
    fields: [['level', 'nivel', plain], ['note', 'nota', plain], ['teamId', 'equipo', (id) => (id ? names.team(String(id)) : '')], ['institution', 'institución', plain]],
  });

  if (before.rounds !== after.rounds) {
    diffEntities(changes, 'round', before.rounds, after.rounds, {
      name: (round) => round.name, added: 'Ronda añadida', removed: 'Ronda eliminada',
      fields: [['name', 'nombre', plain], ['silent', 'cerrada', yesNo], ['panelSize', 'panel', plain], ['sideMode', 'posturas', plain], ['pushedAt', 'enviada al panel', (value) => (value ? 'sí' : '')]],
    });
    const old = new Map(before.rounds.map((round) => [round.id, round]));
    for (const round of after.rounds) {
      const previous = old.get(round.id);
      if (previous && previous.debates !== round.debates) diffRound(changes, previous, round, names);
    }
  }

  if (before.draftRound !== after.draftRound) {
    const x = draftSummary(before.draftRound);
    const y = draftSummary(after.draftRound);
    if (x !== y) changes.push({ key: 'draft', label: 'Borrador de ronda', before: x, after: y });
    else if (canonicalJson(before.draftRound) !== canonicalJson(after.draftRound)) changes.push({ key: 'draft', label: 'Borrador de ronda', before: x, after: y + ' (modificado)' });
  }
  const teamList = (ids: string[]) => ids.map(names.team).join(', ');
  if (canonicalJson(before.groups) !== canonicalJson(after.groups)) {
    const groups = (list: TabTournament['groups']) => list.map((group) => group.name + ': ' + teamList(group.teamIds)).join(' | ');
    changes.push({ key: 'groups', label: 'Grupos', before: groups(before.groups), after: groups(after.groups) });
  }
  if (before.breakSeeds.join() !== after.breakSeeds.join()) changes.push({ key: 'breakSeeds', label: 'Clasificados para eliminatorias', before: teamList(before.breakSeeds), after: teamList(after.breakSeeds) });
  if (before.manualOrder.join() !== after.manualOrder.join()) changes.push({ key: 'manualOrder', label: 'Orden manual de desempate', before: teamList(before.manualOrder), after: teamList(after.manualOrder) });
  if (before.whatsapp?.deskPhone !== after.whatsapp?.deskPhone) changes.push({ key: 'whatsapp:desk', label: 'Móvil de la mesa (WhatsApp)', before: before.whatsapp?.deskPhone ?? '', after: after.whatsapp?.deskPhone ?? '' });
  if (before.whatsapp?.baseUrl !== after.whatsapp?.baseUrl) changes.push({ key: 'whatsapp:url', label: 'Dirección de la página del acta', before: before.whatsapp?.baseUrl ?? '', after: after.whatsapp?.baseUrl ?? '' });
  if (before.panelLink?.tournamentName !== after.panelLink?.tournamentName) {
    changes.push({ key: 'panelLink', label: 'Enlace con el panel', before: before.panelLink?.tournamentName ?? '', after: after.panelLink?.tournamentName ?? '' });
  }
  return changes;
}

/**
 * Adds newer changes to older ones: each field keeps its first `before` and its latest `after`, changes that end
 * where they started disappear, and later edits of something added in the same group only update its name.
 */
export function mergeChanges(previous: Change[], next: Change[]): Change[] {
  const merged = new Map(previous.map((change) => [change.key, { ...change }]));
  for (const change of next) {
    const existing = merged.get(change.key);
    if (existing) {
      merged.set(change.key, { ...existing, after: change.after });
      continue;
    }
    const segments = change.key.split(':');
    const entity = segments.length > 2 ? merged.get(segments.slice(0, 2).join(':')) : undefined;
    if (entity?.added) {
      if (segments[2] === 'name') entity.after = change.after;
      continue;
    }
    merged.set(change.key, { ...change });
  }
  return [...merged.values()].filter((change) => (change.before ?? '') !== (change.after ?? ''));
}

export function summarizeChanges(changes: Change[]): string {
  if (!changes.length) return 'Sin cambios.';
  const shown = changes.slice(0, 3).map((change) => change.label).join('; ');
  return changes.length + (changes.length === 1 ? ' cambio: ' : ' cambios: ') + shown + (changes.length > 3 ? ' y ' + (changes.length - 3) + ' más.' : '.');
}
