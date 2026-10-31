import { describe, expect, it } from 'vitest';
import { clearPendingPanelReconciliation, readPanelSyncBase, readPendingPanelReconciliation, writePanelSyncBase, writePendingPanelReconciliation } from './panelSync';
import type { PanelHandoff } from './panelBridge';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const snapshot: PanelHandoff = {
  format: 'ledu-tabulacion-handoff', version: 1, createdAt: 10, tournamentId: 'remote-1',
  revision: 2, updatedAt: 10, tournamentName: 'Torneo',
  teams: [], speakers: [], judges: [], venues: [],
};

describe('durable panel reconciliation state', () => {
  it('persists and reads the last acknowledged remote snapshot', () => {
    const storage = memoryStorage();
    writePanelSyncBase(storage, 'local-1', snapshot);
    expect(readPanelSyncBase(storage, 'local-1')).toEqual(snapshot);
  });

  it('persists a pending diff and clears it only after explicit resolution', () => {
    const storage = memoryStorage();
    const pending = { detectedAt: 20, base: snapshot, remote: { ...snapshot, revision: 3, updatedAt: 20 } };
    writePendingPanelReconciliation(storage, 'local-1', pending);
    expect(readPendingPanelReconciliation(storage, 'local-1')).toEqual(pending);
    clearPendingPanelReconciliation(storage, 'local-1');
    expect(readPendingPanelReconciliation(storage, 'local-1')).toBeNull();
  });

  it('ignores malformed or incompatible stored snapshots', () => {
    const storage = memoryStorage();
    storage.setItem('ledu-tabulacion-sync-base-v1:local-1', '{"format":"wrong"}');
    expect(readPanelSyncBase(storage, 'local-1')).toBeNull();
  });
});
