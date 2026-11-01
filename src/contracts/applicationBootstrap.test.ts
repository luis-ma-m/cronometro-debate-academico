import { describe, expect, it } from 'vitest';
import { activeTournamentContext } from './activeTournamentContext';
import { createApplicationBootstrap, ApplicationBootstrapError } from './applicationBootstrap';
import { participantSnapshotFromManager } from './participantSnapshot';
import type { Team, Speaker, Judge, PhysicalRoom } from '../domain';

const now = 1_800_000_000_000;
const context = activeTournamentContext('tournament-1', 3, 'server', now);
const session = { token: 'valid-token', expiresAt: now + 60_000 };
const participants = participantSnapshotFromManager(context, {
  teams: [{ id: 'team-1', name: 'Equipo', institution: '', active: true, incompatibleJudgeIds: [] }] as Team[],
  speakers: [{ id: 'speaker-1', teamId: 'team-1', name: 'Orador' }] as Speaker[],
  judges: [] as Judge[],
  physicalRooms: [] as PhysicalRoom[],
});

describe('application bootstrap', () => {
  it('validates and freezes the common session, tournament and participant projection', () => {
    const bootstrap = createApplicationBootstrap({ session, activeTournament: context, participants }, now);
    expect(bootstrap.session?.token).toBe('valid-token');
    expect(bootstrap.activeTournament?.tournamentId).toBe('tournament-1');
    expect(bootstrap.participants?.teams).toHaveLength(1);
    expect(Object.isFrozen(bootstrap)).toBe(true);
  });

  it('treats expired sessions as unavailable without losing local tournament context', () => {
    const bootstrap = createApplicationBootstrap({
      session: { token: 'expired', expiresAt: now },
      activeTournament: context,
    }, now);
    expect(bootstrap.session).toBeNull();
    expect(bootstrap.activeTournament?.tournamentId).toBe('tournament-1');
  });

  it('rejects participant snapshots for a different active tournament', () => {
    const other = activeTournamentContext('tournament-2', 1, 'server', now);
    expect(() => createApplicationBootstrap({ session, activeTournament: other, participants }, now))
      .toThrow(ApplicationBootstrapError);
  });

  it('rejects participant snapshots without an active tournament', () => {
    expect(() => createApplicationBootstrap({ session, activeTournament: null, participants }, now))
      .toThrow(ApplicationBootstrapError);
  });
});
