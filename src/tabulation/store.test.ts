import { describe, expect, it } from 'vitest';
import { normalizeTabTournament, parseTournamentExport, serializeTournamentExport, TabDataError } from './normalize';
import { createSampleTournament } from './sample';
import { createTabStore, INDEX_KEY, isQuotaError, memoryStorage, tournamentKey, type KeyValueStorage } from './store';
import { decided, makeTournament, qualifyingRound } from './test-fixtures';

function harness(storage: KeyValueStorage = memoryStorage()) {
  const pending: Array<() => void> = [];
  const handlers = new Map<string, Set<(event: Event) => void>>();
  const events = {
    addEventListener: (type: string, listener: (event: Event) => void) => { handlers.set(type, (handlers.get(type) ?? new Set()).add(listener)); },
    removeEventListener: (type: string, listener: (event: Event) => void) => { handlers.get(type)?.delete(listener); },
  };
  const store = createTabStore({
    storage, events, now: () => 1000,
    schedule: (callback) => { pending.push(callback); return () => { const i = pending.indexOf(callback); if (i >= 0) pending.splice(i, 1); }; },
  });
  const unsubscribe = store.subscribe(() => undefined);
  const dispatch = (type: string, event: Partial<StorageEvent> = {}) => handlers.get(type)?.forEach((listener) => listener(event as Event));
  const runTimers = () => pending.splice(0).forEach((callback) => callback());
  return { store, storage, dispatch, runTimers, unsubscribe };
}

describe('tabulation store', () => {
  it('creates, edits with a debounced save and reloads from storage', () => {
    const { store, storage, runTimers } = harness();
    store.create(makeTournament('ledu-groups', ['a', 'b']));
    expect(store.getState().tournament!.revision).toBe(1);
    store.update((t) => ({ ...t, name: 'Liga' }));
    expect(store.getState().status).toBe('dirty');
    runTimers();
    expect(store.getState().status).toBe('saved');
    const reopened = createTabStore({ storage, events: null });
    expect(reopened.getState().tournament).toMatchObject({ name: 'Liga', revision: 2 });
    expect(JSON.parse(storage.getItem(INDEX_KEY)!).tournaments[0].name).toBe('Liga');
  });

  it('detects another tab saving from the same revision instead of overwriting it', () => {
    const storage = memoryStorage();
    const first = harness(storage);
    first.store.create(makeTournament('ledu-groups', ['a', 'b']));
    const second = harness(storage);
    second.store.update((t) => ({ ...t, name: 'Pestaña 2' }));
    second.store.flush();
    first.store.update((t) => ({ ...t, name: 'Pestaña 1' }));
    first.store.flush();
    expect(first.store.getState().status).toBe('conflict');
    expect(JSON.parse(storage.getItem(tournamentKey(first.store.getState().tournament!.id))!).name).toBe('Pestaña 2');
    first.store.reloadFromStorage();
    expect(first.store.getState().tournament!.name).toBe('Pestaña 2');
    first.store.update((t) => ({ ...t, name: 'Pestaña 1 otra vez' }));
    first.store.flush();
    expect(first.store.getState().status).toBe('saved');
  });

  it('adopts writes from other tabs when there are no local changes, and flags them otherwise', () => {
    const { store, storage, dispatch } = harness();
    store.create(makeTournament('ledu-groups', ['a']));
    const id = store.getState().tournament!.id;
    const external = { ...JSON.parse(storage.getItem(tournamentKey(id))!), name: 'Externo', revision: 5 };
    storage.setItem(tournamentKey(id), JSON.stringify(external));
    dispatch('storage', { key: tournamentKey(id), newValue: JSON.stringify(external) });
    expect(store.getState().tournament!.name).toBe('Externo');
    store.update((t) => ({ ...t, name: 'Local' }));
    dispatch('storage', { key: tournamentKey(id), newValue: JSON.stringify({ ...external, revision: 6 }) });
    expect(store.getState().status).toBe('conflict');
    store.overwrite();
    expect(JSON.parse(storage.getItem(tournamentKey(id))!).name).toBe('Local');
  });

  it('flushes pending edits on pagehide', () => {
    const { store, storage, dispatch } = harness();
    store.create(makeTournament('ledu-groups', ['a']));
    store.update((t) => ({ ...t, name: 'Antes de cerrar' }));
    dispatch('pagehide');
    expect(JSON.parse(storage.getItem(tournamentKey(store.getState().tournament!.id))!).name).toBe('Antes de cerrar');
  });

  it('frees backups when the quota is exhausted and reports when it still does not fit', () => {
    // Venues inflate the tournament without growing the index, which only stores the name.
    const venues = (count: number) => Array.from({ length: count }, (_, i) => ({ id: 'v' + i, name: 'Aula ' + i, active: true }));
    const { store, runTimers } = harness(memoryStorage({}, 20_000));
    store.create({ ...makeTournament('ledu-groups', ['a']), venues: venues(100) });
    expect(store.backup('Copia 1')).toBe(true);
    store.update((t) => ({ ...t, venues: venues(340) }));
    runTimers();
    expect(store.getState().status).toBe('saved');
    expect(store.listBackups()).toEqual([]);
    store.update((t) => ({ ...t, venues: venues(500) }));
    runTimers();
    expect(store.getState().status).toBe('error');
    expect(isQuotaError(Object.assign(new Error('x'), { code: 22 }))).toBe(true);
  });

  it('keeps at most three backups and restores one', () => {
    const { store, runTimers } = harness();
    store.create(makeTournament('ledu-groups', ['a']));
    for (const name of ['uno', 'dos', 'tres', 'cuatro']) {
      store.update((t) => ({ ...t, name }));
      runTimers();
      store.backup('Copia ' + name);
    }
    const backups = store.listBackups();
    expect(backups).toHaveLength(3);
    store.restoreBackup(backups.find((backup) => backup.label === 'Copia dos')!.slot);
    expect(store.getState().tournament!.name).toBe('dos');
  });

  it('imports over an existing tournament or as a copy', () => {
    const { store } = harness();
    const original = makeTournament('ledu-groups', ['a']);
    store.create(original);
    store.importTournament({ ...original, name: 'Reemplazo' }, 'replace');
    expect(store.getState().tournaments).toHaveLength(1);
    expect(store.getState().tournament!.name).toBe('Reemplazo');
    store.importTournament({ ...original, name: 'Otro' }, 'copy');
    expect(store.getState().tournaments).toHaveLength(2);
    expect(store.getState().tournament!.name).toBe('Otro (copia)');
    store.remove(store.getState().tournament!.id);
    expect(store.getState().tournament).toBeNull();
    expect(store.getState().tournaments).toHaveLength(1);
  });

  it('rebuilds a lost index from the stored tournaments', () => {
    const storage = memoryStorage();
    harness(storage).store.create(makeTournament('ledu-groups', ['a']));
    storage.removeItem(INDEX_KEY);
    expect(createTabStore({ storage, events: null }).getState().tournaments).toHaveLength(1);
  });
});

describe('import and export', () => {
  it('round-trips a full tournament', () => {
    const tournament = createSampleTournament('uc3m-swiss', 1, 5);
    tournament.rounds = [qualifyingRound(1, [{ ...decided('1', 'sample-team-01', 'sample-team-02', 15, 10), favorTeamId: 'sample-team-01' }])];
    tournament.rounds[0].debates[0].judgeIds = ['sample-judge-01'];
    tournament.rounds[0].debates[0].result!.ballots[0].judgeId = 'sample-judge-01';
    const { tournament: parsed, issues } = parseTournamentExport(serializeTournamentExport(tournament, 2));
    expect(issues).toEqual([]);
    expect(parsed).toEqual(tournament);
  });

  it('fills defaults, drops orphans and reports broken references without losing results', () => {
    const { tournament, issues } = normalizeTabTournament({
      id: 'x', name: 'Viejo', settings: { presetId: 'uc3m-swiss', tiebreaks: ['pointsTotal', 'nope'] },
      teams: [{ id: 'a', name: 'A' }, { id: 'a', name: 'Duplicado' }], speakers: [{ id: 's', teamId: 'zz', name: 'Huérfano' }],
      rounds: [{ id: 'r', number: 1, debates: [{ id: 'd', teamIds: ['a', 'ghost'], judgeIds: [], result: { ballots: [{ judgeId: 'j', totals: { a: 10 } }] } }] }],
    });
    expect(tournament.teams).toHaveLength(1);
    expect(tournament.settings.tiebreaks).toEqual(['pointsTotal']);
    expect(tournament.settings.scoreMax).toBe(20);
    expect(tournament.rounds[0].debates[0].result!.ballots[0].totals).toEqual({ a: 10 });
    expect(issues.join(' ')).toContain('oradores');
    expect(issues.join(' ')).toContain('ya no existen');
  });

  it('rejects other files and future versions', () => {
    expect(() => parseTournamentExport('no es json')).toThrow(TabDataError);
    expect(() => parseTournamentExport(JSON.stringify({ format: 'otra-cosa' }))).toThrow('copia de la tabulación');
    expect(() => normalizeTabTournament({ id: 'x', schemaVersion: 99 })).toThrow('más reciente');
  });
});
