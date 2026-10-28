import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ClipboardList, Download, ExternalLink, House, Projector, Shuffle, SlidersHorizontal, Trophy, Users, X } from 'lucide-react';
import { serializeTournamentExport } from './normalize';
import { computeTournamentOutcomes } from './results';
import { STORAGE_WARNING_BYTES } from './store';
import { downloadFile, fileSlug, Notice, type NoticeKind, type ViewProps } from './ui';
import { getBrowserTabStore, useTabStore } from './useTabStore';
import { BallotsView } from './views/BallotsView';
import { HomeView } from './views/HomeView';
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
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

function readHashView(): ViewId {
  const id = window.location.hash.replace(/^#/, '').split('/')[0];
  return VIEWS.find((view) => view.id === id)?.id ?? 'inicio';
}

export default function TabulationApp() {
  const store = getBrowserTabStore();
  const state = useTabStore(store);
  const [view, setViewState] = useState<ViewId>(readHashView);
  const [projection, setProjection] = useState(false);
  const [notice, setNotice] = useState<{ kind: NoticeKind; message: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const tournament = state.tournament;

  useEffect(() => {
    const onHashChange = () => setViewState(readHashView());
    window.addEventListener('hashchange', onHashChange);
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => { window.removeEventListener('hashchange', onHashChange); window.clearInterval(timer); };
  }, []);
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
  const outcomes = useMemo(() => (tournament ? computeTournamentOutcomes(tournament) : new Map()), [tournament]);
  const activeView: ViewId = tournament ? view : 'inicio';

  const exportCopy = () => {
    if (!tournament) return;
    downloadFile('tabulacion-' + fileSlug(tournament.name) + '-' + new Date().toISOString().slice(0, 10) + '.json', serializeTournamentExport(tournament), 'application/json');
    notify('Copia exportada. Guárdala fuera del navegador: es la única forma de recuperar el torneo si se borran los datos del sitio.');
  };

  const saveLabel = state.status === 'dirty' ? 'Guardando…'
    : state.status === 'conflict' ? 'Conflicto con otra pestaña'
      : state.status === 'error' ? 'Error al guardar'
        : state.lastSavedAt ? 'Guardado en este navegador · hace ' + Math.max(0, Math.round((now - state.lastSavedAt) / 1000)) + ' s'
          : tournament ? 'Guardado en este navegador' : 'Sin torneo abierto';

  const props: ViewProps | null = tournament ? { tournament, outcomes, update: store.update, notify } : null;

  return <div className={'app-shell tab-shell' + (projection ? ' tab-projection' : '')}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">T</span><span>Debate <b>Tabulación</b></span></div>
      <div className="sidebar-section">TABULACIÓN LOCAL</div>
      <nav>{VIEWS.map((item) => {
        const Icon = item.icon;
        return <button key={item.id} type="button" className={'nav-button ' + (activeView === item.id ? 'selected' : '')} disabled={!tournament && item.id !== 'inicio'} onClick={() => setView(item.id)}>
          <Icon size={18} /><span>{item.label}</span><ChevronRight size={15} />
        </button>;
      })}</nav>
      <div className="sidebar-bottom">
        <span className={'connection-dot' + (state.status === 'conflict' || state.status === 'error' ? ' tab-dot-error' : '')} />
        <span>{saveLabel}</span>
        <a className="sidebar-logout" href="/"><ExternalLink size={16} /> Panel de organización</a>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div><span className="eyebrow">TABULACIÓN LOCAL · SIN CONEXIÓN AL SERVIDOR</span><h1>{tournament?.name ?? 'Tabulación de debate académico'}</h1></div>
        {tournament && <div className="top-actions tab-no-project">
          <span className="live-status"><i className={state.status === 'conflict' || state.status === 'error' ? 'disconnected' : ''} /> {saveLabel}</span>
          <button type="button" className="button secondary" onClick={exportCopy}><Download size={16} /> Exportar copia</button>
          <button type="button" className="button secondary" onClick={() => setProjection(true)} title="Pantalla limpia para proyectar (Esc para salir)"><Projector size={16} /> Proyectar</button>
        </div>}
      </header>
      {projection && <button type="button" className="button secondary tab-exit-projection" onClick={() => setProjection(false)}><X size={16} /> Salir de la proyección</button>}
      <div className="tab-no-project">
        {state.status === 'conflict' && <div className="notice error-notice tab-conflict" role="alert">
          <span>Este torneo se ha modificado en otra pestaña o ventana. Para no perder datos, los cambios de esta pestaña están en pausa.</span>
          <button type="button" className="button secondary" onClick={() => store.reloadFromStorage()}>Cargar la otra versión</button>
          <button type="button" className="button secondary" onClick={() => { if (window.confirm('¿Sobrescribir la versión guardada por la otra pestaña con la de esta pestaña?')) store.overwrite(); }}>Mantener esta versión</button>
        </div>}
        {state.error && <Notice kind="error">{state.error}</Notice>}
        {state.loadIssues.length > 0 && <Notice kind="warning">{state.loadIssues.join(' ')}</Notice>}
        {state.usageBytes > STORAGE_WARNING_BYTES && <Notice kind="warning">El almacenamiento del navegador está casi lleno ({(state.usageBytes / 1048576).toFixed(1)} MB). Exporta una copia y borra torneos que ya no necesites: el panel también guarda aquí su sesión.</Notice>}
        {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.message}</Notice>}
      </div>
      {activeView === 'inicio' && <HomeView store={store} state={state} outcomes={outcomes} notify={notify} onNavigate={(id) => setView(id as ViewId)} />}
      {props && activeView === 'reglas' && <RulesView {...props} store={store} />}
      {props && activeView === 'participantes' && <ParticipantsView {...props} />}
      {props && activeView === 'rondas' && <RoundsView {...props} store={store} onNavigate={(id) => setView(id as ViewId)} />}
      {props && activeView === 'actas' && <BallotsView {...props} />}
      {props && activeView === 'clasificacion' && <StandingsView {...props} projection={projection} onProject={() => setProjection(true)} />}
      <footer className="footer tab-no-project"><span>Debate Control · Tabulación local</span><span>Los datos se guardan solo en este navegador. Exporta copias con regularidad.</span></footer>
    </main>
  </div>;
}
