import type { Judge, Room, Speaker, Team, Tournament } from '../domain';
import { createTimer, validateAssignments, withRoomStatus } from '../timer';
import { pickChair } from './adjudication';
import { createTabTournament } from './presets';
import { randomSeed } from './random';
import { isFallenAt, sameInstitution, type PresetId, type TabDebate, type TabJudge, type TabTeam, type TabTournament } from './types';

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
  tournamentName: string;
  teams: Array<Pick<Team, 'id' | 'name' | 'institution' | 'active' | 'incompatibleJudgeIds'>>;
  speakers: Speaker[];
  judges: Array<Pick<Judge, 'id' | 'name' | 'institution' | 'active' | 'incompatibleJudgeIds'>>;
  venues: Array<{ id: string; name: string; active: boolean }>;
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
  version: 2;
  createdAt: number;
  presetId: PresetId;
  roundKind: 'qualifying' | 'elimination';
  timerPhases: import('../domain').Phase[];
  tabTournamentName: string;
  panelTournamentName: string | null;
  roundName: string;
  debates: PanelOutboxDebate[];
  /** Participant snapshots travel with the round so the panel can create missing records. */
  teams?: Team[];
  judges?: Judge[];
}

function readJson<T>(storage: SimpleStorage, key: string, format: string): T | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null') as { format?: string; version?: number } | null;
    return value && value.format === format && (value.version === 1 || value.version === 2) ? (value as T) : null;
  } catch {
    return null;
  }
}

export function buildPanelHandoff(panel: Tournament, now = Date.now()): PanelHandoff {
  return {
    format: 'ledu-tabulacion-handoff',
    version: 1,
    createdAt: now,
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

export interface MergeSummary { tournament: TabTournament; added: number; updated: number; warnings: string[] }

/**
 * Brings the panel participants into a tabulation (same IDs). The panel owns names, institutions and
 * incompatibilities; the tabulation keeps its own judge levels, chairs, availability, swing, break eligibility
 * and active flags. Nothing is ever deleted.
 */
export function mergeHandoff(tournament: TabTournament, handoff: PanelHandoff, now = Date.now()): MergeSummary {
  let added = 0;
  let updated = 0;
  const warnings: string[] = [];
  if (tournament.panelLink && tournament.panelLink.tournamentName !== handoff.tournamentName) {
    warnings.push('Este torneo se enlazó con «' + tournament.panelLink.tournamentName + '» y los datos vienen de «' + handoff.tournamentName + '».');
  }
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
    handoff.teams.map((team) => ({ ...team, swing: false, breakEligible: true })),
    (existing, next) => ({ ...existing, name: next.name, institution: next.institution, incompatibleJudgeIds: next.incompatibleJudgeIds }),
  );
  const teamIds = new Set(teams.map((team) => team.id));
  const speakers = merge(
    tournament.speakers,
    handoff.speakers.filter((speaker) => teamIds.has(speaker.teamId)),
    (existing, next) => ({ ...existing, name: next.name, teamId: next.teamId }),
  );
  const judges = merge<TabJudge>(
    tournament.judges,
    handoff.judges.map((judge) => ({ ...judge, rating: 3, canChair: true, unavailableRoundIds: [] })),
    (existing, next) => ({ ...existing, name: next.name, institution: next.institution, incompatibleJudgeIds: next.incompatibleJudgeIds }),
  );
  const venues = merge(tournament.venues, handoff.venues, (existing, next) => ({ ...existing, name: next.name }));
  return {
    tournament: { ...tournament, teams, speakers, judges, venues, panelLink: { tournamentName: handoff.tournamentName, linkedAt: now } },
    added,
    updated,
    warnings,
  };
}

export function tournamentFromHandoff(handoff: PanelHandoff, presetId: PresetId, now = Date.now(), seed = randomSeed()): TabTournament {
  return mergeHandoff(createTabTournament(handoff.tournamentName, presetId, now, seed), handoff, now).tournament;
}

export interface OutboxResult { outbox: PanelOutbox | null; issues: string[]; warnings: string[] }

export function buildOutbox(tournament: TabTournament, roundId: string, now = Date.now()): OutboxResult {
  const round = tournament.rounds.find((item) => item.id === roundId);
  if (!round) return { outbox: null, issues: ['La ronda no existe.'], warnings: [] };
  const issues: string[] = [];
  const warnings: string[] = [];
  const timerPhases = round.timerPhases?.length ? round.timerPhases : tournament.settings.timerPhases;
  if (!timerPhases.length || timerPhases.some((phase) => !phase.id.trim() || !phase.name.trim() || !Number.isFinite(phase.durationSeconds) || phase.durationSeconds <= 0)) {
    return { outbox: null, issues: ['Configura al menos una intervención con nombre y duración válida en Reglas del torneo antes de enviar la ronda.'], warnings };
  }
  const venues = new Map(tournament.venues.map((venue) => [venue.id, venue.name]));
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const judges = new Map(tournament.judges.map((judge) => [judge.id, judge]));
  const debates: PanelOutboxDebate[] = [];
  const usedTeamIds = new Set<string>();
  const usedJudgeIds = new Set<string>();
  const venueBookings = new Map<string, string>();
  const teamBookings = new Map<string, string>();
  const judgeBookings = new Map<string, string>();
  let fallen = 0;
  for (const debate of round.debates) {
    const [a, b] = debate.teamIds;
    if (debate.teamIds.some((id) => id && isFallenAt(teams.get(id), round.number))) { fallen++; continue; }
    const venueName = venues.get(debate.venueId) ?? '';
    if (!venueName) { issues.push('Hay debates sin sala: asigna una sala a cada debate antes de enviarlo.'); continue; }
    if (!a || !b) { issues.push(venueName + ': faltan equipos.'); continue; }
    if (a === b) { issues.push(venueName + ': un equipo no puede debatir contra sí mismo.'); continue; }
    if (!teams.has(a) || !teams.has(b)) { issues.push(venueName + ': contiene un equipo que ya no existe en Participantes. Actualiza el debate y vuelve a generarlo.'); continue; }
    const favor = debate.favorTeamId ?? a;
    if (favor !== a && favor !== b) {
      issues.push(venueName + ': la postura a favor apunta a un equipo que no pertenece a este debate. Vuelve a sortear las posturas.');
      continue;
    }
    const previousVenue = venueBookings.get(debate.venueId);
    if (previousVenue) issues.push('La sala «' + venueName + '» está asignada a ' + previousVenue + ' y a otro debate de la misma ronda.');
    else venueBookings.set(debate.venueId, venueName);
    for (const id of [a, b]) {
      const previous = teamBookings.get(id);
      if (previous) issues.push((teams.get(id)?.name ?? id) + ' aparece en ' + previous + ' y en ' + venueName + ' dentro de la misma ronda.');
      else teamBookings.set(id, venueName);
      usedTeamIds.add(id);
    }
    const panel = tournament.settings.conflictPolicy === 'lastResort' ? panelAcceptedJudges(tournament, debate, venueName, warnings) : debate;
    const localJudges = new Set<string>();
    for (const id of panel.judgeIds) {
      const judge = judges.get(id);
      if (!judge) {
        issues.push(venueName + ': el panel contiene un juez que ya no existe en Participantes. Actualiza el panel.');
        continue;
      }
      if (localJudges.has(id)) {
        issues.push(venueName + ': ' + judge.name + ' aparece más de una vez en el mismo panel.');
        continue;
      }
      localJudges.add(id);
      const previous = judgeBookings.get(id);
      if (previous) issues.push(judge.name + ' está asignado a ' + previous + ' y a ' + venueName + ' en la misma ronda.');
      else judgeBookings.set(id, venueName);
      usedJudgeIds.add(id);
      if (tournament.settings.conflictPolicy === 'hard') {
        for (const teamId of [a, b]) {
          const team = teams.get(teamId);
          if (!team) continue;
          if (sameInstitution(team.institution, judge.institution)) {
            issues.push(venueName + ': ' + judge.name + ' y ' + team.name + ' comparten institución.');
          }
          if (team.incompatibleJudgeIds.includes(judge.id)) {
            issues.push(venueName + ': ' + judge.name + ' es incompatible con el equipo ' + team.name + '.');
          }
        }
      }
    }
    if (tournament.settings.conflictPolicy === 'hard') {
      const seated = [...localJudges].map((id) => judges.get(id)).filter((judge): judge is TabJudge => Boolean(judge));
      for (let i = 0; i < seated.length; i++) for (let j = i + 1; j < seated.length; j++) {
        if (seated[i].incompatibleJudgeIds.includes(seated[j].id) || seated[j].incompatibleJudgeIds.includes(seated[i].id)) {
          issues.push(venueName + ': ' + seated[i].name + ' y ' + seated[j].name + ' son jueces incompatibles.');
        }
      }
    }
    debates.push({
      physicalRoomId: debate.venueId,
      venueName,
      teamFavorId: favor,
      teamContraId: favor === a ? b : a,
      judgeIds: [...localJudges].sort(),
      chairId: localJudges.has(panel.chairId) ? panel.chairId : pickChair([...localJudges], judges),
      sidesProvisional: !debate.favorTeamId,
    });
  }
  if (issues.length) return { outbox: null, issues: [...new Set(issues)], warnings };
  if (fallen) warnings.push(fallen + ' debate(s) contra un equipo caído no se envían al panel: no se disputan.');
  const provisional = debates.filter((debate) => debate.sidesProvisional).length;
  if (provisional) warnings.push(provisional + ' debate(s) sin postura sorteada: se enviarán con una postura provisional que podrás intercambiar en el panel.');
  if (debates.some((debate) => !debate.judgeIds.length)) warnings.push('Hay debates sin jueces.');
  if (issues.length) return { outbox: null, issues: [...new Set(issues)], warnings };
  return {
    outbox: {
      format: 'ledu-tabulacion-outbox',
      version: 2,
      createdAt: now,
      presetId: tournament.settings.presetId,
      roundKind: round.kind,
      timerPhases: timerPhases.map((phase) => ({ ...phase, warningThresholdsSeconds: [...(phase.warningThresholdsSeconds ?? [])] })),
      tabTournamentName: tournament.name,
      panelTournamentName: tournament.panelLink?.tournamentName ?? null,
      roundName: round.name,
      debates,
      teams: tournament.teams.filter((team) => usedTeamIds.has(team.id)).map((team) => ({
        id: team.id, name: team.name, institution: team.institution, active: team.active,
        incompatibleJudgeIds: [...team.incompatibleJudgeIds],
      })),
      judges: tournament.judges.filter((judge) => usedJudgeIds.has(judge.id)).map((judge) => ({
        id: judge.id, name: judge.name, institution: judge.institution, active: judge.active,
        incompatibleJudgeIds: [...judge.incompatibleJudgeIds],
      })),
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

export interface ApplyOutboxResult { rooms: Room[] | null; rounds: Tournament['rounds']; formats: Tournament['formats']; physicalRooms: Tournament['physicalRooms']; teams: Team[]; judges: Judge[]; institutions: string[]; addedTeams: number; addedJudges: number; addedPhysicalRooms: number; overwrittenRooms: number; resetTimers: number; removedScorecards: number; issues: string[]; summary: string[]; changed: number }

const sameSet = (left: string[], right: string[]) => left.length === right.length && [...left].sort().join('|') === [...right].sort().join('|');
const normalizeVenueName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
const venueSlug = (value: string) => normalizeVenueName(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sala';

/**
 * Imports a tabulation round atomically. Physical rooms are resolved by stable ID first and
 * normalized name second; missing rooms are created. This is an explicit destructive replacement:
 * every room in the selected round is reset to the tabulation assignment, its timer is reset,
 * and its existing scorecard is removed. The caller must obtain confirmation before applying it.
 */
export function applyOutboxToPanel(panel: Tournament, panelRoundId: string, outbox: PanelOutbox, options: { makeId: (prefix: string) => string; now?: number }): ApplyOutboxResult {
  const now = options.now ?? Date.now();
  const issues: string[] = [];
  const round = panel.rounds.find((item) => item.id === panelRoundId);
  const empty = { rounds: panel.rounds, formats: panel.formats, physicalRooms: panel.physicalRooms, teams: panel.teams, judges: panel.judges, institutions: panel.institutions ?? [], addedTeams: 0, addedJudges: 0, addedPhysicalRooms: 0, overwrittenRooms: 0, resetTimers: 0, removedScorecards: 0, issues: [] as string[], summary: [] as string[], changed: 0 };
  if (!round) return { ...empty, rooms: null, issues: ['Selecciona una ronda del panel.'] };

  if (outbox.version !== 2 || !Array.isArray(outbox.timerPhases) || !outbox.timerPhases.length || outbox.timerPhases.some((phase) => !phase.id || !phase.name.trim() || !Number.isFinite(phase.durationSeconds) || phase.durationSeconds <= 0)) return { ...empty, rooms: null, issues: ['La ronda no contiene un formato de cronómetro válido. Vuelve a generarla desde Tabulación.'] };

  const importedPhases = outbox.timerPhases.map((phase) => ({ ...phase, warningThresholdsSeconds: [...(phase.warningThresholdsSeconds ?? [])] }));
  const formatId = 'tabulation-' + outbox.presetId;
  const physicalRooms = [...panel.physicalRooms];
  const byId = new Map(physicalRooms.map((physical) => [physical.id, physical]));
  const byName = new Map(physicalRooms.map((physical) => [normalizeVenueName(physical.name), physical]));
  const resolved = new Map<string, Tournament['physicalRooms'][number]>();
  let addedPhysicalRooms = 0;
  for (const debate of outbox.debates) {
    let physical = byId.get(debate.physicalRoomId) ?? byName.get(normalizeVenueName(debate.venueName));
    if (!physical) {
      const baseSlug = venueSlug(debate.venueName);
      let slug = baseSlug;
      let suffix = 2;
      while (physicalRooms.some((item) => item.slug === slug)) slug = baseSlug + '-' + suffix++;
      physical = { id: options.makeId('physical-room'), slug, name: debate.venueName.trim(), active: true, createdAt: now, updatedAt: now };
      physicalRooms.push(physical);
      byId.set(physical.id, physical);
      byName.set(normalizeVenueName(physical.name), physical);
      addedPhysicalRooms++;
    }
    resolved.set(debate.physicalRoomId, physical);
  }

  // Tabulation and Management may contain the same participant with different IDs
  // (e.g. independently created/imported copies). Resolve by stable ID first, then by
  // normalized name, so an existing entity is reused instead of violating Neon’s
  // case-insensitive unique-name index.
  const teams = new Map(panel.teams.map((team) => [team.id, team]));
  const teamsByName = new Map(panel.teams.map((team) => [normalizeVenueName(team.name), team]));
  const canonicalTeamId = new Map<string, string>();
  for (const incoming of outbox.teams ?? []) {
    const byId = teams.get(incoming.id);
    const byName = teamsByName.get(normalizeVenueName(incoming.name));
    if (byId && byName && byId.id !== byName.id) {
      issues.push('El equipo «' + incoming.name + '» tiene identificadores distintos en Gestión y Tabulación y su nombre también está duplicado en Gestión. Corrige los participantes antes de importar.');
      continue;
    }
    const existing = byId ?? byName;
    if (existing) {
      canonicalTeamId.set(incoming.id, existing.id);
      continue;
    }
    const added = { ...incoming, incompatibleJudgeIds: [...incoming.incompatibleJudgeIds] };
    teams.set(added.id, added);
    teamsByName.set(normalizeVenueName(added.name), added);
    canonicalTeamId.set(incoming.id, added.id);
  }
  const judgesById = new Map(panel.judges.map((judge) => [judge.id, judge]));
  const judgesByName = new Map(panel.judges.map((judge) => [normalizeVenueName(judge.name), judge]));
  const canonicalJudgeId = new Map<string, string>();
  for (const incoming of outbox.judges ?? []) {
    const byId = judgesById.get(incoming.id);
    const byName = judgesByName.get(normalizeVenueName(incoming.name));
    if (byId && byName && byId.id !== byName.id) {
      issues.push('El juez «' + incoming.name + '» tiene identificadores distintos en Gestión y Tabulación y su nombre también está duplicado en Gestión. Corrige los participantes antes de importar.');
      continue;
    }
    const existing = byId ?? byName;
    if (existing) {
      canonicalJudgeId.set(incoming.id, existing.id);
      continue;
    }
    const added = { ...incoming, incompatibleJudgeIds: [...incoming.incompatibleJudgeIds] };
    judgesById.set(added.id, added);
    judgesByName.set(normalizeVenueName(added.name), added);
    canonicalJudgeId.set(incoming.id, added.id);
  }
  // New entities may carry incompatibility references using Tabulation IDs.
  // Translate those references through the same canonical-ID maps before persisting.
  const existingPanelTeamIds = new Set(panel.teams.map((team) => team.id));
  for (const incoming of outbox.teams ?? []) {
    const id = canonicalTeamId.get(incoming.id);
    if (id && !existingPanelTeamIds.has(id)) {
      const team = teams.get(id)!;
      teams.set(id, { ...team, incompatibleJudgeIds: incoming.incompatibleJudgeIds.map((judgeId) => canonicalJudgeId.get(judgeId) ?? judgeId) });
    }
  }
  const existingPanelJudgeIds = new Set(panel.judges.map((judge) => judge.id));
  for (const incoming of outbox.judges ?? []) {
    const id = canonicalJudgeId.get(incoming.id);
    if (id && !existingPanelJudgeIds.has(id)) {
      const judge = judgesById.get(id)!;
      judgesById.set(id, { ...judge, incompatibleJudgeIds: incoming.incompatibleJudgeIds.map((judgeId) => canonicalJudgeId.get(judgeId) ?? judgeId) });
    }
  }
  const judges = new Set(judgesById.keys());
  const seenRooms = new Set<string>();
  const targets = new Map<string, PanelOutboxDebate>();
  for (const debate of outbox.debates) {
    const physical = resolved.get(debate.physicalRoomId)!;
    if (seenRooms.has(physical.id)) issues.push('La sala «' + debate.venueName + '» aparece en dos debates.');
    seenRooms.add(physical.id);
    const mappedFavor = canonicalTeamId.get(debate.teamFavorId) ?? (teams.has(debate.teamFavorId) ? debate.teamFavorId : '');
    const mappedContra = canonicalTeamId.get(debate.teamContraId) ?? (teams.has(debate.teamContraId) ? debate.teamContraId : '');
    const mappedJudges = debate.judgeIds.map((id) => canonicalJudgeId.get(id) ?? (judges.has(id) ? id : ''));
    targets.set(physical.id, { ...debate, teamFavorId: mappedFavor, teamContraId: mappedContra, judgeIds: mappedJudges });
    if (!mappedFavor || !mappedContra) issues.push(debate.venueName + ': faltan datos de algún equipo en la copia enviada desde tabulación.');
    if (mappedJudges.some((id) => !id)) issues.push(debate.venueName + ': faltan datos de algún juez en la copia enviada desde tabulación.');
  }
  if (issues.length) return { ...empty, rooms: null, issues: [...new Set(issues)] };

  const minimumJudges = panel.minimumJudgesPerRoom ?? 1;
  const scored = new Set((panel.scoring?.scorecards ?? []).map((card) => card.roomId));
  const addedTeams = teams.size - panel.teams.length;
  const addedJudges = judgesById.size - panel.judges.length;
  let changed = addedTeams + addedJudges + addedPhysicalRooms + Number(round.defaultFormatId !== formatId || round.scoreType !== outbox.roundKind || JSON.stringify(panel.formats.find((item) => item.id === formatId)?.phases ?? []) !== JSON.stringify(importedPhases));
  let overwrittenRooms = 0;
  let resetTimers = 0;
  let removedScorecards = 0;
  const rooms: Room[] = panel.rooms.map((room) => {
    if (room.roundId !== panelRoundId) return room;
    const target = targets.get(room.physicalRoomId);
    const teamFavorId = target?.teamFavorId ?? '';
    const teamContraId = target?.teamContraId ?? '';
    const judgeIds = target?.judgeIds ?? [];
    const assignmentChanged = room.teamFavorId !== teamFavorId || room.teamContraId !== teamContraId || !sameSet(room.judgeIds, judgeIds);
    const formatChanged = room.formatId !== formatId || JSON.stringify(room.phases) !== JSON.stringify(importedPhases);
    const timerChanged = room.timer.status !== 'idle' || room.timer.phaseIndex !== 0 || room.timer.remainingSeconds !== importedPhases[0].durationSeconds || room.timer.startedAt !== null || room.timer.lastResumedAt !== null;
    const hasScorecard = scored.has(room.id);
    if (assignmentChanged && (room.teamFavorId || room.teamContraId || room.judgeIds.length)) overwrittenRooms++;
    if (timerChanged) resetTimers++;
    if (hasScorecard) removedScorecards++;
    changed += Number(assignmentChanged || formatChanged || timerChanged || hasScorecard);
    const phases = importedPhases.map((phase) => ({ ...phase, warningThresholdsSeconds: [...(phase.warningThresholdsSeconds ?? [])] }));
    const reset = { ...room, formatId, phases, teamFavorId, teamContraId, judgeIds: [...judgeIds], status: 'unassigned' as const, timer: { ...createTimer(phases), updatedAt: now }, updatedAt: now };
    return withRoomStatus(reset, minimumJudges);
  });
  const formats = [...panel.formats.filter((item) => item.id !== formatId), { id: formatId, name: 'Tabulación · ' + (outbox.presetId === 'aduma' ? 'V Torneo Nacional ADUMA' : outbox.presetId === 'uc3m-swiss' ? 'Sistema suizo' : 'LEDU · liguilla de equipos'), phases: importedPhases, version: (panel.formats.find((item) => item.id === formatId)?.version ?? 0) + 1, createdAt: panel.formats.find((item) => item.id === formatId)?.createdAt ?? now, updatedAt: now }];
  const rounds = panel.rounds.map((item) => item.id === panelRoundId ? { ...item, defaultFormatId: formatId, scoreType: outbox.roundKind } : item);
  for (const [physicalId, debate] of targets) {
    if (rooms.some((room) => room.roundId === panelRoundId && room.physicalRoomId === physicalId)) continue;
    const physical = physicalRooms.find((item) => item.id === physicalId)!;
    const phases = importedPhases.map((phase) => ({ ...phase, warningThresholdsSeconds: [...(phase.warningThresholdsSeconds ?? [])] }));
    rooms.push(withRoomStatus({
      id: options.makeId('assignment'), name: physical.name, roundId: panelRoundId, physicalRoomId: physical.id, formatId,
      teamFavorId: debate.teamFavorId, teamContraId: debate.teamContraId, judgeIds: [...debate.judgeIds], status: 'unassigned',
      phases, timer: { ...createTimer(phases), updatedAt: now }, notes: '', updatedAt: now,
    }, minimumJudges));
    changed++;
  }
  const mergedTeams = [...teams.values()];
  const mergedJudges = [...judgesById.values()];
  const institutions = [...new Set([...(panel.institutions ?? []), ...mergedTeams.map((team) => team.institution), ...mergedJudges.map((judge) => judge.institution)].map((value) => value.trim()).filter(Boolean))];
  issues.push(...validateAssignments({ ...panel, teams: mergedTeams, judges: mergedJudges, rooms: rooms.filter((room) => room.roundId === panelRoundId) }));
  if (issues.length) return { ...empty, rooms: null, issues: [...new Set(issues)] };
  const name = (id: string) => teams.get(id)?.name ?? id;
  const summary = outbox.debates.map((debate) => debate.venueName + ': ' + name(debate.teamFavorId) + ' (A favor) – ' + name(debate.teamContraId) + ' (En contra) · '
    + debate.judgeIds.length + (debate.judgeIds.length === 1 ? ' juez' : ' jueces') + (debate.sidesProvisional ? ' · postura provisional' : ''));
  return { rooms, rounds, formats, physicalRooms, teams: mergedTeams, judges: mergedJudges, institutions, addedTeams, addedJudges, addedPhysicalRooms, overwrittenRooms, resetTimers, removedScorecards, issues: [], summary, changed };
}
