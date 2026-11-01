import { describe, expect, it } from 'vitest';
import {
  ApplicationPersistenceError,
  createDualReadWriteApplicationRecord,
  createMemoryApplicationRecordRepository,
  LegacyMirrorWriteError,
} from './applicationPersistence';

function legacyAdapter(initial: unknown = null) {
  let raw = initial === null ? null : JSON.stringify(initial);
  let failWrite = false;
  return {
    read: () => raw,
    write: (value: unknown) => {
      if (failWrite) throw new Error('quota');
      raw = JSON.stringify(value);
    },
    parse: (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid legacy value');
      const item = value as Record<string, unknown>;
      if (typeof item.name !== 'string') throw new Error('missing name');
      return { name: item.name };
    },
    setFailWrite: (value: boolean) => { failWrite = value; },
  };
}

describe('application persistence repository', () => {
  it('writes versioned records and increments revisions', async () => {
    const repository = createMemoryApplicationRecordRepository();
    const first = await repository.put('participants', 'active', { teams: 2 }, { expectedRevision: null, now: 10 });
    const second = await repository.put('participants', 'active', { teams: 3 }, { expectedRevision: 1, now: 20 });
    expect(first?.revision).toBe(1);
    expect(second).toMatchObject({ revision: 2, updatedAt: 20, value: { teams: 3 } });
    expect(await repository.get('participants', 'active')).toEqual(second);
  });

  it('uses compare-and-set to reject stale or duplicate creates', async () => {
    const repository = createMemoryApplicationRecordRepository();
    expect(await repository.put('participants', 'active', { teams: 1 }, { expectedRevision: 1 })).toBeNull();
    const first = await repository.put('participants', 'active', { teams: 1 }, { expectedRevision: null });
    expect(await repository.put('participants', 'active', { teams: 2 }, { expectedRevision: null })).toBeNull();
    expect(await repository.put('participants', 'active', { teams: 2 }, { expectedRevision: first!.revision - 1 })).toBeNull();
    expect(await repository.put('participants', 'active', { teams: 2 }, { expectedRevision: 9 })).toBeNull();
  });

  it('returns isolated JSON values and lists by namespace in deterministic order', async () => {
    const repository = createMemoryApplicationRecordRepository();
    const source = { nested: { count: 1 } };
    await repository.put('participants', 'b', source, { now: 20 });
    source.nested.count = 99;
    await repository.put('participants', 'a', { nested: { count: 2 } }, { now: 10 });
    await repository.put('settings', 'rules', { enabled: true }, { now: 5 });
    expect((await repository.get<{ nested: { count: number } }>('participants', 'b'))?.value.nested.count).toBe(1);
    expect((await repository.list('participants')).map((item) => item.key)).toEqual(['a', 'b']);
  });

  it('deletes only the expected revision', async () => {
    const repository = createMemoryApplicationRecordRepository();
    const record = await repository.put('participants', 'active', { teams: 1 });
    expect(await repository.delete('participants', 'active', record!.revision + 1)).toBe(false);
    expect(await repository.delete('participants', 'active', record!.revision)).toBe(true);
    expect(await repository.get('participants', 'active')).toBeNull();
  });

  it('rejects invalid identities and unserializable payloads', async () => {
    const repository = createMemoryApplicationRecordRepository();
    await expect(repository.get(' ', 'key')).rejects.toBeInstanceOf(ApplicationPersistenceError);
    await expect(repository.put('participants', 'key', undefined)).rejects.toBeInstanceOf(ApplicationPersistenceError);
  });
});

describe('legacy compatibility adapter', () => {
  it('migrates a valid legacy record on read without deleting the source', async () => {
    const repository = createMemoryApplicationRecordRepository();
    const legacy = legacyAdapter({ name: 'Torneo' });
    const store = createDualReadWriteApplicationRecord(repository, 'tournament', 'active', legacy, () => 50);
    expect(await store.read()).toMatchObject({ status: 'migrated', record: { revision: 1, value: { name: 'Torneo' } } });
    expect(legacy.read()).toBe(JSON.stringify({ name: 'Torneo' }));
  });

  it('surfaces divergent primary and legacy records instead of choosing silently', async () => {
    const repository = createMemoryApplicationRecordRepository();
    await repository.put('tournament', 'active', { name: 'Nuevo' });
    const legacy = legacyAdapter({ name: 'Antiguo' });
    const store = createDualReadWriteApplicationRecord(repository, 'tournament', 'active', legacy);
    expect(await store.read()).toMatchObject({ status: 'conflict', primary: { value: { name: 'Nuevo' } }, legacy: { name: 'Antiguo' } });
  });

  it('reports a legacy write failure after the primary commit without losing its revision', async () => {
    const repository = createMemoryApplicationRecordRepository();
    const legacy = legacyAdapter({ name: 'Anterior' });
    legacy.setFailWrite(true);
    const store = createDualReadWriteApplicationRecord(repository, 'tournament', 'active', legacy, () => 80);
    let caught: unknown;
    try { await store.write({ name: 'Nuevo' }, null); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(LegacyMirrorWriteError);
    expect((caught as LegacyMirrorWriteError).primaryRecord).toMatchObject({ revision: 1, value: { name: 'Nuevo' } });
    expect(await repository.get('tournament', 'active')).toMatchObject({ revision: 1, value: { name: 'Nuevo' } });
    expect(legacy.read()).toBe(JSON.stringify({ name: 'Anterior' }));
  });

  it('keeps malformed legacy data intact and rejects migration', async () => {
    const repository = createMemoryApplicationRecordRepository();
    const legacy = legacyAdapter('corrupt');
    const raw = legacy.read();
    const store = createDualReadWriteApplicationRecord(repository, 'tournament', 'active', legacy);
    await expect(store.read()).rejects.toBeInstanceOf(ApplicationPersistenceError);
    expect(legacy.read()).toBe(raw);
    expect(await repository.get('tournament', 'active')).toBeNull();
  });
});
