import { describe, expect, it } from 'vitest';
import type { Room, Tournament } from './domain';
import { currentPhaseLabel, resolveActiveRoundId } from './overview';
import { createTimer, LEDU_PHASES } from './timer';

const rounds = [
  { id: 'round-a', number: 1, name: 'Ronda A', active: true, defaultFormatId: 'format' },
  { id: 'round-b', number: 2, name: 'Ronda B', active: false, defaultFormatId: 'format' },
] satisfies Tournament['rounds'];

describe('resolveActiveRoundId', () => {
  it('prefers the confirmed activeRoundId over a different selected/browsed round', () => {
    expect(resolveActiveRoundId({ activeRoundId: 'round-a', rounds })).toBe('round-a');
  });

  it('falls back to the legacy active flag when activeRoundId is missing or invalid', () => {
    expect(resolveActiveRoundId({ activeRoundId: '', rounds })).toBe('round-a');
    expect(resolveActiveRoundId({ activeRoundId: 'deleted-round', rounds })).toBe('round-a');
  });

  it('returns null when there is no active round instead of assuming the first round', () => {
    expect(resolveActiveRoundId({ activeRoundId: '', rounds: rounds.map((round) => ({ ...round, active: false })) })).toBeNull();
  });
});

describe('currentPhaseLabel', () => {
  const room = {
    id: 'room-a', name: 'Sala A', roundId: 'round-a', physicalRoomId: 'physical-a', formatId: 'format',
    teamFavorId: 'team-a', teamContraId: 'team-b', judgeIds: [], status: 'ready' as const,
    phases: LEDU_PHASES, timer: createTimer(LEDU_PHASES), notes: '', updatedAt: 1,
  } satisfies Room;

  it('returns the name for the phase indexed by that room timer', () => {
    expect(currentPhaseLabel({ ...room, timer: { ...room.timer, phaseIndex: 2 } })).toBe(LEDU_PHASES[2].name);
  });

  it('handles invalid phase indexes without throwing', () => {
    expect(currentPhaseLabel({ ...room, timer: { ...room.timer, phaseIndex: -1 } })).toBe('Fase no disponible');
    expect(currentPhaseLabel({ ...room, timer: { ...room.timer, phaseIndex: 999 } })).toBe('Fase no disponible');
  });

  it('does not present the last phase as active after the debate has finished', () => {
    expect(currentPhaseLabel({ ...room, timer: { ...room.timer, status: 'finished' } })).toBe('Debate finalizado');
  });
});
