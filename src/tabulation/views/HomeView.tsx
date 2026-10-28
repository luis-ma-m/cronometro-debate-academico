import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Check, ClipboardList, Database, Download, Gavel, Plus, RotateCcw, Sparkles, Trash2, Upload, Users } from 'lucide-react';
import { tournamentChampion } from '../bracket';
import { parseTournamentExport, serializeTournamentExport, TabDataError } from '../normalize';
import { clearHandoff, HANDOFF_KEY, mergeHandoff, readHandoff, tournamentFromHandoff } from '../panelBridge';
import { createTabTournament, PRESET_OPTIONS } from '../presets';
import { roundIsComplete, type DebateOutcome } from '../results';
import { createSampleTournament } from '../sample';
import { MAX_BACKUPS, type TabStore, type TabStoreState } from '../store';
import { eliminationRounds, qualifyingRounds, type PresetId, type TabTournament } from '../types';
import { downloadFile, Field, fileSlug, formatNumber, Notice, type NoticeKind } from '../ui';

type CreatablePreset = Exclude<PresetId, 'custom'>;

/** Short guidance on what to do next, following the order of a real tournament. */
function nextStep(tournament: TabTournament, outcomes: Map<string, DebateOutcome>): string {
  const { settings } = tournament;
  if (!tournament.teams.some((team) => team.active)) return 'Añade los equipos y sus oradores en Participantes.';
  if (!tournament.judges.some((judge) => judge.active)) return 'Añade los jueces en Participantes.';
  if (!tournament.venues.some((venue) => venue.active)) return 'Añade las salas en Participantes.';
  const qualifying = qualifyingRounds(tournament);
  const elimination = eliminationRounds(tournament);
  const incomplete = tournament.rounds.find((round) => !roundIsComplete(round, outcomes));
  if (incomplete) {
    if (incomplete.debates.some((debate) => !debate.judgeIds.length)) return 'Asigna los jueces de ' + incomplete.name + ' en Rondas.';
    return 'Registra las actas de ' + incomplete.name + ' en Actas.';
  }
  if (settings.stage === 'groups' && !qualifying.length) {
    return tournament.groups.length ? 'Genera las jornadas de la liguilla en Rondas.' : 'Sortea los grupos en Rondas.';
  }
  if (settings.stage === 'swiss' && qualifying.length < settings.swissRounds) return 'Genera la ronda ' + (qualifying.length + 1) + ' en Rondas.';
  if (!elimination.length) return 'La fase clasificatoria ha terminado: revisa la clasificación y genera las eliminatorias en Rondas.';
  const champion = tournamentChampion(tournament, outcomes);
  if (champion) return 'Torneo terminado. Campeón: ' + (tournament.teams.find((team) => team.id === champion)?.name ?? champion) + '.';
  return 'Genera la siguiente eliminatoria en Rondas.';
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
  const [handoffVersion, setHandoffVersion] = useState(0);
  const [backupVersion, setBackupVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const handoff = useMemo(() => readHandoff(window.localStorage), [handoffVersion, state.tournaments]);
  const backups = useMemo(() => store.listBackups(), [store, tournament?.id, tournament?.revision, backupVersion]);
  useEffect(() => {
    // The panel may send its participants while this page is open.
    const onStorage = (event: StorageEvent) => { if (event.key === HANDOFF_KEY) setHandoffVersion((value) => value + 1); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const debates = tournament?.rounds.flatMap((round) => round.debates) ?? [];
  const completeDebates = debates.filter((debate) => outcomes.get(debate.id)?.status === 'complete').length;

  const create = (sample: boolean) => {
    store.create(sample ? createSampleTournament(presetId) : createTabTournament(name || 'Nuevo torneo', presetId));
    setName('');
    notify(sample ? 'Torneo de ejemplo creado con 16 equipos, 12 jueces y 8 salas.' : 'Torneo creado. Revisa las reglas y añade los participantes.');
    onNavigate(sample ? 'rondas' : 'reglas');
  };

  const createFromPanel = () => {
    if (!handoff) return;
    store.create(tournamentFromHandoff(handoff, presetId));
    clearHandoff(window.localStorage);
    setHandoffVersion((value) => value + 1);
    notify('Torneo creado con los participantes del panel. Revisa las reglas, los niveles de los jueces y quién puede presidir.');
    onNavigate('reglas');
  };

  const mergeFromPanel = () => {
    if (!handoff || !tournament) return;
    const merged = mergeHandoff(tournament, handoff);
    store.backup('Antes de actualizar desde el panel');
    store.update(() => merged.tournament);
    clearHandoff(window.localStorage);
    setHandoffVersion((value) => value + 1);
    notify('Participantes actualizados: ' + merged.added + ' nuevos y ' + merged.updated + ' modificados.' + (merged.warnings.length ? ' ' + merged.warnings.join(' ') : ''), merged.warnings.length ? 'warning' : 'success');
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const { tournament: imported, issues } = parseTournamentExport(await file.text());
      let mode: 'replace' | 'copy' = 'copy';
      if (store.hasTournament(imported.id)) {
        mode = window.confirm('Ya existe en este navegador un torneo con esta identidad («' + imported.name + '»).\n\nAceptar: reemplazarlo por la copia (se guarda una copia automática del actual).\nCancelar: importarlo como un torneo nuevo.') ? 'replace' : 'copy';
      }
      store.importTournament(imported, mode);
      notify('Copia importada' + (mode === 'replace' ? ' y reemplazada.' : '.') + (issues.length ? ' ' + issues.join(' ') : ''), issues.length ? 'warning' : 'success');
    } catch (error) {
      notify(error instanceof TabDataError ? error.message : 'No se ha podido leer el archivo.', 'error');
    }
  };

  const requestPersistence = async () => {
    const persisted = await navigator.storage?.persist?.();
    notify(persisted ? 'El navegador conservará estos datos aunque necesite espacio.' : 'El navegador no ha concedido el almacenamiento persistente: exporta copias con frecuencia.', persisted ? 'success' : 'warning');
  };

  const sortedTournaments = [...state.tournaments].sort((x, y) => y.updatedAt - x.updatedAt);

  return <>
    <div className="page-heading"><div><p className="eyebrow">INICIO</p><h2>Tabulación del torneo</h2><p className="muted">Emparejamientos, jueces, actas por juez, clasificación y eliminatorias para debate académico. Todo se calcula y se guarda en este navegador, sin servidor.</p></div></div>

    {handoff && <section className="panel tab-handoff">
      <div className="panel-title"><div><h3>Datos recibidos del panel</h3><p>«{handoff.tournamentName}» · {handoff.teams.length} equipos, {handoff.speakers.length} oradores, {handoff.judges.length} jueces y {handoff.venues.length} salas · enviados el {new Date(handoff.createdAt).toLocaleString('es-ES')}</p></div></div>
      <div className="tab-actions">
        <Field label="Formato"><select value={presetId} onChange={(event) => setPresetId(event.target.value as CreatablePreset)}>{PRESET_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
        <button type="button" className="button primary" onClick={createFromPanel}><Plus size={16} /> Crear torneo con estos datos</button>
        {tournament && <button type="button" className="button secondary" onClick={mergeFromPanel}><RotateCcw size={16} /> Actualizar «{tournament.name}»</button>}
        <button type="button" className="text-button" onClick={() => { clearHandoff(window.localStorage); setHandoffVersion((value) => value + 1); }}>Descartar</button>
      </div>
    </section>}

    {tournament && <section className="panel">
      <div className="panel-title"><div><h3>{tournament.name}</h3><p>{PRESET_OPTIONS.find((option) => option.id === tournament.settings.presetId)?.label ?? 'Reglas personalizadas'} · {tournament.settings.stage === 'groups' ? 'liguilla de grupos' : 'sistema suizo'}{tournament.sample ? ' · torneo de ejemplo' : ''}</p></div></div>
      <div className="stat-grid">
        <div className="stat-card"><span className="stat-icon"><Users size={19} /></span><div><span>Equipos activos</span><b>{tournament.teams.filter((team) => team.active && !team.swing).length}</b></div></div>
        <div className="stat-card"><span className="stat-icon"><Gavel size={19} /></span><div><span>Jueces activos</span><b>{tournament.judges.filter((judge) => judge.active).length}</b></div></div>
        <div className="stat-card"><span className="stat-icon"><Database size={19} /></span><div><span>Rondas</span><b>{tournament.rounds.length}</b></div></div>
        <div className="stat-card"><span className="stat-icon"><ClipboardList size={19} /></span><div><span>Actas completas</span><b>{completeDebates}/{debates.length}</b></div></div>
      </div>
      <Notice kind="info"><b>Siguiente paso:</b> {nextStep(tournament, outcomes)}</Notice>
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
          <button type="button" className="icon-button danger-action" aria-label={'Borrar ' + entry.name} onClick={() => {
            if (window.confirm('¿Borrar «' + entry.name + '» de este navegador? Exporta antes una copia si quieres conservarlo.')) { store.remove(entry.id); notify('Torneo borrado.'); }
          }}><Trash2 size={15} /></button>
        </li>)}</ul>
      </section>
    </div>

    <section className="panel">
      <div className="panel-title"><div><h3>Copias de seguridad</h3><p>Los datos viven solo en este navegador: si se borran los datos del sitio (o Safari los elimina tras días sin uso) se pierden. Exporta una copia tras cada ronda.</p></div></div>
      <div className="tab-actions">
        <button type="button" className="button primary" disabled={!tournament} onClick={() => tournament && downloadFile('tabulacion-' + fileSlug(tournament.name) + '-' + new Date().toISOString().slice(0, 10) + '.json', serializeTournamentExport(tournament), 'application/json')}><Download size={16} /> Exportar copia (.json)</button>
        <button type="button" className="button secondary" onClick={() => fileInput.current?.click()}><Upload size={16} /> Importar copia</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importFile(event)} />
        <button type="button" className="button secondary" disabled={!tournament} onClick={() => { notify(store.backup('Copia manual') ? 'Copia automática guardada en el navegador.' : 'No hay espacio para otra copia en el navegador.', 'success'); setBackupVersion((value) => value + 1); }}><Database size={16} /> Guardar copia en el navegador</button>
        <button type="button" className="text-button" onClick={() => void requestPersistence()}>Pedir almacenamiento persistente</button>
      </div>
      {tournament && <>
        <h4 className="tab-subtitle">Copias automáticas de «{tournament.name}»</h4>
        {backups.length ? <ul className="tab-list">{backups.map((backup) => <li key={backup.slot}>
          <div><b>{backup.label}</b><small>{new Date(backup.createdAt).toLocaleString('es-ES')}</small></div>
          <button type="button" className="button secondary" onClick={() => {
            if (window.confirm('¿Restaurar la copia «' + backup.label + '»? El estado actual se guardará antes como otra copia.')) { store.restoreBackup(backup.slot); setBackupVersion((value) => value + 1); notify('Copia restaurada.'); }
          }}><RotateCcw size={15} /> Restaurar</button>
        </li>)}</ul> : <p className="muted">Se crean automáticamente antes de generar o borrar rondas, importar o aplicar un reglamento (máximo {MAX_BACKUPS}).</p>}
      </>}
      <p className="muted">Uso del almacenamiento del navegador: {formatNumber(state.usageBytes / 1048576)} MB.</p>
    </section>
  </>;
}
