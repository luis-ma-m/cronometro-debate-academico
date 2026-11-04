import { useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo } from 'react';
import { ChevronRight, ClipboardList, Download, ExternalLink, House, Lock, Projector, ScrollText, Shuffle, SlidersHorizontal, Trophy, Users, X } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { tournamentProgress } from './progress';
import { computeTournamentOutcomes } from './results';
import { STORAGE_WARNING_BYTES } from './store';
import { TournamentProgress } from './TournamentProgress';
import { isFallenAt, makeTabId } from './types';
import { apiConfigured, getTabulationSnapshot, listTabulationSnapshots, publishTabulationSnapshot } from '../api';
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
export type TabulationViewId = (typeof VIEWS)[number]['id'];
type ViewId = TabulationViewId;

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
  const [now, setNow] = useState(() => Date.now());
  const [operatorDraft, setOperatorDraft] = useState(state.operator);
  const [remoteSync, setRemoteSync] = useState<'checking' | 'synced' | 'offline' | 'conflict' | 'error'>('checking');
  const [remoteConflict, setRemoteConflict] = useState<{ remote: import('../api').AuthoritativeTabulationSnapshot; localUpdatedAt: number } | null>(null);
  const remoteCursor = useRef<{ id: string; revision: number; localRevision: number; inFlight: boolean } | null>(null);
  const initialRecovery = useRef(false);
  const componentAlive = useRef(true);
  useEffect(() => { componentAlive.current = true; return () => { componentAlive.current = false; }; }, []);
  const remoteToken = useMemo(() => {
    try {
      const session = JSON.parse(localStorage.getItem('ledu-admin-session') || 'null') as { token?: string; expiresAt?: number } | null;
      return session?.token && (session.expiresAt ?? 0) > Date.now() ? session.token : null;
    } catch { return null; }
  }, []);
  const tournament = state.tournament;
  const operatorMissing = !state.operator.trim();
  useEffect(() => { if (state.operator.trim()) setOperatorDraft(state.operator); }, [state.operator]);

  // Neon is the durable source of truth. localStorage remains an offline cache and recovery copy.
  useEffect(() => {
    if (!apiConfigured || !remoteToken || initialRecovery.current) {
      if (!apiConfigured || !remoteToken) setRemoteSync('offline');
      return;
    }
    initialRecovery.current = true;
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
          if (tournament && !remoteCursor.current) {
            remoteCursor.current = { id: tournament.id, revision: 0, localRevision: -1, inFlight: false };
          }
          setRemoteSync('error');
          store.logError(error instanceof Error ? error.message : 'No se pudo recuperar Tabulación desde Neon.');
        }
      }
    };
    void recover();
    return () => { cancelled = true; };
  }, [apiConfigured, remoteToken, tournament?.id, store]);

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

  useEffect(() => {
    if (!apiConfigured || !remoteToken || !tournament || remoteSync === 'conflict') return;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const remote = await getTabulationSnapshot(remoteToken, tournament.id);
        const cursor = remoteCursor.current;
        if (!cursor) return;
        if (!remote) {
          if (cursor.localRevision !== tournament.revision) setRemoteSync('checking');
          return;
        }
        if (remote.revision <= cursor.revision) {
          if (cursor.localRevision !== tournament.revision) setRemoteSync('checking');
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
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => { window.removeEventListener('hashchange', onHashChange); window.clearInterval(timer); };
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
  const badges: Partial<Record<ViewId, { text: string; kind: string; title: string }>> = {
    ...(tournament?.draftRound ? { rondas: { text: 'Borrador', kind: 'info', title: 'Hay un borrador de ronda pendiente de confirmar' } } : {}),
    ...(pendingActas ? { actas: { text: String(pendingActas), kind: 'warn', title: pendingActas + ' actas pendientes' } } : {}),
  };

  const exportCopy = () => {
    if (exportTournamentCopy(store) !== null) notify('Copia exportada con el registro. Guárdala fuera del navegador como respaldo adicional a la sincronización con Neon.');
  };

  const saveLabel = remoteSync === 'synced' ? 'Sincronizado con Neon' : remoteSync === 'checking' ? 'Sincronizando…' : remoteSync === 'conflict' ? 'Conflicto entre dispositivos' : remoteSync === 'offline' ? 'Sin conexión con Neon' : remoteSync === 'error' ? 'Error de sincronización' : state.readOnly ? 'Solo lectura'
    : state.status === 'dirty' ? 'Guardando…'
      : state.status === 'conflict' ? 'Conflicto con otra pestaña'
        : state.status === 'error' ? 'Error al guardar'
          : state.lastSavedAt ? 'Guardado en este navegador · hace ' + Math.max(0, Math.round((now - state.lastSavedAt) / 1000)) + ' s'
            : tournament ? 'Guardado en este navegador' : 'Sin torneo abierto';

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
        <span className={'connection-dot' + (state.status === 'conflict' || state.status === 'error' || state.readOnly ? ' tab-dot-error' : '')} />
        <span>{saveLabel}</span>
        <span className="tab-operator">Operador: {state.operator || 'sin nombre'}</span>
        <a className="sidebar-logout" href="/"><ExternalLink size={16} /> Panel de organización</a>
      </div>
    </aside>}
    <main className="main-area">
      <header className="topbar">
        <div><span className="eyebrow">TABULACIÓN · ESPACIO DE COMPETICIÓN</span><h1>{tournament?.name ?? 'Tabulación de debate académico'}</h1></div>
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
        {remoteSync === 'conflict' && remoteConflict && <div className="notice error-notice" role="alert">
          <span>Hay dos versiones distintas del torneo. La copia local y la de Neon se conservan; elige cuál debe prevalecer antes de seguir sincronizando.</span>
          <button type="button" className="button secondary" onClick={recoverRemoteVersion}>Recuperar Neon</button>
          <button type="button" className="button secondary" onClick={() => { if (window.confirm('¿Publicar la copia de este dispositivo sobre la revisión remota? La copia remota actual quedará reemplazada, pero se conservará una copia local de seguridad.')) void publishLocalVersion(); }}>Publicar este dispositivo</button>
        </div>}
        {remoteSync === 'error' && <Notice kind="error">No se ha podido confirmar el guardado en Neon. La copia local sigue disponible; revisa la conexión y vuelve a intentarlo.</Notice>}
        {remoteSync === 'offline' && apiConfigured && <Notice kind="warning">Sin conexión con Neon. Los cambios permanecen en el almacenamiento local y se intentarán sincronizar al recuperar la conexión.</Notice>}
        {state.error && <Notice kind="error">{state.error}{state.status === 'error' && <> <button type="button" className="button secondary tab-retry" onClick={() => {
          if (store.flush()) notify('Guardado correctamente.');
        }}>Reintentar el guardado</button></>}</Notice>}
        {state.loadIssues.length > 0 && <Notice kind="warning">{state.loadIssues.join(' ')}</Notice>}
        {state.logIssues.length > 0 && <Notice kind="warning">{state.logIssues.join(' ')}</Notice>}
        {state.usageBytes > STORAGE_WARNING_BYTES && <Notice kind="warning">El almacenamiento del navegador está casi lleno ({(state.usageBytes / 1048576).toFixed(1)} MB). Exporta una copia y borra torneos que ya no necesites: el panel también guarda aquí su sesión.</Notice>}
        {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.message}</Notice>}
      </div>
      <ErrorBoundary resetKey={activeView} onError={onViewError}>
        {activeView === 'inicio' && <HomeView store={store} state={state} outcomes={outcomes} notify={notify} onNavigate={(id) => setView(id as ViewId)} />}
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
