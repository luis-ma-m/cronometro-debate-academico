import type { Room, Tournament } from './domain';
import { createTimer, LEDU_PHASES, withRoomStatus } from './timer';

const now = Date.now();
const room = (id: string, name: string, favor: string, contra: string, judgeIds: string[]): Room => withRoomStatus({
  id, name, roundId: 'r1', teamFavorId: favor, teamContraId: contra, judgeIds, status: 'ready',
  phases: LEDU_PHASES.map((phase) => ({ ...phase })), timer: createTimer(), notes: '', updatedAt: now,
});

export const demoTournament: Tournament = {
  tournamentName: 'Torneo LEDU · Demo',
  rounds: [{ id: 'r1', number: 1, name: 'Ronda 1', active: true }, { id: 'r2', number: 2, name: 'Ronda 2', active: false }],
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
  rooms: [room('a1', 'Sala A1', 't1', 't2', ['j1', 'j2']), room('a2', 'Sala A2', 't3', 't4', ['j3', 'j4']), room('a3', 'Sala A3', 't5', 't6', ['j5']), room('a4', 'Sala A4', '', '', [])],
  revision: 1,
  updatedAt: now,
};

const STORAGE_KEY = 'ledu-tournament-demo-v1';
export function readDemo(): Tournament {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Tournament;
  } catch { /* Use fresh demo below. */ }
  return demoTournament;
}
export function writeDemo(data: Tournament): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
export function demoStorageKey(): string { return STORAGE_KEY; }
