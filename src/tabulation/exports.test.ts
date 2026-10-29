import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { latestLogStamp, roundCsv, roundSheet, roundTxt } from './exports';
import { parseTournamentExport } from './normalize';
import { pdfText, roundPdf } from './roundPdf';
import { buildRoundZip, roundZipName } from './roundZip';
import { debate, jointDecided, makeTournament, qualifyingRound } from './test-fixtures';
import type { TabLogEntry, TabTournament } from './types';

function tournamentWithRound(): TabTournament {
  const tournament = makeTournament('aduma', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], ['j1', 'j2', 'j3', 'j4'], 12);
  tournament.teams.find((team) => team.id === 'h')!.fallenFromRound = 1;
  tournament.venues = tournament.venues.map((venue, i) => ({ ...venue, name: 'Aula ' + [10, 2, 1][i % 3] + (i >= 3 ? ' bis ' + i : '') }));
  tournament.rounds = [qualifyingRound(1, [
    { ...jointDecided('d1', 'a', 'b', 44, 41), venueId: 'v1', judgeIds: ['j1', 'j2'], chairId: 'j2' },
    { ...debate('d2', 'c', 'd', ['j3']), venueId: 'v2', favorTeamId: 'd' },
    { ...debate('d3', 'e', 'f', ['j4']), venueId: 'v3' },
    { ...debate('d4', 'g', 'h', []), venueId: '' },
  ], { silent: true })];
  return tournament;
}

const log: TabLogEntry[] = [
  { seq: 1, at: 1, operator: '', type: 'tournament.create', message: 'Creado', prevHash: '', hash: '0000000000abcd' },
  { seq: 2, at: 2, operator: 'Mesa', type: 'round.confirm', message: 'Ronda 1 confirmada', prevHash: '0000000000abcd', hash: '0ae39aa6d33cdb' },
  { seq: 3, at: 3, operator: 'Mesa', type: 'edit', message: 'Pendiente', prevHash: '', hash: '' },
];

describe('round sheet', () => {
  it('lists debates by room in natural order, without results, and the debates that are not held last', () => {
    const tournament = tournamentWithRound();
    const sheet = roundSheet(tournament, tournament.rounds[0]);
    expect(sheet.rows.map((row) => row.venue)).toEqual(['Aula 1', 'Aula 2', 'Aula 10', '']);
    expect(sheet.rows[0]).toMatchObject({ teams: ['Equipo e', 'Equipo f'], side: 'Se sortea en la sala', chair: 'Juez j4', wings: [] });
    expect(sheet.rows[1]).toMatchObject({ teams: ['Equipo c', 'Equipo d'], side: 'A favor: Equipo d' });
    expect(sheet.rows[2]).toMatchObject({ chair: 'Juez j2', wings: ['Juez j1'] });
    expect(sheet.rows[3].note).toContain('No se disputa');
    const text = JSON.stringify(sheet);
    expect(text).not.toContain('44');
    expect(text).not.toContain('gana');
  });

  it('sends nobody to the room of a debate that is not held, even if it kept one', () => {
    const tournament = tournamentWithRound();
    tournament.rounds[0].debates[3] = { ...tournament.rounds[0].debates[3], venueId: 'v4', judgeIds: ['j1'], chairId: 'j1' };
    const row = roundSheet(tournament, tournament.rounds[0]).rows.at(-1)!;
    expect(row).toMatchObject({ venue: '', chair: '', wings: [], side: '' });
    expect(row.note).toContain('No se disputa');
  });

  it('stamps the exports with the last sealed log entry', () => {
    expect(latestLogStamp(log)).toEqual({ seq: 2, hash: '0ae39aa6d33cdb' });
    expect(latestLogStamp([])).toBeNull();
  });

  it('writes CSV and TXT with the log stamp', () => {
    const tournament = tournamentWithRound();
    const stamp = latestLogStamp(log);
    const csv = roundCsv(tournament, tournament.rounds[0], stamp, Date.UTC(2026, 10, 20, 10));
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain('Sala;Equipo 1;Equipo 2;Postura;Juez principal;Vocales;Observaciones');
    expect(csv).toContain('0ae39aa6d33cdb');
    const txt = roundTxt(tournament, tournament.rounds[0], stamp, Date.UTC(2026, 10, 20, 10));
    expect(txt).toContain('Ronda 1');
    expect(txt.indexOf('Aula 2')).toBeLessThan(txt.indexOf('Aula 10'));
    expect(txt).toContain('registro n.º 2 · huella 0ae39aa6d33cdb');
  });
});

describe('round PDF', () => {
  it('keeps Spanish accents and replaces what the standard fonts cannot print', () => {
    expect(pdfText('Málaga – «Ñu» “sí”… 5 €')).toBe('Málaga - «Ñu» "sí"... 5 EUR');
    expect(pdfText('Ronda 1 ✅')).toBe('Ronda 1 ?');
    expect(pdfText('n\u0303')).toBe('ñ');
  });

  it('produces a PDF document', () => {
    const tournament = tournamentWithRound();
    const bytes = roundPdf(tournament, tournament.rounds[0], latestLogStamp(log), 1);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe('round ZIP', () => {
  it('bundles the public sheets and a private copy that can be restored', () => {
    const tournament = tournamentWithRound();
    const { bytes, warnings } = buildRoundZip(tournament, tournament.rounds[0], log, Date.UTC(2026, 10, 20, 10));
    expect(warnings).toEqual([]);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      'privado/copia-torneo.json', 'privado/registro.csv', 'privado/registro.json', 'publico/ronda-1.csv', 'publico/ronda-1.pdf', 'publico/ronda-1.txt',
    ]);
    const restored = parseTournamentExport(strFromU8(files['privado/copia-torneo.json']));
    expect(restored.tournament).toEqual(tournament);
    expect(restored.log).toEqual(log);
    expect(JSON.parse(strFromU8(files['privado/registro.json']))).toEqual(log);
  });

  it('still produces the ZIP when the PDF fails', () => {
    const tournament = tournamentWithRound();
    const { bytes, warnings } = buildRoundZip(tournament, tournament.rounds[0], log, 1, () => { throw new Error('sin fuentes'); });
    const files = unzipSync(bytes);
    expect(files['publico/ronda-1.pdf']).toBeUndefined();
    expect(strFromU8(files['publico/error-pdf.txt'])).toContain('sin fuentes');
    expect(files['publico/ronda-1.csv']).toBeDefined();
    expect(warnings.join(' ')).toContain('PDF');
  });

  it('names the file in plain ASCII', () => {
    const tournament = tournamentWithRound();
    tournament.name = 'V Torneo Nacional ADUMA · 10.º aniversario';
    expect(roundZipName(tournament, tournament.rounds[0], new Date(2026, 10, 20, 9, 5).getTime())).toBe('v-torneo-nacional-aduma-10-o-aniversario-ronda-1-20261120-0905.zip');
  });
});
