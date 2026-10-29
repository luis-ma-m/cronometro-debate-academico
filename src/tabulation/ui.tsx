import type { ReactNode } from 'react';
import { CircleCheck, Info, Monitor, TriangleAlert, X } from 'lucide-react';
import type { LogInput } from './log';
import { serializeTournamentExport } from './normalize';
import type { DebateOutcome } from './results';
import type { TabStore } from './store';
import type { TabTournament } from './types';

export type NoticeKind = 'success' | 'warning' | 'error';

export interface ViewProps {
  tournament: TabTournament;
  outcomes: Map<string, DebateOutcome>;
  /** Applies a change; false when nothing was applied (read-only tab, conflict or a failing change). `meta` names it in the log. */
  update: (mutator: (tournament: TabTournament) => TabTournament, meta?: LogInput) => boolean;
  notify: (message: string, kind?: NoticeKind) => void;
  store: TabStore;
}

/** Version of the running build, shown so everyone can tell which code is in use on the day. */
export const BUILD_INFO = 'v' + __APP_VERSION__ + ' · ' + __APP_COMMIT__ + ' · ' + __APP_BUILT_AT__.slice(0, 16).replace('T', ' ');

const unsavedEditors = new Set<string>();

/** Editors with typed but unsaved data (the page asks before closing). */
export function markUnsaved(key: string, unsaved: boolean) {
  if (unsaved) unsavedEditors.add(key);
  else unsavedEditors.delete(key);
}

export function hasUnsavedEditors(): boolean {
  return unsavedEditors.size > 0;
}

export function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={'tab-field' + (wide ? ' wide' : '')}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Empty({ text }: { text: string }) {
  return <div className="empty"><Monitor size={24} /><p>{text}</p></div>;
}

export function Notice({ kind, children, onClose }: { kind: NoticeKind | 'info'; children: ReactNode; onClose?: () => void }) {
  const className = kind === 'success' ? 'success-notice' : kind === 'error' ? 'notice error-notice' : kind === 'warning' ? 'notice warning-notice' : 'notice tab-info-notice';
  return <div className={className} role={kind === 'error' ? 'alert' : 'status'}>
    {kind === 'success' ? <CircleCheck size={17} /> : kind === 'error' || kind === 'warning' ? <TriangleAlert size={17} /> : <Info size={17} />}<span>{children}</span>
    {onClose && <button type="button" className="text-button" onClick={onClose} aria-label="Cerrar aviso"><X size={16} /></button>}
  </div>;
}

export function IssueList({ items, kind = 'warning' }: { items: string[]; kind?: 'warning' | 'error' }) {
  if (!items.length) return null;
  return <ul className={'tab-issues ' + kind}>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

/** Spanish decimal formatting with at most two decimals. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

/** Accepts "7,5" as well as "7.5"; empty or invalid text gives null. */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Starts a download right away (call it inside the click handler); the link stays valid for a minute. */
export function downloadBytes(filename: string, content: string | Uint8Array, type: string) {
  const part: BlobPart = typeof content === 'string' ? content : new Uint8Array(content);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadFile(filename: string, content: string, type: string) {
  downloadBytes(filename, content, type);
}

/** Copies text; falls back to a hidden text area where the Clipboard API is not allowed (plain http, old phones). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

/** Downloads the tournament with its whole log and records the export; returns how many log entries went with it. */
export function exportTournamentCopy(store: TabStore): number | null {
  store.flush();
  const tournament = store.getState().tournament;
  if (!tournament) return null;
  const log = store.readLog().entries;
  downloadFile('tabulacion-' + fileSlug(tournament.name) + '-' + new Date().toISOString().slice(0, 10) + '.json', serializeTournamentExport(tournament, Date.now(), log), 'application/json');
  store.log({ type: 'export.copy', message: 'Copia del torneo exportada con ' + log.length + ' entradas de registro.' });
  return log.length;
}

export function fileSlug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'torneo';
}

export function lookups(tournament: TabTournament) {
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const judges = new Map(tournament.judges.map((judge) => [judge.id, judge]));
  const venues = new Map(tournament.venues.map((venue) => [venue.id, venue]));
  const speakers = new Map(tournament.speakers.map((speaker) => [speaker.id, speaker]));
  return {
    teams, judges, venues, speakers,
    teamName: (id: string) => teams.get(id)?.name ?? (id ? 'Equipo eliminado' : '—'),
    judgeName: (id: string) => judges.get(id)?.name ?? 'Juez eliminado',
    venueName: (id: string) => venues.get(id)?.name ?? (id ? 'Sala eliminada' : 'Sin sala'),
  };
}

export const STATUS_LABELS: Record<DebateOutcome['status'], { label: string; className: string }> = {
  empty: { label: 'Sin acta', className: 'unassigned' },
  pending: { label: 'Incompleta', className: 'paused' },
  complete: { label: 'Completa', className: 'ready' },
  invalid: { label: 'Con errores', className: 'tab-invalid' },
};
