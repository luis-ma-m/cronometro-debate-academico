import { describe, expect, it } from 'vitest';
import {
  adoptLog, appendLogEntry, archiveTail, entryHash, LOG_PAGE_SIZE, logMetaKey, logPageKey, logToCsv, readLog, removeLog, verifyLog,
} from './log';
import { memoryStorage, type KeyValueStorage } from './store';
import { makeTournament } from './test-fixtures';
import type { TabTournament } from './types';

const ID = 'torneo-1';

function withEntries(count: number, start: TabTournament = makeTournament('aduma', ['a', 'b'])): TabTournament {
  let tournament = { ...start, id: ID };
  for (let i = 0; i < count; i++) tournament = appendLogEntry(tournament, { type: 'test', message: 'Entrada ' + (i + 1), details: { i } }, { at: 1000 + i, operator: 'Mesa' });
  return tournament;
}

describe('log entries', () => {
  it('are numbered consecutively and stay unsealed in the tournament until archived', () => {
    const tournament = withEntries(2);
    expect(tournament.logTail.map((entry) => [entry.seq, entry.message, entry.operator, entry.hash])).toEqual([[1, 'Entrada 1', 'Mesa', ''], [2, 'Entrada 2', 'Mesa', '']]);
    expect(tournament.logSeq).toBe(2);
    expect(appendLogEntry({ ...tournament, logTail: [] }, { type: 'x', message: 'y' }, { at: 1, operator: '' }).logTail[0].seq).toBe(3);
  });
});

describe('archived log', () => {
  it('stores the tail in pages with a hash chain that verifies', () => {
    const storage = memoryStorage();
    const { logTail } = withEntries(3);
    expect(archiveTail(storage, ID, logTail)).toMatchObject({ ok: true, archived: 3 });
    const { entries, issues } = readLog(storage, ID);
    expect(issues).toEqual([]);
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(entries[0].prevHash).toBe('');
    expect(entries[1].prevHash).toBe(entries[0].hash);
    expect(entries.every((entry) => entry.hash === entryHash(entry))).toBe(true);
    expect(verifyLog(entries)).toEqual({ ok: true, problems: [], segments: 1, pending: 0 });
  });

  it('never archives an entry twice and continues the chain later', () => {
    const storage = memoryStorage();
    const tournament = withEntries(2);
    archiveTail(storage, ID, tournament.logTail);
    expect(archiveTail(storage, ID, tournament.logTail)).toMatchObject({ ok: true, archived: 0 });
    const more = withEntries(1, tournament);
    archiveTail(storage, ID, more.logTail);
    const { entries } = readLog(storage, ID);
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(verifyLog(entries).ok).toBe(true);
  });

  it('spreads long logs over several pages without breaking the chain', () => {
    const storage = memoryStorage();
    archiveTail(storage, ID, withEntries(LOG_PAGE_SIZE * 2 + 5).logTail);
    expect(JSON.parse(storage.getItem(logMetaKey(ID))!)).toEqual({ pages: 3 });
    const { entries } = readLog(storage, ID);
    expect(entries).toHaveLength(LOG_PAGE_SIZE * 2 + 5);
    expect(verifyLog(entries).ok).toBe(true);
  });

  it('shows pending tail entries after the archived ones', () => {
    const storage = memoryStorage();
    const tournament = withEntries(2);
    archiveTail(storage, ID, tournament.logTail.slice(0, 1));
    const { entries } = readLog(storage, ID, tournament.logTail);
    expect(entries.map((entry) => [entry.seq, Boolean(entry.hash)])).toEqual([[1, true], [2, false]]);
    expect(verifyLog(entries)).toMatchObject({ ok: true, pending: 1 });
  });

  it('detects an edited or removed entry', () => {
    const storage = memoryStorage();
    archiveTail(storage, ID, withEntries(3).logTail);
    const page = JSON.parse(storage.getItem(logPageKey(ID, 0))!);
    page[1].message = 'Cambiado a mano';
    expect(verifyLog(page).problems.join(' ')).toContain('entrada 2');
    expect(verifyLog([page[0], page[2]]).problems.join(' ')).toContain('entrada 3');
  });

  it('recovers a page written just before a failure, without duplicating entries', () => {
    const base = memoryStorage();
    let failMeta = true;
    const flaky: KeyValueStorage = {
      ...base,
      getItem: base.getItem,
      removeItem: base.removeItem,
      key: base.key,
      get length() { return base.length; },
      setItem(key, value) {
        if (failMeta && key === logMetaKey(ID)) throw new Error('fallo de escritura');
        base.setItem(key, value);
      },
    };
    const tournament = withEntries(2);
    expect(archiveTail(flaky, ID, tournament.logTail).ok).toBe(false);
    failMeta = false;
    expect(archiveTail(flaky, ID, tournament.logTail)).toMatchObject({ ok: true, archived: 0 });
    archiveTail(flaky, ID, withEntries(1, tournament).logTail);
    const { entries } = readLog(base, ID);
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(verifyLog(entries).ok).toBe(true);
  });

  it('starts a new segment after a damaged page instead of failing', () => {
    const storage = memoryStorage();
    const tournament = withEntries(2);
    archiveTail(storage, ID, tournament.logTail);
    storage.setItem(logPageKey(ID, 0), '{dañado');
    archiveTail(storage, ID, withEntries(1, { ...tournament, logTail: [] }).logTail);
    const { entries, issues } = readLog(storage, ID);
    expect(issues.join(' ')).toContain('dañada');
    expect(entries.map((entry) => [entry.seq, entry.prevHash])).toEqual([[3, '']]);
    expect(verifyLog(entries)).toMatchObject({ ok: true, segments: 1 });
  });

  it('keeps the tail when the storage is full', () => {
    const storage = memoryStorage({}, 200);
    expect(archiveTail(storage, ID, withEntries(3).logTail).ok).toBe(false);
    expect(readLog(storage, ID).entries).toEqual([]);
  });

  it('adopts an imported log only when there is none, and can remove it', () => {
    const source = memoryStorage();
    archiveTail(source, ID, withEntries(3).logTail);
    const imported = readLog(source, ID).entries;
    const target = memoryStorage();
    expect(adoptLog(target, ID, imported)).toBe(true);
    expect(readLog(target, ID).entries).toEqual(imported);
    expect(adoptLog(target, ID, imported)).toBe(false);
    removeLog(target, ID);
    expect(target.length).toBe(0);
  });

  it('exports to CSV', () => {
    const csv = logToCsv([{ seq: 1, at: Date.UTC(2026, 10, 20, 9, 30), operator: 'Mesa', type: 'acta', message: 'Acta; "Aula 1"', details: { a: 1 }, prevHash: '', hash: 'abc' }]);
    expect(csv.split('\r\n')[0]).toBe('\ufeffNúmero;Fecha;Operador;Tipo;Mensaje;Detalles;Huella');
    expect(csv).toContain('"Acta; ""Aula 1"""');
    expect(csv).toContain('{""a"":1}');
  });
});
