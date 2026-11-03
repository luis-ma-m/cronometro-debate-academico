import type { Tournament } from '../domain';
import type { TabTournament } from '../tabulation/types';
import { createIndexedDbApplicationRecordRepository } from './applicationPersistence';

export const CANONICAL_TOURNAMENT_KEY = 'ledu-canonical-tournament-v2';
export const CANONICAL_TOURNAMENT_NAMESPACE = 'canonical-tournament';
const LEGACY_SHARED_KEY = 'ledu-shared-tournament-v1';
const LEGACY_MANAGER_KEY = 'ledu-tournament-demo-v1';
const TAB_INDEX_KEY = 'ledu-tabulacion-index-v1';
const TAB_PREFIX = 'ledu-tabulacion-v1:';\nlet mirrorChain: Promise<void> = Promise.resolve();

type EntityKind = 'team' | 'speaker' | 'judge' | 'venue';
type JsonRecord = Record<string, unknown>;

interface CanonicalEntity {
  kind: EntityKind;
  canonicalId: string;
  managerSourceId?: string;
  tabulationSourceId?: string;
  managerData?: JsonRecord;
  tabulationData?: JsonRecord;
  shared: { name?: string; institution?: string; active?: boolean };
}

interface CanonicalDocument {
  schemaVersion: 2;
  revision: number;
  updatedAt: number;
  managerScope: string;
  managerState: JsonRecord | null;
  tabulationStates: Record<string, JsonRecord>;
  tabulationIndex: { activeId: string | null; tournaments: Array<{ id: string; name: string; updatedAt: number }> };
  entities: Record<string, CanonicalEntity>;
}

export interface CanonicalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const emptyDocument = (): CanonicalDocument => ({
  schemaVersion: 2, revision: 0, updatedAt: 0, managerScope: 'manager:local',
  managerState: null, tabulationStates: {}, tabulationIndex: { activeId: null, tournaments: [] }, entities: {},
});
const object = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const entityKey = (scope: string, kind: EntityKind, id: string) => scope + '|' + kind + '|' + id;
const sourceRecord = (value: unknown): JsonRecord => object(value) ? value : {};

function parseDocument(raw: string | null): CanonicalDocument | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CanonicalDocument>;
    if (value.schemaVersion !== 2 || !Number.isSafeInteger(value.revision) || (value.revision ?? -1) < 0
      || !Number.isSafeInteger(value.updatedAt) || (value.updatedAt ?? -1) < 0
      || !object(value.entities) || !object(value.tabulationStates) || !object(value.tabulationIndex)
      || !Array.isArray(value.tabulationIndex.tournaments)) return null;
    return {
      schemaVersion: 2, revision: value.revision!, updatedAt: value.updatedAt!,
      managerScope: typeof value.managerScope === 'string' ? value.managerScope : 'manager:local',
      managerState: object(value.managerState) ? value.managerState : null,
      tabulationStates: value.tabulationStates as Record<string, JsonRecord>,
      tabulationIndex: value.tabulationIndex as CanonicalDocument['tabulationIndex'],
      entities: value.entities as Record<string, CanonicalEntity>,
    };
  } catch { return null; }
}

function sharedFields(kind: EntityKind, data: JsonRecord) {
  if (kind === 'speaker') return { name: typeof data.name === 'string' ? data.name : undefined };
  if (kind === 'venue') return {
    name: typeof data.name === 'string' ? data.name : undefined,
    active: typeof data.active === 'boolean' ? data.active : undefined,
  };
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    institution: typeof data.institution === 'string' ? data.institution : undefined,
    active: typeof data.active === 'boolean' ? data.active : undefined,
  };
}

function upsertSource(
  document: CanonicalDocument,
  scope: string,
  kind: EntityKind,
  canonicalId: string,
  source: 'manager' | 'tabulation',
  sourceId: string,
  data: JsonRecord,
): void {
  const key = entityKey(scope, kind, canonicalId);
  const previous = document.entities[key];
  const managerData = source === 'manager' ? clone(data) : previous?.managerData;
  const tabulationData = source === 'tabulation' ? clone(data) : previous?.tabulationData;
  const preferred = managerData ?? tabulationData ?? data;
  document.entities[key] = {
    kind, canonicalId,
    managerSourceId: source === 'manager' ? sourceId : previous?.managerSourceId,
    tabulationSourceId: source === 'tabulation' ? sourceId : previous?.tabulationSourceId,
    managerData, tabulationData,
    // Gestión owns shared identity fields whenever it has an explicit record.
    shared: sharedFields(kind, preferred),
  };
}

function listSource(document: CanonicalDocument, scope: string, kind: EntityKind, source: 'manager' | 'tabulation') {
  return Object.entries(document.entities)
    .filter(([key, entity]) => key === entityKey(scope, kind, entity.canonicalId)
      && entity.kind === kind
      && entity[source === 'manager' ? 'managerData' : 'tabulationData'] !== undefined)
    .map(([, entity]) => entity);
}

function pruneSourceEntities(document: CanonicalDocument, scope: string, source: 'manager' | 'tabulation', seen: Set<string>): void {
  for (const [key, entity] of Object.entries(document.entities)) {
    if (!key.startsWith(scope + '|')) continue;
    const sourceKey = source === 'manager' ? 'managerData' : 'tabulationData';
    if (!entity[sourceKey] || seen.has(key)) continue;
    const next = { ...entity };
    if (source === 'manager') {
      delete next.managerData;
      delete next.managerSourceId;
    } else {
      delete next.tabulationData;
      delete next.tabulationSourceId;
    }
    if (!next.managerData && !next.tabulationData) delete document.entities[key];
    else document.entities[key] = next;
  }
}

function mapTabCanonical(kind: EntityKind, sourceId: string, tournament: TabTournament): string {
  const key = kind === 'venue' ? 'venues' : kind === 'team' ? 'teams' : kind === 'speaker' ? 'speakers' : 'judges';
  const mapping = tournament.panelLink?.idMap?.[key] as Record<string, string> | undefined;
  // Only an explicit ID mapping joins a Tabulation entity to a Gestión entity.
  return mapping?.[sourceId] ?? 'tab:' + tournament.id + ':' + sourceId;
}

function tabScope(tournament: TabTournament): string {
  return tournament.panelLink?.remoteId ? 'remote:' + tournament.panelLink.remoteId : 'tabulation:' + tournament.id;
}

function managerScope(tournament: Tournament): string {
  return tournament.remoteId ? 'remote:' + tournament.remoteId : 'manager:local';
}

function updateDocument(storage: CanonicalStorage, mutate: (document: CanonicalDocument) => void, now: () => number): CanonicalDocument {
  const current = parseDocument(storage.getItem(CANONICAL_TOURNAMENT_KEY)) ?? emptyDocument();
  const next = clone(current);
  mutate(next);
  next.revision = current.revision + 1;
  next.updatedAt = now();
  storage.setItem(CANONICAL_TOURNAMENT_KEY, JSON.stringify(next));
  // IndexedDB is a durable mirror of the canonical document. The synchronous local
  // transaction remains the browser runtime's read boundary for legacy sync stores.
  try {
    mirrorChain = mirrorChain.then(async () => {
      const repository = createIndexedDbApplicationRecordRepository();
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await repository.get<CanonicalDocument>(CANONICAL_TOURNAMENT_NAMESPACE, 'active');
        const saved = await repository.put(CANONICAL_TOURNAMENT_NAMESPACE, 'active', next, {
          expectedRevision: existing?.revision ?? null, now: next.updatedAt,
        });
        if (saved) break;
      }
    }).catch(() => undefined);
  } catch { /* IndexedDB unavailable: local-first runtime remains usable. */ }
  return next;
}

export function createCanonicalTournamentRepository(storage: CanonicalStorage, now: () => number = Date.now) {
  const readDocument = () => parseDocument(storage.getItem(CANONICAL_TOURNAMENT_KEY)) ?? emptyDocument();

  function writeManager(tournament: Tournament): void {
    const scope = managerScope(tournament);
    updateDocument(storage, (document) => {
      document.managerScope = scope;
      const { teams = [], speakers = [], judges = [], physicalRooms = [], ...state } = tournament;
      document.managerState = clone(state as unknown as JsonRecord);
      const entries: Array<[EntityKind, Array<JsonRecord>]> = [
        ['team', teams as unknown as JsonRecord[]],
        ['speaker', (speakers ?? []) as unknown as JsonRecord[]],
        ['judge', judges as unknown as JsonRecord[]],
        ['venue', physicalRooms as unknown as JsonRecord[]],
      ];
      const seen = new Set<string>();
      for (const [kind, values] of entries) for (const data of values) {
        if (typeof data.id !== 'string') continue;
        const key = entityKey(scope, kind, data.id);
        seen.add(key);
        upsertSource(document, scope, kind, data.id, 'manager', data.id, data);
      }
      pruneSourceEntities(document, scope, 'manager', seen);
    }, now);
  }

  function readManager<T = Tournament>(): T | null {
    const document = readDocument();
    if (!document.managerState) return null;
    const scope = document.managerScope;
    const entities = (kind: EntityKind) => listSource(document, scope, kind, 'manager')
      .map((entity) => ({ ...(entity.managerData ?? {}), ...entity.shared, id: entity.managerSourceId ?? entity.canonicalId }));
    return {
      ...clone(document.managerState),
      teams: entities('team'),
      speakers: entities('speaker'),
      judges: entities('judge'),
      physicalRooms: entities('venue'),
    } as T;
  }

  function writeTabulation(tournament: TabTournament): void {
    const scope = tabScope(tournament);
    updateDocument(storage, (document) => {
      const { teams = [], speakers = [], judges = [], venues = [], ...state } = tournament;
      document.tabulationStates[tournament.id] = { ...clone(state as unknown as JsonRecord), __canonicalScope: scope };
      const entries: Array<[EntityKind, Array<JsonRecord>]> = [
        ['team', teams as unknown as JsonRecord[]],
        ['speaker', speakers as unknown as JsonRecord[]],
        ['judge', judges as unknown as JsonRecord[]],
        ['venue', venues as unknown as JsonRecord[]],
      ];
      const seen = new Set<string>();
      for (const [kind, values] of entries) for (const data of values) {
        if (typeof data.id !== 'string') continue;
        const canonicalId = mapTabCanonical(kind, data.id, tournament);
        const key = entityKey(scope, kind, canonicalId);
        seen.add(key);
        upsertSource(document, scope, kind, canonicalId, 'tabulation', data.id, data);
      }
      pruneSourceEntities(document, scope, 'tabulation', seen);
    }, now);
  }

  function readTabulation<T = TabTournament>(id: string): T | null {
    const document = readDocument();
    const state = document.tabulationStates[id];
    if (!state) return null;
    const scope = typeof state.__canonicalScope === 'string' ? state.__canonicalScope : 'tabulation:' + id;
    const entities = (kind: EntityKind) => listSource(document, scope, kind, 'tabulation')
      .map((entity) => ({ ...(entity.tabulationData ?? {}), ...entity.shared, id: entity.tabulationSourceId ?? entity.canonicalId }));
    return {
      ...Object.fromEntries(Object.entries(state).filter(([key]) => key !== '__canonicalScope')),
      teams: entities('team'),
      speakers: entities('speaker'),
      judges: entities('judge'),
      venues: entities('venue'),
    } as T;
  }

  function writeIndex(index: CanonicalDocument['tabulationIndex']): void {
    updateDocument(storage, (document) => { document.tabulationIndex = clone(index); }, now);
  }

  function readIndex(): CanonicalDocument['tabulationIndex'] {
    return clone(readDocument().tabulationIndex);
  }

  function deleteTabulation(id: string): void {
    updateDocument(storage, (document) => {
      delete document.tabulationStates[id];
      // Entity history is retained; deleting an index entry never destroys canonical entities.
      document.tabulationIndex.tournaments = document.tabulationIndex.tournaments.filter((entry) => entry.id !== id);
      if (document.tabulationIndex.activeId === id) document.tabulationIndex.activeId = document.tabulationIndex.tournaments[0]?.id ?? null;
    }, now);
  }

  return { readManager, writeManager, readTabulation, writeTabulation, readIndex, writeIndex, deleteTabulation };
}

export function getBrowserCanonicalTournamentRepository() {
  return createCanonicalTournamentRepository(window.localStorage);
}

/**
 * Migrate old whole-object snapshots on first read. Legacy bytes are deliberately
 * retained for rollback/export; migration never infers identity from names.
 */
export function migrateLegacyTournamentStorage(storage: Storage): void {
  const repository = createCanonicalTournamentRepository(storage);
  if (!repository.readManager()) {
    let legacyManager: unknown = null;
    try {
      const shared = JSON.parse(storage.getItem(LEGACY_SHARED_KEY) ?? 'null') as { manager?: unknown } | null;
      legacyManager = shared?.manager ?? JSON.parse(storage.getItem(LEGACY_MANAGER_KEY) ?? 'null');
    } catch { /* Invalid legacy bytes are left untouched for manual recovery. */ }
    if (object(legacyManager)) repository.writeManager(legacyManager as unknown as Tournament);
  }

  let index: CanonicalDocument['tabulationIndex'] | null = null;
  try {
    const raw = JSON.parse(storage.getItem(TAB_INDEX_KEY) ?? 'null') as CanonicalDocument['tabulationIndex'] | null;
    if (raw && Array.isArray(raw.tournaments)) index = raw;
  } catch { /* The store will rebuild from individual legacy tournament keys. */ }
  if (index) repository.writeIndex(index);

  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(TAB_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    const id = key.slice(TAB_PREFIX.length);
    if (repository.readTabulation(id)) continue;
    try {
      const raw = JSON.parse(storage.getItem(key) ?? 'null') as TabTournament | null;
      if (raw && raw.id === id) repository.writeTabulation(raw);
    } catch { /* Keep the malformed legacy record untouched. */ }
  }
}

export function createCanonicalTabulationStorage(legacy: Storage): Storage {
  migrateLegacyTournamentStorage(legacy);
  const repository = getBrowserCanonicalTournamentRepository();
  const isTournamentKey = (key: string) => key.startsWith(TAB_PREFIX);
  return {
    get length() { return legacy.length; },
    key: (index: number) => legacy.key(index),
    getItem(key: string) {
      if (key === TAB_INDEX_KEY) return JSON.stringify(repository.readIndex());
      if (isTournamentKey(key)) {
        const id = key.slice(TAB_PREFIX.length);
        const canonical = repository.readTabulation(id);
        if (canonical) return JSON.stringify(canonical);
      }
      return legacy.getItem(key);
    },
    setItem(key: string, value: string) {
      if (key === TAB_INDEX_KEY) {
        try { repository.writeIndex(JSON.parse(value)); return; } catch { /* Fall through to legacy for recovery. */ }
      }
      if (isTournamentKey(key)) {
        try {
          const tournament = JSON.parse(value) as TabTournament;
          if (tournament && tournament.id === key.slice(TAB_PREFIX.length)) { repository.writeTabulation(tournament); return; }
        } catch { /* Preserve the raw value in legacy storage if parsing fails. */ }
      }
      legacy.setItem(key, value);
    },
    removeItem(key: string) {
      if (isTournamentKey(key)) { repository.deleteTabulation(key.slice(TAB_PREFIX.length)); return; }
      legacy.removeItem(key);
    },
    clear() { legacy.clear(); },
  } as Storage;
}

export function readCanonicalManager<T = Tournament>(): T | null {
  migrateLegacyTournamentStorage(window.localStorage);
  return getBrowserCanonicalTournamentRepository().readManager<T>();
}

export function writeCanonicalManager(tournament: Tournament): void {
  getBrowserCanonicalTournamentRepository().writeManager(tournament);
}
