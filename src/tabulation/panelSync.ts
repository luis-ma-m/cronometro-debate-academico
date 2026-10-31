import type { PanelHandoff } from './panelBridge';

export const PANEL_SYNC_BASE_PREFIX = 'ledu-tabulacion-sync-base-v1:';
export const PANEL_SYNC_PENDING_PREFIX = 'ledu-tabulacion-sync-pending-v1:';

function validSnapshot(value: unknown): value is PanelHandoff {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<PanelHandoff>;
  return snapshot.format === 'ledu-tabulacion-handoff' && snapshot.version === 1
    && typeof snapshot.tournamentId === 'string' && typeof snapshot.tournamentName === 'string'
    && Array.isArray(snapshot.teams) && Array.isArray(snapshot.speakers)
    && Array.isArray(snapshot.judges) && Array.isArray(snapshot.venues)
    && Number.isSafeInteger(snapshot.revision) && Number.isFinite(snapshot.updatedAt);
}

export interface PendingPanelReconciliation {
  detectedAt: number;
  base: PanelHandoff;
  remote: PanelHandoff;
}

export function readPanelSyncBase(storage: Pick<Storage, 'getItem'>, tournamentId: string): PanelHandoff | null {
  try {
    const value = JSON.parse(storage.getItem(PANEL_SYNC_BASE_PREFIX + tournamentId) ?? 'null') as PanelHandoff | null;
    return validSnapshot(value) ? value : null;
  } catch { return null; }
}

export function writePanelSyncBase(storage: Pick<Storage, 'setItem' | 'removeItem'>, tournamentId: string, snapshot: PanelHandoff): boolean {
  const key = PANEL_SYNC_BASE_PREFIX + tournamentId;
  try {
    storage.setItem(key, JSON.stringify(snapshot));
    return true;
  } catch {
    // The baseline is reconstructible from the flushed local tournament and its
    // remote cursor. Remove a stale baseline rather than comparing against it.
    try { storage.removeItem(key); } catch { /* Storage may be fully unavailable. */ }
    return false;
  }
}

export function readPendingPanelReconciliation(storage: Pick<Storage, 'getItem'>, tournamentId: string): PendingPanelReconciliation | null {
  try {
    const value = JSON.parse(storage.getItem(PANEL_SYNC_PENDING_PREFIX + tournamentId) ?? 'null') as PendingPanelReconciliation | null;
    return value && validSnapshot(value.base) && validSnapshot(value.remote) && typeof value.detectedAt === 'number' ? value : null;
  } catch { return null; }
}

export function writePendingPanelReconciliation(storage: Pick<Storage, 'setItem'>, tournamentId: string, value: PendingPanelReconciliation): void {
  storage.setItem(PANEL_SYNC_PENDING_PREFIX + tournamentId, JSON.stringify(value));
}

export function clearPendingPanelReconciliation(storage: Pick<Storage, 'removeItem'>, tournamentId: string): void {
  storage.removeItem(PANEL_SYNC_PENDING_PREFIX + tournamentId);
}
