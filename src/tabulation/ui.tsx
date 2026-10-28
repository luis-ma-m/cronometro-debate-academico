import type { ReactNode } from 'react';
import { CircleHelp, Monitor, X } from 'lucide-react';
import type { DebateOutcome } from './results';
import type { TabTournament } from './types';

export type NoticeKind = 'success' | 'warning' | 'error';

export interface ViewProps {
  tournament: TabTournament;
  outcomes: Map<string, DebateOutcome>;
  update: (mutator: (tournament: TabTournament) => TabTournament) => void;
  notify: (message: string, kind?: NoticeKind) => void;
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
    <CircleHelp size={17} /><span>{children}</span>
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

export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileSlug(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'torneo';
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
