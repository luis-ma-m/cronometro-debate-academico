import type { Tournament } from '../domain';
import type { TabTournament } from '../tabulation/types';
import { createIndexedDbApplicationRecordRepository } from './applicationPersistence';

export const CANONICAL_TOURNAMENT_KEY = 'ledu-canonical-tournament-v2';
export const CANONICAL_TOURNAMENT_NAMESPACE = 'canonical-tournament';
const LEGACY_SHARED_KEY = 'ledu-shared-tournament-v1';
const LEGACY_MANAGER_KEY = 'ledu-tournament-demo-v1';
const TAB_INDEX_KEY = 'ledu-tabulacion-index-v1';
const TAB_PREFIX = 'ledu-tabulacion-v1:';
let mirrorChain: Promise<void> = Promise.resolve();

type EntityKind = 'team' | 'speaker' | 'judge' | 'venue' | 'round' | 'assignment' | 'debate';
type JsonRecord = Record<string, unknown>;

interface CanonicalEntity {
  kind: EntityKind;
  canonicalId: string;
  managerSourceId?: string;
  tabulationSourceId?: string;
  managerData?: JsonRecord;
  tabulationData?: JsonRecord;
  shared: { name?: string; institution?: string; active?: boolean; teamId?: string; incompatibleJudgeIds?: string[]; number?: number };
}

interface CanonicalDocument {
  schemaVersion: 2;
  revision: number;
  updatedAt: number;
  legacyMigrationComplete: boolean;
  managerScope: string;
  managerState: JsonRecord | null;
  tabulationStates: Record<string, JsonRecord>;
  deletedTabulationIds: Record<string, true>;
  tabulationIndex: { activeId: string | null; tournaments: Array<{ id: string; name: string; updatedAt: number }> };
  entities: Record<string, CanonicalEntity>;
}

export interface CanonicalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const emptyDocument = (): CanonicalDocument => ({
  schemaVersion: 2, revision: 0, updatedAt: 0, legacyMigrationComplete: false, managerScope: 'manager:local',
  managerState: null, tabulationStates: {}, deletedTabulationIds: {}, tabulationIndex: { activeId: null, tournaments: [] }, entities: {},
});
const object = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const entityKey = (scope: string, kind: EntityKind, id: string) => scope + '|' + kind + '|' + id;

function parseDocument(raw: string | null): CanonicalDocument | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CanonicalDocument>;
    if (value.schemaVersion !== 2 || !Number.isSafeInteger(value.revision) || (value.revision ?? -1) < 0
      || !Number.isSafeInteger(value.updatedAt) || (value.updatedAt ?? -1) < 0
      || !object(value.entities) || !object(value.tabulationStates) || !object(value.deletedTabulationIds ?? {}) || !object(value.tabulationIndex)
      || !Array.isArray(value.tabulationIndex.tournaments)) return null;
    return {
      schemaVersion: 2, revision: value.revision!, updatedAt: value.updatedAt!,
      legacyMigrationComplete: value.legacyMigrationComplete === true,
      managerScope: typeof value.managerScope === 'string' ? value.managerScope : 'manager:local',
      managerState: object(value.managerState) ? value.managerState : null,
      tabulationStates: value.tabulationStates as Record<string, JsonRecord>,
      deletedTabulationIds: (value.deletedTabulationIds ?? {}) as Record<string, true>,
      tabulationIndex: value.tabulationIndex as CanonicalDocument['tabulationIndex'],
      entities: value.entities as Record<string, CanonicalEntity>,
    };
  } catch { return null; }
}

function sharedFields(kind: EntityKind, data: JsonRecord, mapRelation: (kind: EntityKind, id: string) => string = (_kind, id) => id) {
  if (kind === 'speaker') return {
    name: typeof data.name === 'string' ? data.name : undefined,
    teamId: typeof data.teamId === 'string' ? mapRelation('team', data.teamId) : undefined,
  };
  if (kind === 'venue') return {
    name: typeof data.name === 'string' ? data.name : undefined,
    active: typeof data.active === 'boolean' ? data.active : undefined,
  };
  if (kind === 'round') return {
    name: typeof data.name === 'string' ? data.name : undefined,
    number: typeof data.number === 'number' ? data.number : undefined,
  };
  if (kind === 'assignment' || kind === 'debate') return {};
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    institution: typeof data.institution === 'string' ? data.institution : undefined,
    active: typeof data.active === 'boolean' ? data.active : undefined,
    incompatibleJudgeIds: Array.isArray(data.incompatibleJudgeIds)
      ? data.incompatibleJudgeIds.filter((id): id is string => typeof id === 'string').map((id) => mapRelation('judge', id))
      : undefined,
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
  sharedOverride?: CanonicalEntity['shared'],
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
    shared: source === 'manager' || !previous?.managerData ? (sharedOverride ?? sharedFields(kind, preferred)) : previous.shared,
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
    else {
      const remaining = next.managerData ?? next.tabulationData ?? {};
      next.shared = sharedFields(entity.kind, remaining);
      document.entities[key] = next;
    }
  }
}

function mapTabCanonical(kind: EntityKind, sourceId: string, tournament: TabTournament): string {
  if (kind === 'round') {
    const round = tournament.rounds.find((item) => item.id === sourceId);
    return round?.managerRoundId ?? 'tab:' + tournament.id + ':round:' + sourceId;
  }
  if (kind === 'debate') return 'tab:' + tournament.id + ':debate:' + sourceId;
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
  const raw = storage.getItem(CANONICAL_TOURNAMENT_KEY);
  const parsed = raw === null ? emptyDocument() : parseDocument(raw);
  if (!parsed) throw new Error('El repositorio canónico está dañado; se conserva intacto para recuperación.');
  const current = parsed;
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
      const { teams = [], speakers = [], judges = [], physicalRooms = [], rounds = [], rooms = [], ...state } = tournament;
      document.managerState = clone(state as unknown as JsonRecord);
      const entries: Array<[EntityKind, Array<JsonRecord>]> = [
        ['team', teams as unknown as JsonRecord[]],
        ['speaker', (speakers ?? []) as unknown as JsonRecord[]],
        ['judge', judges as unknown as JsonRecord[]],
        ['venue', physicalRooms as unknown as JsonRecord[]],
        ['round', rounds as unknown as JsonRecord[]],
        ['assignment', rooms as unknown as JsonRecord[]],
      ];
      const seen = new Set<string>();
      for (const [kind, values] of entries) for (const data of values) {
        if (typeof data.id !== 'string') continue;
        const canonicalId = kind === 'assignment' && typeof data.assignmentId === 'string' ? data.assignmentId
          : kind === 'assignment' ? 'manager-room:' + data.id : data.id;
        const key = entityKey(scope, kind, canonicalId);
        seen.add(key);
        upsertSource(document, scope, kind, canonicalId, 'manager', data.id, data, sharedFields(kind, data));
      }
      pruneSourceEntities(document, scope, 'manager', seen);
    }, now);
  }

  function readManager<T = Tournament>(): T | null {
    const document = readDocument();
    if (!document.managerState) return null;
    const scope = document.managerScope;
    const sourceId = (kind: EntityKind, canonical: string) =>
      listSource(document, scope, kind, 'manager').find((entity) => entity.canonicalId === canonical)?.managerSourceId ?? canonical;
    const entities = (kind: EntityKind) => listSource(document, scope, kind, 'manager')
      .map((entity) => {
        const data = { ...(entity.managerData ?? {}), ...entity.shared, id: entity.managerSourceId ?? entity.canonicalId };
        if ((kind === 'team' || kind === 'judge') && Array.isArray(entity.shared.incompatibleJudgeIds)) {
          data.incompatibleJudgeIds = entity.shared.incompatibleJudgeIds.map((id) => sourceId('judge', id));
        }
        if (kind === 'speaker' && typeof entity.shared.teamId === 'string') data.teamId = sourceId('team', entity.shared.teamId);
        return data;
      });
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
      const { teams = [], speakers = [], judges = [], venues = [], rounds = [], ...state } = tournament;
      document.tabulationStates[tournament.id] = { ...clone(state as unknown as JsonRecord), __canonicalScope: scope };
      delete document.deletedTabulationIds[tournament.id];
      const entries: Array<[EntityKind, Array<JsonRecord>]> = [
        ['team', teams as unknown as JsonRecord[]],
        ['speaker', speakers as unknown as JsonRecord[]],
        ['judge', judges as unknown as JsonRecord[]],
        ['venue', venues as unknown as JsonRecord[]],
        ['round', rounds.map((round) => {
          const record = { ...round } as unknown as JsonRecord;
          delete record.debates;
          return record;
        })],
      ];
      const seen = new Set<string>();
      for (const [kind, values] of entries) for (const data of values) {
        if (typeof data.id !== 'string') continue;
        const canonicalId = mapTabCanonical(kind, data.id, tournament);
        const key = entityKey(scope, kind, canonicalId);
        seen.add(key);
        upsertSource(document, scope, kind, canonicalId, 'tabulation', data.id, data, sharedFields(kind, data, (relationKind, relationId) => mapTabCanonical(relationKind, relationId, tournament)));
      }
      for (const round of rounds) for (const debate of round.debates) {
        const canonicalId = debate.managerAssignmentId ?? 'tab:' + tournament.id + ':debate:' + debate.id;
        const kind: EntityKind = debate.managerAssignmentId ? 'assignment' : 'debate';
        const key = entityKey(scope, kind, canonicalId);
        seen.add(key);
        upsertSource(document, scope, kind, canonicalId, 'tabulation', debate.id, { ...debate, __roundId: round.id }, {});
      }
      pruneSourceEntities(document, scope, 'tabulation', seen);
    }, now);
  }

  function readTabulation<T = TabTournament>(id: string): T | null {
    const document = readDocument();
    if (document.deletedTabulationIds[id]) return null;
    const state = document.tabulationStates[id];
    if (!state) return null;
    const scope = typeof state.__canonicalScope === 'string' ? state.__canonicalScope : 'tabulation:' + id;
    const sourceId = (kind: EntityKind, canonical: string) =>
      listSource(document, scope, kind, 'tabulation').find((entity) => entity.canonicalId === canonical)?.tabulationSourceId ?? canonical;
    const entities = (kind: EntityKind) => listSource(document, scope, kind, 'tabulation')
      .map((entity) => {
        const data = { ...(entity.tabulationData ?? {}), ...entity.shared, id: entity.tabulationSourceId ?? entity.canonicalId };
        if ((kind === 'team' || kind === 'judge') && Array.isArray(entity.shared.incompatibleJudgeIds)) {
          data.incompatibleJudgeIds = entity.shared.incompatibleJudgeIds.map((id) => sourceId('judge', id));
        }
        if (kind === 'speaker' && typeof entity.shared.teamId === 'string') data.teamId = sourceId('team', entity.shared.teamId);
        return data;
      });
    return {
      ...Object.fromEntries(Object.entries(state).filter(([key]) => key !== '__canonicalScope')),
      teams: entities('team'),
      speakers: entities('speaker'),
      judges: entities('judge'),
      venues: entities('venue'),
      rounds: entities('round').map((round) => ({
        ...round,
        debates: [...listSource(document, scope, 'assignment', 'tabulation'), ...listSource(document, scope, 'debate', 'tabulation')]
          .filter((entity) => entity.tabulationData?.__roundId === round.id)
          .map((entity) => Object.fromEntries(Object.entries(entity.tabulationData ?? {}).filter(([key]) => key !== '__roundId'))),
      })),
    } as T;
  }

  function writeIndex(index: CanonicalDocument['tabulationIndex']): void {
    updateDocument(storage, (document) => { document.tabulationIndex = clone(index); }, now);
  }

  function readIndex(): CanonicalDocument['tabulationIndex'] {
    return clone(readDocument().tabulationIndex);
  }

  function isTabulationDeleted(id: string): boolean {
    return readDocument().deletedTabulationIds[id] === true;
  }

  function markLegacyMigrationComplete(): void {
    updateDocument(storage, (document) => { document.legacyMigrationComplete = true; }, now);
  }

  function deleteTabulation(id: string): void {
    updateDocument(storage, (document) => {
      delete document.tabulationStates[id];
      document.deletedTabulationIds[id] = true;
      // Entity history is retained; deleting an index entry never destroys canonical entities.
      document.tabulationIndex.tournaments = document.tabulationIndex.tournaments.filter((entry) => entry.id !== id);
      if (document.tabulationIndex.activeId === id) document.tabulationIndex.activeId = document.tabulationIndex.tournaments[0]?.id ?? null;
    }, now);
  }

  return { readManager, writeManager, readTabulation, writeTabulation, readIndex, writeIndex, deleteTabulation, isTabulationDeleted, markLegacyMigrationComplete };
}

export function getBrowserCanonicalTournamentRepository() {
  return createCanonicalTournamentRepository(window.localStorage);
}

/**
 * Migrate old whole-object snapshots on first read. Legacy bytes are deliberately
 * retained for rollback/export; migration never infers identity from names.
 */
interface LegacySharedDocument { manager?: unknown; tabulation?: Record<string, string> }

function readLegacySharedDocument(storage: Storage): LegacySharedDocument | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LEGACY_SHARED_KEY) ?? 'null');
    if (!object(parsed)) return null;
    const tabulation = object(parsed.tabulation)
      ? Object.fromEntries(Object.entries(parsed.tabulation).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : undefined;
    return { manager: parsed.manager, tabulation };
  } catch { return null; }
}

export function migrateLegacyTournamentStorage(storage: Storage): void {
  const canonicalRaw = storage.getItem(CANONICAL_TOURNAMENT_KEY);
  const existingDocument = canonicalRaw === null ? null : parseDocument(canonicalRaw);
  if (canonicalRaw !== null && !existingDocument) return;
  if (existingDocument?.legacyMigrationComplete) return;
  const repository = createCanonicalTournamentRepository(storage);
  const legacyShared = readLegacySharedDocument(storage);
  if (!repository.readManager()) {
    let legacyManager: unknown = null;
    try {
      legacyManager = legacyShared?.manager ?? JSON.parse(storage.getItem(LEGACY_MANAGER_KEY) ?? 'null');
    } catch { /* Invalid legacy bytes are left untouched for manual recovery. */ }
    if (object(legacyManager)) repository.writeManager(legacyManager as unknown as Tournament);
  }
  // The previous projection adapter could hold Tabulation keys only inside its
  // shared document. Restore those bytes only when the original key is absent.
  for (const [key, value] of Object.entries(legacyShared?.tabulation ?? {})) {
    if (key.startsWith(TAB_PREFIX) || key === TAB_INDEX_KEY) {
      if (storage.getItem(key) === null && typeof value === 'string') storage.setItem(key, value);
    }
  }

  let index: CanonicalDocument['tabulationIndex'] | null = null;
  try {
    const raw = JSON.parse(storage.getItem(TAB_INDEX_KEY) ?? 'null') as CanonicalDocument['tabulationIndex'] | null;
    if (raw && Array.isArray(raw.tournaments)) index = raw;
  } catch { /* Rebuild from individual legacy tournament keys. */ }

  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(TAB_PREFIX)) keys.push(key);
  }
  const migratedEntries: CanonicalDocument['tabulationIndex']['tournaments'] = [];
  for (const key of keys) {
    const id = key.slice(TAB_PREFIX.length);
    if (repository.isTabulationDeleted(id)) continue;
    let tournament = repository.readTabulation<TabTournament>(id);
    if (!tournament) {
      try {
        const raw = JSON.parse(storage.getItem(key) ?? 'null') as TabTournament | null;
        if (raw && raw.id === id) {
          repository.writeTabulation(raw);
          tournament = raw;
        }
      } catch { /* Keep the malformed legacy record untouched. */ }
    }
    if (tournament) migratedEntries.push({ id, name: tournament.name, updatedAt: tournament.updatedAt });
  }
  const currentIndex = repository.readIndex();
  if (index && JSON.stringify(index) !== JSON.stringify(currentIndex)) repository.writeIndex(index);
  else if (!index && !currentIndex.tournaments.length && migratedEntries.length) {
    const ordered = [...migratedEntries].sort((a, b) => b.updatedAt - a.updatedAt);
    repository.writeIndex({ activeId: ordered[0].id, tournaments: ordered });
  }
  repository.markLegacyMigrationComplete();
}

export function createCanonicalTabulationStorage(legacy: Storage): Storage {
  migrateLegacyTournamentStorage(legacy);
  const repository = getBrowserCanonicalTournamentRepository();
  const isTournamentKey = (key: string) => key.startsWith(TAB_PREFIX);
  return {
    get length() { return legacy.length; },
    key: (index: number) => legacy.key(index),
    getItem(key: string) {
      if (key === TAB_INDEX_KEY) {
        const rawCanonical = legacy.getItem(CANONICAL_TOURNAMENT_KEY);
        if (rawCanonical !== null && !parseDocument(rawCanonical)) return legacy.getItem(key);
        return JSON.stringify(repository.readIndex());
      }
      if (isTournamentKey(key)) {
        const id = key.slice(TAB_PREFIX.length);
        if (repository.isTabulationDeleted(id)) return null;
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
