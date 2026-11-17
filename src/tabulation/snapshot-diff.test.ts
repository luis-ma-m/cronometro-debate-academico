import { describe, expect, it } from 'vitest';
import { findSnapshotDifferences } from './snapshot-diff';

describe('findSnapshotDifferences', () => {
  it('ignores sync metadata at every nesting level', () => {
    const local = {
      id: 'tournament-1', revision: 4, updatedAt: 100, createdAt: 10, logTail: [], logSeq: 2,
      teams: [{ id: 'team-1', name: 'Equipo A', revision: 2, updatedAt: 90 }],
    };
    const remote = {
      id: 'tournament-1', revision: 8, updatedAt: 200, createdAt: 10, logTail: ['remote log'], logSeq: 9,
      teams: [{ id: 'team-1', name: 'Equipo A', revision: 5, updatedAt: 190 }],
    };
    expect(findSnapshotDifferences(local, remote)).toEqual([]);
  });

  it('detects functional data changes', () => {
    const local = { id: 'tournament-1', teams: [{ id: 'team-1', name: 'Equipo A' }] };
    const remote = { id: 'tournament-1', teams: [{ id: 'team-1', name: 'Equipo B' }] };
    expect(findSnapshotDifferences(local, remote)).toEqual([
      { path: 'teams[team-1].name', localValue: 'Equipo A', remoteValue: 'Equipo B' },
    ]);
  });

  it('treats keyed collection ordering as non-functional', () => {
    const local = { teams: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
    const remote = { teams: [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }] };
    expect(findSnapshotDifferences(local, remote)).toEqual([]);
  });
});
