import { useCallback, useEffect, useMemo, useState, type ErrorInfo } from 'react';
import { ChevronRight, ClipboardList, Download, ExternalLink, House, Lock, Projector, ScrollText, Shuffle, SlidersHorizontal, Trophy, Users, X } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { tournamentProgress } from './progress';
import { computeTournamentOutcomes } from './results';
import { STORAGE_WARNING_BYTES } from './store';
import { TournamentProgress } from './TournamentProgress';
import { isFallenAt } from './types';
import { BUILD_INFO, exportTournamentCopy, hasUnsavedEditors, Notice, type NoticeKind, type ViewProps } from './ui';
import { getBrowserTabStore, useTabStore } from './useTabStore';

const MANAGER_SESSION_KEY = 'ledu-admin-session';
function readManagerSessionToken(): string | undefined {
  try {
    const session = JSON.parse(window.localStorage.getItem(MANAGER_SESSION_KEY) ?? 'null') as { token?: unknown; expiresAt?: unknown } | null;
    return typeof session?.token === 'string' && typeof session.expiresAt === 'number' && session.expiresAt > Date.now() ? session.token : undefined;
  } catch { return undefined; }
}
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
export default function TabulationApp() {
  const onError = (error: Error) => {
    try {
      getBrowserTabStore().logError('Fallo de la aplicación: ' + error.message);
    } catch { /* The crash screen still offers the emergency copy. */ }
  };
  return <ErrorBoundary resetKey="app" onError={onError} page><TabulationShell /></ErrorBoundary>;
}

function TabulationShell() {
  const store = getBrowserTabStore();
  const state = useTabStore(store);
  const [view, setViewState] = useState<ViewId>(readHashView);
  const [projection, setProjection] = useState(false);
  const [notice, setNotice] = useState<{ kind: NoticeKind; message: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [managerSessionToken, setManagerSessionToken] = useState(readManagerSessionToken);
  const [managerConnection, setManagerConnection] = useState<{ connected: boolean; checkedAt: number | null; lastSuccessAt: number | null }>({ connected: false, checkedAt: null, lastSuccessAt: null });
  const tournament = state.tournament;

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === MANAGER_SESSION_KEY) setManagerSessionToken(readManagerSessionToken());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
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

  const props: ViewProps | null = tournament ? { tournament, outcomes, update, notify, store, managerSessionToken } : null;

  return <div className={'app-shell tab-shell' + (projection ? ' tab-projection' : '')}>
    <aside className="sidebar">
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
        <div className={'tab-manager-connection ' + (managerConnection.connected ? 'is-connected' : 'is-disconnected')} role="status" aria-live="polite">
          <span><span className="tab-manager-connection-dot" />{managerConnection.connected ? 'API, Neon y Redis disponibles' : 'Sin conexión con el servidor'}</span>
          <small>{managerConnection.lastSuccessAt ? 'Último health correcto hace ' + Math.max(0, Math.floor((now - managerConnection.lastSuccessAt) / 1000)) + ' s' : managerConnection.checkedAt ? 'Sin conexión confirmada' : 'Comprobando disponibilidad…'}</small>
        </div>
        <span className={'connection-dot' + (state.status === 'conflict' || state.status === 'error' || state.readOnly ? ' tab-dot-error' : '')} />
        <span>{saveLabel}</span>
        <span className="tab-operator">Operador: {state.operator || 'sin nombre'}</span>
        <a className="sidebar-logout" href="/"><ExternalLink size={16} /> Panel de organización</a>
      </div>
    </aside>
    <main className="main-area">
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
        {activeView === 'inicio' && <HomeView store={store} state={state} outcomes={outcomes} notify={notify} onNavigate={(id) => setView(id as ViewId)} />}
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
