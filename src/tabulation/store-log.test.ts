import { describe, expect, it } from 'vitest';
import { appendLogEntry, archiveTail } from './log';
import { parseTournamentExport, serializeTournamentExport } from './normalize';
import { createTabStore, memoryStorage, tournamentKey, type KeyValueStorage, type TabStoreOptions } from './store';
import { makeTournament } from './test-fixtures';
import type { WriterLock } from './writerLock';

function fakeLock(initial: boolean) {
  let writer = initial;
  const listeners = new Set<() => void>();
  const set = (value: boolean) => {
    writer = value;
    listeners.forEach((listener) => listener());
  };
  const lock: WriterLock & { set(value: boolean): void } = {
    isWriter: () => writer,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    takeOver: () => set(true),
    release: () => set(false),
    dispose: () => undefined,
    set,
  };
  return lock;
}

function harness(options: { storage?: KeyValueStorage; lock?: WriterLock | null; describe?: TabStoreOptions['describe'] } = {}) {
  const storage = options.storage ?? memoryStorage();
  let time = 1_000_000;
  const timers: Array<{ at: number; callback: () => void }> = [];
  const store = createTabStore({
    storage, events: null, now: () => time, lock: options.lock ?? null, describe: options.describe,
    schedule: (callback, delay) => {
      const timer = { at: time + delay, callback };
      timers.push(timer);
      return () => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); };
    },
  });
  const advance = (ms: number) => {
    time += ms;
    for (const timer of timers.filter((item) => item.at <= time)) {
      const index = timers.indexOf(timer);
      if (index < 0) continue;
      timers.splice(index, 1);
      timer.callback();
    }
  };
  return { store, storage, advance };
}

const tournamentId = (store: ReturnType<typeof harness>['store']) => store.getState().tournament!.id;

describe('store changes', () => {
  it('reports whether a change was applied and survives a failing change', () => {
    const { store } = harness();
    expect(store.update((t) => t)).toBe(false);
    store.create(makeTournament('aduma', ['a', 'b']));
    expect(store.update((t) => ({ ...t, name: 'ADUMA' }))).toBe(true);
    expect(store.update((t) => t)).toBe(true);
    expect(store.update(() => { throw new Error('fallo'); })).toBe(false);
    expect(store.getState().tournament!.name).toBe('ADUMA');
    expect(store.getState().error).toContain('fallo');
  });

  it('reports whether everything is saved', () => {
    const storage = memoryStorage();
    const first = harness({ storage });
    first.store.create(makeTournament('aduma', ['a']));
    const second = harness({ storage });
    second.store.update((t) => ({ ...t, name: 'Otra pestaña' }));
    expect(second.store.flush()).toBe(true);
    first.store.update((t) => ({ ...t, name: 'Esta pestaña' }));
    expect(first.store.flush()).toBe(false);
    expect(first.store.getState().status).toBe('conflict');
    expect(first.store.update((t) => ({ ...t, name: 'Bloqueada' }))).toBe(false);
  });
});

describe('store log', () => {
  it('saves named actions with their change and archives them once saved', () => {
    const { store, advance } = harness();
    store.create(makeTournament('aduma', ['a', 'b']));
    store.setOperator('Mesa 1');
    store.update((t) => ({ ...t, name: 'ADUMA' }), { type: 'round.confirm', message: 'Ronda 1 confirmada', details: { round: 1 } });
    advance(300);
    const { entries } = store.readLog();
    expect(entries.map((entry) => [entry.type, entry.operator, Boolean(entry.hash)])).toEqual([['tournament.create', '', true], ['round.confirm', 'Mesa 1', true]]);
    expect(store.getState().tournament!.logTail).toEqual([]);
    expect(store.verifyLog()).toMatchObject({ ok: true, segments: 1, issues: [] });
  });

  it('groups unnamed edits into one entry that is archived after 10 s without changes', () => {
    const { store, advance } = harness();
    store.create(makeTournament('aduma', ['a', 'b']));
    store.update((t) => ({ ...t, name: 'A' }));
    advance(300);
    store.update((t) => ({ ...t, name: 'AB' }));
    advance(300);
    let edits = store.readLog().entries.filter((entry) => entry.type === 'edit');
    expect(edits.map((entry) => entry.hash)).toEqual(['']);
    advance(10_000);
    edits = store.readLog().entries.filter((entry) => entry.type === 'edit');
    expect(edits).toHaveLength(1);
    expect(edits[0].hash).not.toBe('');
    expect(edits[0].details).toEqual({ changes: [{ key: 'name', label: 'Nombre del torneo', before: 'Prueba', after: 'AB' }], omitted: 0 });
  });

  it('closes the group of unnamed edits at each named action, keeping the order', () => {
    const { store, advance } = harness();
    store.create(makeTournament('aduma', ['a', 'b']));
    store.update((t) => ({ ...t, name: 'Uno' }));
    store.update((t) => ({ ...t, name: 'Dos' }), { type: 'named', message: 'Acción' });
    store.update((t) => ({ ...t, name: 'Tres' }));
    advance(10_300);
    expect(store.readLog().entries.map((entry) => entry.type)).toEqual(['tournament.create', 'edit', 'named', 'edit']);
  });

  it('drops a group whose edits were undone', () => {
    const { store, advance } = harness();
    store.create(makeTournament('aduma', ['a', 'b']));
    store.update((t) => ({ ...t, name: 'Otro' }));
    store.update((t) => ({ ...t, name: 'Prueba' }));
    advance(10_300);
    expect(store.readLog().entries.map((entry) => entry.type)).toEqual(['tournament.create']);
    expect(store.getState().tournament!.logSeq).toBe(1);
  });

  it('keeps saving when the changes cannot be described', () => {
    const { store, storage } = harness({ describe: () => { throw new Error('boom'); } });
    store.create(makeTournament('aduma', ['a', 'b']));
    expect(store.update((t) => ({ ...t, name: 'Z' }))).toBe(true);
    expect(store.flush()).toBe(true);
    expect(JSON.parse(storage.getItem(tournamentKey(tournamentId(store)))!).name).toBe('Z');
    expect(store.readLog().entries.at(-1)!.message).toContain('sin detalle');
  });

  it('records errors once per message', () => {
    const { store } = harness();
    store.create(makeTournament('aduma', ['a']));
    store.logError('No se pudo exportar', { reason: 'prueba' });
    store.logError('No se pudo exportar');
    store.flush();
    expect(store.readLog().entries.filter((entry) => entry.type === 'error')).toHaveLength(1);
  });

  it('never rewinds the log when a backup is restored', () => {
    const { store, advance } = harness();
    store.create(makeTournament('aduma', ['a']));
    advance(1000);
    store.backup('Copia 1');
    store.update((t) => ({ ...t, name: 'Cambiado' }), { type: 'named', message: 'Cambio' });
    store.flush();
    const before = store.getState().tournament!.logSeq;
    store.restoreBackup(store.listBackups()[0].slot);
    store.flush();
    expect(store.getState().tournament!.name).toBe('Prueba');
    expect(store.getState().tournament!.logSeq).toBe(before + 1);
    expect(store.readLog().entries.at(-1)!.type).toBe('backup.restore');
    expect(store.verifyLog().ok).toBe(true);
  });

  it('archives the entries an interrupted session left in the saved tournament, without repeating any', () => {
    const storage = memoryStorage();
    const first = harness({ storage });
    first.store.create(makeTournament('aduma', ['a']));
    const id = tournamentId(first.store);
    const saved = JSON.parse(storage.getItem(tournamentKey(id))!);
    // The tail still holds the archived creation entry plus two entries that never reached the archive.
    let crashed = appendLogEntry(saved, { type: 'named', message: 'Uno' }, { at: 5, operator: '' });
    crashed = appendLogEntry(crashed, { type: 'named', message: 'Dos' }, { at: 6, operator: '' });
    storage.setItem(tournamentKey(id), JSON.stringify(crashed));
    const second = harness({ storage });
    expect(second.store.readLog().entries.map((entry) => [entry.seq, entry.message, Boolean(entry.hash)])).toEqual([
      [1, 'Torneo creado: Prueba.', true], [2, 'Uno', true], [3, 'Dos', true],
    ]);
    expect(second.store.getState().tournament!.logTail).toEqual([]);
    second.store.update((t) => ({ ...t, name: 'Sigue' }), { type: 'named', message: 'Tres' });
    second.store.flush();
    expect(second.store.readLog().entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
    expect(second.store.verifyLog().ok).toBe(true);
  });

  it('continues numbering after an archive that is ahead of the saved tournament', () => {
    const storage = memoryStorage();
    const first = harness({ storage });
    first.store.create(makeTournament('aduma', ['a']));
    const id = tournamentId(first.store);
    const ahead = appendLogEntry(appendLogEntry({ ...first.store.getState().tournament!, logTail: [] }, { type: 'x', message: 'x' }, { at: 1, operator: '' }), { type: 'y', message: 'y' }, { at: 2, operator: '' });
    archiveTail(storage, id, ahead.logTail);
    const second = harness({ storage });
    second.store.update((t) => ({ ...t, name: 'Nuevo' }), { type: 'named', message: 'Después' });
    second.store.flush();
    expect(second.store.readLog().entries.map((entry) => [entry.seq, entry.type])).toEqual([[1, 'tournament.create'], [2, 'x'], [3, 'y'], [4, 'named']]);
  });

  it('adopts the log of an imported copy when this browser has none, and keeps its own otherwise', () => {
    const source = harness();
    source.store.create(makeTournament('aduma', ['a']));
    source.store.update((t) => ({ ...t, name: 'Origen' }), { type: 'named', message: 'En el portátil 1' });
    source.store.flush();
    const parsed = parseTournamentExport(serializeTournamentExport(source.store.getState().tournament!, 1, source.store.readLog().entries));

    const target = harness();
    target.store.importTournament(parsed.tournament, 'replace', parsed.log);
    target.store.flush();
    const log = target.store.readLog().entries;
    expect(log.slice(0, 2).map((entry) => entry.hash)).toEqual(source.store.readLog().entries.map((entry) => entry.hash));
    expect(log.at(-1)).toMatchObject({ seq: 3, type: 'tournament.import' });
    expect(target.store.verifyLog().ok).toBe(true);

    target.store.update((t) => ({ ...t, name: 'Local' }), { type: 'named', message: 'En el portátil 2' });
    target.store.flush();
    target.store.importTournament(parsed.tournament, 'replace', parsed.log);
    target.store.flush();
    const after = target.store.readLog().entries;
    expect(after.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(after.at(-1)!.message).toContain('Se conserva el registro de este navegador');
    expect(target.store.getState().tournament!.name).toBe('Origen');
  });

  it('frees only the oldest backup when the storage is full, and logs it', () => {
    const build = (storage: KeyValueStorage) => {
      const run = harness({ storage });
      run.store.create(makeTournament('aduma', ['a', 'b', 'c', 'd']));
      for (const label of ['Primera', 'Segunda', 'Tercera']) {
        run.advance(1000);
        run.store.backup(label);
      }
      return run;
    };
    const probe = memoryStorage();
    build(probe);
    let used = 0;
    for (let i = 0; i < probe.length; i++) used += probe.key(i)!.length + probe.getItem(probe.key(i)!)!.length;
    const { store } = build(memoryStorage({}, used + 400));
    store.update((t) => ({ ...t, name: 'x'.repeat(1500) }), { type: 'named', message: 'Nombre largo' });
    expect(store.flush()).toBe(true);
    expect(store.listBackups().map((backup) => backup.label)).toEqual(['Tercera', 'Segunda']);
    expect(store.readLog().entries.find((entry) => entry.type === 'storage.quota')!.message).toContain('Primera');
  });
});

describe('single writer', () => {
  it('keeps read-only tabs from changing anything until they take control', () => {
    const storage = memoryStorage();
    const writer = harness({ storage });
    writer.store.create(makeTournament('aduma', ['a']));
    const lock = fakeLock(false);
    const reader = harness({ storage, lock });
    expect(reader.store.getState()).toMatchObject({ readOnly: true });
    expect(reader.store.update((t) => ({ ...t, name: 'No' }))).toBe(false);
    expect(reader.store.log({ type: 'x', message: 'No' })).toBe(false);
    writer.store.update((t) => ({ ...t, name: 'Último cambio' }), { type: 'named', message: 'Antes del relevo' });
    writer.store.flush();
    reader.store.takeControl();
    expect(reader.store.getState()).toMatchObject({ readOnly: false });
    expect(reader.store.getState().tournament!.name).toBe('Último cambio');
    expect(reader.store.update((t) => ({ ...t, name: 'Sí' }))).toBe(true);
  });

  it('saves pending edits before losing the role', () => {
    const storage = memoryStorage();
    const lock = fakeLock(true);
    const { store } = harness({ storage, lock });
    store.create(makeTournament('aduma', ['a']));
    store.update((t) => ({ ...t, name: 'Pendiente' }));
    lock.set(false);
    expect(store.getState().readOnly).toBe(true);
    expect(JSON.parse(storage.getItem(tournamentKey(tournamentId(store)))!).name).toBe('Pendiente');
  });
});
