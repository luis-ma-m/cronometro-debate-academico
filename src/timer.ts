import type { Phase, TimerState } from './domain';

export const LEDU_PHASES: Phase[] = [
  { id: 'f1', name: 'Introducción', side: 'favor', speaker: 'Orador/a 1', durationSeconds: 240 },
  { id: 'c1', name: 'Introducción', side: 'contra', speaker: 'Orador/a 1', durationSeconds: 240 },
  { id: 'f2', name: 'Refutación 1', side: 'favor', speaker: 'Orador/a 2', durationSeconds: 240 },
  { id: 'c2', name: 'Refutación 1', side: 'contra', speaker: 'Orador/a 2', durationSeconds: 240 },
  { id: 'f3', name: 'Refutación 2', side: 'favor', speaker: 'Orador/a 3', durationSeconds: 240 },
  { id: 'c3', name: 'Refutación 2', side: 'contra', speaker: 'Orador/a 3', durationSeconds: 240 },
  { id: 'f4', name: 'Refutación 3', side: 'favor', speaker: 'Orador/a 4', durationSeconds: 240 },
  { id: 'c4', name: 'Refutación 3', side: 'contra', speaker: 'Orador/a 4', durationSeconds: 240 },
  { id: 'f5', name: 'Conclusión', side: 'favor', speaker: 'Orador/a 5', durationSeconds: 180 },
  { id: 'c5', name: 'Conclusión', side: 'contra', speaker: 'Orador/a 5', durationSeconds: 180 },
  { id: 'f6', name: 'Cierre', side: 'favor', speaker: 'Orador/a 6', durationSeconds: 180 },
  { id: 'c6', name: 'Cierre', side: 'contra', speaker: 'Orador/a 6', durationSeconds: 180 },
];

export const createTimer = (phases: Phase[] = LEDU_PHASES): TimerState => ({
  status: 'idle',
  phaseIndex: 0,
  remainingSeconds: phases[0]?.durationSeconds ?? 0,
  startedAt: null,
  lastResumedAt: null,
  revision: 0,
  updatedAt: Date.now(),
});

export function secondsLeft(timer: TimerState, now = Date.now()): number {
  if (timer.status !== 'running' || timer.lastResumedAt === null) return Math.max(0, timer.remainingSeconds);
  return Math.max(0, timer.remainingSeconds - Math.floor((now - timer.lastResumedAt) / 1000));
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return String(Math.floor(safe / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0');
}

export function transitionTimer(timer: TimerState, phases: Phase[], action: 'start' | 'pause' | 'reset' | 'next', now = Date.now()): TimerState {
  const phase = phases[timer.phaseIndex];
  if (action === 'reset') return { ...createTimer(phases), updatedAt: now, revision: timer.revision + 1 };
  if (action === 'start') {
    if (timer.status === 'running' || timer.status === 'finished' || !phase) return timer;
    const remaining = timer.status === 'paused' ? secondsLeft(timer, now) : (timer.remainingSeconds || phase.durationSeconds);
    return { ...timer, status: 'running', remainingSeconds: remaining, startedAt: timer.startedAt ?? now, lastResumedAt: now, updatedAt: now, revision: timer.revision + 1 };
  }
  if (action === 'pause') {
    if (timer.status !== 'running') return timer;
    return { ...timer, status: 'paused', remainingSeconds: secondsLeft(timer, now), lastResumedAt: null, updatedAt: now, revision: timer.revision + 1 };
  }
  const nextIndex = timer.phaseIndex + 1;
  if (nextIndex >= phases.length) return { ...timer, status: 'finished', remainingSeconds: 0, lastResumedAt: null, updatedAt: now, revision: timer.revision + 1 };
  return { ...timer, status: 'idle', phaseIndex: nextIndex, remainingSeconds: phases[nextIndex].durationSeconds, startedAt: null, lastResumedAt: null, updatedAt: now, revision: timer.revision + 1 };
}

export function withRoomStatus<T extends { status: string; timer: TimerState; teamFavorId: string; teamContraId: string; judgeIds: string[] }>(room: T): T {
  const status = room.timer.status === 'running' ? 'running'
    : room.timer.status === 'paused' ? 'paused'
    : room.timer.status === 'finished' ? 'finished'
    : room.teamFavorId && room.teamContraId && room.judgeIds.length ? 'ready' : 'unassigned';
  return { ...room, status };
}
