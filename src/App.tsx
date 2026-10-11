import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Activity, ArrowDown, ArrowRight, ArrowUp, BookOpen, Check, ChevronRight, CircleHelp, Clock3, ExternalLink, Gavel, LayoutDashboard, LogOut, Monitor, Pause, Play, Plus, RefreshCw, RotateCcw, Save, Settings, ShieldCheck, Trash2, Users, Volume2, VolumeX, X } from 'lucide-react';
import type { Judge, Phase, PublicRoom, Room, Round, Team, Tournament } from './domain';
import { apiConfigured, getPublicRoom, getRoomControllerToken, getTournament, login, logout as apiLogout, saveTournament, updateTimer } from './api';
import { readDemo, writeDemo } from './demo';
import { createTimer, formatTime, LEDU_PHASES, secondsLeft, transitionTimer, validateAssignments, withRoomStatus } from './timer';
import type { TimerAction } from './timer';

const SESSION_KEY = 'ledu-admin-session';
const POLL_MS = 10000;
type View = 'overview' | 'rooms' | 'teams' | 'judges' | 'settings';

function getSession(): { token: string; expiresAt: number } | null {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as { token?: string; expiresAt?: number } | null;
    return session?.token && (session.expiresAt ?? 0) > Date.now() ? { token: session.token, expiresAt: session.expiresAt ?? 0 } : null;
  } catch { return null; }
}

function makeId(prefix: string): string { return prefix + Math.random().toString(36).slice(2, 9); }

export default function App() {
  const roomId = window.location.pathname.match(/^\/sala\/([^/]+)/)?.[1] ?? '';
  const [data, setData] = useState<Tournament>(readDemo);
  const [session, setSession] = useState(getSession);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [serverError, setServerError] = useState('');
  const [view, setView] = useState<View>('overview');
  const [selectedRound, setSelectedRound] = useState('');
  const [now, setNow] = useState(Date.now());
  const [snapshot, setSnapshot] = useState<PublicRoom | null>(null);
  const [saving, setSaving] = useState(false);
  const [preparingRoomId, setPreparingRoomId] = useState<string | null>(null);
  const [preparedRoomLink, setPreparedRoomLink] = useState<{ roomName: string; href: string } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const hasUnsavedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [formatDirty, setFormatDirty] = useState(false);
  const [roomFormatMismatch, setRoomFormatMismatch] = useState(false);
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<string, string>>({});
  const [soundEnabled, setSoundEnabled] = useState(() => { try { return localStorage.getItem('ledu-timer-sound') === 'true'; } catch { return false; } });
  const controllerToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('control') ?? '';

  const reloadAdmin = useCallback(async () => {
    if (apiConfigured && session) {
      try {
        const requestStartedAt = Date.now();
        const fresh = await getTournament(session.token);
        const responseReceivedAt = Date.now();
        if (typeof fresh.serverTime === 'number') setServerOffsetMs(fresh.serverTime - (requestStartedAt + responseReceivedAt) / 2);
        const format = fresh.formatPhases?.length ? fresh.formatPhases : LEDU_PHASES;
        const roomFormatMismatch = fresh.rooms.some((room) => JSON.stringify(room.phases) !== JSON.stringify(format));
        setRoomFormatMismatch(roomFormatMismatch);
        setData((current) => {
          if (!hasUnsavedRef.current) return fresh;
          const refreshedRooms = fresh.rooms.map((remote) => {
            const local = current.rooms.find((room) => room.id === remote.id);
            if (!local) return remote;
            const merged = { ...remote, name: local.name, roundId: local.roundId, teamFavorId: local.teamFavorId,
              teamContraId: local.teamContraId, judgeIds: local.judgeIds, phases: local.phases, notes: local.notes };
            return { ...withRoomStatus({ ...merged, timer: remote.timer }, fresh.minimumJudgesPerRoom ?? 1), updatedAt: remote.updatedAt };
          });
          const addedLocally = current.rooms.filter((room) => !fresh.rooms.some((remote) => remote.id === room.id));
          return { ...fresh, tournamentName: current.tournamentName, rounds: current.rounds, teams: current.teams,
            judges: current.judges, rooms: [...refreshedRooms, ...addedLocally], formatPhases: current.formatPhases,
            revision: current.revision, updatedAt: current.updatedAt };
        });
        setConnected(true);
        setLastSyncedAt(Date.now());
        setServerError('');
      } catch (error) {
        setConnected(false);
        if (error instanceof Error && 'code' in error && (error as Error & { code?: string }).code === 'UNAUTHORIZED') { localStorage.removeItem(SESSION_KEY); setSession(null); }
        setServerError(error instanceof Error ? error.message : 'No se ha podido cargar el torneo.');
      }
    } else if (!apiConfigured) setData(readDemo());
  }, [session]);

  const reloadRoom = useCallback(async () => {
    if (!roomId) return;
    if (apiConfigured) {
      try {
        const requestStartedAt = Date.now();
        const fresh = await getPublicRoom(roomId);
        const responseReceivedAt = Date.now();
        setSnapshot(fresh);
        setServerOffsetMs(fresh.serverTime - (requestStartedAt + responseReceivedAt) / 2);
        setConnected(true); setLastSyncedAt(responseReceivedAt); setServerError('');
      }
      catch (error) { setConnected(false); setServerError(error instanceof Error ? error.message : 'No se ha podido cargar la sala.'); }
    } else {
      const fresh = readDemo();
      setData(fresh);
      const room = fresh.rooms.find((item) => item.id === roomId || item.name.toLowerCase() === roomId.toLowerCase());
      if (!room) { setSnapshot(null); return; }
      const round = fresh.rounds.find((item) => item.id === room.roundId);
      setSnapshot({
        tournamentName: fresh.tournamentName, roundName: round?.name ?? '',
        room, teamFavor: fresh.teams.find((item) => item.id === room.teamFavorId)?.name ?? '',
        teamContra: fresh.teams.find((item) => item.id === room.teamContraId)?.name ?? '',
        judges: room.judgeIds.map((id) => fresh.judges.find((item) => item.id === id)?.name ?? '').filter(Boolean),
        serverTime: Date.now(),
      });
      setConnected(true);
      setLastSyncedAt(Date.now());
      setServerError('');
    }
  }, [roomId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (roomId) {
      void reloadRoom();
      const id = window.setInterval(() => void reloadRoom(), POLL_MS);
      return () => window.clearInterval(id);
    }
    if (session) {
      void reloadAdmin();
      const id = window.setInterval(() => void reloadAdmin(), POLL_MS);
      return () => window.clearInterval(id);
    }
  }, [roomId, session, reloadAdmin, reloadRoom]);

  useEffect(() => {
    if (!selectedRound && data.rounds.length) setSelectedRound(data.rounds.find((round) => round.active)?.id ?? data.rounds[0].id);
  }, [data.rounds, selectedRound]);

  const updateData = (updater: (current: Tournament) => Tournament) => {
    setPreparedRoomLink(null);
    hasUnsavedRef.current = true;
    setHasUnsavedChanges(true);
    setData((current) => ({ ...updater(current), updatedAt: Date.now() }));
  };
  const persist = async (): Promise<Tournament | null> => {
    setSaving(true);
    try {
      let payload = data;
      if (formatDirty) {
        if (data.rooms.some((room) => room.timer.status === 'running' || room.timer.status === 'paused')) {
          throw new Error('Pausa o finaliza los cronómetros antes de aplicar un cambio global de formato. No se alterará ningún debate en curso.');
        }
        const phases = data.formatPhases?.length ? data.formatPhases : LEDU_PHASES;
        const timestamp = Date.now();
        payload = {
          ...data,
          rooms: data.rooms.map((room) => ({
            ...room,
            phases,
            timer: { ...createTimer(phases), revision: room.timer.revision + 1, updatedAt: timestamp },
            updatedAt: timestamp,
          })),
        };
      }
      const issues = validateAssignments(payload);
      if (issues.length) throw new Error('Corrige las asignaciones antes de guardar: ' + issues.slice(0, 3).join(' '));
      let saved: Tournament;
      if (apiConfigured) {
        if (!session) throw new Error('Inicia sesión antes de guardar.');
        saved = await saveTournament(session.token, data.revision, payload);
      } else {
        saved = { ...payload, revision: payload.revision + 1, updatedAt: Date.now() };
        writeDemo(saved);
      }
      setData(saved);
      hasUnsavedRef.current = false;
      setHasUnsavedChanges(false);
      setFormatDirty(false);
      setRoomFormatMismatch(false);
      setConnected(true);
      setLastSyncedAt(Date.now());
      setServerError('');
      return saved;
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'No se han podido guardar los cambios.');
      return null;
    } finally { setSaving(false); }
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError('');
    try {
      const result = apiConfigured ? await login(password) : password === 'contraseña' ? { token: 'demo-session', expiresAt: Date.now() + 8 * 60 * 60 * 1000 } : null;
      if (!result) throw new Error('Contraseña incorrecta.');
      localStorage.setItem(SESSION_KEY, JSON.stringify(result));
      setSession(result);
      setPassword('');
    } catch (error) { setLoginError(error instanceof Error ? error.message : 'No se ha podido iniciar sesión.'); }
  };

  const logout = () => {
    const token = session?.token;
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setView('overview');
    if (apiConfigured && token) void apiLogout(token).catch(() => undefined);
  };

  const timerAction = async (action: TimerAction) => {
    if (!snapshot) return;
    try {
      if (apiConfigured) {
        const requestStartedAt = Date.now();
        const updated = await updateTimer(snapshot.room.id, action, snapshot.room.timer.revision, controllerToken);
        const responseReceivedAt = Date.now();
        setServerOffsetMs(updated.serverTime - (requestStartedAt + responseReceivedAt) / 2);
        setSnapshot(updated);
      } else {
        const current = readDemo();
        const room = current.rooms.find((item) => item.id === snapshot.room.id);
        if (!room) return;
        const changed = withRoomStatus({ ...room, timer: transitionTimer(room.timer, room.phases, action) }, current.minimumJudgesPerRoom ?? 1);
        const next = { ...current, rooms: current.rooms.map((item) => item.id === room.id ? changed : item), revision: current.revision + 1, updatedAt: Date.now() };
        writeDemo(next);
        setData(next);
        await reloadRoom();
      }
      setConnected(true);
      setServerError('');
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'No se ha podido controlar el cronómetro.');
      if (error instanceof Error && 'code' in error && (error as Error & { code?: string }).code === 'REVISION_CONFLICT') await reloadRoom();
    }
  };

  const openRoom = async (id: string, rotate = false) => {
    if (preparingRoomId) return;
    if (rotate && !window.confirm('Regenerar el enlace de control invalida el enlace anterior para esta sala. ¿Continuar?')) return;

    // Prepare the destination first. A real anchor, clicked in a second gesture,
    // is more reliable than window.open() after asynchronous save/token calls.
    setPreparedRoomLink(null);
    setServerError('');
    setPreparingRoomId(id);
    try {
      const saved = await persist();
      if (!saved) return;

      let hash = '';
      if (apiConfigured) {
        if (!session) throw new Error('La sesión ha caducado. Vuelve a iniciar sesión.');
        const control = await getRoomControllerToken(session.token, id, rotate);
        hash = '#control=' + encodeURIComponent(control.token);
      }

      const roomName = saved.rooms.find((room) => room.id === id)?.name || id;
      setPreparedRoomLink({
        roomName,
        href: window.location.origin + '/sala/' + encodeURIComponent(id) + hash,
      });
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'No se ha podido preparar el enlace de control de la sala.');
    } finally {
      setPreparingRoomId(null);
    }
  };

  if (roomId) return <RoomScreen snapshot={snapshot} now={now} serverOffsetMs={serverOffsetMs} error={serverError} onAction={timerAction} onRetry={() => void reloadRoom()} controllerEnabled={!apiConfigured || Boolean(controllerToken)} soundEnabled={soundEnabled} onToggleSound={() => setSoundEnabled((enabled) => { const next = !enabled; localStorage.setItem('ledu-timer-sound', String(next)); if (next) playTone(); return next; })} connected={connected} lastSyncedAt={lastSyncedAt} />;

  if (!session) {
    return <div className="login-shell">
      <aside className="login-hero"><div className="brand"><span className="brand-mark">L</span><span>LEDU <b>Control</b></span></div><p className="eyebrow">OPERACIONES DEL TORNEO</p><h1>Un torneo.<br />Todas las salas.<br /><em>Una sola visión.</em></h1><p className="hero-copy">Organiza equipos, coordina al panel de jueces y sigue el estado de cada debate desde un único lugar.</p><div className="hero-tags"><span><ShieldCheck size={15} /> Gestión privada</span><span><Activity size={15} /> Actualización automática</span></div></aside>
      <main className="login-side"><form className="login-card" onSubmit={submitLogin}><span className="eyebrow">PANEL DE ORGANIZACIÓN</span><h2>Acceso al torneo</h2><p>Introduce la contraseña para gestionar rondas, equipos, jueces y salas.</p><label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Introduce la contraseña" required /><button className="button primary full" type="submit">Entrar al panel <ArrowRight size={17} /></button>{loginError && <p className="error">{loginError}</p>}<p className="security-note"><ShieldCheck size={15} /> {apiConfigured ? 'Autenticación validada por el backend.' : 'Modo de demostración: contraseña' + ' contraseña'}.</p><p className="subtle">Los cronómetros de sala se abren por enlace y no requieren iniciar sesión.</p></form></main>
    </div>;
  }

  const activeRound = selectedRound || data.rounds[0]?.id || '';
  const rooms = data.rooms.filter((room) => room.roundId === activeRound);
  const counts = { total: rooms.length, running: rooms.filter((room) => room.timer.status === 'running').length, ready: rooms.filter((room) => room.status === 'ready').length, unassigned: rooms.filter((room) => room.status === 'unassigned').length, finished: rooms.filter((room) => room.timer.status === 'finished').length };

  const addTeam = () => {
    const name = window.prompt('Nombre del equipo');
    if (!name?.trim()) return;
    const team: Team = { id: makeId('t'), name: name.trim(), institution: '', active: true };
    updateData((current) => ({ ...current, teams: [...current.teams, team] }));
  };
  const addJudge = () => {
    const name = window.prompt('Nombre del juez/a');
    if (!name?.trim()) return;
    const judge: Judge = { id: makeId('j'), name: name.trim(), institution: '', active: true };
    updateData((current) => ({ ...current, judges: [...current.judges, judge] }));
  };
  const addRoom = () => {
    const name = window.prompt('Nombre de la sala', 'Sala nueva');
    if (!name?.trim()) return;
    const roundIdValue = activeRound || data.rounds[0]?.id || makeId('r');
    const room: Room = { id: makeId('s'), name: name.trim(), roundId: roundIdValue, teamFavorId: '', teamContraId: '', judgeIds: [], status: 'unassigned', phases: data.rooms[0]?.phases ?? [], timer: data.rooms[0]?.timer ? { ...data.rooms[0].timer, status: 'idle', phaseIndex: 0, remainingSeconds: data.rooms[0].phases[0]?.durationSeconds ?? 240, startedAt: null, lastResumedAt: null, revision: 0 } : { status: 'idle', phaseIndex: 0, remainingSeconds: 240, startedAt: null, lastResumedAt: null, revision: 0, updatedAt: Date.now() }, notes: '', updatedAt: Date.now() };
    updateData((current) => ({ ...current, rooms: [...current.rooms, room] }));
  };
  const updateRoom = (id: string, patch: Partial<Room>) => {
    const currentRoom = data.rooms.find((room) => room.id === id);
    if (!currentRoom) return;
    const assignmentsChanged =
      (patch.teamFavorId !== undefined && patch.teamFavorId !== currentRoom.teamFavorId) ||
      (patch.teamContraId !== undefined && patch.teamContraId !== currentRoom.teamContraId) ||
      (patch.roundId !== undefined && patch.roundId !== currentRoom.roundId) ||
      (patch.judgeIds !== undefined && JSON.stringify(patch.judgeIds) !== JSON.stringify(currentRoom.judgeIds));
    if (assignmentsChanged && (currentRoom.timer.status === 'running' || currentRoom.timer.status === 'paused') &&
      !window.confirm('Esta sala tiene un cronómetro iniciado o pausado. Cambiar la asignación puede afectar al debate. ¿Confirmas el cambio?')) return;
    updateData((current) => ({ ...current, rooms: current.rooms.map((room) => room.id === id ? withRoomStatus({ ...room, ...patch }, current.minimumJudgesPerRoom ?? 1) : room) }));
  };
  const addRound = () => {
    const name = window.prompt('Nombre de la ronda', 'Ronda ' + (data.rounds.length + 1));
    if (!name?.trim()) return;
    const newRound: Round = { id: makeId('r'), number: data.rounds.length + 1, name: name.trim(), active: false };
    updateData((current) => ({ ...current, rounds: [...current.rounds, newRound] }));
    setSelectedRound(newRound.id);
  };

  const configuredPhases = data.formatPhases?.length ? data.formatPhases : (data.rooms[0]?.phases?.length ? data.rooms[0].phases : LEDU_PHASES);
  const updatePhase = (id: string, patch: Partial<Phase>) => {
    setFormatDirty(true);
    updateData((current) => {
      const phases = current.formatPhases?.length ? current.formatPhases : (current.rooms[0]?.phases?.length ? current.rooms[0].phases : LEDU_PHASES);
      return { ...current, formatPhases: phases.map((phase) => phase.id === id ? { ...phase, ...patch } : phase) };
    });
  };
  const movePhase = (index: number, offset: number) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= configuredPhases.length) return;
    setFormatDirty(true);
    updateData((current) => {
      const phases = [...(current.formatPhases?.length ? current.formatPhases : configuredPhases)];
      [phases[index], phases[nextIndex]] = [phases[nextIndex], phases[index]];
      return { ...current, formatPhases: phases };
    });
  };
  const addPhase = () => {
    setFormatDirty(true);
    updateData((current) => {
      const phases = current.formatPhases?.length ? current.formatPhases : configuredPhases;
      const phase: Phase = { id: makeId('p'), name: 'Nueva intervención', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 180, type: 'other', warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true };
      return { ...current, formatPhases: [...phases, phase] };
    });
  };
  const removePhase = (id: string) => {
    if (configuredPhases.length <= 1) { setServerError('El formato debe tener al menos una intervención.'); return; }
    setFormatDirty(true);
    updateData((current) => ({ ...current, formatPhases: (current.formatPhases ?? configuredPhases).filter((phase) => phase.id !== id) }));
  };
  const markRoundActive = (roundId: string) => updateData((current) => ({ ...current, rounds: current.rounds.map((round) => ({ ...round, active: round.id === roundId })) }));
  const renameSelectedRound = () => {
    const round = data.rounds.find((item) => item.id === activeRound);
    if (!round) return;
    const name = window.prompt('Nombre de la ronda', round.name);
    if (name?.trim()) updateData((current) => ({ ...current, rounds: current.rounds.map((item) => item.id === round.id ? { ...item, name: name.trim() } : item) }));
  };
  const assignmentWarnings = validateAssignments(data);
  const hasLiveTimer = data.rooms.some((room) => room.timer.status === 'running' || room.timer.status === 'paused');

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">L</span><span>LEDU <b>Control</b></span></div><div className="sidebar-section">TORNEO</div><nav>
      <NavButton icon={<LayoutDashboard size={18} />} label="Resumen" selected={view === 'overview'} onClick={() => setView('overview')} />
      <NavButton icon={<Monitor size={18} />} label="Rondas y salas" selected={view === 'rooms'} onClick={() => setView('rooms')} />
      <NavButton icon={<Users size={18} />} label="Equipos" selected={view === 'teams'} onClick={() => setView('teams')} />
      <NavButton icon={<Gavel size={18} />} label="Jueces" selected={view === 'judges'} onClick={() => setView('judges')} />
      <NavButton icon={<Settings size={18} />} label="Configuración" selected={view === 'settings'} onClick={() => setView('settings')} />
    </nav><div className="sidebar-bottom"><span className="connection-dot" />{apiConfigured ? 'Google Sheets conectado' : 'Modo demostración'}<button className="sidebar-logout" onClick={logout}><LogOut size={16} /> Cerrar sesión</button></div></aside>
    <main className="main-area"><header className="topbar"><div><span className="eyebrow">GESTIÓN DEL TORNEO</span><h1>{data.tournamentName}</h1></div><div className="top-actions"><span className="live-status"><i className={connected ? '' : 'disconnected'} /> {connected ? 'Conectado · cada 10 s' : 'Sin conexión confirmada'}</span><button className="icon-button" title="Actualizar" onClick={() => void reloadAdmin()}><RefreshCw size={17} /></button><button className="button primary" onClick={() => void persist()} disabled={saving}><Save size={16} />{saving ? 'Guardando…' : formatDirty ? 'Aplicar formato y guardar' : hasUnsavedChanges ? 'Guardar cambios · pendientes' : 'Guardar cambios'}</button></div></header>
      {serverError && <div className="notice error-notice"><CircleHelp size={17} /><span>{serverError}</span><button onClick={() => setServerError('')} aria-label="Cerrar aviso"><X size={16} /></button></div>}
      {preparingRoomId && <div className="notice warning-notice"><RefreshCw size={17} /><span>Guardando los cambios y preparando el enlace de la sala…</span></div>}
      {preparedRoomLink && <div className="notice warning-notice room-link-ready"><Check size={17} /><span>La sala <b>{preparedRoomLink.roomName}</b> está guardada y lista. Ábrela en una pestaña nueva:</span><a className="button primary" href={preparedRoomLink.href} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Abrir cronómetro</a><button className="text-button" onClick={() => setPreparedRoomLink(null)} aria-label="Cerrar enlace preparado"><X size={16} /></button></div>}
      {hasUnsavedChanges && <div className="notice warning-notice"><CircleHelp size={17} /><span>Tienes cambios locales sin guardar. El panel seguirá actualizando los cronómetros sin descartar estas ediciones.</span><button className="text-button" onClick={() => { if (window.confirm('¿Descartar todos los cambios locales y volver a cargar los datos guardados?')) { hasUnsavedRef.current = false; setHasUnsavedChanges(false); setFormatDirty(false); void reloadAdmin(); } }}>Descartar y recargar</button></div>}
      {assignmentWarnings.length > 0 && view !== 'settings' && <div className="notice warning-notice"><CircleHelp size={17} /><span>Hay incidencias en las asignaciones: {assignmentWarnings.slice(0, 2).join(' ')}{assignmentWarnings.length > 2 ? ' +' + (assignmentWarnings.length - 2) + ' más.' : ''}</span></div>}
      {view === 'overview' && <><div className="page-heading"><div><p className="eyebrow">VISTA OPERATIVA</p><h2>Estado del torneo</h2><p className="muted">Seguimiento de debates, asignaciones y cronómetros.</p></div><div className="round-badge"><BookOpen size={17} /><span>Ronda activa: <b>{data.rounds.find((round) => round.active)?.name ?? 'Sin ronda activa'}</b></span></div></div>
      <div className="stat-grid"><Stat label="Salas de la ronda" value={counts.total} icon={<Monitor />} /><Stat label="En debate" value={counts.running} icon={<Activity />} /><Stat label="Preparadas" value={counts.ready} icon={<Check />} /><Stat label="Pendientes" value={counts.unassigned} icon={<Clock3 />} /></div>
      <section className="panel"><div className="panel-title"><div><h3>Estado de las salas</h3><p>Selecciona una sala para abrir su cronómetro público.</p></div><button className="text-button" onClick={() => setView('rooms')}>Gestionar salas <ArrowRight size={15} /></button></div><div className="room-list">{rooms.map((room) => <RoomRow key={room.id} room={room} data={data} now={now + serverOffsetMs} onOpen={() => void openRoom(room.id)} />)}</div>{rooms.length === 0 && <Empty text="No hay salas creadas para esta ronda." />}</section></>}

      {view === 'rooms' && <><div className="page-heading"><div><p className="eyebrow">ASIGNACIÓN</p><h2>Rondas y salas</h2><p className="muted">Los jueces y equipos de cada sala se sincronizan con los cronómetros.</p></div><button className="button secondary" onClick={addRound}><Plus size={16} /> Nueva ronda</button></div><div className="round-tabs">{data.rounds.map((round) => <button key={round.id} className={round.id === activeRound ? 'selected' : ''} onClick={() => setSelectedRound(round.id)}>{round.name}{round.active ? ' · Activa' : ''}</button>)}<button onClick={addRoom}><Plus size={15} /> Sala</button><button onClick={renameSelectedRound} disabled={!activeRound}>Renombrar ronda</button><button onClick={() => markRoundActive(activeRound)} disabled={!activeRound || data.rounds.find((round) => round.id === activeRound)?.active}>Marcar activa</button></div><div className="managed-rooms">{rooms.map((room) => <section className="panel room-editor" key={room.id}><div className="panel-title"><div><input className="table-input room-name-input" aria-label="Nombre de la sala" value={room.name} onChange={(event) => updateRoom(room.id, { name: event.target.value })} /><p className="muted">Enlace público: /sala/{room.id}</p></div><div className="room-open-actions"><button className="icon-button" title="Abrir cronómetro" onClick={() => void openRoom(room.id)}><ExternalLink size={16} /></button><button className="text-button" title="Invalidar y regenerar el enlace de control" onClick={() => void openRoom(room.id, true)}>Regenerar enlace</button></div></div><div className="assign-grid"><label>Equipo a favor<select value={room.teamFavorId} onChange={(event) => updateRoom(room.id, { teamFavorId: event.target.value })}><option value="">Pendiente de asignar</option>{data.teams.filter((team) => team.active || team.id === room.teamFavorId || team.id === room.teamContraId).map((team) => <option key={team.id} value={team.id}>{team.name}{team.active ? '' : ' · Inactivo'}</option>)}</select></label><label>Equipo en contra<select value={room.teamContraId} onChange={(event) => updateRoom(room.id, { teamContraId: event.target.value })}><option value="">Pendiente de asignar</option>{data.teams.filter((team) => team.active || team.id === room.teamFavorId || team.id === room.teamContraId).map((team) => <option key={team.id} value={team.id}>{team.name}{team.active ? '' : ' · Inactivo'}</option>)}</select></label></div><div className="judges-select"><b>Jueces asignados</b><div className="check-grid">{data.judges.filter((judge) => judge.active || room.judgeIds.includes(judge.id)).map((judge) => <label key={judge.id} className="check-item"><input type="checkbox" checked={room.judgeIds.includes(judge.id)} onChange={(event) => updateRoom(room.id, { judgeIds: event.target.checked ? [...room.judgeIds, judge.id] : room.judgeIds.filter((id) => id !== judge.id) })} />{judge.name}{judge.active ? '' : ' · Inactivo'}</label>)}</div></div><div className="room-editor-footer"><span className={'state-pill ' + room.status}>{room.status === 'ready' ? 'Preparada' : room.status === 'unassigned' ? 'Pendiente' : room.status === 'running' ? 'En curso' : room.status === 'paused' ? 'Pausada' : 'Finalizada'}</span><button className="text-button" onClick={() => void openRoom(room.id)}>Abrir cronómetro <ChevronRight size={15} /></button></div></section>)}</div>{rooms.length === 0 && <Empty text="Añade una sala a esta ronda para comenzar." />}</>}

      {view === 'teams' && <><div className="page-heading"><div><p className="eyebrow">PARTICIPANTES</p><h2>Equipos</h2><p className="muted">Listado de equipos disponibles para enfrentamientos.</p></div><button className="button primary" onClick={addTeam}><Plus size={16} /> Añadir equipo</button></div><section className="panel table-panel"><table><thead><tr><th>Equipo</th><th>Institución</th><th>Estado</th></tr></thead><tbody>{data.teams.map((team) => <tr key={team.id}><td><input className="table-input" aria-label="Nombre del equipo" value={team.name} onChange={(event) => updateData((current) => ({ ...current, teams: current.teams.map((item) => item.id === team.id ? { ...item, name: event.target.value } : item) }))} /></td><td><input className="table-input" aria-label="Institución del equipo" value={team.institution} onChange={(event) => updateData((current) => ({ ...current, teams: current.teams.map((item) => item.id === team.id ? { ...item, institution: event.target.value } : item) }))} /></td><td><button className={'state-pill ' + (team.active ? 'ready' : 'unassigned')} onClick={() => updateData((current) => ({ ...current, teams: current.teams.map((item) => item.id === team.id ? { ...item, active: !item.active } : item) }))}>{team.active ? 'Activo' : 'Inactivo'}</button></td></tr>)}</tbody></table></section></>}

      {view === 'judges' && <><div className="page-heading"><div><p className="eyebrow">PANEL DE JUECES</p><h2>Jueces</h2><p className="muted">Un debate puede incluir varios jueces. Evita duplicar una asignación dentro de la misma ronda.</p></div><button className="button primary" onClick={addJudge}><Plus size={16} /> Añadir juez</button></div><section className="panel table-panel"><table><thead><tr><th>Juez/a</th><th>Institución</th><th>Estado</th></tr></thead><tbody>{data.judges.map((judge) => <tr key={judge.id}><td><input className="table-input" aria-label="Nombre del juez" value={judge.name} onChange={(event) => updateData((current) => ({ ...current, judges: current.judges.map((item) => item.id === judge.id ? { ...item, name: event.target.value } : item) }))} /></td><td><input className="table-input" aria-label="Institución del juez" value={judge.institution} onChange={(event) => updateData((current) => ({ ...current, judges: current.judges.map((item) => item.id === judge.id ? { ...item, institution: event.target.value } : item) }))} /></td><td><button className={'state-pill ' + (judge.active ? 'ready' : 'unassigned')} onClick={() => updateData((current) => ({ ...current, judges: current.judges.map((item) => item.id === judge.id ? { ...item, active: !item.active } : item) }))}>{judge.active ? 'Activo' : 'Inactivo'}</button></td></tr>)}</tbody></table></section></>}

      {view === 'settings' && <><div className="page-heading"><div><p className="eyebrow">CONFIGURACIÓN</p><h2>Formato y torneo</h2><p className="muted">Edita la secuencia base. Los cambios se aplicarán a todas las salas cuando guardes.</p></div><button className="button secondary" onClick={() => { setFormatDirty(true); updateData((current) => ({ ...current, formatPhases: LEDU_PHASES.map((phase) => ({ ...phase })) })); }}><RotateCcw size={16} /> Restaurar preset LEDU</button></div>
      <section className="panel settings-panel"><label className="settings-name">Nombre del torneo<input className="table-input" value={data.tournamentName} onChange={(event) => updateData((current) => ({ ...current, tournamentName: event.target.value }))} /></label><label className="settings-name">Mínimo de jueces por sala<input className="table-input" type="number" min={1} max={25} step={1} value={data.minimumJudgesPerRoom ?? 1} onChange={(event) => updateData((current) => ({ ...current, minimumJudgesPerRoom: Math.max(1, Math.min(25, Math.trunc(Number(event.target.value) || 1))) }))} /></label>{roomFormatMismatch && <div className="notice warning-notice"><CircleHelp size={17} /><span>El formato global no coincide con el guardado en una o varias salas. Aplica el formato global para migrarlas; los relojes se reiniciarán al primer turno.</span><button className="button secondary" disabled={hasLiveTimer} onClick={() => { setFormatDirty(true); updateData((current) => ({ ...current })); }}>Aplicar a todas las salas</button></div>}<div className="format-summary"><div><b>{configuredPhases.length} intervenciones</b><span>Duración teórica total: {formatTime(configuredPhases.reduce((total, phase) => total + phase.durationSeconds, 0))}</span></div><span className={formatDirty ? 'state-pill paused' : 'state-pill ready'}>{formatDirty ? 'Formato modificado' : 'Formato guardado'}</span></div>
      {hasLiveTimer && <div className="notice warning-notice"><CircleHelp size={17} /><span>Hay debates iniciados o pausados. Por seguridad, no se aplicará el formato hasta que todos estén detenidos.</span></div>}
      <div className="format-table-wrap"><table className="format-table"><thead><tr><th>#</th><th>Intervención</th><th>Tipo</th><th>Postura</th><th>Quién interviene</th><th>Segundos</th><th>Avisos</th><th>Exceso</th><th>Orden</th></tr></thead><tbody>{configuredPhases.map((phase, index) => <tr key={phase.id}><td>{index + 1}</td><td><input className="table-input" aria-label={'Nombre intervención ' + (index + 1)} value={phase.name} onChange={(event) => updatePhase(phase.id, { name: event.target.value })} /></td><td><select className="format-select" aria-label="Tipo de intervención" value={phase.type ?? 'other'} onChange={(event) => updatePhase(phase.id, { type: event.target.value as Phase['type'] })}><option value="opening">Exposición inicial</option><option value="cross-examination">Examen cruzado</option><option value="rebuttal">Refutación</option><option value="cross-rebuttal">Refutación cruzada</option><option value="conclusion">Conclusión</option><option value="other">Otro</option></select></td><td><select className="format-select" aria-label="Postura" value={phase.side} onChange={(event) => updatePhase(phase.id, { side: event.target.value as Phase['side'] })}><option value="favor">A favor</option><option value="contra">En contra</option></select></td><td><input className="table-input" aria-label="Interviniente" value={phase.speaker} onChange={(event) => updatePhase(phase.id, { speaker: event.target.value })} /></td><td><div className="duration-input"><input type="number" min={1} max={7200} value={phase.durationSeconds} aria-label="Duración en segundos" onChange={(event) => updatePhase(phase.id, { durationSeconds: Math.max(1, Math.min(7200, Number(event.target.value) || 1)) })} /><small>{formatTime(phase.durationSeconds)}</small></div></td><td><input className="threshold-input" aria-label="Umbrales de aviso en segundos" title="Segundos separados por coma" value={thresholdDrafts[phase.id] ?? (phase.warningThresholdsSeconds ?? []).join(', ')} onChange={(event) => { const value = event.target.value; setThresholdDrafts((drafts) => ({ ...drafts, [phase.id]: value })); if (/^\s*$|^\s*\d+\s*(,\s*\d+\s*)*$/.test(value)) updatePhase(phase.id, { warningThresholdsSeconds: value.trim() ? value.split(',').map((item) => Number(item.trim())) : [] }); }} onBlur={() => { const value = thresholdDrafts[phase.id] ?? (phase.warningThresholdsSeconds ?? []).join(', '); updatePhase(phase.id, { warningThresholdsSeconds: value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item >= 0) }); setThresholdDrafts((drafts) => { const next = { ...drafts }; delete next[phase.id]; return next; }); }} /></td><td><label className="overtime-toggle"><input type="checkbox" checked={phase.allowOvertimeDisplay !== false} onChange={(event) => updatePhase(phase.id, { allowOvertimeDisplay: event.target.checked })} />Sí</label></td><td><div className="phase-order"><button className="icon-button" title="Subir intervención" aria-label="Subir intervención" disabled={index === 0} onClick={() => movePhase(index, -1)}><ArrowUp size={14} /></button><button className="icon-button" title="Bajar intervención" aria-label="Bajar intervención" disabled={index === configuredPhases.length - 1} onClick={() => movePhase(index, 1)}><ArrowDown size={14} /></button><button className="icon-button danger-action" title="Eliminar intervención" aria-label="Eliminar intervención" disabled={configuredPhases.length <= 1} onClick={() => removePhase(phase.id)}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div><div className="settings-actions"><button className="button secondary" onClick={addPhase}><Plus size={16} /> Añadir intervención</button><p className="muted">Los cambios de formato reinician los cronómetros detenidos al primer turno al guardar.</p></div></section></>}

      <footer className="footer"><span>LEDU Control · Herramienta de organización</span><span>{connected ? 'Conectado' : 'Conexión no confirmada'} · {lastSyncedAt ? 'Última sincronización: ' + new Date(lastSyncedAt).toLocaleTimeString('es-ES') : 'Sin sincronización confirmada'} · {apiConfigured ? 'Google Sheets' : 'Demo local'}</span></footer>
    </main>
  </div>;
}

function NavButton({ icon, label, selected, onClick }: { icon: React.ReactNode; label: string; selected: boolean; onClick: () => void }) {
  return <button className={'nav-button ' + (selected ? 'selected' : '')} onClick={onClick}>{icon}<span>{label}</span><ChevronRight size={15} /></button>;
}
function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <div className="stat-card"><span className="stat-icon">{icon}</span><div><span>{label}</span><b>{value}</b></div></div>;
}
function Empty({ text }: { text: string }) { return <div className="empty"><Monitor size={24} /><p>{text}</p></div>; }

function RoomRow({ room, data, onOpen, now }: { room: Room; data: Tournament; onOpen: () => void; now: number }) {
  const favor = data.teams.find((team) => team.id === room.teamFavorId)?.name || 'Equipo pendiente';
  const contra = data.teams.find((team) => team.id === room.teamContraId)?.name || 'Equipo pendiente';
  const judges = room.judgeIds.map((id) => data.judges.find((judge) => judge.id === id)?.name).filter(Boolean);
  const title = room.timer.status === 'running' ? 'En curso' : room.timer.status === 'paused' ? 'Pausada' : room.timer.status === 'finished' ? 'Finalizada' : room.status === 'ready' ? 'Preparada' : 'Pendiente';
  return <button className="room-row" onClick={onOpen}><div className={'room-icon ' + room.status}><Monitor size={18} /></div><div className="room-row-main"><b>{room.name}<span className={'state-pill ' + room.status}>{title}</span></b><p>{favor} <i>vs.</i> {contra}</p><small><Gavel size={13} /> {judges.length ? judges.join(' · ') : 'Sin jueces asignados'}</small></div><div className="room-row-end">{room.timer.status === 'running' && <strong>{formatTime(secondsLeft(room.timer, now))}</strong>}<ChevronRight size={17} /></div></button>;
}

function RoomScreen({ snapshot, now, serverOffsetMs, error, onAction, onRetry, controllerEnabled, soundEnabled, onToggleSound, connected, lastSyncedAt }: {
  snapshot: PublicRoom | null;
  now: number;
  serverOffsetMs: number;
  error: string;
  onAction: (action: TimerAction) => void;
  onRetry: () => void;
  controllerEnabled: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  connected: boolean;
  lastSyncedAt: number | null;
}) {
  const room = snapshot?.room;
  const phase = room?.phases[room.timer.phaseIndex];
  const left = room ? secondsLeft(room.timer, now + serverOffsetMs) : 0;
  const pct = phase ? Math.max(0, Math.min(100, left / phase.durationSeconds * 100)) : 0;
  const ended = room?.timer.status === 'finished';
  const timedOut = room?.timer.status === 'running' && left <= 0;
  const fullyAssigned = Boolean(snapshot?.teamFavor && snapshot.teamContra && snapshot.judges.length >= (snapshot.minimumJudgesPerRoom ?? 1) && room?.phases.length);
  const lastLeft = useRef<number | null>(null);

  useEffect(() => {
    const previous = lastLeft.current;
    if (soundEnabled && room?.timer.status === 'running' && previous !== null && left < previous) {
      const thresholds = phase?.warningThresholdsSeconds ?? [30, 10];
      if (thresholds.some((threshold) => previous > threshold && left <= threshold) || (previous > 0 && left <= 0)) playTone();
    }
    lastLeft.current = left;
  }, [left, soundEnabled, room?.timer.status, phase?.id, phase?.warningThresholdsSeconds]);

  const runAction = (action: TimerAction, confirmation?: string) => {
    if (!controllerEnabled || !fullyAssigned) return;
    if (confirmation && !window.confirm(confirmation)) return;
    onAction(action);
  };

  return <main className="timer-shell">
    <header className="timer-top">
      <a href="/gestion" className="brand"><span className="brand-mark">L</span><span>LEDU <b>Control</b></span></a>
      <div className="timer-top-actions">
        <span className="public-pill"><i className={connected ? '' : 'disconnected'} />{connected ? 'SINCRONIZADO' : 'SIN CONEXIÓN'}</span>
        <button className="button secondary sound-toggle" onClick={onToggleSound} aria-pressed={soundEnabled}><>{soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}{soundEnabled ? 'Avisos sonoros activados' : 'Activar sonido'}</></button>
      </div>
    </header>
    {!snapshot ? <section className="timer-empty"><Monitor size={36} /><h1>Sala no disponible</h1><p>{error || 'La sala no existe o aún no se ha configurado.'}</p><button className="button secondary" onClick={onRetry}><RefreshCw size={16} /> Reintentar</button></section> :
    <>
      <section className="timer-heading">
        <p>{snapshot.tournamentName} <span>·</span> {snapshot.roundName}</p>
        <h1>{room?.name}</h1>
        <div className="team-versus"><div><small>A FAVOR</small><b>{snapshot.teamFavor || 'Pendiente'}</b></div><span>VS</span><div><small>EN CONTRA</small><b>{snapshot.teamContra || 'Pendiente'}</b></div></div>
        <div className="judge-line"><Gavel size={16} /><span>{snapshot.judges.length ? snapshot.judges.join(' · ') : 'Jueces pendientes de asignación'}</span></div>
      </section>
      <section className="timer-card">
        <div className="timer-status"><span className={'state-pill ' + (timedOut ? 'paused' : room?.timer.status || '')}>{ended ? 'Debate finalizado' : timedOut ? 'Tiempo agotado · exceso de tiempo' : room?.timer.status === 'running' ? 'Intervención en curso' : room?.timer.status === 'paused' ? 'Cronómetro pausado' : 'Preparado para comenzar'}</span><span>INTERVENCIÓN {(room?.timer.phaseIndex ?? 0) + 1} / {room?.phases.length ?? 0}</span></div>
        <div className="phase-heading"><span>{phase?.name ?? 'Debate completado'}</span><b>{phase?.speaker ?? ''} · {phase?.side === 'favor' ? 'A favor' : phase?.side === 'contra' ? 'En contra' : ''}</b></div>
        <div className={'timer-digits ' + ((left <= 30 || timedOut) && room?.timer.status === 'running' ? 'urgent' : '')}>{formatTime(phase?.allowOvertimeDisplay === false && left < 0 ? 0 : left)}</div>
        <div className="timer-track"><div style={{ width: pct + '%' }} /></div>
        {!fullyAssigned && <div className="notice warning-notice timer-assignment-warning"><CircleHelp size={16} /><span>Para iniciar el debate, asigna los dos equipos, al menos {snapshot?.minimumJudgesPerRoom ?? 1} juez(es) y un formato válido desde el panel.</span></div>}
        <div className="timer-controls">
          {room?.timer.status === 'running'
            ? <button className="button primary big" onClick={() => runAction('pause')} disabled={!controllerEnabled}><Pause size={19} /> Pausar</button>
            : <button className="button primary big" onClick={() => runAction('start')} disabled={!controllerEnabled || !fullyAssigned || ended}><Play size={19} /> {room?.timer.status === 'paused' ? 'Reanudar' : 'Iniciar intervención'}</button>}
          <button className="button secondary big" onClick={() => runAction('previous', '¿Volver a la intervención anterior? Se detendrá el reloj actual.')} disabled={!controllerEnabled || !room || room.timer.phaseIndex === 0 || ended}><ArrowRight className="reverse-arrow" size={18} /> Anterior</button>
          <button className="button secondary big" onClick={() => runAction('next')} disabled={!controllerEnabled || ended}><ArrowRight size={18} /> Siguiente</button>
          <button className="button ghost big" onClick={() => runAction('reset', '¿Reiniciar únicamente esta intervención?')} disabled={!controllerEnabled || !phase}><RotateCcw size={17} /> Reiniciar turno</button>
          <button className="button ghost big" onClick={() => runAction('finish', '¿Dar por finalizado el debate?')} disabled={!controllerEnabled || ended}><Check size={17} /> Finalizar</button>
        </div>
        <p className="timer-note"><ShieldCheck size={15} /> {controllerEnabled ? 'Este enlace puede controlar únicamente el cronómetro de esta sala.' : 'Modo de solo lectura. Para controlar el reloj, abre la sala desde el panel de organización.'} {lastSyncedAt ? 'Última sincronización: ' + new Date(lastSyncedAt).toLocaleTimeString('es-ES') : 'Esperando la primera sincronización.'}</p>
      </section>
      <section className="phase-list"><div className="panel-title"><div><h3>Orden de intervenciones</h3><p>Secuencia y tiempos configurados para este debate</p></div><span>{room?.phases.length ?? 0} intervenciones</span></div>{room?.phases.map((item, index) => <div key={item.id} className={'phase-row ' + (index === room.timer.phaseIndex ? 'current' : index < room.timer.phaseIndex ? 'passed' : '')}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{item.name}</b><small>{item.speaker} · {item.side === 'favor' ? 'A favor' : 'En contra'}</small></div><strong>{formatTime(item.durationSeconds)}</strong>{index === room.timer.phaseIndex && <span className="current-dot" />}</div>)}</section>
    </>}
    {error && <p className="error timer-error">{error}</p>}
    <footer className="footer timer-footer"><span>LEDU Control</span><button className="text-button" onClick={onRetry}><RefreshCw size={14} /> Actualizar estado</button></footer>
  </main>;
}

let audioContext: AudioContext | null = null;
function playTone() {
  try {
    const Context = window.AudioContext;
    if (!Context) return;
    if (!audioContext) audioContext = new Context();
    const context = audioContext;
    if (context.state === 'suspended') void context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
  } catch {
    // Sound is an optional convenience; the visual clock remains authoritative.
  }
}
