import type { PanelHandoff } from './panelBridge';

export const PANEL_SYNC_BASE_PREFIX = 'ledu-tabulacion-sync-base-v1:';
export const PANEL_SYNC_PENDING_PREFIX = 'ledu-tabulacion-sync-pending-v1:';

export interface PendingPanelReconciliation {
  detectedAt: number;
  base: PanelHandoff;
  remote: PanelHandoff;
}

export function readPanelSyncBase(storage: Pick<Storage, 'getItem'>, tournamentId: string): PanelHandoff | null {
  try {
    const value = JSON.parse(storage.getItem(PANEL_SYNC_BASE_PREFIX + tournamentId) ?? 'null') as PanelHandoff | null;
    return value?.format === 'ledu-tabulacion-handoff' && value.version === 1 ? value : null;
  } catch { return null; }
}

export function writePanelSyncBase(storage: Pick<Storage, 'setItem'>, tournamentId: string, snapshot: PanelHandoff): void {
  storage.setItem(PANEL_SYNC_BASE_PREFIX + tournamentId, JSON.stringify(snapshot));
}

export function readPendingPanelReconciliation(storage: Pick<Storage, 'getItem'>, tournamentId: string): PendingPanelReconciliation | null {
  try {
    const value = JSON.parse(storage.getItem(PANEL_SYNC_PENDING_PREFIX + tournamentId) ?? 'null') as PendingPanelReconciliation | null;
    return value?.base?.format === 'ledu-tabulacion-handoff' && value?.remote?.format === 'ledu-tabulacion-handoff' ? value : null;
  } catch { return null; }
}

export function writePendingPanelReconciliation(storage: Pick<Storage, 'setItem'>, tournamentId: string, value: PendingPanelReconciliation): void {
  storage.setItem(PANEL_SYNC_PENDING_PREFIX + tournamentId, JSON.stringify(value));
}

export function clearPendingPanelReconciliation(storage: Pick<Storage, 'removeItem'>, tournamentId: string): void {
  storage.removeItem(PANEL_SYNC_PENDING_PREFIX + tournamentId);
}
