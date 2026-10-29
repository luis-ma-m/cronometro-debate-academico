import { strToU8, zipSync } from 'fflate';
import { asciiSlug, latestLogStamp, roundCsv, roundTxt } from './exports';
import { formatLogTime, logToCsv } from './log';
import { serializeTournamentExport } from './normalize';
import { roundPdf } from './roundPdf';
import type { TabLogEntry, TabRound, TabTournament } from './types';

export function roundZipName(tournament: TabTournament, round: TabRound, now: number): string {
  const stamp = formatLogTime(now).replace(/-/g, '').replace(' ', '-').replace(/:/g, '').slice(0, 13);
  return asciiSlug(tournament.name) + '-' + asciiSlug(round.name) + '-' + stamp + '.zip';
}

export interface RoundZip { bytes: Uint8Array; filename: string; warnings: string[] }

/**
 * Everything to print and keep after confirming a round: the public sheets (CSV, TXT, PDF) and a private copy of
 * the tournament with its log that can be imported on another computer. A failing PDF never blocks the rest.
 */
export function buildRoundZip(
  tournament: TabTournament, round: TabRound, log: TabLogEntry[], now: number,
  pdf: typeof roundPdf = roundPdf,
): RoundZip {
  const stamp = latestLogStamp(log);
  const name = asciiSlug(round.name);
  const warnings: string[] = [];
  const files: Record<string, Uint8Array> = {
    ['publico/' + name + '.csv']: strToU8(roundCsv(tournament, round, stamp, now)),
    ['publico/' + name + '.txt']: strToU8(roundTxt(tournament, round, stamp, now)),
    'privado/copia-torneo.json': strToU8(serializeTournamentExport(tournament, now, log)),
    'privado/registro.json': strToU8(JSON.stringify(log, null, 2)),
    'privado/registro.csv': strToU8(logToCsv(log)),
  };
  try {
    files['publico/' + name + '.pdf'] = pdf(tournament, round, stamp, now);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    files['publico/error-pdf.txt'] = strToU8('No se ha podido generar el PDF: ' + reason + '\r\nUsa el TXT o el CSV para imprimir la ronda.');
    warnings.push('No se ha podido generar el PDF (' + reason + '): el ZIP incluye el TXT y el CSV.');
  }
  // ZIP dates only cover 1980–2099: a computer with a wrong clock must still be able to export.
  const mtime = new Date(Math.min(Math.max(now, Date.UTC(1980, 0, 2)), Date.UTC(2099, 11, 30)));
  return { bytes: zipSync(files, { level: 6, mtime }), filename: roundZipName(tournament, round, now), warnings };
}
