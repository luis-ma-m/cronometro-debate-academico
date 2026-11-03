import { useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo } from 'react';
import { ChevronRight, ClipboardList, Download, ExternalLink, House, Lock, Projector, ScrollText, Shuffle, SlidersHorizontal, Trophy, Users, X } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { tournamentProgress } from './progress';
import { computeTournamentOutcomes } from './results';
import { STORAGE_WARNING_BYTES } from './store';
import { TournamentProgress } from './TournamentProgress';
import { isFallenAt, makeTabId, type PanelEntityIdMap } from './types';
import { apiConfigured, getTabulationPublishedRounds, getTabulationSettings, getTournament, saveTabulationSettings, saveTournament, publishTabulationSnapshot } from '../api';
import { MANAGER_SESSION_STORAGE_KEY, readManagerSession } from '../contracts/managerSession';
import { createApplicationBootstrap } from '../contracts/applicationBootstrap';
import { participantSnapshotFromTabulation } from '../contracts/participantSnapshot';
import { mergePublishedTabulationRounds } from '../contracts/tabulationPublishedRounds';
import { persistTabulationParticipantSnapshot } from '../contracts/tabulationParticipantSync';
import { activeTournamentContext } from '../contracts/activeTournamentContext';
import { createIndexedDbSyncOutboxRepository, createSyncOutbox } from './syncOutbox';
import type { PendingSyncOperation } from './syncOutbox';
import { createSyncOutboxWorker } from './syncOutboxWorker';
import { createTabulationSyncDispatcher, notifyTabulationSyncAcknowledged } from './syncDispatcher';
import { buildPanelHandoff, mergeHandoff, tournamentFromHandoff } from './panelBridge';
import { BUILD_INFO, exportTournamentCopy, hasUnsavedEditors, Notice, type NoticeKind, type ViewProps } from './ui';
import { getBrowserTabStore, useTabStore } from './useTabStore';

import { BallotsView } from './views/BallotsView';
import { HomeView } from './views/HomeView';
import { LogView } from './views/LogView';
import { ParticipantsView } from './views/ParticipantsView';
import { RoundsView } from './views/RoundsView';
import { RulesView } from './views/RulesView';
import { StandingsView } from './views/StandingsView';

const VIEWS = [
  { id: 'inicio', label: 'Inicio', icon: House },
  { id: 'reglas', label: 'Reglas', icon: SlidersHorizontal },
  { id: 'participantes', label: 'Participantes', icon: Users },
  { id: 'rondas', label: 'Rondas', icon: Shuffle },
  { id: 'actas', label: 'Actas', icon: ClipboardList },
  { id: 'clasificacion', label: 'Clasificación', icon: Trophy },
  { id: 'registro', label: 'Registro', icon: ScrollText },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

function readHashView(): ViewId {
  const id = window.location.hash.replace(/^#/, '').split('/')[0];
  return VIEWS.find((view) => view.id === id)?.id ?? 'inicio';
}

/** Even a failure of the shell itself (not only of one screen) leaves the data safe and offers the emergency copy. */
export default function TabulationApp({ embedded = false }: { embedded?: boolean } = {}) {
  const onError = (error: Error) => {
    try {
      getBrowserTabStore().logError('Fallo de la aplicación: ' + error.message);
    } catch { /* The crash screen still offers the emergency copy. */ }
  };
  return <ErrorBoundary resetKey="app" onError={onError} page><TabulationShell embedded={embedded} /></ErrorBoundary>;
}

function TabulationShell({ embedded }: { embedded: boolean }) {
  const store = getBrowserTabStore();
  const state = useTabStore(store);
  const [view, setViewState] = useState<ViewId>(readHashView);
  const [projection, setProjection] = useState(false);
  const [notice, setNotice] = useState<{ kind: NoticeKind; message: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [managerSession, setManagerSession] = useState(() => readManagerSession(window.localStorage));
  const [syncQueue, setSyncQueue] = useState<PendingSyncOperation[]>([]);
  const [managerConnection, setManagerConnection] = useState<{ connected: boolean; checkedAt: number | null; lastSuccessAt: number | null }>({ connected: false, checkedAt: null, lastSuccessAt: null });
  const [participantSyncPending, setParticipantSyncPending] = useState(false);
  const participantSyncTimer = useRef<number | null>(null);
  const participantSyncInFlight = useRef(false);
  const participantSyncPromise = useRef<Promise<boolean> | null>(null);
  const participantSyncBlocked = useRef(false);
  const tabSettingsRevision = useRef<number | null>(null);
  const tabSettingsHydrated = useRef(false);
  const tabSettingsPending = useRef(false);
  const tabSettingsSyncInFlight = useRef(false);
  const tabSettingsSyncBlocked = useRef(false);
  const tabSettingsSyncTimer = useRef<number | null>(null);
  const remoteParticipantRefreshInFlight = useRef(false);
  const tournament = state.tournament;
  const activeTournament = useMemo(() => {
    const remoteId = tournament?.panelLink?.remoteId;
    if (!remoteId || !tournament) return null;
    try {
      return activeTournamentContext(
        remoteId,
        tournament.panelLink?.remoteRevision ?? 0,
        'server',
        tournament.panelLink?.remoteUpdatedAt ?? tournament.updatedAt,
      );
    } catch {
      return null;
    }
  }, [tournament?.panelLink?.remoteId, tournament?.panelLink?.remoteRevision, tournament?.panelLink?.remoteUpdatedAt, tournament?.updatedAt]);
  const tabulationParticipants = useMemo(() => {
    if (!tournament || !activeTournament || !tournament.panelLink?.idMap) return null;
    const stored = tournament.panelLink.idMap;
    const idMap: PanelEntityIdMap = tournament.panelLink.identityMode === 'local-canonical' ? {
      teams: { ...stored.teams, ...Object.fromEntries(tournament.teams.map((item) => [item.id, item.id])) },
      speakers: { ...stored.speakers, ...Object.fromEntries(tournament.speakers.map((item) => [item.id, item.id])) },
      judges: { ...stored.judges, ...Object.fromEntries(tournament.judges.map((item) => [item.id, item.id])) },
      venues: { ...stored.venues, ...Object.fromEntries(tournament.venues.map((item) => [item.id, item.id])) },
    } : stored;
    try {
      return participantSnapshotFromTabulation(activeTournament, {
        teams: tournament.teams,
        speakers: tournament.speakers,
        judges: tournament.judges,
        venues: tournament.venues,
      }, idMap);
    } catch {
      return null;
    }
  }, [tournament, activeTournament]);
  const applicationBootstrap = useMemo(() => createApplicationBootstrap({
    session: managerSession,
    activeTournament,
    participants: tabulationParticipants,
  }), [managerSession, activeTournament, tabulationParticipants]);

  useEffect(() => {
    const refreshSession = () => {
      const next = readManagerSession(window.localStorage);
      setManagerSession((current) => current?.token === next?.token && current?.expiresAt === next?.expiresAt ? current : next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === MANAGER_SESSION_STORAGE_KEY) refreshSession();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refreshSession);
    document.addEventListener('visibilitychange', refreshSession);
    // A same-tab login/refresh does not emit a StorageEvent. Re-read the
    // session periodically so a paused outbox worker can resume without reload.
    const interval = window.setInterval(refreshSession, 15000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refreshSession);
      document.removeEventListener('visibilitychange', refreshSession);
      window.clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    if (!apiConfigured || !applicationBootstrap.session?.token || !applicationBootstrap.activeTournament || state.readOnly) {
      setSyncQueue([]);
      return;
    }
    let disposed = false;
    let outbox: ReturnType<typeof createSyncOutbox>;
    try {
      outbox = createSyncOutbox(createIndexedDbSyncOutboxRepository());
    } catch (error) {
      store.logError(error instanceof Error ? error.message : 'No se pudo abrir la cola offline.');
      return;
    }
    const worker = createSyncOutboxWorker({
      outbox,
      tournamentId: applicationBootstrap.activeTournament.tournamentId,
      workerId: makeTabId('sync-worker'),
      dispatch: createTabulationSyncDispatcher({ token: applicationBootstrap.session.token }),
      onQueueChange: (operations) => { if (!disposed) setSyncQueue(operations); },
      onAcknowledged: (operation, response) => {
        if (disposed) return;
        notifyTabulationSyncAcknowledged(operation, response);
        if (operation.operation === 'publish-round' && operation.entityType === 'round'
          && response && typeof response === 'object' && !Array.isArray(response)) {
          const published = response as { roundId?: unknown; revision?: unknown; updatedAt?: unknown; debateAssignments?: unknown };
          const payload = operation.payload && typeof operation.payload === 'object' && !Array.isArray(operation.payload)
            ? operation.payload as { tabulationRoundId?: unknown } : {};
          if (typeof published.roundId === 'string' && typeof payload.tabulationRoundId === 'string'
            && Array.isArray(published.debateAssignments)) {
            const assignmentByDebate = new Map<string, string>();
            for (const item of published.debateAssignments) {
              if (item && typeof item === 'object' && 'tabulationDebateId' in item && 'assignmentId' in item
                && typeof item.tabulationDebateId === 'string' && typeof item.assignmentId === 'string') {
                assignmentByDebate.set(item.tabulationDebateId, item.assignmentId);
              }
            }
            store.update((current) => ({
              ...current,
              panelLink: current.panelLink ? {
                ...current.panelLink,
                ...(typeof published.revision === 'number' ? { remoteRevision: published.revision } : {}),
                ...(typeof published.updatedAt === 'number' ? { remoteUpdatedAt: published.updatedAt } : {}),
              } : current.panelLink,
              rounds: current.rounds.map((round) => round.id !== payload.tabulationRoundId ? round : ({
                ...round, managerRoundId: published.roundId as string, pushedAt: Date.now(),
                debates: round.debates.map((debate) => ({
                  ...debate,
                  ...(assignmentByDebate.has(debate.id) ? { managerAssignmentId: assignmentByDebate.get(debate.id) } : {}),
                })),
              })),
            }), { type: 'sync.ack', message: 'Ronda y asignaciones canónicas confirmadas por Neon', details: { operationId: operation.operationId } });
          }
        }
        store.log({
          type: 'sync.ack',
          message: operation.operation === 'replace-acta'
            ? 'Acta oficial confirmada por el Gestor · ' + operation.entityId
            : 'Ronda confirmada por el Gestor · ' + operation.entityId,
          details: { operationId: operation.operationId, entityType: operation.entityType, entityId: operation.entityId },
        });
      },
      onError: (error) => { if (!disposed) store.logError(error instanceof Error ? error.message : 'Error en la cola offline.'); },
    });
    worker.start();
    return () => { disposed = true; worker.stop(); };
  }, [applicationBootstrap.session?.token, applicationBootstrap.activeTournament?.tournamentId, state.readOnly, store]);

  useEffect(() => {
    const onHashChange = () => setViewState(readHashView());
    window.addEventListener('hashchange', onHashChange);
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => { window.removeEventListener('hashchange', onHashChange); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let disposed = false;
    let checking = false;
    let activeController: AbortController | null = null;
    const checkManagerConnection = async () => {
      // Do not overlap polls or let a slow response overwrite a newer result.
      if (disposed || checking || document.visibilityState === 'hidden') return;
      checking = true;
      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch('/api?action=health', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Health check failed');
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('ok' in body) || (body as { ok?: unknown }).ok !== true) {
          throw new Error('Health check failed');
        }
        const at = Date.now();
        if (!disposed && activeController === controller) {
          setManagerConnection({ connected: true, checkedAt: at, lastSuccessAt: at });
        }
      } catch {
        if (!disposed && activeController === controller) {
          setManagerConnection((current) => ({ ...current, connected: false, checkedAt: Date.now() }));
        }
      } finally {
        window.clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        checking = false;
      }
    };
    void checkManagerConnection();
    const interval = window.setInterval(() => void checkManagerConnection(), 15000);
    const onOnline = () => void checkManagerConnection();
    const onFocus = () => void checkManagerConnection();
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void checkManagerConnection(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      activeController?.abort();
      window.clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
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
    document.title = (tournament ? tournament.name + ' · ' : '') + 'Tabulación · Debate Control';
  }, [tournament?.name]);
  useEffect(() => {
    if (!projection) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setProjection(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projection]);

  const setView = useCallback((id: ViewId) => {
    window.location.hash = id;
    setViewState(id);
    setNotice(null);
  }, []);
  const notify = useCallback((message: string, kind: NoticeKind = 'success') => setNotice({ message, kind }), []);
  const syncParticipantDomain = useCallback(async (): Promise<boolean> => {
    const token = managerSession?.token;
    const local = store.getState().tournament;
    const remoteId = local?.panelLink?.remoteId;
    const storedIdMap = local?.panelLink?.idMap;
    if (!apiConfigured || !token || !local || !remoteId || !storedIdMap || participantSyncBlocked.current) return false;
    if (participantSyncInFlight.current) return participantSyncPromise.current ?? false;
    const idMap: PanelEntityIdMap = local.panelLink?.identityMode === 'local-canonical' ? {
      teams: { ...storedIdMap.teams, ...Object.fromEntries(local.teams.map((item) => [item.id, item.id])) },
      speakers: { ...storedIdMap.speakers, ...Object.fromEntries(local.speakers.map((item) => [item.id, item.id])) },
      judges: { ...storedIdMap.judges, ...Object.fromEntries(local.judges.map((item) => [item.id, item.id])) },
      venues: { ...storedIdMap.venues, ...Object.fromEntries(local.venues.map((item) => [item.id, item.id])) },
    } : storedIdMap;
    participantSyncInFlight.current = true;
    const run = (async () => {
      try {
        const context = activeTournamentContext(remoteId, local.panelLink?.remoteRevision ?? 0, 'server', local.panelLink?.remoteUpdatedAt ?? local.updatedAt);
        const snapshot = participantSnapshotFromTabulation(context, {
          teams: local.teams, speakers: local.speakers, judges: local.judges, venues: local.venues,
        }, idMap);
        const result = await persistTabulationParticipantSnapshot(token, snapshot, local.panelLink?.remoteRevision, {
          getTournament,
          saveTournament,
        });
        const saved = result.tournament;
        window.localStorage.removeItem('ledu-tabulation-participant-sync-pending:' + remoteId);
        setParticipantSyncPending(false);
        store.update((current) => ({
          ...current,
          panelLink: current.panelLink ? { ...current.panelLink, remoteRevision: saved.revision, remoteUpdatedAt: saved.updatedAt } : current.panelLink,
        }), { type: 'sync.ack', message: result.changed ? 'Participantes confirmados en Neon' : 'Participantes ya sincronizados', details: { revision: saved.revision } });
        if (result.changed) store.log({ type: 'sync.ack', message: 'Participantes, oradores, jueces e incompatibilidades confirmados en Neon', details: { revision: saved.revision, tournamentId: remoteId } });
        setManagerConnection((current) => ({ ...current, connected: true, checkedAt: Date.now(), lastSuccessAt: Date.now() }));
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se han podido sincronizar los participantes con Neon.';
        if (message.startsWith('Conflicto de sincronización:')) participantSyncBlocked.current = true;
        store.logError(message);
        notify(message + ' Los cambios locales siguen guardados en este navegador.', 'error');
        return false;
      } finally {
        participantSyncInFlight.current = false;
      }
    })();
    participantSyncPromise.current = run;
    try { return await run; }
    finally { if (participantSyncPromise.current === run) participantSyncPromise.current = null; }
  }, [managerSession?.token, store, notify]);
  const syncTabulationSettings = useCallback(async () => {
    const token = managerSession?.token;
    const local = store.getState().tournament;
    const remoteId = local?.panelLink?.remoteId;
    if (!apiConfigured || !token || !remoteId || !tabSettingsHydrated.current
      || tabSettingsRevision.current === null || tabSettingsSyncInFlight.current || tabSettingsSyncBlocked.current) return;
    tabSettingsSyncInFlight.current = true;
    const settings = local.settings;
    try {
      const saved = await saveTabulationSettings(token, tabSettingsRevision.current, settings, makeTabId('settings-op'));
      if (saved.tournamentId !== remoteId) throw new Error('Las reglas confirmadas pertenecen a otro torneo.');
      tabSettingsRevision.current = saved.revision;
      tabSettingsPending.current = false;
      setManagerConnection((current) => ({ ...current, connected: true, checkedAt: Date.now(), lastSuccessAt: Date.now() }));
      store.log({ type: 'sync.ack', message: 'Reglas de Tabulación confirmadas en Neon', details: { revision: saved.revision } });
      const latest = store.getState().tournament;
      if (latest && JSON.stringify(latest.settings) !== JSON.stringify(settings)) {
        tabSettingsPending.current = true;
        if (tabSettingsSyncTimer.current !== null) window.clearTimeout(tabSettingsSyncTimer.current);
        tabSettingsSyncTimer.current = window.setTimeout(() => {
          tabSettingsSyncTimer.current = null;
          void syncTabulationSettings();
        }, 250);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se han podido sincronizar las reglas con Neon.';
      tabSettingsPending.current = true;
      if (message.startsWith('Las reglas han cambiado') || message.includes('REVISION_CONFLICT')) tabSettingsSyncBlocked.current = true;
      store.logError(message);
      notify(message + ' No se ha sobrescrito la versión remota.', 'error');
    } finally {
      tabSettingsSyncInFlight.current = false;
    }
  }, [managerSession?.token, store, notify]);
  useEffect(() => {
    const token = managerSession?.token;
    const remoteId = activeTournament?.tournamentId;
    if (!apiConfigured || !token || !remoteId) {
      tabSettingsHydrated.current = false;
      tabSettingsRevision.current = null;
      return;
    }
    let disposed = false;
    const hydrate = async () => {
      try {
        const remote = await getTabulationSettings(token);
        if (disposed) return;
        if (remote.tournamentId !== remoteId) throw new Error('Las reglas remotas pertenecen a otro torneo.');
        const local = store.getState().tournament;
        if (!local) return;
        tabSettingsRevision.current = remote.revision;
        if (JSON.stringify(local.settings) !== JSON.stringify(remote.settings)) {
          if (store.getState().status === 'dirty') {
            tabSettingsSyncBlocked.current = true;
            notify('Hay reglas locales pendientes y una versión remota distinta. No he sobrescrito ninguna; exporta una copia y resuelve el conflicto.', 'error');
            return;
          }
          store.backup('Antes de recuperar las reglas oficiales de Neon');
          store.update((current) => ({ ...current, settings: remote.settings }), {
            type: 'sync.remote', message: 'Reglas oficiales recuperadas desde Neon', details: { revision: remote.revision },
          });
        }
        tabSettingsSyncBlocked.current = false;
        tabSettingsHydrated.current = true;
      } catch (error) {
        if (!disposed) {
          store.logError(error instanceof Error ? error.message : 'No se pudieron recuperar las reglas de Neon.');
          notify('No se han podido recuperar las reglas oficiales. No edites reglas hasta restablecer la conexión.', 'error');
        }
      }
    };
    void hydrate();
    return () => { disposed = true; };
  }, [managerSession?.token, activeTournament?.tournamentId, store, notify]);
  useEffect(() => {
    const retry = () => {
      if (tabSettingsPending.current && tabSettingsHydrated.current && !tabSettingsSyncBlocked.current) {
        void syncTabulationSettings();
      }
    };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
    };
  }, [syncTabulationSettings]);
  const refreshRemoteParticipants = useCallback(async () => {
    const token = managerSession?.token;
    if (!apiConfigured || !token || remoteParticipantRefreshInFlight.current || participantSyncInFlight.current) return;
    remoteParticipantRefreshInFlight.current = true;
    try {
      const remote = await getTournament(token);
      if (!remote.remoteId) return;
      const handoff = buildPanelHandoff(remote);
      const publishedRounds = await getTabulationPublishedRounds(token, remote.remoteId);
      const local = store.getState().tournament;
      if (!local) {
        const created = mergePublishedTabulationRounds(tournamentFromHandoff(handoff, 'ledu-groups'), publishedRounds);
        store.create(created);
        return;
      }
      if (local.panelLink?.remoteId !== remote.remoteId) return;
      if (local.panelLink.remoteRevision === remote.revision
        && local.panelLink.remoteUpdatedAt === remote.updatedAt) return;
      const pendingKey = 'ledu-tabulation-participant-sync-pending:' + remote.remoteId;
      if (window.localStorage.getItem(pendingKey)) {
        setParticipantSyncPending(true);
        participantSyncBlocked.current = true;
        notify('Neon contiene una revisión más reciente mientras hay cambios locales pendientes. No he fusionado ni sobrescrito ninguna versión; resuelve el conflicto antes de continuar.', 'error');
        return;
      }
      const merged = mergeHandoff(local, handoff);
      if (merged.issues.length) {
        notify(merged.issues.join(' '), 'error');
        return;
      }
      const withPublishedRounds = mergePublishedTabulationRounds(merged.tournament, publishedRounds);
      const roundsChanged = JSON.stringify(local.rounds) !== JSON.stringify(withPublishedRounds.rounds);
      if (merged.added || merged.updated || local.panelLink?.remoteRevision !== remote.revision || roundsChanged) {
        store.update(() => ({
          ...withPublishedRounds,
          panelLink: withPublishedRounds.panelLink ? {
            ...withPublishedRounds.panelLink, remoteRevision: remote.revision, remoteUpdatedAt: remote.updatedAt,
          } : withPublishedRounds.panelLink,
        }), {
          type: 'sync.remote',
          message: roundsChanged ? 'Rondas, asignaciones y actas oficiales actualizadas desde Neon' : 'Participantes actualizados desde Neon',
          details: { revision: remote.revision, added: merged.added, updated: merged.updated, rounds: publishedRounds.length },
        });
        store.log({ type: 'sync.remote', message: 'Snapshot canónico recibido desde Neon', details: { revision: remote.revision, added: merged.added, updated: merged.updated, rounds: publishedRounds.length } });
      }
    } catch (error) {
      store.logError(error instanceof Error ? error.message : 'No se pudo actualizar el snapshot remoto de participantes.');
    } finally {
      remoteParticipantRefreshInFlight.current = false;
    }
  }, [managerSession?.token, store, notify]);
  useEffect(() => {
    if (!apiConfigured || !managerSession?.token) return;
    let disposed = false;
    const refresh = () => {
      if (!disposed && document.visibilityState !== 'hidden') void refreshRemoteParticipants();
    };
    refresh();
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [managerSession?.token, refreshRemoteParticipants]);
  const authoritativePublication = useRef<{ timerId: string; inFlight: boolean; expectedRevision: number } | null>(null);
  const publishAuthoritativeSnapshot = useCallback(async (candidate: import('./types').TabTournament) => {
    const token = managerSession?.token;
    if (!apiConfigured || !token || candidate.sample) return;
    const current = authoritativePublication.current;
    if (current?.inFlight) return;
    const stateRevision = current?.timerId === candidate.id ? current.expectedRevision : 0;
    authoritativePublication.current = { timerId: candidate.id, inFlight: true, expectedRevision: stateRevision };
    const operationId = makeTabId('tabpub');
    try {
      const result = await publishTabulationSnapshot(token, {
        tabTournamentId: candidate.id,
        expectedRevision: stateRevision,
        operationId,
        snapshot: candidate,
      });
      if (result.tabTournamentId !== candidate.id || result.snapshot.id !== candidate.id
        || result.revision !== stateRevision + 1 || !/^[a-f0-9]{64}$/.test(result.snapshotSha256)) {
        throw new Error('El servidor devolvió una identidad, revisión o hash de snapshot incoherente.');
      }
      authoritativePublication.current = { timerId: candidate.id, inFlight: false, expectedRevision: result.revision };
      store.log({ type: 'sync.ack', message: 'Snapshot íntegro publicado en Neon', details: {
        tabTournamentId: candidate.id, revision: result.revision, snapshotSha256: result.snapshotSha256,
      } });
      setManagerConnection((current) => ({ ...current, connected: true, checkedAt: Date.now(), lastSuccessAt: Date.now() }));
    } catch (error) {
      authoritativePublication.current = { timerId: candidate.id, inFlight: false, expectedRevision: stateRevision };
      store.logError(error instanceof Error ? error.message : 'No se pudo publicar el snapshot autoritativo.');
      notify((error instanceof Error ? error.message : 'No se pudo publicar el snapshot autoritativo.')
        + ' La copia local sigue disponible; Gestión no debe considerar publicada esta revisión.', 'error');
    }
  }, [managerSession?.token, store, notify]);
  useEffect(() => {
    if (!tournament || state.readOnly || state.status !== 'saved' || tournament.sample) return;
    const token = managerSession?.token;
    if (!apiConfigured || !token) return;
    if (authoritativePublication.current?.timerId === tournament.id
      && authoritativePublication.current.expectedRevision >= tournament.revision) return;
    void publishAuthoritativeSnapshot(tournament);
  }, [tournament?.id, tournament?.revision, state.status, state.readOnly, managerSession?.token, publishAuthoritativeSnapshot]);
  const update = useCallback<ViewProps['update']>((mutator, meta) => {
    const before = store.getState().tournament;
    const applied = store.update(mutator, meta);
    if (!applied) {
      const current = store.getState();
      notify(current.readOnly ? 'Esta pestaña es de solo lectura: pulsa «Tomar el control» para hacer cambios.'
        : current.status === 'conflict' ? 'Resuelve antes el conflicto con la otra pestaña.'
          : current.error ?? 'No se ha podido aplicar el cambio.', 'error');
    } else {
      const after = store.getState().tournament;
      const participantsChanged = Boolean(before && after && (
        before.teams !== after.teams || before.speakers !== after.speakers
        || before.judges !== after.judges || before.venues !== after.venues
      ));
      const tabSettingsChanged = Boolean(before && after && before.settings !== after.settings);
      if (tabSettingsChanged && after?.panelLink?.remoteId && tabSettingsHydrated.current && !tabSettingsSyncBlocked.current) {
        tabSettingsPending.current = true;
        if (tabSettingsSyncTimer.current !== null) window.clearTimeout(tabSettingsSyncTimer.current);
        tabSettingsSyncTimer.current = window.setTimeout(() => {
          tabSettingsSyncTimer.current = null;
          void syncTabulationSettings();
        }, 700);
      }
      if (participantsChanged && after?.panelLink?.remoteId) {
        participantSyncBlocked.current = false;
        try { window.localStorage.setItem('ledu-tabulation-participant-sync-pending:' + after.panelLink.remoteId, String(Date.now())); } catch { /* IndexedDB remains the local data store. */ }
        setParticipantSyncPending(true);
        if (participantSyncTimer.current !== null) window.clearTimeout(participantSyncTimer.current);
        participantSyncTimer.current = window.setTimeout(() => { participantSyncTimer.current = null; void syncParticipantDomain(); }, 800);
      }
    }
    return applied;
  }, [store, notify, syncParticipantDomain, syncTabulationSettings]);
  useEffect(() => {
    const remoteId = store.getState().tournament?.panelLink?.remoteId;
    if (!remoteId || !window.localStorage.getItem('ledu-tabulation-participant-sync-pending:' + remoteId)) return;
    setParticipantSyncPending(true);
    void syncParticipantDomain();
    const retry = () => { participantSyncBlocked.current = false; void syncParticipantDomain(); };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
      if (participantSyncTimer.current !== null) window.clearTimeout(participantSyncTimer.current);
    };
  }, [store, syncParticipantDomain]);
  const onViewError = useCallback((error: Error, info: ErrorInfo) => {
    store.logError('Fallo de la pantalla: ' + error.message, { stack: (info.componentStack ?? '').slice(0, 2000) });
  }, [store]);
  const outcomes = useMemo(() => (tournament ? computeTournamentOutcomes(tournament) : new Map()), [tournament]);
  const activeView: ViewId = tournament ? view : 'inicio';
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
  const badges: Partial<Record<ViewId, { text: string; kind: string; title: string }>> = {
    ...(tournament?.draftRound ? { rondas: { text: 'Borrador', kind: 'info', title: 'Hay un borrador de ronda pendiente de confirmar' } } : {}),
    ...(pendingActas ? { actas: { text: String(pendingActas), kind: 'warn', title: pendingActas + ' actas pendientes' } } : {}),
  };

  const exportCopy = () => {
    if (exportTournamentCopy(store) !== null) notify('Copia exportada con el registro. Guárdala fuera del navegador: es la única forma de recuperar el torneo si se borran los datos del sitio.');
  };

  const saveLabel = state.readOnly ? 'Solo lectura'
    : state.status === 'dirty' ? 'Guardando…'
      : state.status === 'conflict' ? 'Conflicto con otra pestaña'
        : state.status === 'error' ? 'Error al guardar'
          : state.lastSavedAt ? 'Guardado en este navegador · hace ' + Math.max(0, Math.round((now - state.lastSavedAt) / 1000)) + ' s'
            : tournament ? 'Guardado en este navegador' : 'Sin torneo abierto';

  const props: ViewProps | null = tournament ? { tournament, outcomes, update, notify, store, managerSessionToken: applicationBootstrap.session?.token, syncParticipants: syncParticipantDomain } : null;

  return <div className={'app-shell tab-shell' + (projection ? ' tab-projection' : '') + (embedded ? ' tab-embedded' : '')}>
    {!embedded && <aside className="sidebar">
      <div className="brand"><span className="brand-mark">T</span><span>Debate <b>Tabulación</b></span></div>
      <div className="sidebar-section">TABULACIÓN LOCAL</div>
      <nav>{VIEWS.map((item) => {
        const Icon = item.icon;
        const badge = badges[item.id];
        return <button key={item.id} type="button" className={'nav-button ' + (activeView === item.id ? 'selected' : '')} disabled={!tournament && item.id !== 'inicio'} onClick={() => setView(item.id)}>
          <Icon size={18} /><span>{item.label}</span>{badge && <em className={'nav-badge ' + badge.kind} title={badge.title}>{badge.text}</em>}<ChevronRight size={15} />
        </button>;
      })}</nav>
      <div className="sidebar-bottom">
        {syncQueue.length > 0 && <div className="muted tab-sync-queue" role="status" aria-live="polite">
          Cola offline: {syncQueue.filter((item) => item.status === 'pending').length} pendiente(s), {syncQueue.filter((item) => item.status === 'sending').length} en curso, {syncQueue.filter((item) => item.status === 'conflict').length} conflicto(s), {syncQueue.filter((item) => item.status === 'failed').length} error(es).
          {syncQueue.find((item) => item.status === 'conflict' || item.status === 'failed')?.lastError?.message ?? ''}
        </div>}
        <div className={'tab-manager-connection ' + (managerConnection.connected ? 'is-connected' : 'is-disconnected')} role="status" aria-live="polite">
          <span><span className="tab-manager-connection-dot" />{managerConnection.connected ? 'API, Neon y Redis disponibles' : 'Sin conexión con el servidor'}</span>
          <small>{managerConnection.lastSuccessAt ? 'Último health correcto hace ' + Math.max(0, Math.floor((now - managerConnection.lastSuccessAt) / 1000)) + ' s' : managerConnection.checkedAt ? 'Sin conexión confirmada' : 'Comprobando disponibilidad…'}</small>
        </div>
        <span className={'connection-dot' + (state.status === 'conflict' || state.status === 'error' || state.readOnly ? ' tab-dot-error' : '')} />
        <span>{saveLabel}</span>
        <span className="tab-operator">Operador: {state.operator || 'sin nombre'}</span>
        <a className="sidebar-logout" href="/"><ExternalLink size={16} /> Panel de organización</a>
      </div>
    </aside>}
    <main className="main-area">
      {embedded && <nav className="tab-embedded-nav" aria-label="Secciones de tabulación">{VIEWS.map((item) => {
        const Icon = item.icon;
        return <button key={item.id} type="button" className={'nav-button ' + (activeView === item.id ? 'selected' : '')} disabled={!tournament && item.id !== 'inicio'} onClick={() => setView(item.id)}>
          <Icon size={17} /><span>{item.label}</span>
        </button>;
      })}</nav>}
      {embedded && participantSyncPending && <div className="notice warning-notice" role="status" aria-live="polite">Cambios de participantes pendientes de confirmación en Neon. La copia local se conserva y se reintentará al recuperar la conexión; si hay conflicto de revisión, no se sobrescriben datos remotos.</div>}
      <header className="topbar">
        <div><span className="eyebrow">TABULACIÓN LOCAL · SIN CONEXIÓN AL SERVIDOR</span><h1>{tournament?.name ?? 'Tabulación de debate académico'}</h1></div>
        {tournament && <div className="top-actions tab-no-project">
          <span className="live-status"><i className={state.status === 'conflict' || state.status === 'error' || state.readOnly ? 'disconnected' : ''} /> {saveLabel}</span>
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
        {state.error && <Notice kind="error">{state.error}{state.status === 'error' && <> <button type="button" className="button secondary tab-retry" onClick={() => {
          if (store.flush()) notify('Guardado correctamente.');
        }}>Reintentar el guardado</button></>}</Notice>}
        {state.loadIssues.length > 0 && <Notice kind="warning">{state.loadIssues.join(' ')}</Notice>}
        {state.logIssues.length > 0 && <Notice kind="warning">{state.logIssues.join(' ')}</Notice>}
        {state.usageBytes > STORAGE_WARNING_BYTES && <Notice kind="warning">El almacenamiento del navegador está casi lleno ({(state.usageBytes / 1048576).toFixed(1)} MB). Exporta una copia y borra torneos que ya no necesites: el panel también guarda aquí su sesión.</Notice>}
        {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.message}</Notice>}
      </div>
      <ErrorBoundary resetKey={activeView} onError={onViewError}>
        <div hidden={activeView !== 'inicio'}><HomeView store={store} state={state} outcomes={outcomes} notify={notify} onNavigate={(id) => setView(id as ViewId)} /></div>
        {props && activeView === 'reglas' && <RulesView {...props} />}
        {props && activeView === 'participantes' && <ParticipantsView {...props} />}
        {props && activeView === 'rondas' && <RoundsView {...props} projection={projection} onProject={() => setProjection(true)} onNavigate={(id) => setView(id as ViewId)} />}
        {props && activeView === 'actas' && <BallotsView {...props} />}
        {props && activeView === 'clasificacion' && <StandingsView {...props} projection={projection} onProject={() => setProjection(true)} />}
        {props && activeView === 'registro' && <LogView {...props} />}
      </ErrorBoundary>
      <footer className="footer tab-no-project"><span>Debate Control · Tabulación local · {BUILD_INFO}</span><span>Los datos se guardan solo en este navegador. Exporta copias con regularidad.</span></footer>
    </main>
  </div>;
}
