import { describe, expect, it } from 'vitest';
import { emergencyDump, parseBackupFile } from './emergency';
import { serializeTournamentExport, TabDataError } from './normalize';
import { createTabStore, memoryStorage } from './store';
import { makeTournament } from './test-fixtures';

describe('emergency copy', () => {
  it('dumps every tabulation key as stored and can be imported back with its log', () => {
    const storage = memoryStorage({ 'otra-app': 'x' });
    const store = createTabStore({ storage, events: null });
    store.create(makeTournament('aduma', ['a', 'b']));
    store.update((t) => ({ ...t, name: 'Rescate' }), { type: 'named', message: 'Antes del fallo' });
    store.flush();
    const dump = emergencyDump(storage, 5);
    expect(JSON.parse(dump)).toMatchObject({ format: 'ledu-tabulacion-emergencia', createdAt: 5 });
    expect(dump).not.toContain('otra-app');
    const parsed = parseBackupFile(dump);
    expect(parsed.tournament.name).toBe('Rescate');
    expect(parsed.log.map((entry) => entry.message)).toEqual(['Torneo creado: Prueba.', 'Antes del fallo']);
  });

  it('reads regular exported copies and rejects anything else', () => {
    const tournament = makeTournament('aduma', ['a']);
    expect(parseBackupFile(serializeTournamentExport(tournament, 1)).tournament.id).toBe(tournament.id);
    expect(() => parseBackupFile(JSON.stringify({ format: 'ledu-tabulacion-emergencia', entries: {} }))).toThrow(TabDataError);
  });
});
