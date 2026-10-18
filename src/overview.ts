import type { Room, Tournament } from './domain';

/**
 * Resolve the round that is operationally active, never the round selected
 * for browsing in the admin UI. Return null when the tournament has no active
 * round rather than silently treating the first round as active.
 */
export function resolveActiveRoundId(tournament: Pick<Tournament, 'activeRoundId' | 'rounds'>): string | null {
  const activeId = tournament.activeRoundId;
  if (activeId && tournament.rounds.some((round) => round.id === activeId)) return activeId;
  return tournament.rounds.find((round) => round.active)?.id ?? null;
}

/** Human-readable phase label for a room row in the operational overview. */
export function currentPhaseLabel(room: Pick<Room, 'phases' | 'timer'>): string {
  if (room.timer.status === 'finished') return 'Debate finalizado';
  const phase = room.phases[room.timer.phaseIndex];
  return phase?.name?.trim() || 'Fase no disponible';
}

/** Current debate side, omitted when the debate is finished or the phase is invalid. */
export function currentPhaseSideLabel(room: Pick<Room, 'phases' | 'timer'>): string | null {
  if (room.timer.status === 'finished') return null;
  const phase = room.phases[room.timer.phaseIndex];
  if (!phase) return null;
  return phase.side === 'favor' ? 'A favor' : 'En contra';
}
