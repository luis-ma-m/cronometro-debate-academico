import { deflateSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { auditRound, createRoundDraft } from './draft';
import { parseBackupFile } from './emergency';
import { cyrb53 } from './hash';
import { computeDebateOutcome, outcomeContext } from './results';
import { createTabStore, memoryStorage, tournamentKey, type KeyValueStorage } from './store';
import { debate, makeTournament, qualifyingRound } from './test-fixtures';
import { applyReceivedActa, base32Encode, buildActaLink, decodeActaLink, encodeActaCode, readActaCode, type ActaEntry } from './whatsapp';
import { createWriterLock, LEASE_KEY } from './writerLock';

/** Storage whose writes can be made to fail for some keys, as a full or locked-down browser does. */
function flakyStorage(fails: (key: string) => Error | null): KeyValueStorage {
  const base = memoryStorage();
  return {
    getItem: base.getItem,
    removeItem: base.removeItem,
    key: base.key,
    get length() { return base.length; },
    setItem(key, value) {
      const error = fails(key);
      if (error) throw error;
      base.setItem(key, value);
    },
  };
}

describe('saving when the browser misbehaves', () => {
  it('keeps log entries inside the saved tournament while the log pages cannot be written, and archives them later', () => {
    let full = false;
    const storage = flakyStorage((key) => (full && key.startsWith('ledu-tabulacion-log-v1:') ? Object.assign(new Error('full'), { name: 'QuotaExceededError' }) : null));
    const store = createTabStore({ storage, events: null });
    store.create(makeTournament('aduma', ['a']));
    full = true;
    store.update((t) => ({ ...t, name: 'Uno' }), { type: 'named', message: 'Uno' });
    expect(store.flush()).toBe(true);
    expect(store.getState().logIssues.join(' ')).toContain('No se ha podido archivar');
    expect(store.getState().tournament!.logTail.map((entry) => entry.message)).toEqual(['Uno']);
    full = false;
    const reopened = createTabStore({ storage, events: null });
    expect(reopened.readLog().entries.map((entry) => [entry.message, Boolean(entry.hash)])).toEqual([['Torneo creado: Prueba.', true], ['Uno', true]]);
    expect(reopened.verifyLog().ok).toBe(true);
  });

  it('reports a browser that refuses to save for other reasons, keeps the edit and retries when asked', () => {
    let refuse = false;
    const storage = flakyStorage((key) => (refuse && key.startsWith('ledu-tabulacion-v1:') ? new Error('SecurityError') : null));
    const store = createTabStore({ storage, events: null });
    store.create(makeTournament('aduma', ['a']));
    refuse = true;
    store.update((t) => ({ ...t, name: 'Pendiente' }));
    expect(store.flush()).toBe(false);
    expect(store.getState()).toMatchObject({ status: 'error' });
    expect(store.getState().error).toContain('no ha permitido guardar');
    expect(store.getState().tournament!.name).toBe('Pendiente');
    refuse = false;
    expect(store.flush()).toBe(true);
    expect(store.getState()).toMatchObject({ status: 'saved', error: null });
    expect(createTabStore({ storage, events: null }).getState().tournament!.name).toBe('Pendiente');
  });

  it('refuses to open damaged data and keeps the tournament that was open', () => {
    const storage = memoryStorage();
    const store = createTabStore({ storage, events: null });
    store.create(makeTournament('aduma', ['a']));
    storage.setItem(tournamentKey('roto'), '{no es json');
    store.open('roto');
    expect(store.getState().error).toContain('no son válidos');
    expect(store.getState().tournament!.name).toBe('Prueba');
  });
});

describe('hostile or broken input from the phones', () => {
  function setup() {
    const tournament = makeTournament('aduma', ['a', 'b'], ['j1'], 1);
    tournament.rounds = [qualifyingRound(1, [{ ...debate('d1', 'a', 'b', ['j1']), venueId: 'v1' }])];
    return { tournament, link: buildActaLink(tournament, tournament.rounds[0], tournament.rounds[0].debates[0], 'https://x.example').link };
  }

  it('rejects a link that passes the checksum but does not hold an acta link', () => {
    for (const value of [{ version: 1 }, 'texto', [1, 2]]) {
      const data = base32Encode(deflateSync(strToU8(JSON.stringify(value))));
      expect(() => decodeActaLink('#A1-' + data + '-' + cyrb53(data))).toThrow('incompleto');
    }
    const garbage = 'ZZZZZZZZ';
    expect(() => decodeActaLink('#A1-' + garbage + '-' + cyrb53(garbage))).toThrow('incompleto');
  });

  it('keeps only well-formed values of a malformed acta and never breaks the tabulation', () => {
    const { tournament, link } = setup();
    const hostile = {
      favor: 5, winner: null,
      items: { a: { coherencia: 'x', veracidad: Number.NaN, evidencias: 4 }, intruso: { coherencia: 5 } },
      quickTotals: 'nada',
      penalties: { a: { warnings: -3, minors: 2.7, majors: 'x', disqualified: 'sí' }, b: 'nada' },
      speakers: { a: [{ speakerId: 5 }, { speakerId: 'a-s1', score: 'x' }, { speakerId: 'a-s2', score: 7, roles: ['pirata', 'concluder'] }], b: 'nada' },
      notes: 'x'.repeat(5000), signedBy: 42, sentAt: 'ayer',
    } as unknown as ActaEntry;
    const received = readActaCode(tournament, encodeActaCode(link, hostile));
    expect(received.error).toBeNull();
    expect(received.payload).toMatchObject({
      favor: '', winner: '', items: { a: { evidencias: 4 }, intruso: { coherencia: 5 } }, penalties: { a: { warnings: 0, minors: 2, majors: 0, disqualified: false } },
      speakers: { a: [{ speakerId: 'a-s2', score: 7, roles: ['concluder'] }], b: [] }, signedBy: '', sentAt: 0,
    });
    expect(received.payload!.notes).toHaveLength(2000);
    expect(received.payload!.quickTotals).toBeUndefined();
    const applied = applyReceivedActa(tournament, received);
    const stored = applied.rounds[0].debates[0];
    expect(Object.keys(stored.result!.joint!.items)).toEqual(['a']);
    // No winner was declared: the acta is incomplete, never a crash.
    expect(computeDebateOutcome(applied.rounds[0], stored, outcomeContext(applied)).status).toBe('pending');
  });

  it('rejects codes of another format version', () => {
    const { tournament, link } = setup();
    const data = base32Encode(deflateSync(strToU8(JSON.stringify({ version: 2, debate: 'd1', round: 1 }))));
    expect(readActaCode(tournament, 'ACTA1-' + data + '-' + cyrb53(link.key + '|' + data)).error).toContain('dañado');
  });
});

describe('other recoveries', () => {
  it('takes the writer role when the stored lease is damaged, and a closed tab never takes it again', () => {
    const storage = memoryStorage({ [LEASE_KEY]: '{dañado' });
    const lock = createWriterLock({ name: 'tab', locks: null, storage, tabId: 'a', now: () => 0, schedule: () => () => undefined });
    expect(lock.isWriter()).toBe(true);
    lock.dispose();
    lock.takeOver();
    expect(lock.isWriter()).toBe(false);
  });

  it('explains a damaged tournament inside an emergency copy', () => {
    const dump = JSON.stringify({ format: 'ledu-tabulacion-emergencia', entries: { 'ledu-tabulacion-v1:x': '{dañado' } });
    expect(() => parseBackupFile(dump)).toThrow('dañado');
  });

  it('explains why group stages have no round drafts or audits', () => {
    const tournament = makeTournament('ledu-groups', ['a', 'b', 'c', 'd'], ['j1'], 2);
    expect(createRoundDraft(tournament, 1, 1).issues.join(' ')).toContain('Generar jornadas');
    tournament.rounds = [qualifyingRound(1, [debate('d1', 'a', 'b', ['j1'])])];
    expect(auditRound(tournament, 'r1').differences.join(' ')).toContain('liguilla');
  });
});
