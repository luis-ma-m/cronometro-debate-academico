import { describe, expect, it } from 'vitest';
import { buildLocalPanelBase, comparePanelRevisions } from './reconciliation';
import { createTabTournament } from './presets';
import type { PanelHandoff } from './panelBridge';
import type { TabTournament } from './types';

const base: PanelHandoff = {
  format: 'ledu-tabulacion-handoff', version: 1, createdAt: 100, tournamentId: 'remote-1',
  revision: 4, updatedAt: 100, tournamentName: 'Torneo',
  teams: [{ id: 'team-1', name: 'Equipo A', institution: 'Universidad A', active: true, incompatibleJudgeIds: [] }],
  speakers: [], judges: [], venues: [],
};

function linkedTournament(): TabTournament {
  const tournament = createTabTournament('Torneo', 'ledu-groups', 100, 1);
  tournament.teams = [{ id: 'local-team-1', name: 'Equipo A', institution: 'Universidad A', active: true,
    swing: false, breakEligible: true, incompatibleJudgeIds: [] }];
  tournament.panelLink = { tournamentName: 'Torneo', linkedAt: 100, remoteId: 'remote-1', remoteRevision: 4,
    remoteUpdatedAt: 100, idMap: { teams: { 'local-team-1': 'team-1' }, speakers: {}, judges: {}, venues: {} } };
  return tournament;
}

describe('three-way panel reconciliation', () => {
  it('reconstructs a stable remote baseline for a linked tournament created before F3', () => {
    const local = linkedTournament();
    const snapshot = buildLocalPanelBase(local);
    expect(snapshot).toMatchObject({ tournamentId: 'remote-1', revision: 4, teams: [{ id: 'team-1', name: 'Equipo A' }] });
    const result = comparePanelRevisions(local, snapshot!, base);
    expect(result.changes[0].change).toBe('unchanged');
  });

  it('classifies a remote-only entity edit as independently applicable', () => {
    const remote = { ...base, revision: 5, updatedAt: 200,
      teams: [{ ...base.teams[0], name: 'Equipo A renombrado' }] };
    const result = comparePanelRevisions(linkedTournament(), base, remote);
    expect(result.remoteRevision).toBe(5);
    expect(result.hasConflicts).toBe(false);
    expect(result.changes[0]).toMatchObject({ change: 'independent', fields: ['name'], localId: 'local-team-1' });
  });

  it('preserves a simultaneous incompatible local and remote edit as a conflict', () => {
    const local = linkedTournament();
    local.teams[0].name = 'Nombre local';
    const remote = { ...base, revision: 5, updatedAt: 200,
      teams: [{ ...base.teams[0], name: 'Nombre remoto' }] };
    const result = comparePanelRevisions(local, base, remote);
    expect(result.hasConflicts).toBe(true);
    expect(result.changes[0].change).toBe('conflict');
  });

  it('requires explicit review when a remote edit touches an entity in a historical debate', () => {
    const local = linkedTournament();
    local.rounds = [{
      id: 'round-1', number: 1, name: 'Ronda 1', kind: 'qualifying', sideMode: 'balanced', panelSize: 1,
      seed: 1, silent: false, createdAt: 100,
      debates: [{ id: 'debate-1', venueId: 'venue-1', teamIds: ['local-team-1', 'other-team'],
        judgeIds: [], chairId: '' }],
    }];
    const remote = { ...base, revision: 5, updatedAt: 200,
      teams: [{ ...base.teams[0], institution: 'Universidad B' }] };
    const result = comparePanelRevisions(local, base, remote);
    expect(result.requiresHistoricalReview).toBe(true);
    expect(result.changes[0].change).toBe('historical-review');
  });
});
