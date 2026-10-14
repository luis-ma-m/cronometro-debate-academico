import type { Phase, TimerState } from './domain';
import { findAssignmentConflicts } from './incompatibilities';

export const LEDU_PHASES: Phase[] = [
  { id: 'ledu-01', name: 'Exposición inicial', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 240, type: 'opening', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
  { id: 'ledu-02', name: 'Examen cruzado', side: 'contra', speaker: 'En contra pregunta a A favor', durationSeconds: 120, type: 'cross-examination', warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
  { id: 'ledu-03', name: 'Exposición inicial', side: 'contra', speaker: 'Equipo en contra', durationSeconds: 240, type: 'opening', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
  { id: 'ledu-04', name: 'Examen cruzado', side: 'favor', speaker: 'A favor pregunta a En contra', durationSeconds: 120, type: 'cross-examination', warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
  { id: 'ledu-05', name: 'Refutación 1', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 300, type: 'rebuttal', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
  { id: 'ledu-06', name: 'Refutación 1', side: 'contra', speaker: 'Equipo en contra', durationSeconds: 300, type: 'rebuttal', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
  { id: 'ledu-07', name: 'Refutación 2', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 300, type: 'rebuttal', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
  { id: 'ledu-08', name: 'Refutación 2', side: 'contra', speaker: 'Equipo en contra', durationSeconds: 300, type: 'rebuttal', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
  { id: 'ledu-09', name: 'Refutación cruzada', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 90, type: 'cross-rebuttal', warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
  { id: 'ledu-10', name: 'Refutación cruzada', side: 'contra', speaker: 'Equipo en contra', durationSeconds: 90, type: 'cross-rebuttal', warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
  { id: 'ledu-11', name: 'Conclusión', side: 'contra', speaker: 'Equipo en contra', durationSeconds: 180, type: 'conclusion', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
  { id: 'ledu-12', name: 'Conclusión', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 180, type: 'conclusion', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
];

/**
 * Resolves the tournament's usable phase sequence. New/legacy rooms sometimes
 * have an empty phase list; use the global format, then another configured room,
 * and finally the LEDU preset so a room can always be saved with valid phases.
 */
export function resolvePhases(formatPhases?: Phase[] | null, rooms: { phases?: Phase[] | null }[] = []): Phase[] {
  const roomPhases = rooms.find((room) => room.phases?.length)?.phases;
  const source = formatPhases?.length ? formatPhases : roomPhases?.length ? roomPhases : LEDU_PHASES;
  return source.map((phase) => ({
    ...phase,
    warningThresholdsSeconds: [...(phase.warningThresholdsSeconds ?? [])],
  }));
}

export type TimerAction = 'start' | 'pause' | 'reset' | 'next' | 'previous' | 'finish';

export const createTimer = (phases: Phase[] = LEDU_PHASES): TimerState => ({
  status: 'idle',
  phaseIndex: 0,
  remainingSeconds: phases[0]?.durationSeconds ?? 0,
  startedAt: null,
  lastResumedAt: null,
  revision: 0,
  updatedAt: Date.now(),
});

/** Derives time from timestamps, so background-tab throttling never accumulates clock drift. */
export function secondsLeft(timer: TimerState, now = Date.now()): number {
  if (timer.status !== 'running' || timer.lastResumedAt === null) return timer.remainingSeconds;
  return timer.remainingSeconds - Math.floor((now - timer.lastResumedAt) / 1000);
}

export function formatTime(seconds: number): string {
  const safe = Math.floor(Math.abs(seconds));
  const time = String(Math.floor(safe / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0');
  return seconds < 0 ? '+' + time : time;
}

export function transitionTimer(timer: TimerState, phases: Phase[], action: TimerAction, now = Date.now()): TimerState {
  const phase = phases[timer.phaseIndex];
  if (action === 'finish') {
    if (timer.status === 'finished') return timer;
    return { ...timer, status: 'finished', remainingSeconds: 0, lastResumedAt: null, updatedAt: now, revision: timer.revision + 1 };
  }
  if (action === 'reset') {
    if (!phase) return timer;
    return { ...timer, status: 'idle', remainingSeconds: phase.durationSeconds, startedAt: null, lastResumedAt: null, updatedAt: now, revision: timer.revision + 1 };
  }
  if (action === 'start') {
    if (timer.status === 'running' || timer.status === 'finished' || !phase) return timer;
    return { ...timer, status: 'running', startedAt: timer.startedAt ?? now, lastResumedAt: now, updatedAt: now, revision: timer.revision + 1 };
  }
  if (action === 'pause') {
    if (timer.status !== 'running') return timer;
    return { ...timer, status: 'paused', remainingSeconds: secondsLeft(timer, now), lastResumedAt: null, updatedAt: now, revision: timer.revision + 1 };
  }
  const nextIndex = action === 'previous' ? timer.phaseIndex - 1 : timer.phaseIndex + 1;
  if (action === 'previous' && nextIndex < 0) return timer;
  if (nextIndex >= phases.length) {
    return { ...timer, status: 'finished', remainingSeconds: 0, lastResumedAt: null, updatedAt: now, revision: timer.revision + 1 };
  }
  const nextPhase = phases[nextIndex];
  return { ...timer, status: 'idle', phaseIndex: nextIndex, remainingSeconds: nextPhase.durationSeconds, startedAt: null, lastResumedAt: null, updatedAt: now, revision: timer.revision + 1 };
}

export function withRoomStatus<T extends { status: string; timer: TimerState; teamFavorId: string; teamContraId: string; judgeIds: string[] }>(room: T, minimumJudgesPerRoom = 1): T {
  const status = room.timer.status === 'running' ? 'running'
    : room.timer.status === 'paused' ? 'paused'
    : room.timer.status === 'finished' ? 'finished'
    : room.teamFavorId && room.teamContraId && room.judgeIds.length >= minimumJudgesPerRoom ? 'ready' : 'unassigned';
  return { ...room, status };
}

export function validateAssignments(tournament: { rounds: { id: string; name: string }[]; teams: { id: string; name: string; institution?: string; incompatibleJudgeIds?: string[] }[]; judges: { id: string; name: string; institution?: string; incompatibleJudgeIds?: string[] }[]; rooms: { id: string; name: string; roundId: string; teamFavorId: string; teamContraId: string; judgeIds: string[]; phases: Phase[] }[] }): string[] {
  const errors: string[] = [];
  const roundIds = new Set(tournament.rounds.map((round) => round.id));
  const teamIds = new Map(tournament.teams.map((team) => [team.id, team.name]));
  const judgeIds = new Map(tournament.judges.map((judge) => [judge.id, judge.name]));
  const teamBookings = new Map<string, string>();
  const judgeBookings = new Map<string, string>();
  for (const room of tournament.rooms) {
    if (!roundIds.has(room.roundId)) errors.push(`${room.name}: no tiene una ronda válida.`);
    if (room.teamFavorId && room.teamFavorId === room.teamContraId) errors.push(`${room.name}: un equipo no puede debatir contra sí mismo.`);
    for (const id of [room.teamFavorId, room.teamContraId].filter(Boolean)) {
      if (!teamIds.has(id)) errors.push(`${room.name}: contiene un equipo inexistente.`);
      const key = room.roundId + ':' + id;
      const other = teamBookings.get(key);
      if (other) errors.push(`${teamIds.get(id) ?? id} está asignado a ${other} y ${room.name} en la misma ronda.`);
      else teamBookings.set(key, room.name);
    }
    const seenJudges = new Set<string>();
    for (const id of room.judgeIds ?? []) {
      if (!judgeIds.has(id)) errors.push(`${room.name}: contiene un juez inexistente.`);
      if (seenJudges.has(id)) errors.push(`${room.name}: un juez aparece más de una vez en la misma sala.`);
      seenJudges.add(id);
      const key = room.roundId + ':' + id;
      const other = judgeBookings.get(key);
      if (other && other !== room.name) errors.push(`${judgeIds.get(id) ?? id} está asignado a ${other} y ${room.name} en la misma ronda.`);
      else judgeBookings.set(key, room.name);

      const judge = tournament.judges.find((item) => item.id === id);
      const judgeInstitution = judge?.institution?.trim().toLocaleLowerCase('es-ES') ?? '';
      if (judge && judgeInstitution) {
        for (const teamId of [room.teamFavorId, room.teamContraId].filter(Boolean)) {
          const team = tournament.teams.find((item) => item.id === teamId);
          const teamInstitution = team?.institution?.trim().toLocaleLowerCase('es-ES') ?? '';
          if (team && teamInstitution && teamInstitution === judgeInstitution) {
            errors.push(`${judge.name} y ${team.name} comparten institución y no pueden coincidir en ${room.name}.`);
          }
        }
      }
    }
    if (!Array.isArray(room.phases) || !room.phases.length) errors.push(`${room.name}: el formato no tiene intervenciones.`);
    else for (const phase of room.phases) {
      if (!phase.name.trim() || !phase.speaker.trim() || !Number.isFinite(phase.durationSeconds) || phase.durationSeconds < 1) {
        errors.push(`${room.name}: revisa el nombre, el interviniente y la duración de cada intervención.`);
        break;
      }
    }
  }
  const conflictInput = {
    teams: tournament.teams.map((team) => ({ ...team, active: true, incompatibleJudgeIds: (team as typeof team & { incompatibleJudgeIds?: string[] }).incompatibleJudgeIds ?? [] })),
    judges: tournament.judges.map((judge) => ({ ...judge, active: true, incompatibleJudgeIds: (judge as typeof judge & { incompatibleJudgeIds?: string[] }).incompatibleJudgeIds ?? [] })),
    rooms: tournament.rooms,
  } as unknown as Parameters<typeof findAssignmentConflicts>[0];
  const conflictLabels = { institution: 'Conflicto de institución', 'team-judge': 'Incompatibilidad equipo–juez', 'judge-judge': 'Incompatibilidad juez–juez' } as const;
  for (const conflict of findAssignmentConflicts(conflictInput)) {
    errors.push(`${conflict.roomName}: ${conflictLabels[conflict.type]}. ${conflict.message}`);
  }
  return [...new Set(errors)];
}
