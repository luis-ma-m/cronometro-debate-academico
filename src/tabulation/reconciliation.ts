import type { PanelEntityIdMap, TabTournament } from './types';
import type { PanelHandoff, PanelEntityKind } from './panelBridge';

export type ReconciliationChangeKind = 'independent' | 'conflict' | 'historical-review' | 'remote-only' | 'unchanged';

export interface ReconciliationChange {
  kind: PanelEntityKind;
  localId: string | null;
  remoteId: string;
  label: string;
  change: ReconciliationChangeKind;
  fields: string[];
  base: Record<string, unknown> | null;
  local: Record<string, unknown> | null;
  remote: Record<string, unknown>;
}

export interface ReconciliationResult {
  baseRevision: number;
  remoteRevision: number;
  changes: ReconciliationChange[];
  hasConflicts: boolean;
  requiresHistoricalReview: boolean;
}

/** Stable JSON comparison: object key order must not create false conflicts. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ':' + stable(item)).join(',') + '}';
  }
  return JSON.stringify(value) ?? String(value);
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function localToRemoteMap(idMap: PanelEntityIdMap, kind: PanelEntityKind): Map<string, string> {
  return new Map(Object.entries(idMap[kind]).map(([localId, remoteId]) => [localId, remoteId]));
}

function historicalIds(tournament: TabTournament, kind: PanelEntityKind): Set<string> {
  const ids = new Set<string>();
  for (const round of tournament.rounds) {
    for (const debate of round.debates) {
      if (kind === 'teams') debate.teamIds.forEach((id) => ids.add(id));
      if (kind === 'judges') debate.judgeIds.forEach((id) => ids.add(id));
      if (kind === 'venues') ids.add(debate.venueId);
    }
  }
  if (kind === 'speakers') {
    for (const speaker of tournament.speakers) {
      if (tournament.rounds.some((round) => round.debates.some((debate) => debate.result?.ballots.some((ballot) =>
        Object.keys(ballot.speeches ?? {}).includes(speaker.id))))) ids.add(speaker.id);
    }
  }
  return ids;
}

/**
 * Three-way comparison for a linked tournament. The base is the last remote snapshot
 * acknowledged locally; local edits are never treated as the new base. A simultaneous
 * incompatible edit is a conflict, while a remote change to an entity used by historical
 * debates is held for explicit review even if the local copy was untouched.
 */
export function comparePanelRevisions(
  tournament: TabTournament,
  base: PanelHandoff,
  remote: PanelHandoff,
): ReconciliationResult {
  const idMap = tournament.panelLink?.idMap ?? { teams: {}, speakers: {}, judges: {}, venues: {} };
  const changes: ReconciliationChange[] = [];
  const definitions: Array<{
    kind: PanelEntityKind;
    base: Array<{ id: string; name: string }>;
    remote: Array<{ id: string; name: string }>;
    local: Array<{ id: string; name: string }>;
  }> = [
    { kind: 'teams', base: base.teams, remote: remote.teams, local: tournament.teams },
    { kind: 'speakers', base: base.speakers, remote: remote.speakers, local: tournament.speakers },
    { kind: 'judges', base: base.judges, remote: remote.judges, local: tournament.judges },
    { kind: 'venues', base: base.venues, remote: remote.venues, local: tournament.venues },
  ];

  for (const definition of definitions) {
    const baseRows = byId(definition.base);
    const remoteRows = byId(definition.remote);
    const localRows = byId(definition.local);
    const localMap = localToRemoteMap(idMap, definition.kind);
    const reverseMap = new Map([...localMap].map(([localId, remoteId]) => [remoteId, localId]));
    const usedHistorically = historicalIds(tournament, definition.kind);

    for (const [remoteId, remoteRow] of remoteRows) {
      const baseRow = baseRows.get(remoteId) ?? null;
      const localId = reverseMap.get(remoteId) ?? (localRows.has(remoteId) ? remoteId : null);
      const localRow = localId ? localRows.get(localId) ?? null : null;
      const baseValue = baseRow as Record<string, unknown> | null;
      const localValue = localRow as Record<string, unknown> | null;
      const remoteValue = remoteRow as Record<string, unknown>;
      if (!baseRow) {
        changes.push({ kind: definition.kind, localId, remoteId, label: remoteRow.name, change: 'remote-only', fields: Object.keys(remoteValue), base: null, local: localValue, remote: remoteValue });
        continue;
      }
      const remoteChanged = stable(baseRow) !== stable(remoteRow);
      if (!remoteChanged) {
        changes.push({ kind: definition.kind, localId, remoteId, label: remoteRow.name, change: 'unchanged', fields: [], base: baseValue, local: localValue, remote: remoteValue });
        continue;
      }
      const localChanged = localValue !== null && stable({ ...baseRow, id: remoteId }) !== stable({ ...localValue, id: remoteId });
      const fields = [...new Set([...Object.keys(baseRow), ...Object.keys(remoteRow)])]
        .filter((field) => stable((baseRow as Record<string, unknown>)[field]) !== stable(remoteValue[field]));
      const change: ReconciliationChangeKind = localChanged
        ? 'conflict'
        : localId && usedHistorically.has(localId) ? 'historical-review' : 'independent';
      changes.push({ kind: definition.kind, localId, remoteId, label: remoteRow.name, change, fields, base: baseValue, local: localValue, remote: remoteValue });
    }
  }

  return {
    baseRevision: base.revision ?? 0,
    remoteRevision: remote.revision ?? 0,
    changes,
    hasConflicts: changes.some((item) => item.change === 'conflict'),
    requiresHistoricalReview: changes.some((item) => item.change === 'historical-review'),
  };
}
