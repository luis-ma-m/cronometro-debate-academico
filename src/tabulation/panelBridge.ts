import type { Judge, Room, Speaker, Team, Tournament } from '../domain';
import { createTimer, resolvePhases, validateAssignments, withRoomStatus } from '../timer';
import { pickChair } from './adjudication';
import { createTabTournament } from './presets';
import { randomSeed } from './random';
import { isFallenAt, sameInstitution, type PresetId, type TabDebate, type TabJudge, type TabTeam, type TabTournament, type PanelEntityIdMap, makeTabId } from './types';

/**
 * Versioned hand-offs between the admin panel and the local tabulation. Each side only reads the other's
 * payload through these formats, never its internal storage.
 */
export const HANDOFF_KEY = 'ledu-tabulacion-handoff-v1';
export const OUTBOX_KEY = 'ledu-tabulacion-outbox-v1';

type SimpleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface PanelHandoff {
  format: 'ledu-tabulacion-handoff';
  version: 1;
  createdAt: number;
  /** Canonical ID supplied by the authenticated manager; absent only in legacy/demo mode. */
  tournamentId?: string;
  tournamentName: string;
  teams: Array<Pick<Team, 'id' | 'name' | 'institution' | 'active' | 'incompatibleJudgeIds'>>;
  speakers: Speaker[];
  judges: Array<Pick<Judge, 'id' | 'name' | 'institution' | 'active' | 'incompatibleJudgeIds'>>;
  venues: Array<{ id: string; name: string; active: boolean }>;
}


export type PanelEntityKind = 'teams' | 'speakers' | 'judges' | 'venues';
export interface PanelEntityMatchSuggestion {
  kind: PanelEntityKind;
  localId: string;
  remoteId: string;
  reason: 'same-id' | 'name-and-institution' | 'name';
}

/** Suggestions are deliberately advisory: callers must ask the operator to confirm every mapping. */
export function suggestPanelEntityMatches(tournament: TabTournament, handoff: PanelHandoff): PanelEntityMatchSuggestion[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLocaleLowerCase('es-ES').replace(/[^a-z0-9]+/g, ' ').trim();
  const suggestions: PanelEntityMatchSuggestion[] = [];
  const collect = <T extends { id: string; name: string }, R extends { id: string; name: string }>(
    kind: PanelEntityKind,
    local: T[],
    remote: R[],
    institution?: (item: T | R) => string,
  ) => {
    for (const incoming of remote) {
      const sameId = local.find((item) => item.id === incoming.id);
      if (sameId) {
        suggestions.push({ kind, localId: sameId.id, remoteId: incoming.id, reason: 'same-id' });
        continue;
      }
      const name = normalize(incoming.name);
      const candidates = local.filter((item) => normalize(item.name) === name && (!institution
        || normalize(institution(item)) === normalize(institution(incoming))));
      for (const candidate of candidates) {
        suggestions.push({ kind, localId: candidate.id, remoteId: incoming.id, reason: institution ? 'name-and-institution' : 'name' });
      }
    }
  };
  collect('teams', tournament.teams, handoff.teams, (item) => 'institution' in item ? String(item.institution ?? '') : '');
  collect('speakers', tournament.speakers, handoff.speakers);
  collect('judges', tournament.judges, handoff.judges, (item) => 'institution' in item ? String(item.institution ?? '') : '');
  collect('venues', tournament.venues, handoff.venues);
  return suggestions;
}

/** Rejects stale, cross-type and many-to-one mappings before any local data can be changed. */
export function validatePanelEntityIdMap(tournament: TabTournament, handoff: PanelHandoff, idMap: PanelEntityIdMap): string[] {
  const errors: string[] = [];
  const definitions: Array<{ kind: PanelEntityKind; localIds: Set<string>; remoteIds: Set<string> }> = [
    { kind: 'teams', localIds: new Set(tournament.teams.map((item) => item.id)), remoteIds: new Set(handoff.teams.map((item) => item.id)) },
    { kind: 'speakers', localIds: new Set(tournament.speakers.map((item) => item.id)), remoteIds: new Set(handoff.speakers.map((item) => item.id)) },
    { kind: 'judges', localIds: new Set(tournament.judges.map((item) => item.id)), remoteIds: new Set(handoff.judges.map((item) => item.id)) },
    { kind: 'venues', localIds: new Set(tournament.venues.map((item) => item.id)), remoteIds: new Set(handoff.venues.map((item) => item.id)) },
  ];
  for (const definition of definitions) {
    const seenRemote = new Set<string>();
    for (const [localId, remoteId] of Object.entries(idMap[definition.kind] ?? {})) {
      if (!definition.localIds.has(localId)) errors.push('El ID local «' + localId + '» no existe en ' + definition.kind + '.');
      if (!definition.remoteIds.has(remoteId)) errors.push('El ID remoto «' + remoteId + '» no existe en ' + definition.kind + '.');
      if (seenRemote.has(remoteId)) errors.push('El ID remoto «' + remoteId + '» está asignado a más de una entidad local en ' + definition.kind + '.');
      seenRemote.add(remoteId);
    }
  }
  const localSpeakers = new Map(tournament.speakers.map((item) => [item.id, item]));
  const remoteSpeakers = new Map(handoff.speakers.map((item) => [item.id, item]));
  const remoteTeamToLocal = new Map(Object.entries(idMap.teams).map(([localId, remoteId]) => [remoteId, localId]));
  for (const [localSpeakerId, remoteSpeakerId] of Object.entries(idMap.speakers)) {
    const localSpeaker = localSpeakers.get(localSpeakerId);
    const remoteSpeaker = remoteSpeakers.get(remoteSpeakerId);
    if (!localSpeaker || !remoteSpeaker) continue;
    const mappedTeamId = remoteTeamToLocal.get(remoteSpeaker.teamId);
    if (!mappedTeamId || mappedTeamId !== localSpeaker.teamId) {
      errors.push('El orador «' + localSpeaker.name + '» no pertenece al equipo local correspondiente al equipo remoto de «' + remoteSpeaker.name + '». No se puede vincular sin revisar primero el equipo.');
    }
  }
  return [...new Set(errors)];
}

export interface PanelOutboxDebate {
  physicalRoomId: string;
  venueName: string;
  teamFavorId: string;
  teamContraId: string;
  /** Sorted: the panel stores judges without order, so the chair stays in the tabulation. */
  judgeIds: string[];
  chairId: string;
  sidesProvisional: boolean;
}

export interface PanelOutbox {
  format: 'ledu-tabulacion-outbox';
  version: 1;
  createdAt: number;
  tabTournamentName: string;
  panelTournamentName: string | null;
  roundName: string;
  debates: PanelOutboxDebate[];
}

function readJson<T>(storage: SimpleStorage, key: string, format: string): T | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null') as { format?: string; version?: number } | null;
    return value && value.format === format && value.version === 1 ? (value as T) : null;
  } catch {
    return null;
  }
}

export function buildPanelHandoff(panel: Tournament, now = Date.now()): PanelHandoff {
  return {
    format: 'ledu-tabulacion-handoff',
    version: 1,
    createdAt: now,
    ...(panel.remoteId ? { tournamentId: panel.remoteId } : {}),
    tournamentName: panel.tournamentName,
    teams: panel.teams.map(({ id, name, institution, active, incompatibleJudgeIds }) => ({ id, name, institution, active, incompatibleJudgeIds: [...incompatibleJudgeIds] })),
    speakers: (panel.speakers ?? []).map((speaker) => ({ ...speaker })),
    judges: panel.judges.map(({ id, name, institution, active, incompatibleJudgeIds }) => ({ id, name, institution, active, incompatibleJudgeIds: [...incompatibleJudgeIds] })),
    venues: panel.physicalRooms.map(({ id, name, active }) => ({ id, name, active })),
  };
}

export const writeHandoff = (storage: SimpleStorage, handoff: PanelHandoff) => storage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
export const readHandoff = (storage: SimpleStorage) => readJson<PanelHandoff>(storage, HANDOFF_KEY, 'ledu-tabulacion-handoff');
export const clearHandoff = (storage: SimpleStorage) => storage.removeItem(HANDOFF_KEY);
export const writeOutbox = (storage: SimpleStorage, outbox: PanelOutbox) => storage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
export const readOutbox = (storage: SimpleStorage) => readJson<PanelOutbox>(storage, OUTBOX_KEY, 'ledu-tabulacion-outbox');

export interface MergeSummary { tournament: TabTournament; added: number; updated: number; warnings: string[]; issues: string[] }

/**
 * Reconciles panel participants through explicit local→remote IDs. The panel owns names, institutions and
 * incompatibilities; tabulation keeps judge levels, chair eligibility, availability, swing and break eligibility.
 * Nothing is ever deleted, and every cross-entity reference is translated through the same map.
 */
export function mergeHandoff(
  tournament: TabTournament,
  handoff: PanelHandoff,
  now = Date.now(),
  reviewedIdMap?: PanelEntityIdMap,
): MergeSummary {
  let added = 0;
  let updated = 0;
  const warnings: string[] = [];
  const issues: string[] = [];
  if (tournament.panelLink?.remoteId && handoff.tournamentId !== tournament.panelLink.remoteId) {
    issues.push('El torneo local está vinculado a otra identidad remota. No se han aplicado cambios.');
    return { tournament, added, updated, warnings, issues };
  }
  if (tournament.panelLink && handoff.tournamentId && !tournament.panelLink.remoteId) {
    issues.push('Este torneo tiene un vínculo antiguo sin identidad verificable. Crea una copia vinculada desde el panel; no se fusionarán datos por nombre.');
    return { tournament, added, updated, warnings, issues };
  }
  if (!tournament.panelLink && handoff.tournamentId && !reviewedIdMap) {
    issues.push('Este torneo local todavía no está vinculado. La vinculación inicial requiere una revisión explícita de las correspondencias.');
    return { tournament, added, updated, warnings, issues };
  }
  if (tournament.panelLink && tournament.panelLink.tournamentName !== handoff.tournamentName) {
    warnings.push('Este torneo se enlazó con «' + tournament.panelLink.tournamentName + '» y los datos vienen de «' + handoff.tournamentName + '».');
  }

  const emptyMap = (): PanelEntityIdMap => ({ teams: {}, speakers: {}, judges: {}, venues: {} });
  const idMap: PanelEntityIdMap = structuredClone(reviewedIdMap ?? tournament.panelLink?.idMap ?? emptyMap());
  if (!reviewedIdMap && tournament.panelLink?.remoteId && !tournament.panelLink.idMap) {
    // Older copies were created from a hand-off that reused the manager IDs. Recover only exact ID matches.
    for (const kind of ['teams', 'speakers', 'judges', 'venues'] as const) {
      const localItems = kind === 'teams' ? tournament.teams : kind === 'speakers' ? tournament.speakers : kind === 'judges' ? tournament.judges : tournament.venues;
      const remoteItems = kind === 'teams' ? handoff.teams : kind === 'speakers' ? handoff.speakers : kind === 'judges' ? handoff.judges : handoff.venues;
      const remoteIds = new Set(remoteItems.map((item) => item.id));
      for (const item of localItems) if (remoteIds.has(item.id)) idMap[kind][item.id] = item.id;
    }
  }

  if (handoff.tournamentId) {
    const mapIssues = validatePanelEntityIdMap(tournament, handoff, idMap);
    if (mapIssues.length) return { tournament, added, updated, warnings, issues: mapIssues };
  }

  const localIds = {
    teams: new Set(tournament.teams.map((item) => item.id)),
    speakers: new Set(tournament.speakers.map((item) => item.id)),
    judges: new Set(tournament.judges.map((item) => item.id)),
    venues: new Set(tournament.venues.map((item) => item.id)),
  };
  const mapRemote = (kind: PanelEntityKind, remoteId: string): string => {
    const existing = Object.entries(idMap[kind]).find(([, value]) => value === remoteId)?.[0];
    if (existing) return existing;
    let localId = '';
    do { localId = makeTabId(kind.slice(0, -1)); } while (localIds[kind].has(localId));
    localIds[kind].add(localId);
    idMap[kind][localId] = remoteId;
    return localId;
  };

  // References are translated as well as entity IDs; a cross-entity reference must never keep a remote ID.
  const remoteTeamIds = new Set(handoff.teams.map((item) => item.id));
  const remoteJudgeIds = new Set(handoff.judges.map((item) => item.id));
  const referenceIssues: string[] = [];
  for (const team of handoff.teams) for (const judgeId of team.incompatibleJudgeIds) {
    if (!remoteJudgeIds.has(judgeId)) referenceIssues.push('El equipo «' + team.name + '» referencia un juez remoto inexistente (' + judgeId + ').');
  }
  for (const judge of handoff.judges) for (const judgeId of judge.incompatibleJudgeIds) {
    if (!remoteJudgeIds.has(judgeId)) referenceIssues.push('El juez «' + judge.name + '» referencia un juez remoto inexistente (' + judgeId + ').');
  }
  for (const speaker of handoff.speakers) if (!remoteTeamIds.has(speaker.teamId)) {
    referenceIssues.push('El orador «' + speaker.name + '» referencia un equipo remoto inexistente (' + speaker.teamId + ').');
  }
  if (referenceIssues.length) return { tournament, added, updated, warnings, issues: referenceIssues };

  const judgeId = (id: string) => mapRemote('judges', id);
  const teamId = (id: string) => mapRemote('teams', id);
  const mappedTeams: TabTeam[] = handoff.teams.map((team) => ({
    ...team,
    id: teamId(team.id),
    incompatibleJudgeIds: team.incompatibleJudgeIds.map(judgeId),
    swing: false,
    breakEligible: true,
  }));
  const mappedSpeakers = handoff.speakers.map((speaker) => ({
    ...speaker,
    id: mapRemote('speakers', speaker.id),
    teamId: teamId(speaker.teamId),
  }));
  const mappedJudges: TabJudge[] = handoff.judges.map((judge) => ({
    ...judge,
    id: judgeId(judge.id),
    incompatibleJudgeIds: judge.incompatibleJudgeIds.map(judgeId),
    rating: 3,
    canChair: true,
    unavailableRoundIds: [],
  }));
  const mappedVenues = handoff.venues.map((venue) => ({ ...venue, id: mapRemote('venues', venue.id) }));

  const merge = <T extends { id: string }>(current: T[], incoming: T[], update: (existing: T, next: T) => T) => {
    const result = [...current];
    for (const item of incoming) {
      const index = result.findIndex((existing) => existing.id === item.id);
      if (index < 0) { result.push(item); added++; continue; }
      const next = update(result[index], item);
      if (JSON.stringify(next) !== JSON.stringify(result[index])) { result[index] = next; updated++; }
    }
    return result;
  };
  const teams = merge<TabTeam>(
    tournament.teams,
    mappedTeams,
    (existing, next) => ({ ...existing, name: next.name, institution: next.institution, incompatibleJudgeIds: next.incompatibleJudgeIds }),
  );
  const speakers = merge(
    tournament.speakers,
    mappedSpeakers,
    (existing, next) => ({ ...existing, name: next.name, teamId: next.teamId }),
  );
  const judges = merge<TabJudge>(
    tournament.judges,
    mappedJudges,
    (existing, next) => ({ ...existing, name: next.name, institution: next.institution, incompatibleJudgeIds: next.incompatibleJudgeIds }),
  );
  const venues = merge(tournament.venues, mappedVenues, (existing, next) => ({ ...existing, name: next.name }));
  return {
    tournament: {
      ...tournament,
      teams,
      speakers,
      judges,
      venues,
      panelLink: {
        tournamentName: handoff.tournamentName,
        linkedAt: tournament.panelLink?.linkedAt ?? now,
        ...(handoff.tournamentId ? { remoteId: handoff.tournamentId, idMap } : {}),
      },
    },
    added,
    updated,
    warnings,
    issues,
  };
}

export function tournamentFromHandoff(handoff: PanelHandoff, presetId: PresetId, now = Date.now(), seed = randomSeed()): TabTournament {
  const created = createTabTournament(handoff.tournamentName, presetId, now, seed);
  const linked = handoff.tournamentId
    ? { ...created, panelLink: {
      tournamentName: handoff.tournamentName,
      linkedAt: now,
      remoteId: handoff.tournamentId,
      idMap: {
        teams: Object.fromEntries(handoff.teams.map((item) => [item.id, item.id])),
        speakers: Object.fromEntries(handoff.speakers.map((item) => [item.id, item.id])),
        judges: Object.fromEntries(handoff.judges.map((item) => [item.id, item.id])),
        venues: Object.fromEntries(handoff.venues.map((item) => [item.id, item.id])),
      },
    } }
    : created;
  return mergeHandoff(linked, handoff, now).tournament;
}

export interface OutboxResult { outbox: PanelOutbox | null; issues: string[]; warnings: string[] }

export function buildOutbox(tournament: TabTournament, roundId: string, now = Date.now()): OutboxResult {
  const round = tournament.rounds.find((item) => item.id === roundId);
  if (!round) return { outbox: null, issues: ['La ronda no existe.'], warnings: [] };
  const issues: string[] = [];
  const warnings: string[] = [];
  const venues = new Map(tournament.venues.map((venue) => [venue.id, venue.name]));
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const debates: PanelOutboxDebate[] = [];
  let fallen = 0;
  for (const debate of round.debates) {
    const [a, b] = debate.teamIds;
    if (debate.teamIds.some((id) => isFallenAt(teams.get(id), round.number))) { fallen++; continue; }
    const venueName = venues.get(debate.venueId) ?? '';
    if (!venueName) { issues.push('Hay debates sin sala: asigna una sala a cada debate antes de enviarlo.'); continue; }
    if (!a || !b) { issues.push(venueName + ': faltan equipos.'); continue; }
    const favor = debate.favorTeamId ?? a;
    const panel = tournament.settings.conflictPolicy === 'lastResort' ? panelAcceptedJudges(tournament, debate, venueName, warnings) : debate;
    debates.push({
      physicalRoomId: debate.venueId,
      venueName,
      teamFavorId: favor,
      teamContraId: favor === a ? b : a,
      judgeIds: [...panel.judgeIds].sort(),
      chairId: panel.chairId,
      sidesProvisional: !debate.favorTeamId,
    });
  }
  if (fallen) warnings.push(fallen + ' debate(s) contra un equipo caído no se envían al panel: no se disputan.');
  const provisional = debates.filter((debate) => debate.sidesProvisional).length;
  if (provisional) warnings.push(provisional + ' debate(s) sin postura sorteada: se enviarán con una postura provisional que podrás intercambiar en el panel.');
  if (debates.some((debate) => !debate.judgeIds.length)) warnings.push('Hay debates sin jueces.');
  if (issues.length) return { outbox: null, issues: [...new Set(issues)], warnings };
  return {
    outbox: {
      format: 'ledu-tabulacion-outbox',
      version: 1,
      createdAt: now,
      tabTournamentName: tournament.name,
      panelTournamentName: tournament.panelLink?.tournamentName ?? null,
      roundName: round.name,
      debates,
    },
    issues,
    warnings,
  };
}

/**
 * The panel refuses institution, team–judge and judge–judge conflicts, which ADUMA may seat as a last resort: those
 * judges stay in the tabulation but are left out of the push, with a warning. The chair is kept whenever possible.
 */
function panelAcceptedJudges(tournament: TabTournament, debate: TabDebate, venueName: string, warnings: string[]): Pick<TabDebate, 'judgeIds' | 'chairId'> {
  const judges = new Map(tournament.judges.map((judge) => [judge.id, judge]));
  const debateTeams = debate.teamIds.map((id) => tournament.teams.find((team) => team.id === id)).filter((team): team is TabTeam => Boolean(team));
  const kept: TabJudge[] = [];
  const ordered = [...debate.judgeIds].sort((x, y) => Number(y === debate.chairId) - Number(x === debate.chairId));
  for (const id of ordered) {
    const judge = judges.get(id);
    if (!judge) continue;
    const team = debateTeams.find((item) => sameInstitution(item.institution, judge.institution) || item.incompatibleJudgeIds.includes(judge.id));
    const colleague = kept.find((other) => other.incompatibleJudgeIds.includes(judge.id) || judge.incompatibleJudgeIds.includes(other.id));
    if (team || colleague) {
      warnings.push(venueName + ': ' + judge.name + ' no se envía al panel (incompatible con ' + (team ? team.name : colleague!.name) + '); el panel no admite incompatibilidades.');
      continue;
    }
    kept.push(judge);
  }
  const judgeIds = kept.map((judge) => judge.id);
  return { judgeIds, chairId: judgeIds.includes(debate.chairId) ? debate.chairId : pickChair(judgeIds, judges) };
}

export interface ApplyOutboxResult { rooms: Room[] | null; issues: string[]; summary: string[]; changed: number }

const sameSet = (left: string[], right: string[]) => left.length === right.length && [...left].sort().join('|') === [...right].sort().join('|');

/**
 * All-or-nothing: returns the panel rooms with the selected round re-assigned from the outbox, or only issues.
 * Existing assignments are reused per physical room, missing ones are created like "Asignar sala existente",
 * rooms of that round not used by the tabulation are emptied (never deleted), and rooms whose timer has started
 * or that already have a scorecard can only stay as they are.
 */
export function applyOutboxToPanel(panel: Tournament, panelRoundId: string, outbox: PanelOutbox, options: { makeId: (prefix: string) => string; now?: number }): ApplyOutboxResult {
  const now = options.now ?? Date.now();
  const issues: string[] = [];
  const round = panel.rounds.find((item) => item.id === panelRoundId);
  if (!round) return { rooms: null, issues: ['Selecciona una ronda del panel.'], summary: [], changed: 0 };
  const physicalRooms = new Map(panel.physicalRooms.map((physical) => [physical.id, physical]));
  const teams = new Map(panel.teams.map((team) => [team.id, team]));
  const judges = new Set(panel.judges.map((judge) => judge.id));
  const seenRooms = new Set<string>();
  for (const debate of outbox.debates) {
    if (!physicalRooms.has(debate.physicalRoomId)) issues.push('La sala «' + debate.venueName + '» no existe en el panel.');
    if (seenRooms.has(debate.physicalRoomId)) issues.push('La sala «' + debate.venueName + '» aparece en dos debates.');
    seenRooms.add(debate.physicalRoomId);
    if (!teams.has(debate.teamFavorId) || !teams.has(debate.teamContraId)) issues.push(debate.venueName + ': algún equipo no existe en el panel.');
    if (debate.judgeIds.some((id) => !judges.has(id))) issues.push(debate.venueName + ': algún juez no existe en el panel.');
  }
  if (issues.length) return { rooms: null, issues: [...new Set(issues)], summary: [], changed: 0 };

  const minimumJudges = panel.minimumJudgesPerRoom ?? 1;
  const scored = new Set((panel.scoring?.scorecards ?? []).map((card) => card.roomId));
  const targets = new Map(outbox.debates.map((debate) => [debate.physicalRoomId, debate]));
  let changed = 0;
  const rooms: Room[] = panel.rooms.map((room) => {
    if (room.roundId !== panelRoundId) return room;
    const target = targets.get(room.physicalRoomId);
    const teamFavorId = target?.teamFavorId ?? '';
    const teamContraId = target?.teamContraId ?? '';
    const judgeIds = target?.judgeIds ?? [];
    if (room.teamFavorId === teamFavorId && room.teamContraId === teamContraId && sameSet(room.judgeIds, judgeIds)) return room;
    if (room.timer.status !== 'idle' || scored.has(room.id)) {
      issues.push(room.name + ' tiene el cronómetro iniciado o finalizado, o un acta: su asignación no se puede cambiar.');
      return room;
    }
    changed++;
    return withRoomStatus({ ...room, teamFavorId, teamContraId, judgeIds: [...judgeIds], updatedAt: now }, minimumJudges);
  });
  const format = panel.formats.find((item) => item.id === round.defaultFormatId) ?? panel.formats[0];
  for (const debate of outbox.debates) {
    if (rooms.some((room) => room.roundId === panelRoundId && room.physicalRoomId === debate.physicalRoomId)) continue;
    const physical = physicalRooms.get(debate.physicalRoomId)!;
    const phases = (format?.phases?.length ? format.phases : resolvePhases(panel.formatPhases, panel.rooms)).map((phase) => ({ ...phase }));
    rooms.push(withRoomStatus({
      id: options.makeId('assignment'), name: physical.name, roundId: panelRoundId, physicalRoomId: physical.id, formatId: '',
      teamFavorId: debate.teamFavorId, teamContraId: debate.teamContraId, judgeIds: [...debate.judgeIds], status: 'unassigned',
      phases, timer: { ...createTimer(phases), updatedAt: now }, notes: '', updatedAt: now,
    }, minimumJudges));
    changed++;
  }
  issues.push(...validateAssignments({ ...panel, rooms: rooms.filter((room) => room.roundId === panelRoundId) }));
  if (issues.length) return { rooms: null, issues: [...new Set(issues)], summary: [], changed: 0 };
  const name = (id: string) => teams.get(id)?.name ?? id;
  const summary = outbox.debates.map((debate) => debate.venueName + ': ' + name(debate.teamFavorId) + ' (A favor) – ' + name(debate.teamContraId) + ' (En contra) · '
    + debate.judgeIds.length + (debate.judgeIds.length === 1 ? ' juez' : ' jueces') + (debate.sidesProvisional ? ' · postura provisional' : ''));
  return { rooms, issues: [], summary, changed };
}
