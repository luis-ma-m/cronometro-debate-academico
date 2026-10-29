import { toCsv } from './csv';
import { canonicalJson, cyrb53 } from './hash';
import { normalizeLogEntry } from './normalize';
import type { KeyValueStorage } from './store';
import type { TabLogEntry, TabTournament } from './types';

/**
 * Persistent log of a tournament. New entries are added to `tournament.logTail`, so they are saved in the same
 * write as the change they describe. After each save the tail is sealed (hash chain) and copied to append-only
 * pages; an entry is archived once, by its sequence number, so a failure at any point never loses or repeats one.
 */
const LOG_PREFIX = 'ledu-tabulacion-log-v1:';
export const LOG_PAGE_SIZE = 200;

export const logPageKey = (tournamentId: string, page: number) => LOG_PREFIX + tournamentId + ':' + page;
export const logMetaKey = (tournamentId: string) => LOG_PREFIX + tournamentId + ':meta';

export interface LogInput { type: string; message: string; details?: unknown }

export function appendLogEntry(tournament: TabTournament, input: LogInput, context: { at: number; operator: string }): TabTournament {
  const seq = Math.max(tournament.logSeq, ...tournament.logTail.map((entry) => entry.seq)) + 1;
  const entry: TabLogEntry = {
    seq, at: context.at, operator: context.operator, type: input.type, message: input.message,
    ...(input.details !== undefined ? { details: input.details } : {}), prevHash: '', hash: '',
  };
  return { ...tournament, logTail: [...tournament.logTail, entry], logSeq: seq };
}

export function entryHash(entry: TabLogEntry): string {
  const { seq, at, operator, type, message, details, prevHash } = entry;
  return cyrb53(canonicalJson({ seq, at, operator, type, message, details, prevHash }));
}

function sealEntries(entries: TabLogEntry[], previousHash: string): TabLogEntry[] {
  let previous = previousHash;
  return entries.map((entry) => {
    const sealed = { ...entry, prevHash: previous };
    sealed.hash = entryHash(sealed);
    previous = sealed.hash;
    return sealed;
  });
}

function parsePage(raw: string | null): TabLogEntry[] | null {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    return value.map((item) => (item && typeof item === 'object' ? normalizeLogEntry(item as Record<string, unknown>) : null)).filter((entry): entry is TabLogEntry => entry !== null);
  } catch {
    return null;
  }
}

interface ArchiveState { pages: number; lastSeq: number; lastHash: string; broken: boolean }

/** Where the archive ends. Pages written before their metadata are found by probing; a damaged end breaks the chain. */
function archiveState(storage: KeyValueStorage, tournamentId: string): ArchiveState {
  let pages = 0;
  try {
    pages = Math.max(0, Math.floor(Number((JSON.parse(storage.getItem(logMetaKey(tournamentId)) ?? '{}') as { pages?: unknown }).pages) || 0));
  } catch { /* Rebuilt by probing below. */ }
  while (storage.getItem(logPageKey(tournamentId, pages)) !== null) pages++;
  for (let page = pages - 1; page >= 0; page--) {
    const entries = parsePage(storage.getItem(logPageKey(tournamentId, page)));
    if (entries === null) return { pages, lastSeq: 0, lastHash: '', broken: true };
    const last = entries.at(-1);
    if (last) return { pages, lastSeq: last.seq, lastHash: last.hash, broken: entryHash(last) !== last.hash };
  }
  return { pages, lastSeq: 0, lastHash: '', broken: false };
}

/** Sequence number of the last archived entry (0 when there is none or it cannot be read). */
export function archivedLastSeq(storage: KeyValueStorage, tournamentId: string): number {
  try {
    return archiveState(storage, tournamentId).lastSeq;
  } catch {
    return 0;
  }
}

export interface ArchiveResult { ok: boolean; archived: number; newSegment?: boolean; error?: unknown }

/** Seals and stores the tail entries that are not archived yet. On failure nothing counts as archived. */
export function archiveTail(storage: KeyValueStorage, tournamentId: string, tail: TabLogEntry[]): ArchiveResult {
  try {
    const state = archiveState(storage, tournamentId);
    const pending = tail.filter((entry) => entry.seq > state.lastSeq).sort((x, y) => x.seq - y.seq);
    if (!pending.length) return { ok: true, archived: 0 };
    // A damaged end starts a new page and a new segment of the chain (prevHash '').
    const sealed = sealEntries(pending, state.broken ? '' : state.lastHash);
    let index = state.pages - 1;
    let page = index >= 0 && !state.broken ? parsePage(storage.getItem(logPageKey(tournamentId, index))) ?? [] : [];
    if (index < 0 || state.broken || page.length >= LOG_PAGE_SIZE) {
      index = state.pages;
      page = [];
    }
    const writes: Array<[number, TabLogEntry[]]> = [];
    for (const entry of sealed) {
      if (page.length >= LOG_PAGE_SIZE) {
        writes.push([index, page]);
        index++;
        page = [];
      }
      page = [...page, entry];
    }
    writes.push([index, page]);
    for (const [number, entries] of writes) storage.setItem(logPageKey(tournamentId, number), JSON.stringify(entries));
    storage.setItem(logMetaKey(tournamentId), JSON.stringify({ pages: index + 1 }));
    return { ok: true, archived: sealed.length, newSegment: state.broken };
  } catch (error) {
    return { ok: false, archived: 0, error };
  }
}

/** Archived entries followed by the tail entries still pending (unsealed). Damaged pages are reported, not fatal. */
export function readLog(storage: KeyValueStorage, tournamentId: string, tail: TabLogEntry[] = []): { entries: TabLogEntry[]; issues: string[] } {
  const entries: TabLogEntry[] = [];
  const issues: string[] = [];
  const { pages } = archiveState(storage, tournamentId);
  for (let page = 0; page < pages; page++) {
    const content = parsePage(storage.getItem(logPageKey(tournamentId, page)));
    if (content === null) issues.push('La página ' + (page + 1) + ' del registro está dañada y no se puede leer.');
    else entries.push(...content);
  }
  const archived = new Set(entries.map((entry) => entry.seq));
  for (const entry of tail) if (!archived.has(entry.seq)) entries.push(entry);
  return { entries: entries.sort((x, y) => x.seq - y.seq), issues };
}

export interface LogVerification { ok: boolean; problems: string[]; segments: number; pending: number }

/** Recomputes every hash and link. A new segment (empty prevHash) is reported by count, not as an error. */
export function verifyLog(entries: TabLogEntry[]): LogVerification {
  const problems: string[] = [];
  let previous: TabLogEntry | null = null;
  let segments = 0;
  let pending = 0;
  for (const entry of entries) {
    if (!entry.hash) {
      pending++;
      continue;
    }
    if (entryHash(entry) !== entry.hash) problems.push('La entrada ' + entry.seq + ' no coincide con su huella: se ha modificado.');
    if (!entry.prevHash) segments++;
    else if (!previous || entry.prevHash !== previous.hash) problems.push('Falta una entrada o se ha alterado el orden antes de la entrada ' + entry.seq + '.');
    if (previous && entry.seq <= previous.seq) problems.push('La entrada ' + entry.seq + ' está fuera de orden.');
    previous = entry;
  }
  return { ok: !problems.length, problems, segments, pending };
}

export function removeLog(storage: KeyValueStorage, tournamentId: string) {
  const { pages } = archiveState(storage, tournamentId);
  for (let page = 0; page < pages; page++) storage.removeItem(logPageKey(tournamentId, page));
  storage.removeItem(logMetaKey(tournamentId));
}

/** Copies an imported log when this browser has none for the tournament (it never mixes two histories). */
export function adoptLog(storage: KeyValueStorage, tournamentId: string, entries: TabLogEntry[]): boolean {
  if (!entries.length || archiveState(storage, tournamentId).pages > 0) return false;
  const sealed = entries.filter((entry) => entry.hash).sort((x, y) => x.seq - y.seq);
  try {
    let page = 0;
    for (let start = 0; start < sealed.length; start += LOG_PAGE_SIZE) storage.setItem(logPageKey(tournamentId, page++), JSON.stringify(sealed.slice(start, start + LOG_PAGE_SIZE)));
    if (page) storage.setItem(logMetaKey(tournamentId), JSON.stringify({ pages: page }));
  } catch {
    return false;
  }
  return archiveTail(storage, tournamentId, entries.filter((entry) => !entry.hash)).ok;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function formatLogTime(at: number): string {
  const date = new Date(at);
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

export function logToCsv(entries: TabLogEntry[]): string {
  return toCsv([
    ['Número', 'Fecha', 'Operador', 'Tipo', 'Mensaje', 'Detalles', 'Huella'],
    ...entries.map((entry) => [String(entry.seq), formatLogTime(entry.at), entry.operator, entry.type, entry.message, entry.details === undefined ? '' : JSON.stringify(entry.details), entry.hash || 'pendiente']),
  ]);
}
