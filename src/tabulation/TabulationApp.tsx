import { useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo } from 'react';
import { ChevronRight, ClipboardList, Download, ExternalLink, House, Lock, Projector, Save, ScrollText, Shuffle, SlidersHorizontal, Trophy, Users, X } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { tournamentProgress } from './progress';
import { computeTournamentOutcomes } from './results';
import { STORAGE_WARNING_BYTES } from './store';
import { TournamentProgress } from './TournamentProgress';
import { isFallenAt, makeTabId } from './types';
import { apiConfigured, deleteTabulationSnapshot, getTabulationSnapshot, listPublicActas, listTabulationSnapshots, publishTabulationSnapshot } from '../api';
import { BUILD_INFO, exportTournamentCopy, hasUnsavedEditors, Notice, type NoticeKind, type ViewProps } from './ui';
import { getBrowserTabStore, useTabStore } from './useTabStore';
import { BallotsView } from './views/BallotsView';
import { HomeView } from './views/HomeView';
import { LogView } from './views/LogView';
import { ParticipantsView } from './views/ParticipantsView';
import { RoundsView } from './views/RoundsView';
import { RulesView } from './views/RulesView';
import { StandingsView } from './views/StandingsView';
import { applyReceivedActa, readActaCode } from './whatsapp';
import { findSnapshotDifferences, isMetadataOnlySnapshotDifference, type SnapshotDifference } from './snapshot-diff';

const VIEWS = [
  { id: 'inicio', label: 'Inicio', icon: House },
  { id: 'reglas', label: 'Reglas', icon: SlidersHorizontal },
  { id: 'participantes', label: 'Participantes', icon: Users },
  { id: 'rondas', label: 'Rondas', icon: Shuffle },
  { id: 'actas', label: 'Actas', icon: ClipboardList },
  { id: 'clasificacion', label: 'Clasificación', icon: Trophy },
  { id: 'registro', label: 'Registro', icon: ScrollText },
] as const;
export type TabulationViewId = (typeof VIEWS)[number]['id'];
type ViewId = TabulationViewId;


const SNAPSHOT_LABELS: Record<string, string> = {
  name: 'Nombre', seed: 'Semilla del torneo', settings: 'Configuración',
  teams: 'Equipos', speakers: 'Oradores', judges: 'Jueces', venues: 'Salas',
  groups: 'Grupos', rounds: 'Rondas y debates', breakSeeds: 'Orden de clasificación',
  manualOrder: 'Orden manual', panelLink: 'Vinculación con Gestión', whatsapp: 'Configuración de WhatsApp',
  judgeConflicts: 'Incompatibilidades', draftRound: 'Borrador de ronda',
  active: 'Activo', institution: 'Institución', rating: 'Experiencia',
  canChair: 'Puede presidir', incompatibleJudgeIds: 'Jueces incompatibles',
  unavailableRoundIds: 'Rondas no disponibles', unavailableRoundNumbers: 'Números de ronda no disponibles',
  unavailableRoundNames: 'Rondas no disponibles por nombre', phone: 'Teléfono',
  teamId: 'Equipo', teamIds: 'Equipos', judgeId: 'Juez', judgeIds: 'Jueces',
  venueId: 'Sala', chairId: 'Juez principal', favorTeamId: 'Equipo a favor',
  kind: 'Tipo', number: 'Número', sideMode: 'Reparto de posturas',
  panelSize: 'Tamaño del panel', silent: 'Ronda cerrada', debates: 'Debates',
  result: 'Acta / resultado', ballots: 'Actas de jueces', penalties: 'Penalizaciones',
  winnerTeamId: 'Equipo ganador', totals: 'Puntuaciones', speeches: 'Notas de orador',
  roles: 'Intervenciones', score: 'Puntuación', notes: 'Observaciones',
  rubric: 'Rúbrica', timerPhases: 'Fases del cronómetro', ballotMode: 'Modalidad de acta',
  stage: 'Sistema de competición', groupCount: 'Número de grupos', groupAdvance: 'Clasifican por grupo',
  swissRounds: 'Rondas suizas', avoidSameInstitution: 'Evitar misma institución',
  breakSize: 'Plazas de clasificación', qualifyingPanelSize: 'Jueces por debate (clasificatoria)',
  eliminationPanelSize: 'Jueces por debate (eliminatorias)', speakerScores: 'Puntuar oradores',
  tiebreaks: 'Criterios de desempate', conflictPolicy: 'Política de incompatibilidades',
};

function prettyDifferencePath(path: string): string {
  const parts = path.replace(/^tournament\\./, '').split('.');
  const root = parts[0] ?? path;
  const label = SNAPSHOT_LABELS[root] ?? root;
  const detail = parts.slice(1).map((part) => {
    const match = part.match(/^(.+)\\[(.+)\\]$/);
    if (match) {
      const field = SNAPSHOT_LABELS[match[1]!] ?? match[1]!;
      return field + ' «' + match[2] + '»';
    }
    return SNAPSHOT_LABELS[part] ?? part;
  });
  return detail.length ? label + ' → ' + detail.join(' → ') : label;
}

function displayDifferenceValue(value: unknown): string {
  if (value === undefined) return 'No existe';
  if (value === null) return 'Vacío';
  if (typeof value === 'string') return value.length ? value : 'Vacío';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  try { return JSON.stringify(value, null, 2) ?? '—'; } catch { return String(value); }
}


function readHashView(): ViewId {
  const id = window.location.hash.replace(/^#/, '').split('/')[0];
  return VIEWS.find((view) => view.id === id)?.id ?? 'inicio';
}

/** Even a failure of the shell itself (not only of one screen) leaves the data safe and offers the emergency copy. */
export default function TabulationApp({ embedded = false, onViewChange }: { embedded?: boolean; onViewChange?: (id: TabulationViewId) => void }) {
  const onError = (error: Error) => {
    try {
      getBrowserTabStore().logError('Fallo de la aplicación: ' + error.message);
    } catch { /* The crash screen still offers the emergency copy. */ }
  };
  return <ErrorBoundary resetKey="app" onError={onError} page={!embedded}><TabulationShell embedded={embedded} onViewChange={onViewChange} /></ErrorBoundary>;
}

function TabulationShell({ embedded, onViewChange }: { embedded: boolean; onViewChange?: (id: TabulationViewId) => void }) {
  const store = getBrowserTabStore();
  const state = useTabStore(store);
  const [view, setViewState] = useState<ViewId>(readHashView);
  const [projection, setProjection] = useState(false);
  const [notice, setNotice] = useState<{ kind: NoticeKind; message: string } | null>(null);
  const [operatorDraft, setOperatorDraft] = useState(state.operator);
  const [remoteSync, setRemoteSync] = useState<'checking' | 'synced' | 'offline' | 'conflict' | 'error'>('checking');
  const activeTournamentId = useRef<string | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const [remoteConflict, setRemoteConflict] = useState<{ remote: import('../api').AuthoritativeTabulationSnapshot; localUpdatedAt: number } | null>(null);
  const remoteCursor = useRef<{ id: string; revision: number; localRevision: number; inFlight: boolean } | null>(null);
  const autoResolvedConflict = useRef<string | null>(null);
  const initialRecovery = useRef(false);
  const recoveredTournamentId = useRef<string | null | undefined>(undefined);
  const skipNextEmptyRecovery = useRef(false);
  const componentAlive = useRef(true);
  const seenPublicActas = useRef(new Set<string>());
  useEffect(() => { componentAlive.current = true; return () => { componentAlive.current = false; }; }, []);
  const remoteToken = useMemo(() => {
    try {
      const session = JSON.parse(localStorage.getItem('ledu-admin-session') || 'null') as { token?: string; expiresAt?: number } | null;
      return session?.token && (session.expiresAt ?? 0) > Date.now() ? session.token : null;
    } catch { return null; }
  }, []);
  const tournament = state.tournament;
  const operatorMissing = !state.operator.trim();
  const deleteTournament = useCallback(async (id: string) => {
    if (apiConfigured) {
      if (!remoteToken) throw new Error('Inicia sesión en Gestión para eliminar también la copia sincronizada en Neon.');
      await deleteTabulationSnapshot(remoteToken, id);
    }
    if (remoteCursor.current?.id === id) remoteCursor.current = null;
    if (tournament?.id === id) {
      skipNextEmptyRecovery.current = true;
      recoveredTournamentId.current = null;
      setRemoteSync('synced');
      setRemoteConflict(null);
    }
    store.remove(id);
  }, [remoteToken, store, tournament?.id]);
  useEffect(() => { if (state.operator.trim()) setOperatorDraft(state.operator); }, [state.operator]);

  // Neon is the durable source of truth. localStorage remains an offline cache and recovery copy.
  useEffect(() => {
    if (apiConfigured && remoteToken && !tournament && skipNextEmptyRecovery.current) {
      skipNextEmptyRecovery.current = false;
      recoveredTournamentId.current = null;
      setRemoteSync('synced');
      return;
    }
    if (!apiConfigured || !remoteToken || recoveredTournamentId.current === (tournament?.id ?? null)) {
      if (!apiConfigured || !remoteToken) setRemoteSync('offline');
      return;
    }
    recoveredTournamentId.current = tournament?.id ?? null;
    initialRecovery.current = true;
    activeTournamentId.current = tournament?.id ?? null;
    let cancelled = false;
    const recover = async () => {
      try {
        if (!tournament) {
          const available = await listTabulationSnapshots(remoteToken);
          if (cancelled) return;
          if (!available.length) { setRemoteSync('synced'); return; }
          const latest = await getTabulationSnapshot(remoteToken, available[0]!.tabTournamentId);
          if (cancelled || !latest) return;
          store.create(latest.snapshot);
          remoteCursor.current = { id: latest.tabTournamentId, revision: latest.revision, localRevision: store.getState().tournament?.revision ?? latest.snapshot.revision, inFlight: false };
          setRemoteSync('synced');
          return;
        }
        const remote = await getTabulationSnapshot(remoteToken, tournament.id);
        if (cancelled) return;
        if (!remote) {
          remoteCursor.current = { id: tournament.id, revision: 0, localRevision: -1, inFlight: false };
          setRemoteSync('synced');
          return;
        }
        if (remote.revision < 1 || remote.snapshot.id !== tournament.id || !/^[a-f0-9]{64}$/.test(remote.snapshotSha256)) {
          throw new Error('La copia de Neon no supera la validación de identidad e integridad.');
        }
        remoteCursor.current = { id: remote.tabTournamentId, revision: remote.revision, localRevision: -1, inFlight: false };
        if (remote.updatedAt >= tournament.updatedAt) {
          store.backup('Antes de recuperar el snapshot de Neon r' + remote.revision);
          store.update(() => remote.snapshot, { type: 'sync.remote', message: 'Snapshot recuperado desde Neon', details: { revision: remote.revision, sha256: remote.snapshotSha256 } });
          store.flush();
          remoteCursor.current.localRevision = store.getState().tournament?.revision ?? remote.snapshot.revision;
          setRemoteSync('synced');
        } else {
          setRemoteConflict({ remote, localUpdatedAt: tournament.updatedAt });
          setRemoteSync('conflict');
        }
      } catch (error) {
        if (!cancelled) {
          // Do not memoize a failed recovery: the next online/focus/poll attempt must retry it.
          recoveredTournamentId.current = undefined;
          if (tournament && !remoteCursor.current) {
            remoteCursor.current = { id: tournament.id, revision: 0, localRevision: -1, inFlight: false };
          }
          setRemoteSync('offline');
          store.logError(error instanceof Error ? error.message : 'No se pudo recuperar Tabulación desde Neon.');
        }
      }
    };
    void recover();
    // An empty browser cache must keep trying: otherwise a single startup outage leaves this device blank forever.
    const retry = !tournament ? window.setInterval(() => {
      if (document.visibilityState === 'visible' && !cancelled && !store.getState().tournament) void recover();
    }, 15000) : null;
    const retryOnReturn = () => { if (!cancelled && document.visibilityState === 'visible' && !store.getState().tournament) void recover(); };
    window.addEventListener('online', retryOnReturn);
    window.addEventListener('focus', retryOnReturn);
    return () => {
      cancelled = true;
      if (retry !== null) window.clearInterval(retry);
      window.removeEventListener('online', retryOnReturn);
      window.removeEventListener('focus', retryOnReturn);
    };
  }, [apiConfigured, remoteToken, tournament?.id, store]);

  // Any tournament switch invalidates the previous remote cursor. A new/duplicated aggregate
  // must discover its own Neon revision before it can publish, never inherit another ID's cursor.
  useEffect(() => {
    const activeId = tournament?.id ?? null;
    if (activeTournamentId.current === activeId) return;
    activeTournamentId.current = activeId;
    remoteCursor.current = null;
    setRemoteConflict(null);
    setRemoteSync(apiConfigured && remoteToken ? 'checking' : 'offline');
    initialRecovery.current = false;
  }, [tournament?.id, apiConfigured, remoteToken]);

  useEffect(() => {
    if (!apiConfigured || !remoteToken || !tournament || state.readOnly || state.status !== 'saved' || remoteSync === 'conflict' || remoteSync === 'error' || remoteSync === 'offline') return;
    const cursor = remoteCursor.current;
    if (!cursor || cursor.id !== tournament.id || cursor.inFlight || cursor.localRevision === tournament.revision) return;
    cursor.inFlight = true;
    void publishTabulationSnapshot(remoteToken, {
      tabTournamentId: tournament.id,
      expectedRevision: cursor.revision,
      operationId: makeTabId('tabpub'),
      snapshot: tournament,
    }).then((result) => {
      if (result.tabTournamentId !== tournament.id || result.snapshot.id !== tournament.id || result.revision !== cursor.revision + 1) {
        throw new Error('Neon devolvió una confirmación de publicación incoherente.');
      }
      remoteCursor.current = { id: tournament.id, revision: result.revision, localRevision: tournament.revision, inFlight: false };
      if (componentAlive.current) setRemoteSync('synced');
    }).catch((error: unknown) => {
      cursor.inFlight = false;
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
      if (code === 'REVISION_CONFLICT') {
        void getTabulationSnapshot(remoteToken, tournament.id).then((remote) => {
          if (remote && componentAlive.current) setRemoteConflict({ remote, localUpdatedAt: tournament.updatedAt });
        }).catch(() => undefined);
      }
      if (componentAlive.current) setRemoteSync(code === 'REVISION_CONFLICT' ? 'conflict' : 'error');
      store.logError(error instanceof Error ? error.message : 'No se pudo publicar Tabulación en Neon.');
    });
  }, [apiConfigured, remoteToken, tournament?.id, tournament?.revision, state.status, state.readOnly, remoteSync, store]);

  useEffect(() => {
    if (apiConfigured && remoteToken && tournament && state.status === 'dirty' && remoteSync === 'synced') {
      setRemoteSync('checking');
    }
  }, [apiConfigured, remoteToken, tournament?.id, state.status, remoteSync]);

  // Public judge submissions are immutable inbox records. Only the authenticated tabulation session
  // can read them; each valid code is checked against the current debate before being applied.
  useEffect(() => {
    if (!apiConfigured || !remoteToken || !tournament || state.readOnly || remoteSync !== 'synced') return;
    let cancelled = false;
    const receive = async () => {
      try {
        const submissions = await listPublicActas(remoteToken, tournament.id);
        if (cancelled) return;
        const currentState = store.getState();
        if (!currentState.tournament || currentState.tournament.id !== tournament.id || currentState.status !== 'saved' || currentState.readOnly) return;
        let next = currentState.tournament;
        let applied = 0;
        let recoveredSignatures = 0;
        const appliedIds: string[] = [];
        for (const submission of submissions) {
          if (seenPublicActas.current.has(submission.id)) continue;
          const received = readActaCode(next, submission.code);
          if (received.error || !received.payload || !received.roundId || !received.debateId) {
            seenPublicActas.current.add(submission.id);
            store.logError('Acta pública rechazada (' + submission.roundName + ', ' + submission.judgeName + '): ' + (received.error ?? 'código no válido'));
            continue;
          }
          const round = next.rounds.find((item) => item.id === received.roundId);
          const debate = round?.debates.find((item) => item.id === received.debateId);
          if (!round || !debate || debate.id !== submission.debateRef || round.number !== submission.roundNumber || round.name !== submission.roundName
              || received.payload.signedBy.trim() !== submission.judgeName.trim()) {
            seenPublicActas.current.add(submission.id);
            store.logError('Acta pública rechazada: la ronda indicada no coincide con el debate.');
            continue;
          }
          if (debate.publicActaSubmissionId === submission.id) {
            // Backfill signatures for actas received before the signer field was persisted locally.
            if (!debate.publicActaSignedBy && received.payload.signedBy.trim()) {
              next = { ...next, rounds: next.rounds.map((item) => item.id !== round.id ? item : {
                ...item, debates: item.debates.map((itemDebate) => itemDebate.id === debate.id
                  ? { ...itemDebate, publicActaSignedBy: received.payload!.signedBy.trim() } : itemDebate),
              }) };
              recoveredSignatures++;
            }
            seenPublicActas.current.add(submission.id);
            continue;
          }
          next = applyReceivedActa(next, received, submission.createdAt);
          next = { ...next, rounds: next.rounds.map((item) => item.id !== round.id ? item : {
            ...item, debates: item.debates.map((itemDebate) => itemDebate.id === debate.id
              ? { ...itemDebate, publicActaSubmissionId: submission.id } : itemDebate),
          }) };
          appliedIds.push(submission.id);
          applied++;
        }
        if ((applied || recoveredSignatures) && !cancelled) {
          const message = applied
            ? applied + ' acta(s) recibida(s) directamente desde el móvil y sincronizada(s) con Neon.'
            : recoveredSignatures + ' firma(s) de actas ya recibidas recuperada(s) para su revisión.';
          const ok = store.update(() => next, {
            type: 'acta.save',
            message,
            details: { source: 'public-acta-inbox', count: applied, recoveredSignatures },
          });
          if (ok) {
            store.flush();
            appliedIds.forEach((id) => seenPublicActas.current.add(id));
          }
        }
      } catch {
        // Network errors are retried on the next polling cycle; they do not affect local tabulation.
      }
    };
    void receive();
    const timer = window.setInterval(() => void receive(), 10000);
    window.addEventListener('focus', receive);
    window.addEventListener('online', receive);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', receive); window.removeEventListener('online', receive); };
  }, [apiConfigured, remoteToken, tournament?.id, state.readOnly, remoteSync, store]);

  useEffect(() => {
    if (!apiConfigured || !remoteToken || !tournament || remoteSync === 'conflict') return;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const remote = await getTabulationSnapshot(remoteToken, tournament.id);
        let cursor = remoteCursor.current;
        if (!cursor || cursor.id !== tournament.id) {
          // Rebuild a lost cursor after a transient outage instead of leaving the client permanently offline.
          if (!remote) {
            cursor = { id: tournament.id, revision: 0, localRevision: -1, inFlight: false };
            remoteCursor.current = cursor;
            setRemoteSync('checking');
            return;
          }
          const differences = findSnapshotDifferences(tournament, remote.snapshot);
          if (differences.length === 0) {
            store.backup('Antes de recuperar Neon tras una desconexión');
            const applied = store.update(() => remote.snapshot, { type: 'sync.remote', message: 'Sincronización recuperada desde Neon', details: { revision: remote.revision } });
            if (!applied || !store.flush()) throw new Error('No se pudo guardar localmente la versión recuperada desde Neon.');
            remoteCursor.current = { id: tournament.id, revision: remote.revision, localRevision: store.getState().tournament?.revision ?? remote.snapshot.revision, inFlight: false };
            setRemoteConflict(null);
            setRemoteSync('synced');
            return;
          }
          remoteCursor.current = { id: tournament.id, revision: remote.revision, localRevision: -1, inFlight: false };
          setRemoteConflict({ remote, localUpdatedAt: tournament.updatedAt });
          setRemoteSync('conflict');
          return;
        }
        if (!remote) {
          if (cursor.localRevision !== tournament.revision) setRemoteSync('checking');
          else setRemoteSync('synced');
          return;
        }
        if (remote.revision <= cursor.revision) {
          if (cursor.localRevision === tournament.revision) setRemoteSync('synced');
          else setRemoteSync('checking');
          return;
        }
        if (cursor.localRevision === tournament.revision && store.getState().status === 'saved') {
          store.backup('Antes de sincronizar cambios de otro dispositivo');
          store.update(() => remote.snapshot, { type: 'sync.remote', message: 'Cambios recuperados desde otro dispositivo', details: { revision: remote.revision } });
          store.flush();
          remoteCursor.current = { id: tournament.id, revision: remote.revision, localRevision: store.getState().tournament?.revision ?? remote.snapshot.revision, inFlight: false };
          setRemoteSync('synced');
        } else {
          setRemoteConflict({ remote, localUpdatedAt: tournament.updatedAt });
          setRemoteSync('conflict');
        }
      } catch {
        setRemoteSync('offline');
      }
    };
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [apiConfigured, remoteToken, tournament?.id, tournament?.revision, tournament?.updatedAt, remoteSync, store]);

  useEffect(() => {
    if (!tournament || !apiConfigured || !remoteToken || remoteCursor.current) return;
    let cancelled = false;
    void getTabulationSnapshot(remoteToken, tournament.id).then((remote) => {
      if (cancelled) return;
      if (remote) {
        remoteCursor.current = { id: tournament.id, revision: remote.revision, localRevision: -1, inFlight: false };
        setRemoteConflict({ remote, localUpdatedAt: tournament.updatedAt });
        setRemoteSync('conflict');
      } else {
        remoteCursor.current = { id: tournament.id, revision: 0, localRevision: -1, inFlight: false };
        setRemoteSync('checking');
      }
    }).catch(() => {
      if (!cancelled) {
        if (!remoteCursor.current) remoteCursor.current = { id: tournament.id, revision: 0, localRevision: -1, inFlight: false };
        setRemoteSync('offline');
      }
    });
    return () => { cancelled = true; };
  }, [tournament?.id, remoteToken, tournament?.updatedAt]);

  const recoverRemoteVersion = () => {
    if (!remoteConflict || !tournament) return;
    store.backup('Antes de sustituir por la versión remota de Neon');
    store.update(() => remoteConflict.remote.snapshot, { type: 'sync.remote', message: 'Versión de Neon recuperada manualmente' });
    store.flush();
    remoteCursor.current = { id: tournament.id, revision: remoteConflict.remote.revision, localRevision: store.getState().tournament?.revision ?? remoteConflict.remote.snapshot.revision, inFlight: false };
    setRemoteConflict(null); setRemoteSync('synced');
  };
  const publishLocalVersion = async () => {
    if (!remoteConflict || !tournament || !remoteToken) return;
    const cursor = remoteCursor.current;
    if (!cursor) return;
    try {
      const result = await publishTabulationSnapshot(remoteToken, {
        tabTournamentId: tournament.id, expectedRevision: remoteConflict.remote.revision,
        operationId: makeTabId('tabpub'), snapshot: tournament,
      });
      remoteCursor.current = { id: tournament.id, revision: result.revision, localRevision: tournament.revision, inFlight: false };
      setRemoteConflict(null); setRemoteSync('synced');
    } catch (error) {
      setRemoteSync('conflict');
      store.logError(error instanceof Error ? error.message : 'No se pudo resolver el conflicto de sincronización.');
    }
  };
  useEffect(() => {
    const onHashChange = () => { const next = readHashView(); setViewState(next); onViewChange?.(next); };
    window.addEventListener('hashchange', onHashChange);
    return () => { window.removeEventListener('hashchange', onHashChange); };
  }, [onViewChange]);
  useEffect(() => {
    // Every unexpected error is kept in the log (once per message); none of them stops the page.
    const onError = (event: ErrorEvent) => store.logError('Error en la página: ' + (event.message || 'desconocido') + '.');
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
      store.logError('Error en una operación: ' + reason + '.');
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (store.getState().status === 'dirty') store.flush();
      if (!hasUnsavedEditors()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [store]);
  useEffect(() => {
    // Ask the browser not to evict the data under storage pressure (Safari and Firefox may otherwise do it).
    if (tournament?.id) navigator.storage?.persist?.().catch(() => undefined);
  }, [tournament?.id]);
  useEffect(() => {
    if (!embedded) document.title = (tournament ? tournament.name + ' · ' : '') + 'Tabulación · Debate Control';
  }, [tournament?.name, embedded]);
  useEffect(() => {
    if (!projection) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setProjection(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projection]);

  const setView = useCallback((id: ViewId) => {
    window.location.hash = id;
    setViewState(id);
    onViewChange?.(id);
    setNotice(null);
  }, [onViewChange]);
  const notify = useCallback((message: string, kind: NoticeKind = 'success') => setNotice({ message, kind }), []);
  const update = useCallback<ViewProps['update']>((mutator, meta) => {
    const applied = store.update(mutator, meta);
    if (!applied) {
      const current = store.getState();
      notify(current.readOnly ? 'Esta pestaña es de solo lectura: pulsa «Tomar el control» para hacer cambios.'
        : current.status === 'conflict' ? 'Resuelve antes el conflicto con la otra pestaña.'
          : current.error ?? 'No se ha podido aplicar el cambio.', 'error');
    }
    return applied;
  }, [store, notify]);
  const onViewError = useCallback((error: Error, info: ErrorInfo) => {
    store.logError('Fallo de la pantalla: ' + error.message, { stack: (info.componentStack ?? '').slice(0, 2000) });
  }, [store]);
  const outcomes = useMemo(() => (tournament ? computeTournamentOutcomes(tournament) : new Map()), [tournament]);
  const activeView: ViewId = view;
  // A new screen starts at its top, not at the scroll position of the previous one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeView]);
  const steps = useMemo(() => (tournament ? tournamentProgress(tournament, outcomes) : []), [tournament, outcomes]);
  // Actas still missing in confirmed rounds (debates against a fallen team need none).
  const pendingActas = useMemo(() => {
    if (!tournament) return 0;
    const teams = new Map(tournament.teams.map((team) => [team.id, team]));
    return tournament.rounds.reduce((total, round) => total + round.debates.filter((debate) => !debate.teamIds.some((id) => isFallenAt(teams.get(id), round.number))
      && outcomes.get(debate.id)?.status !== 'complete').length, 0);
  }, [tournament, outcomes]);
  const remoteDifferences = useMemo(
    () => remoteConflict && tournament ? findSnapshotDifferences(tournament, remoteConflict.remote.snapshot) : [],
    [remoteConflict, tournament],
  );
  const remoteDifferenceGroups = useMemo(() => {
    const groups = new Map<string, SnapshotDifference[]>();
    for (const difference of remoteDifferences) {
      const root = difference.path.split(/[.[]/, 1)[0] ?? 'Otros datos';
      const label = SNAPSHOT_LABELS[root] ?? root;
      groups.set(label, [...(groups.get(label) ?? []), difference]);
    }
    return [...groups.entries()];
  }, [remoteDifferences]);

  // Reconcile presentation/contact metadata without asking the operator to resolve a false conflict.
  // Keep the newer side; publish local changes with Neon CAS when this device is ahead.
  useEffect(() => {
    if (!remoteConflict || !tournament || state.readOnly || state.status !== 'saved') return;
    if (remoteConflict.remote.tabTournamentId !== tournament.id || remoteConflict.remote.snapshot.id !== tournament.id) return;
    if (!isMetadataOnlySnapshotDifference(remoteDifferences)) return;
    const { remote } = remoteConflict;
    const conflictKey = tournament.id + ':' + remote.revision + ':' + remote.snapshotSha256 + ':' + tournament.updatedAt;
    if (autoResolvedConflict.current === conflictKey) return;
    let cancelled = false;
    const reconcile = async () => {
      try {
        if (remote.updatedAt > tournament.updatedAt) {
          store.backup('Antes de sincronizar metadatos desde Neon');
          const applied = store.update(() => remote.snapshot, {
            type: 'sync.remote',
            message: 'Metadatos más recientes recuperados desde Neon',
            details: { revision: remote.revision, sha256: remote.snapshotSha256 },
          });
          if (!applied || !store.flush()) throw new Error('No se pudo guardar localmente la versión de metadatos de Neon.');
          if (cancelled) return;
          const saved = store.getState().tournament;
          remoteCursor.current = {
            id: tournament.id, revision: remote.revision,
            localRevision: saved?.revision ?? remote.snapshot.revision, inFlight: false,
          };
        } else {
          // Local is newer (or timestamps tie): preserve this device's snapshot and advance Neon
          // with optimistic concurrency. A concurrent remote write becomes a real conflict.
          if (!store.flush()) throw new Error('No se pudo confirmar la copia local antes de sincronizar con Neon.');
          const local = store.getState().tournament;
          if (!local || local.id !== tournament.id || store.getState().status !== 'saved') {
            throw new Error('La copia local ha cambiado durante la reconciliación; se mantiene el conflicto.');
          }
          const result = await publishTabulationSnapshot(remoteToken!, {
            tabTournamentId: local.id, expectedRevision: remote.revision,
            operationId: makeTabId('tabpub'), snapshot: local,
          });
          if (result.tabTournamentId !== local.id || result.snapshot.id !== local.id || result.revision !== remote.revision + 1) {
            throw new Error('Neon devolvió una confirmación incoherente al publicar los metadatos locales.');
          }
          if (cancelled) return;
          remoteCursor.current = { id: local.id, revision: result.revision, localRevision: local.revision, inFlight: false };
        }
        autoResolvedConflict.current = conflictKey;
        setRemoteConflict(null);
        setRemoteSync('synced');
      } catch (error) {
        if (cancelled) return;
        setRemoteSync('error');
        store.logError(error instanceof Error ? error.message : 'No se pudieron reconciliar automáticamente los metadatos.');
      }
    };
    void reconcile();
    return () => { cancelled = true; };
  }, [remoteConflict, remoteDifferences, tournament?.id, tournament?.updatedAt, state.readOnly, state.status, remoteToken, store]);

  const badges: Partial<Record<ViewId, { text: string; kind: string; title: string }>> = {
    ...(tournament?.draftRound ? { rondas: { text: 'Borrador', kind: 'info', title: 'Hay un borrador de ronda pendiente de confirmar' } } : {}),
    ...(pendingActas ? { actas: { text: String(pendingActas), kind: 'warn', title: pendingActas + ' actas pendientes' } } : {}),
  };

  const exportCopy = () => {
    if (exportTournamentCopy(store) !== null) notify('Copia exportada con el registro. Guárdala fuera del navegador como respaldo adicional a la sincronización con Neon.');
  };

  const saveToNeon = async () => {
    if (!apiConfigured || !remoteToken || !tournament || state.readOnly || state.status === 'conflict' || remoteSync === 'conflict' || manualSaving) return;
    if (!store.flush()) {
      notify('No se ha podido guardar la copia local. Resuelve primero el error de almacenamiento.', 'error');
      return;
    }
    const latest = store.getState();
    const snapshot = latest.tournament;
    if (!snapshot || snapshot.id !== tournament.id || latest.status !== 'saved') {
      notify('La copia local todavía no está lista para sincronizarse. Vuelve a intentarlo.', 'error');
      return;
    }
    let cursor = remoteCursor.current;
    if (!cursor || cursor.id !== snapshot.id) {
      try {
        const remote = await getTabulationSnapshot(remoteToken, snapshot.id);
        if (remote) {
          setRemoteConflict({ remote, localUpdatedAt: snapshot.updatedAt });
          setRemoteSync('conflict');
          notify('Neon contiene una revisión que todavía no está vinculada a esta sesión. Revisa las diferencias antes de publicar.', 'error');
          return;
        }
        cursor = { id: snapshot.id, revision: 0, localRevision: -1, inFlight: false };
        remoteCursor.current = cursor;
      } catch (error) {
        setRemoteSync('error');
        notify(error instanceof Error ? error.message : 'No se ha podido consultar Neon.', 'error');
        return;
      }
    }
    if (cursor.inFlight) {
      notify('Ya hay una sincronización en curso. Espera a que termine.', 'warning');
      return;
    }
    cursor.inFlight = true;
    setManualSaving(true);
    setRemoteSync('checking');
    try {
      const result = await publishTabulationSnapshot(remoteToken, {
        tabTournamentId: snapshot.id,
        expectedRevision: cursor.revision,
        operationId: makeTabId('tabpub'),
        snapshot,
      });
      if (result.tabTournamentId !== snapshot.id || result.snapshot.id !== snapshot.id || result.revision !== cursor.revision + 1) {
        throw new Error('Neon devolvió una confirmación de publicación incoherente.');
      }
      remoteCursor.current = { id: snapshot.id, revision: result.revision, localRevision: snapshot.revision, inFlight: false };
      setRemoteSync('synced');
      notify('Tabulación guardada y confirmada en Neon.');
    } catch (error) {
      cursor.inFlight = false;
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
      if (code === 'REVISION_CONFLICT') {
        try {
          const remote = await getTabulationSnapshot(remoteToken, snapshot.id);
          if (remote) setRemoteConflict({ remote, localUpdatedAt: snapshot.updatedAt });
        } catch { /* Preserve the local copy and the original publication error. */ }
        setRemoteSync('conflict');
      } else {
        setRemoteSync('error');
      }
      notify(error instanceof Error ? error.message : 'No se ha podido guardar Tabulación en Neon.', 'error');
      store.logError(error instanceof Error ? error.message : 'No se pudo publicar Tabulación manualmente en Neon.');
    } finally {
      setManualSaving(false);
    }
  };

  const cursorForStatus = remoteCursor.current;
  const hasPendingNeonChanges = Boolean(tournament && (state.status === 'dirty' || state.status === 'error' || !cursorForStatus || cursorForStatus.id !== tournament.id || cursorForStatus.localRevision !== tournament.revision));
  // Keep the displayed status and the save action in agreement: a local-tab conflict or a
  // read-only tab blocks publishing even if the Neon cursor also looks out of date.
  const saveBlockedByLocalState = state.readOnly || state.status === 'conflict';
  const saveLabel = saveBlockedByLocalState
    ? (state.readOnly ? 'Solo lectura en este dispositivo' : 'Conflicto en este navegador')
    : remoteSync === 'conflict' ? 'Conflicto entre dispositivos'
      : remoteSync === 'error' ? 'Error de sincronización'
        : remoteSync === 'offline' ? 'Sin conexión con Neon'
          : manualSaving ? 'Guardando en Neon…'
            : hasPendingNeonChanges ? 'Cambios pendientes de guardar en Neon'
              : remoteSync === 'checking' ? 'Comprobando Neon…' : 'Sincronizado con Neon';
  const saveStatusClass = saveBlockedByLocalState || remoteSync === 'conflict' || remoteSync === 'error' || remoteSync === 'offline'
    ? 'disconnected' : '';

  const props: ViewProps | null = tournament ? { tournament, outcomes, update, notify, store } : null;

  return <div className={'tab-shell' + (projection ? ' tab-projection' : '') + (embedded ? ' tab-embedded' : ' app-shell')}>
    {!embedded && <aside className="sidebar">
      <div className="brand"><span className="brand-mark">T</span><span>Debate <b>Tabulación</b></span></div>
      <div className="sidebar-section">TABULACIÓN</div>
      <nav>{VIEWS.map((item) => {
        const Icon = item.icon;
        const badge = badges[item.id];
        return <button key={item.id} type="button" className={'nav-button ' + (activeView === item.id ? 'selected' : '')} disabled={!tournament && item.id !== 'inicio'} onClick={() => setView(item.id)}>
          <Icon size={18} /><span>{item.label}</span>{badge && <em className={'nav-badge ' + badge.kind} title={badge.title}>{badge.text}</em>}<ChevronRight size={15} />
        </button>;
      })}</nav>
      <div className="sidebar-bottom">
        <span className={'connection-dot' + (saveStatusClass ? ' tab-dot-error' : '')} />
        <span>{saveLabel}</span>
        <span className="tab-operator">Operador: {state.operator || 'sin nombre'}</span>
        <a className="sidebar-logout" href="/"><ExternalLink size={16} /> Panel de organización</a>
      </div>
    </aside>}
    <main className="main-area">
      <header className="topbar">
        <div><span className="eyebrow">TABULACIÓN · ESPACIO DE COMPETICIÓN</span><h1>{tournament?.name ?? 'Tabulación de debate académico'}</h1></div>
        {tournament && <div className="top-actions tab-no-project">
          <span className="live-status"><i className={saveStatusClass} /> {saveLabel}</span>
          <button type="button" className="button primary" onClick={() => void saveToNeon()} disabled={!apiConfigured || !remoteToken || saveBlockedByLocalState || remoteSync === 'conflict' || manualSaving} title={saveBlockedByLocalState ? 'Resuelve el conflicto local o toma el control de esta pestaña antes de guardar.' : remoteSync === 'conflict' ? 'Resuelve primero las diferencias entre este dispositivo y Neon.' : 'Forzar el guardado de la copia local en Neon'}><Save size={16} /> {manualSaving ? 'Guardando…' : 'Guardar en Neon'}</button>
          <button type="button" className="button secondary" onClick={exportCopy}><Download size={16} /> Exportar copia</button>
          <button type="button" className="button secondary" onClick={() => setProjection(true)} title="Pantalla limpia para proyectar (Esc para salir)"><Projector size={16} /> Proyectar</button>
        </div>}
      </header>
      {projection && <button type="button" className="button secondary tab-exit-projection" onClick={() => setProjection(false)}><X size={16} /> Salir de la proyección</button>}
      {tournament && <TournamentProgress steps={steps} onOpen={() => setView('rondas')} />}
      <div className="tab-no-project">
        {state.readOnly && <div className="notice warning-notice tab-readonly" role="alert">
          <Lock size={17} /><span>Otra pestaña o ventana de este navegador está editando la tabulación: aquí solo se puede consultar. Si la otra se ha cerrado o bloqueado, toma el control.</span>
          <button type="button" className="button secondary" onClick={() => { if (window.confirm('¿Tomar el control? La otra pestaña pasará a solo lectura.')) store.takeControl(); }}>Tomar el control</button>
        </div>}
        {state.status === 'conflict' && <div className="notice error-notice tab-conflict" role="alert">
          <span>Este torneo se ha modificado en otra pestaña o ventana. Para no perder datos, los cambios de esta pestaña están en pausa.</span>
          <button type="button" className="button secondary" onClick={() => store.reloadFromStorage()}>Cargar la otra versión</button>
          <button type="button" className="button secondary" onClick={() => { if (window.confirm('¿Sobrescribir la versión guardada por la otra pestaña con la de esta pestaña?')) store.overwrite(); }}>Mantener esta versión</button>
        </div>}
        {remoteSync === 'conflict' && !remoteConflict && <section className="notice error-notice tab-remote-conflict" role="alert">
          <strong>Conflicto de sincronización pendiente de comprobar</strong>
          <p>La sesión detectó una revisión distinta, pero todavía no ha podido recuperar sus detalles. Tus datos locales se conservan.</p>
          <div className="tab-remote-conflict-actions">
            <button type="button" className="button secondary" onClick={() => {
              if (!remoteToken || !tournament) return;
              setRemoteSync('checking');
              void getTabulationSnapshot(remoteToken, tournament.id).then((remote) => {
                if (!remote) {
                  remoteCursor.current = { id: tournament.id, revision: 0, localRevision: -1, inFlight: false };
                  setRemoteSync('checking');
                  return;
                }
                setRemoteConflict({ remote, localUpdatedAt: tournament.updatedAt });
                setRemoteSync('conflict');
              }).catch(() => setRemoteSync('offline'));
            }}>Volver a comprobar y resolver</button>
          </div>
        </section>}
        {remoteSync === 'conflict' && remoteConflict && remoteDifferences.length > 0 && <section className="notice error-notice tab-remote-conflict" role="alert" aria-labelledby="tab-remote-conflict-title">
          <div className="tab-remote-conflict-heading">
            <div>
              <strong id="tab-remote-conflict-title">Hay dos versiones distintas del torneo</strong>
              <p>La copia local y la de Neon se conservan. Revisa los valores divergentes y elige cuál debe prevalecer antes de continuar la sincronización.</p>
            </div>
            <span className="tab-remote-conflict-count">{remoteDifferences.length} {remoteDifferences.length === 1 ? 'diferencia' : 'diferencias'}</span>
          </div>
          {remoteDifferences.length ? <div className="tab-remote-diff-groups">
            {remoteDifferenceGroups.map(([group, items]) => <details className="tab-remote-diff-group" key={group} open>
              <summary><b>{group}</b><span>{items.length} {items.length === 1 ? 'cambio' : 'cambios'}</span></summary>
              <div className="tab-remote-diff-list">
                {items.map((difference) => <article className="tab-remote-diff-item" key={difference.path}>
                  <strong>{prettyDifferencePath(difference.path)}</strong>
                  <div className="tab-remote-diff-values">
                    <div><small>Este dispositivo</small><pre>{displayDifferenceValue(difference.localValue)}</pre></div>
                    <div><small>Neon</small><pre>{displayDifferenceValue(difference.remoteValue)}</pre></div>
                  </div>
                </article>)}
              </div>
            </details>)}
          </div> : null}
          <div className="tab-remote-conflict-actions">
            <button type="button" className="button secondary" onClick={recoverRemoteVersion}>Recuperar Neon</button>
            <button type="button" className="button secondary" onClick={() => { if (window.confirm('¿Publicar la copia de este dispositivo sobre la revisión remota? La copia remota actual quedará reemplazada, pero se conservará una copia local de seguridad.')) void publishLocalVersion(); }}>Publicar este dispositivo</button>
          </div>
        </section>}
        {remoteSync === 'error' && <Notice kind="error">No se ha podido confirmar el guardado en Neon. La copia local sigue disponible; revisa la conexión y vuelve a intentarlo.</Notice>}
        {remoteSync === 'offline' && apiConfigured && <Notice kind="warning">Sin conexión con Neon. Los cambios permanecen en el almacenamiento local y se intentarán sincronizar al recuperar la conexión. <button type="button" className="button secondary tab-retry" onClick={() => {
          setRemoteSync('checking');
          if (tournament && remoteToken) void getTabulationSnapshot(remoteToken, tournament.id).then((remote) => {
            if (remote) {
              setRemoteConflict({ remote, localUpdatedAt: tournament.updatedAt });
              setRemoteSync('conflict');
            } else {
              remoteCursor.current = { id: tournament.id, revision: 0, localRevision: -1, inFlight: false };
              setRemoteSync('checking');
            }
          }).catch(() => setRemoteSync('offline'));
        }}>Reintentar conexión</button></Notice>}
        {state.error && <Notice kind="error">{state.error}{state.status === 'error' && <> <button type="button" className="button secondary tab-retry" onClick={() => {
          if (store.flush()) notify('Guardado correctamente.');
        }}>Reintentar el guardado</button></>}</Notice>}
        {state.loadIssues.length > 0 && <Notice kind="warning">{state.loadIssues.join(' ')}</Notice>}
        {state.logIssues.length > 0 && <Notice kind="warning">{state.logIssues.join(' ')}</Notice>}
        {state.usageBytes > STORAGE_WARNING_BYTES && <Notice kind="warning">El almacenamiento del navegador está casi lleno ({(state.usageBytes / 1048576).toFixed(1)} MB). Exporta una copia y borra torneos que ya no necesites: el panel también guarda aquí su sesión.</Notice>}
        {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.message}</Notice>}
      </div>
      <ErrorBoundary resetKey={activeView} onError={onViewError}>
        {activeView === 'inicio' && <HomeView store={store} state={state} outcomes={outcomes} notify={notify} onNavigate={(id) => setView(id as ViewId)} onDeleteTournament={deleteTournament} />}
        {props && activeView === 'reglas' && <RulesView {...props} />}
        {props && activeView === 'participantes' && <ParticipantsView {...props} />}
        {props && activeView === 'rondas' && <RoundsView {...props} projection={projection} onProject={() => setProjection(true)} onNavigate={(id) => setView(id as ViewId)} />}
        {props && activeView === 'actas' && <BallotsView {...props} />}
        {props && activeView === 'clasificacion' && <StandingsView {...props} projection={projection} onProject={() => setProjection(true)} />}
        {props && activeView === 'registro' && <LogView {...props} />}
        {!props && activeView !== 'inicio' && <section className="panel tab-empty-workspace">
          <div className="panel-title"><div><h3>{VIEWS.find((item) => item.id === activeView)?.label ?? 'Tabulación'}</h3><p>Esta sección estará disponible cuando crees o importes un torneo.</p></div></div>
          <p className="muted">Ve a Inicio para crear un torneo nuevo o importar una copia de seguridad. La navegación permanece disponible para que puedas acceder directamente a cada apartado.</p>
          <button type="button" className="button primary" onClick={() => setView('inicio')}>Ir a Inicio</button>
        </section>}
      </ErrorBoundary>
      <footer className="footer tab-no-project"><span>Debate Control · Tabulación local · {BUILD_INFO}</span><span>Neon conserva la copia sincronizada; el navegador mantiene una copia local para trabajar sin conexión.</span></footer>
    </main>

    {operatorMissing && <div className="activation-backdrop operator-required-backdrop">
      <form className="activation-dialog operator-required-dialog" role="dialog" aria-modal="true" aria-labelledby="operator-required-title"
        onSubmit={(event) => { event.preventDefault(); const name = operatorDraft.trim(); if (name) store.setOperator(name); }}>
        <div className="activation-dialog-top"><span className="eyebrow">IDENTIFICACIÓN DE SESIÓN</span><span className="workspace-tag">OBLIGATORIO</span></div>
        <h2 id="operator-required-title">¿Quién está operando?</h2>
        <p>Antes de utilizar la aplicación, identifica a la persona responsable de esta sesión. El nombre quedará asociado a las acciones del registro de tabulación.</p>
        <label className="operator-required-label">Nombre del operador
          <input autoFocus required maxLength={60} value={operatorDraft} onChange={(event) => setOperatorDraft(event.target.value)} placeholder="Introduce tu nombre" />
        </label>
        <div className="activation-dialog-actions"><button className="button primary" type="submit" disabled={!operatorDraft.trim()}>Continuar</button></div>
      </form>
    </div>}
  </div>;
}
