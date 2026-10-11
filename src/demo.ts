import type { Room, Tournament } from './domain';
import { createTimer, LEDU_PHASES, withRoomStatus } from './timer';

const now = Date.now();
const room = (id: string, name: string, favor: string, contra: string, judgeIds: string[], roundId = 'r1'): Room => withRoomStatus({
  id, name, roundId, physicalRoomId: 'physical-' + id, formatId: '', teamFavorId: favor, teamContraId: contra, judgeIds, status: 'ready',
  phases: LEDU_PHASES.map((phase) => ({ ...phase })), timer: createTimer(), notes: '', updatedAt: now,
});

export const demoTournament: Tournament = {
  tournamentName: 'Torneo LEDU · Demo',
  rounds: [{ id: 'r1', number: 1, name: 'Ronda 1', active: true, defaultFormatId: 'format-ledu' }, { id: 'r2', number: 2, name: 'Ronda 2', active: false, defaultFormatId: 'format-ledu' }],
  teams: [
    { id: 't1', name: 'Málaga A', institution: 'Universidad de Málaga', active: true },
    { id: 't2', name: 'Sevilla B', institution: 'Universidad de Sevilla', active: true },
    { id: 't3', name: 'Granada A', institution: 'Universidad de Granada', active: true },
    { id: 't4', name: 'Córdoba B', institution: 'Universidad de Córdoba', active: true },
    { id: 't5', name: 'Madrid A', institution: 'Universidad Complutense', active: true },
    { id: 't6', name: 'Murcia B', institution: 'Universidad de Murcia', active: true },
  ],
  judges: [
    { id: 'j1', name: 'Ana García', institution: 'LEDU', active: true },
    { id: 'j2', name: 'Luis Pérez', institution: 'LEDU', active: true },
    { id: 'j3', name: 'María Ruiz', institution: 'LEDU', active: true },
    { id: 'j4', name: 'Pablo Díaz', institution: 'LEDU', active: true },
    { id: 'j5', name: 'Elena Martín', institution: 'LEDU', active: true },
  ],
  rooms: [
    room('a1', 'Sala A1', 't1', 't2', ['j1', 'j2']),
    room('a2', 'Sala A2', 't3', 't4', ['j3', 'j4']),
    room('a3', 'Sala A3', 't5', 't6', ['j5']),
    room('a4', 'Sala A4', '', '', []),
    room('b1', 'Sala A1', 't1', 't2', ['j1', 'j2'], 'r2'),
    room('b2', 'Sala A2', 't3', 't4', ['j3', 'j4'], 'r2'),
  ],
  physicalRooms: [
    { id: 'physical-a1', slug: 'sala-a1', name: 'Sala A1', active: true, createdAt: now, updatedAt: now },
    { id: 'physical-a2', slug: 'sala-a2', name: 'Sala A2', active: true, createdAt: now, updatedAt: now },
    { id: 'physical-a3', slug: 'sala-a3', name: 'Sala A3', active: true, createdAt: now, updatedAt: now },
    { id: 'physical-a4', slug: 'sala-a4', name: 'Sala A4', active: true, createdAt: now, updatedAt: now },
  ],
  formats: [{ id: 'format-ledu', name: 'LEDU', phases: LEDU_PHASES.map((phase) => ({ ...phase })), version: 1, createdAt: now, updatedAt: now }],
  activeRoundId: 'r1',
  activationRevision: 1,
  activatedAt: now - 30000,
  formatPhases: LEDU_PHASES.map((phase) => ({ ...phase })),
  minimumJudgesPerRoom: 1,
  revision: 1,
  updatedAt: now,
};

const STORAGE_KEY = 'ledu-tournament-demo-v1';
export function readDemo(): Tournament {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Tournament;
      if (!Array.isArray(parsed.physicalRooms) || !Array.isArray(parsed.formats)) return demoTournament;
      if (!parsed.formatPhases?.length) parsed.formatPhases = parsed.rooms[0]?.phases?.length ? parsed.rooms[0].phases : LEDU_PHASES;
      return parsed;
    }
  } catch { /* Use fresh demo below. */ }
  return demoTournament;
}
export function writeDemo(data: Tournament): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
export function demoStorageKey(): string { return STORAGE_KEY; }
