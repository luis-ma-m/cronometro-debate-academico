import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowRight, Check, ClipboardList, Database, Download, Flag, Gavel, Plus, RotateCcw, ShieldCheck, Sparkles, Stethoscope, Trash2, Trophy, Upload, Users } from 'lucide-react';
import { tournamentChampion } from '../bracket';
import { PanelLinkReview } from '../PanelLinkReview';
import { parseBackupFile } from '../emergency';
import { downloadEmergencyCopy } from '../ErrorBoundary';
import { checkIntegrity, type IntegrityReport } from '../integrity';
import { type LogVerification } from '../log';
import { TabDataError } from '../normalize';
import { clearHandoff, HANDOFF_KEY, mergeHandoff, readHandoff, tournamentFromHandoff } from '../panelBridge';
import { ADUMA_DEFAULT_NAME, createTabTournament, PRESET_OPTIONS } from '../presets';
import { roundIsComplete, type DebateOutcome } from '../results';
import { createSampleTournament } from '../sample';
import { MAX_BACKUPS, type TabStore, type TabStoreState } from '../store';
import { eliminationRounds, isFallenAt, qualifyingRounds, type PresetId, type TabTournament, type PanelEntityIdMap } from '../types';
import { BUILD_INFO, exportTournamentCopy, Field, formatNumber, IssueList, Notice, type NoticeKind } from '../ui';

type CreatablePreset = Exclude<PresetId, 'custom'>;

interface NextStep { text: string; view: string; action: string; finished?: boolean }

/** What to do next, following the order of a real tournament, and the screen where it is done. */
function nextStep(tournament: TabTournament, outcomes: Map<string, DebateOutcome>): NextStep {
  const { settings } = tournament;
  const participants = { view: 'participantes', action: 'Ir a Participantes' };
  const rounds = { view: 'rondas', action: 'Ir a Rondas' };
  const activeTeams = tournament.teams.filter((team) => team.active && !team.swing).length;
  if (!activeTeams) return { text: 'Añade los equipos y sus oradores.', ...participants };
  if (!tournament.judges.some((judge) => judge.active)) return { text: 'Añade los jueces.', ...participants };
  if (!tournament.venues.some((venue) => venue.active)) return { text: 'Añade las salas.', ...participants };
  if (tournament.draftRound) return { text: 'Revisa el borrador de ' + tournament.draftRound.round.name + ' y pulsa «Confirmar ronda».', view: 'rondas', action: 'Revisar el borrador' };
  const qualifying = qualifyingRounds(tournament);
  const elimination = eliminationRounds(tournament);
  const incomplete = tournament.rounds.find((round) => !roundIsComplete(round, outcomes));
  if (incomplete) return { text: 'Registra las actas de ' + incomplete.name + '.', view: 'actas', action: 'Ir a las actas' };
  if (settings.stage === 'groups' && !qualifying.length) {
    return { text: tournament.groups.length ? 'Genera las jornadas de la liguilla.' : 'Sortea los grupos.', ...rounds };
  }
  if (settings.stage === 'swiss' && qualifying.length < settings.swissRounds) {
    const odd = tournament.teams.filter((team) => team.active).length % 2;
    return odd
      ? { text: 'Hay un número impar de equipos: añade un equipo «Descanso» antes de la siguiente ronda.', ...participants }
      : { text: 'Genera la ronda ' + (qualifying.length + 1) + ' con «Nueva ronda».', ...rounds };
  }
  if (!elimination.length) return { text: 'La fase clasificatoria ha terminado: revisa la clasificación y genera las eliminatorias en Rondas.', view: 'clasificacion', action: 'Ver la clasificación' };
  const champion = tournamentChampion(tournament, outcomes);
  if (champion) return { text: 'Torneo terminado. Campeón: ' + (tournament.teams.find((team) => team.id === champion)?.name ?? champion) + '.', view: 'clasificacion', action: 'Ver la clasificación', finished: true };
  return { text: 'Genera la siguiente eliminatoria.', ...rounds };
}

export function HomeView({ store, state, outcomes, notify, onNavigate }: {
  store: TabStore;
  state: TabStoreState;
  outcomes: Map<string, DebateOutcome>;
  notify: (message: string, kind?: NoticeKind) => void;
  onNavigate: (view: string) => void;
}) {
  const tournament = state.tournament;
  const [name, setName] = useState('');
  const [presetId, setPresetId] = useState<CreatablePreset>('ledu-groups');
  const [operator, setOperator] = useState(state.operator);
  const [handoffVersion, setHandoffVersion] = useState(0);
  const [showLinkReview, setShowLinkReview] = useState(false);
  const [backupVersion, setBackupVersion] = useState(0);
  const [diagnosis, setDiagnosis] = useState<{ integrity: IntegrityReport; log: LogVerification & { issues: string[] } } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const handoff = useMemo(() => readHandoff(window.localStorage), [handoffVersion, state.tournaments]);
  const backups = useMemo(() => store.listBackups(), [store, tournament?.id, tournament?.revision, backupVersion]);
  useEffect(() => {
    // The panel may send its participants while this page is open.
    const onStorage = (event: StorageEvent) => { if (event.key === HANDOFF_KEY) setHandoffVersion((value) => value + 1); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  useEffect(() => setDiagnosis(null), [tournament?.id]);

  const debates = tournament?.rounds.flatMap((round) => round.debates.map((debate) => ({ debate, round }))) ?? [];
  const teams = tournament ? new Map(tournament.teams.map((team) => [team.id, team])) : new Map();
  const played = debates.filter(({ debate, round }) => !debate.teamIds.some((id) => isFallenAt(teams.get(id), round.number)));
  const completeDebates = played.filter(({ debate }) => outcomes.get(debate.id)?.status === 'complete').length;
  const activeTeams = tournament?.teams.filter((team) => team.active && !team.swing).length ?? 0;
  const expectedTeams = tournament?.settings.expectedTeams ?? 0;
  const adumaOpen = tournament?.settings.presetId === 'aduma' || tournament?.settings.ballotMode === 'joint';
  const next = tournament ? nextStep(tournament, outcomes) : null;

  const readOnlyNotice = () => {
    if (state.readOnly) notify('Esta pestaña es de solo lectura: pulsa «Tomar el control» para crear o importar torneos.', 'error');
    return state.readOnly;
  };

  const create = (sample: boolean) => {
    if (readOnlyNotice()) return;
    store.create(sample ? createSampleTournament(presetId) : createTabTournament(name || 'Nuevo torneo', presetId));
    setName('');
    notify(sample ? 'Torneo de ejemplo creado para probar la herramienta.' : 'Torneo creado. Revisa las reglas y añade los participantes.');
    onNavigate(sample ? 'rondas' : 'reglas');
  };

  const createAduma = (sample: boolean) => {
    if (readOnlyNotice()) return;
    const existing = state.tournaments.find((entry) => entry.name === ADUMA_DEFAULT_NAME);
    if (!sample && existing && !window.confirm('Ya hay un torneo «' + existing.name + '» en este navegador. ¿Crear otro?')) return;
    const created = sample ? { ...createSampleTournament('aduma'), name: 'Ensayo ADUMA (equipos de ejemplo)' } : createTabTournament(ADUMA_DEFAULT_NAME, 'aduma');
    store.create(created);
    notify(sample
      ? 'Ensayo creado con 20 equipos, 30 jueces y 10 salas de ejemplo: genera rondas y simula resultados sin tocar el torneo real.'
      : 'Torneo ADUMA creado con su reglamento (4 rondas suizas a ciegas, acta conjunta, cuartos 1–8, 3–6, 2–7, 4–5). Añade ahora los 20 equipos, los jueces, sus incompatibilidades y las salas.');
    onNavigate(sample ? 'rondas' : 'participantes');
  };

  const createFromPanel = () => {
    if (!handoff || readOnlyNotice()) return;
    store.create(tournamentFromHandoff(handoff, presetId));
    clearHandoff(window.localStorage);
    setHandoffVersion((value) => value + 1);
    notify('Torneo creado y vinculado con la identidad del panel. Revisa las reglas, los niveles de los jueces y quién puede presidir.');
    onNavigate('reglas');
  };

  const mergeFromPanel = () => {
    if (!handoff || !tournament) return;
    const merged = mergeHandoff(tournament, handoff);
    if (merged.issues.length) { notify(merged.issues.join(' '), 'error'); return; }
    store.backup('Antes de actualizar desde el panel');
    if (!store.update(() => merged.tournament, { type: 'tournament.import', message: 'Participantes actualizados desde el panel: ' + merged.added + ' nuevos y ' + merged.updated + ' modificados.' })) {
      notify('No se han podido aplicar los datos del panel en esta pestaña.', 'error');
      return;
    }
    clearHandoff(window.localStorage);
    setHandoffVersion((value) => value + 1);
    notify('Participantes actualizados: ' + merged.added + ' nuevos y ' + merged.updated + ' modificados.' + (merged.warnings.length ? ' ' + merged.warnings.join(' ') : ''), merged.warnings.length ? 'warning' : 'success');
  };

  const linkExistingFromPanel = (idMap: PanelEntityIdMap) => {
    if (!handoff || !tournament || readOnlyNotice()) return;
    const merged = mergeHandoff(tournament, handoff, Date.now(), idMap);
    if (merged.issues.length) { notify(merged.issues.join(' '), 'error'); return; }
    store.backup('Antes de vincular con el panel');
    if (!store.update(() => merged.tournament, { type: 'tournament.link', message: 'Torneo local vinculado al panel mediante correspondencias revisadas.' })) {
      notify('No se ha podido guardar la vinculación. Los datos locales no se han modificado.', 'error');
      return;
    }
    clearHandoff(window.localStorage);
    setHandoffVersion((value) => value + 1);
    setShowLinkReview(false);
    notify('Torneo vinculado. Se han conservado los IDs locales y se han importado las entidades remotas no vinculadas.', 'success');
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const { tournament: imported, issues, log } = parseBackupFile(await file.text());
      let mode: 'replace' | 'copy' = 'copy';
      if (store.hasTournament(imported.id)) {
        mode = window.confirm('Ya existe en este navegador un torneo con esta identidad («' + imported.name + '»).\n\nAceptar: reemplazarlo por la copia (se guarda antes una copia automática del actual y se conserva su registro).\nCancelar: importarlo como un torneo nuevo.') ? 'replace' : 'copy';
      }
      store.importTournament(imported, mode, log);
      notify('Copia importada' + (mode === 'replace' ? ' y reemplazada.' : '.') + (log.length ? ' Incluye ' + log.length + ' entradas de registro.' : '') + (issues.length ? ' ' + issues.join(' ') : ''), issues.length ? 'warning' : 'success');
    } catch (error) {
      notify(error instanceof TabDataError ? error.message : 'No se ha podido leer el archivo.', 'error');
    }
  };

  const requestPersistence = async () => {
    const persisted = await navigator.storage?.persist?.().catch(() => false);
    notify(persisted ? 'El navegador conservará estos datos aunque necesite espacio.' : 'El navegador no ha concedido el almacenamiento persistente: exporta copias con frecuencia.', persisted ? 'success' : 'warning');
  };

  const diagnose = () => {
    if (!tournament) return;
    setDiagnosis({ integrity: checkIntegrity(tournament), log: store.verifyLog() });
  };

  const sortedTournaments = [...state.tournaments].sort((x, y) => y.updatedAt - x.updatedAt);

  return <>
    <div className="page-heading"><div><p className="eyebrow">INICIO</p><h2>Tabulación del torneo</h2><p className="muted">Emparejamientos, jueces, actas, clasificación y eliminatorias para debate académico. Todo se calcula y se guarda en este navegador, sin servidor.</p></div></div>

    {!adumaOpen && <section className="panel tab-aduma">
      <div className="panel-title"><div><h3><Trophy size={18} /> V Torneo Nacional ADUMA · 10.º aniversario</h3>
        <p>20 equipos · 4 rondas suizas a ciegas (victorias → ítems → enfrentamiento directo → faltas) · acta conjunta · incompatibilidades objetivas y subjetivas · equipos caídos · cuartos, semifinales y final según el art. 31.</p></div></div>
      <div className="tab-actions">
        <button type="button" className="button primary tab-big-button" onClick={() => createAduma(false)}><Plus size={18} /> Crear Torneo ADUMA</button>
        <button type="button" className="button secondary" onClick={() => createAduma(true)}><Sparkles size={16} /> Crear ensayo ADUMA con equipos de ejemplo</button>
      </div>
    </section>}

    {handoff && <section className="panel tab-handoff">
      <div className="panel-title"><div><h3>Datos recibidos del panel</h3><p>«{handoff.tournamentName}» · {handoff.teams.length} equipos, {handoff.speakers.length} oradores, {handoff.judges.length} jueces y {handoff.venues.length} salas · enviados el {new Date(handoff.createdAt).toLocaleString('es-ES')}</p></div></div>
      <div className="tab-actions">
        <Field label="Formato"><select value={presetId} onChange={(event) => setPresetId(event.target.value as CreatablePreset)}>{PRESET_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
        <button type="button" className="button primary" onClick={createFromPanel}><Plus size={16} /> Crear torneo con estos datos</button>
        {tournament && !tournament.panelLink?.remoteId && handoff.tournamentId && !tournament.panelLink
          && <button type="button" className="button secondary" onClick={() => setShowLinkReview(true)}>Vincular torneo existente con revisión</button>}
        {tournament && ((!handoff.tournamentId && !tournament.panelLink?.remoteId)
          || (handoff.tournamentId && tournament.panelLink?.remoteId === handoff.tournamentId))
          && <button type="button" className="button secondary" onClick={mergeFromPanel}><RotateCcw size={16} /> Actualizar «{tournament.name}»</button>}
        {tournament && handoff.tournamentId && tournament.panelLink?.remoteId && tournament.panelLink.remoteId !== handoff.tournamentId
          && <p className="muted">Este snapshot pertenece a otra identidad remota. No se puede aplicar a «{tournament.name}».</p>}
        {tournament && handoff.tournamentId && tournament.panelLink && !tournament.panelLink.remoteId
          && <p className="muted">Este torneo conserva un vínculo antiguo sin identidad verificable. Para evitar una asociación incorrecta, crea una copia nueva vinculada desde el panel.</p>}
        <button type="button" className="text-button" onClick={() => { clearHandoff(window.localStorage); setHandoffVersion((value) => value + 1); setShowLinkReview(false); }}>Descartar</button>
      </div>
    </section>}
    {showLinkReview && tournament && handoff?.tournamentId && !tournament.panelLink && <PanelLinkReview
      tournament={tournament}
      handoff={handoff}
      onCancel={() => setShowLinkReview(false)}
      onConfirm={linkExistingFromPanel}
    />}

    {tournament && <section className="panel">
      <div className="panel-title"><div><h3>{tournament.name}</h3><p>{PRESET_OPTIONS.find((option) => option.id === tournament.settings.presetId)?.label ?? 'Reglas personalizadas'} · {tournament.settings.stage === 'groups' ? 'liguilla de grupos' : 'sistema suizo'}{tournament.sample ? ' · torneo de ejemplo' : ''}</p></div></div>
      <div className="stat-grid">
        <div className={'stat-card' + (expectedTeams && activeTeams !== expectedTeams ? ' tab-stat-warning' : '')}><span className="stat-icon"><Users size={19} /></span><div><span>Equipos activos</span><b>{activeTeams}{expectedTeams ? '/' + expectedTeams : ''}</b></div></div>
        <div className="stat-card"><span className="stat-icon"><Gavel size={19} /></span><div><span>Jueces disponibles</span><b>{tournament.judges.filter((judge) => judge.active).length}</b></div></div>
        <div className="stat-card"><span className="stat-icon"><Database size={19} /></span><div><span>Rondas</span><b>{tournament.rounds.length}{tournament.draftRound ? ' + borrador' : ''}</b></div></div>
        <div className="stat-card"><span className="stat-icon"><ClipboardList size={19} /></span><div><span>Actas completas</span><b>{completeDebates}/{played.length}</b></div></div>
      </div>
      {next && <div className={'tab-next-step' + (next.finished ? ' finished' : '')}>
        <span className="tab-next-icon">{next.finished ? <Trophy size={20} /> : <Flag size={20} />}</span>
        <div><small>Siguiente paso</small><b>{next.text}</b></div>
        <button type="button" className="button primary" onClick={() => onNavigate(next.view)}>{next.action} <ArrowRight size={16} /></button>
      </div>}
      <form className="tab-inline-form" onSubmit={(event) => { event.preventDefault(); store.setOperator(operator); notify('Las próximas entradas del registro llevarán el nombre «' + operator.trim() + '».'); }}>
        <Field label="Operador de la mesa de tabulación" hint="Se anota en cada entrada del registro."><input value={operator} maxLength={60} onChange={(event) => setOperator(event.target.value)} placeholder="Nombre de quien tabula" /></Field>
        <button type="submit" className="button secondary" disabled={operator.trim() === state.operator}><Check size={16} /> Guardar nombre</button>
      </form>
    </section>}

    <div className="tab-two-columns">
      <section className="panel">
        <div className="panel-title"><div><h3>Nuevo torneo</h3><p>Elige el reglamento de partida; después podrás ajustar cada criterio en Reglas.</p></div></div>
        <div className="tab-form-grid">
          <Field label="Nombre"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Torneo de debate 2026" /></Field>
          <Field label="Formato" hint={PRESET_OPTIONS.find((option) => option.id === presetId)?.description}>
            <select value={presetId} onChange={(event) => setPresetId(event.target.value as CreatablePreset)}>{PRESET_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
          </Field>
        </div>
        <div className="tab-actions">
          <button type="button" className="button primary" onClick={() => create(false)}><Plus size={16} /> Crear torneo</button>
          <button type="button" className="button secondary" onClick={() => create(true)}><Sparkles size={16} /> Crear torneo de ejemplo</button>
        </div>
        <p className="muted">Para usar los equipos y jueces del panel, abre el panel de organización y pulsa «Enviar a tabulación» en la vista Torneo.</p>
      </section>

      <section className="panel">
        <div className="panel-title"><div><h3>Torneos en este navegador</h3><p>{sortedTournaments.length ? 'Abre uno para continuar donde lo dejaste.' : 'Todavía no hay torneos guardados.'}</p></div></div>
        <ul className="tab-list">{sortedTournaments.map((entry) => <li key={entry.id} className={entry.id === tournament?.id ? 'current' : ''}>
          <div><b>{entry.name}</b><small>Modificado {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString('es-ES') : '—'}</small></div>
          {entry.id === tournament?.id ? <span className="state-pill ready"><Check size={12} /> Abierto</span>
            : <button type="button" className="button secondary" onClick={() => { store.open(entry.id); notify('Torneo abierto.'); }}>Abrir</button>}
          <button type="button" className="icon-button danger-action" aria-label={'Borrar ' + entry.name} disabled={state.readOnly} onClick={() => {
            if (window.confirm('¿Borrar «' + entry.name + '» de este navegador, con su registro y sus copias automáticas? Exporta antes una copia si quieres conservarlo.')) { store.remove(entry.id); notify('Torneo borrado.'); }
          }}><Trash2 size={15} /></button>
        </li>)}</ul>
      </section>
    </div>

    {tournament && <section className="panel">
      <div className="panel-title"><div><h3><Stethoscope size={18} /> Diagnóstico</h3><p>Comprueba que los datos son coherentes (identificadores, referencias, dobles reservas, instituciones escritas de dos formas…) y que el registro no se ha alterado. Hazlo antes de cada ronda.</p></div></div>
      <div className="tab-actions">
        <button type="button" className="button primary" onClick={diagnose}><ShieldCheck size={16} /> Comprobar ahora</button>
        <button type="button" className="button secondary" onClick={downloadEmergencyCopy}><Download size={16} /> Copia de emergencia</button>
      </div>
      {diagnosis && <>
        {!diagnosis.integrity.errors.length && !diagnosis.integrity.warnings.length && diagnosis.log.ok
          ? <Notice kind="success">Todo en orden: datos coherentes y registro verificado ({diagnosis.log.segments} tramo{diagnosis.log.segments === 1 ? '' : 's'}{diagnosis.log.pending ? ', ' + diagnosis.log.pending + ' entradas pendientes de sellar' : ''}).</Notice>
          : <>
            <IssueList items={diagnosis.integrity.errors} kind="error" />
            <IssueList items={diagnosis.integrity.warnings} />
            {!diagnosis.log.ok && <IssueList items={diagnosis.log.problems} kind="error" />}
            <IssueList items={diagnosis.log.issues} />
          </>}
      </>}
      <p className="muted">Versión en uso: {BUILD_INFO}. Usa la misma durante todo el torneo.</p>
    </section>}

    <section className="panel">
      <div className="panel-title"><div><h3>Copias de seguridad</h3><p>Los datos viven solo en este navegador: si se borran los datos del sitio (o Safari los elimina tras días sin uso) se pierden. Cada ronda confirmada descarga un ZIP con una copia completa; exporta también una copia cuando termines de pasar actas.</p></div></div>
      <div className="tab-actions">
        <button type="button" className="button primary" disabled={!tournament} onClick={() => { if (exportTournamentCopy(store) !== null) notify('Copia exportada con el registro.'); }}><Download size={16} /> Exportar copia (.json)</button>
        <button type="button" className="button secondary" disabled={state.readOnly} onClick={() => fileInput.current?.click()}><Upload size={16} /> Importar copia</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importFile(event)} />
        <button type="button" className="button secondary" disabled={!tournament || state.readOnly} onClick={() => { notify(store.backup('Copia manual') ? 'Copia guardada en el navegador.' : 'No hay espacio para otra copia en el navegador.', 'success'); setBackupVersion((value) => value + 1); }}><Database size={16} /> Guardar copia en el navegador</button>
        <button type="button" className="text-button" onClick={() => void requestPersistence()}>Pedir almacenamiento persistente</button>
      </div>
      <p className="muted">«Importar copia» acepta la copia exportada, el archivo <code>privado/copia-torneo.json</code> del ZIP de cualquier ronda y la copia de emergencia.</p>
      {tournament && <>
        <h4 className="tab-subtitle">Copias automáticas de «{tournament.name}»</h4>
        {backups.length ? <ul className="tab-list">{backups.map((backup) => <li key={backup.slot}>
          <div><b>{backup.label}</b><small>{new Date(backup.createdAt).toLocaleString('es-ES')}</small></div>
          <button type="button" className="button secondary" disabled={state.readOnly} onClick={() => {
            if (window.confirm('¿Restaurar la copia «' + backup.label + '»? El estado actual se guardará antes como otra copia y el registro anotará la restauración.')) { store.restoreBackup(backup.slot); setBackupVersion((value) => value + 1); notify('Copia restaurada.'); }
          }}><RotateCcw size={15} /> Restaurar</button>
        </li>)}</ul> : <p className="muted">Se crean automáticamente antes de confirmar o borrar rondas, importar o aplicar un reglamento (máximo {MAX_BACKUPS}).</p>}
      </>}
      <p className="muted">Uso del almacenamiento del navegador: {formatNumber(state.usageBytes / 1048576)} MB.</p>
    </section>
  </>;
}
