import { readLog } from './log';
import { normalizeTabTournament, parseTournamentExport, TabDataError, type ParsedExport } from './normalize';
import { INDEX_KEY, memoryStorage, tournamentKey, type KeyValueStorage } from './store';

const EMERGENCY_FORMAT = 'ledu-tabulacion-emergencia';
const PREFIX = 'ledu-tabulacion';

/**
 * Every tabulation key exactly as stored, without parsing anything: the last resort when the screen fails. The
 * file can be imported back like a regular copy.
 */
export function emergencyDump(storage: KeyValueStorage, now = Date.now()): string {
  const entries: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      entries[key] = storage.getItem(key) ?? '';
    } catch { /* Keep dumping the rest. */ }
  }
  return JSON.stringify({ format: EMERGENCY_FORMAT, createdAt: now, entries });
}

/** Reads an exported copy (.json of the tabulation or of a round ZIP) or an emergency copy. */
export function parseBackupFile(content: string): ParsedExport {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new TabDataError('El archivo no es un JSON válido.');
  }
  const dump = raw as { format?: unknown; entries?: unknown } | null;
  if (dump?.format !== EMERGENCY_FORMAT) return parseTournamentExport(content);
  const entries = dump.entries && typeof dump.entries === 'object' ? dump.entries as Record<string, unknown> : {};
  const storage = memoryStorage(Object.fromEntries(Object.entries(entries).filter((entry): entry is [string, string] => typeof entry[1] === 'string')));
  let activeId: string | null = null;
  try {
    activeId = (JSON.parse(storage.getItem(INDEX_KEY) ?? 'null') as { activeId?: string } | null)?.activeId ?? null;
  } catch { /* Fall back to any stored tournament. */ }
  const ids = Object.keys(entries).filter((key) => key.startsWith(tournamentKey(''))).map((key) => key.slice(tournamentKey('').length));
  const id = activeId && ids.includes(activeId) ? activeId : ids[0];
  if (!id) throw new TabDataError('La copia de emergencia no contiene ningún torneo.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(tournamentKey(id))!);
  } catch {
    throw new TabDataError('El torneo de la copia de emergencia está dañado.');
  }
  const normalized = normalizeTabTournament(parsed);
  const log = readLog(storage, id, normalized.tournament.logTail).entries;
  return { ...normalized, log };
}
