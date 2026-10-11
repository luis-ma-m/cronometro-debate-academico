import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Activity, ArrowDown, ArrowRight, ArrowUp, BookOpen, Check, ChevronRight, CircleHelp, Clock3, ExternalLink, Gavel, LayoutDashboard, LogOut, Monitor, Pause, Play, Plus, RefreshCw, RotateCcw, Save, Settings, ShieldCheck, Trash2, Users, Volume2, VolumeX, X } from 'lucide-react';
import type { FormatPreset, Judge, Phase, PhysicalRoom, PublicRoom, Room, Round, Team, Tournament } from './domain';
import { activateRound as apiActivateRound, apiConfigured, getPublicRoom, getRoomControllerToken, getRoundActivationPreview, getTournament, login, logout as apiLogout, saveTournament, updateTimer } from './api';
import type { RoundActivationPreview } from './api';
import { readDemo, writeDemo } from './demo';
import { createTimer, formatTime, LEDU_PHASES, resolvePhases, secondsLeft, transitionTimer, validateAssignments, withRoomStatus } from './timer';
import type { TimerAction } from './timer';

const SESSION_KEY = 'ledu-admin-session';
const POLL_MS = 10000;
type View = 'overview' | 'rooms' | 'teams' | 'judges' | 'settings';

function makeSlug(value: string): string {
  return value.normalize('NFD').replace(/\\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sala';
}

function getSession(): { token: string; expiresAt: number } | null {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as { token?: string; expiresAt?: number } | null;
    return session?.token && (session.expiresAt ?? 0) > Date.now() ? { token: session.token, expiresAt: session.expiresAt ?? 0 } : null;
  } catch { return null; }
}

function makeId(prefix: string): string { return prefix + Math.random().toString(36).slice(2, 9); }

function getInstitutionCatalog(tournament: Pick<Tournament, 'institutions' | 'teams' | 'judges'>): string[] {
  const known = new Map<string, string>();
  for (const rawName of [
    ...(tournament.institutions ?? []),
    ...tournament.teams.map((team) => team.institution),
    ...tournament.judges.map((judge) => judge.institution),
  ]) {
    const name = rawName.trim();
    const key = name.toLocaleLowerCase('es-ES');
    if (name && !known.has(key)) known.set(key, name);
  }
  return [...known.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

function sameInstitution(left: string | undefined, right: string | undefined): boolean {
  const a = left?.trim().toLocaleLowerCase('es-ES') ?? '';
  const b = right?.trim().toLocaleLowerCase('es-ES') ?? '';
  return Boolean(a && b && a === b);
}

function conflictingTeamForJudge(data: Tournament, room: Room, judge: Judge): Team | undefined {
  const teamIds = [room.teamFavorId, room.teamContraId].filter(Boolean);
  return teamIds.map((id) => data.teams.find((team) => team.id === id))
    .find((team): team is Team => Boolean(team && sameInstitution(judge.institution, team.institution)));
}

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
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<string, string>>({});
  const [institutionDraft, setInstitutionDraft] = useState('');
  const [selectedFormatId, setSelectedFormatId] = useState('');
  const [activationPreview, setActivationPreview] = useState<RoundActivationPreview | null>(null);
  const [activatingRound, setActivatingRound] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => { try { return localStorage.getItem('ledu-timer-sound') === 'true'; } catch { return false; } });
  const controllerToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('control') ?? '';

  const reloadAdmin = useCallback(async () => {
    if (apiConfigured && session) {
      try {
        const requestStartedAt = Date.now();
        const fresh = await getTournament(session.token);
        const responseReceivedAt = Date.now();
        if (typeof fresh.serverTime === 'number') setServerOffsetMs(fresh.serverTime - (requestStartedAt + responseReceivedAt) / 2);
        if (!selectedFormatId && fresh.formats?.length) setSelectedFormatId(fresh.formats[0].id);
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
            institutions: current.institutions ?? fresh.institutions,
            formats: current.formats ?? fresh.formats, physicalRooms: current.physicalRooms ?? fresh.physicalRooms,
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
      const physical = fresh.physicalRooms.find((item) => item.slug === roomId || item.id === roomId);
      if (!physical) { setSnapshot(null); return; }
      const activeRoundId = fresh.activeRoundId || fresh.rounds.find((item) => item.active)?.id || '';
      const room = fresh.rooms.find((item) => item.physicalRoomId === physical.id && item.roundId === activeRoundId);
      const round = fresh.rounds.find((item) => item.id === activeRoundId);
      const phases = room?.phases?.length ? room.phases : fresh.formats.find((item) => item.id === round?.defaultFormatId)?.phases ?? LEDU_PHASES;
      const emptyRoom: Room = room ?? {
        id: 'unassigned-' + physical.id, name: physical.name, roundId: activeRoundId, physicalRoomId: physical.id,
        formatId: round?.defaultFormatId ?? '', teamFavorId: '', teamContraId: '', judgeIds: [], status: 'unassigned',
        phases, timer: createTimer(phases), notes: '', updatedAt: Date.now(),
      };
      setSnapshot({
        tournamentName: fresh.tournamentName, roundName: round?.name ?? 'Sin ronda activa',
        room: emptyRoom, hasAssignment: Boolean(room), physicalRoomId: physical.id, roomSlug: physical.slug,
        physicalRoomName: physical.name, activationRevision: fresh.activationRevision, activatedAt: fresh.activatedAt,
        teamFavor: fresh.teams.find((item) => item.id === emptyRoom.teamFavorId)?.name ?? '',
        teamContra: fresh.teams.find((item) => item.id === emptyRoom.teamContraId)?.name ?? '',
        judges: emptyRoom.judgeIds.map((id) => fresh.judges.find((item) => item.id === id)?.name ?? '').filter(Boolean),
        serverTime: Date.now(), minimumJudgesPerRoom: fresh.minimumJudgesPerRoom,
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
  useEffect(() => {
    if (!selectedFormatId || !data.formats.some((format) => format.id === selectedFormatId)) {
      setSelectedFormatId(data.formats[0]?.id ?? '');
    }
  }, [data.formats, selectedFormatId]);

  const updateData = (updater: (current: Tournament) => Tournament) => {
    setPreparedRoomLink(null);
    hasUnsavedRef.current = true;
    setHasUnsavedChanges(true);
    setData((current) => ({ ...updater(current), updatedAt: Date.now() }));
  };
  const persist = async (sourceData: Tournament = data): Promise<Tournament | null> => {
    setSaving(true);
    try {
      // Presets are templates. Existing assignments retain their phase snapshots;
      // a selected round adopts a changed preset only when that round is activated.
      let payload = sourceData;
      payload = { ...payload, institutions: getInstitutionCatalog(payload) };
      // Older and newly created rooms may have no stored phases. Normalize them
      // to the configured tournament sequence (or the LEDU preset) before validating.
      const fallbackPhases = resolvePhases(payload.formatPhases, payload.rooms);
      payload = {
        ...payload,
        formatPhases: payload.formatPhases?.length ? payload.formatPhases : fallbackPhases,
        rooms: payload.rooms.map((room) => {
          if (room.phases?.length) return room;
          const phases = resolvePhases(fallbackPhases);
          const timer = room.timer.status === 'running' || room.timer.status === 'paused'
            ? room.timer
            : { ...createTimer(phases), revision: room.timer.revision + 1, updatedAt: Date.now() };
          return { ...room, phases, timer, updatedAt: Date.now() };
        }),
      };
      const issues = validateAssignments(payload);
      if (issues.length) throw new Error('Corrige las asignaciones antes de guardar: ' + issues.slice(0, 3).join(' '));
      let saved: Tournament;
      if (apiConfigured) {
        if (!session) throw new Error('Inicia sesión antes de guardar.');
        saved = await saveTournament(session.token, sourceData.revision, payload);
      } else {
        saved = { ...payload, revision: payload.revision + 1, updatedAt: Date.now() };
        writeDemo(saved);
      }
      setData(saved);
      hasUnsavedRef.current = false;
      setHasUnsavedChanges(false);
      setFormatDirty(false);
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
        const updated = await updateTimer(snapshot.roomSlug, action, snapshot.room.timer.revision, controllerToken, snapshot.room.id, snapshot.activationRevision);
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
      const assignment = saved.rooms.find((room) => room.id === id);
      if (!assignment) throw new Error('La asignación ya no existe. Actualiza el panel.');
      const physical = saved.physicalRooms.find((room) => room.id === assignment.physicalRoomId);
      if (!physical) throw new Error('No se encuentra la sala física vinculada a esta asignación.');
      if (apiConfigured) {
        if (!session) throw new Error('La sesión ha caducado. Vuelve a iniciar sesión.');
        const control = await getRoomControllerToken(session.token, physical.slug, rotate);
        hash = '#control=' + encodeURIComponent(control.token);
      }

      setPreparedRoomLink({
        roomName: physical.name,
        href: window.location.origin + '/sala/' + encodeURIComponent(physical.slug) + hash,
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

  const addInstitution = () => {
    const name = institutionDraft.trim();
    if (!name) return;
    const existing = getInstitutionCatalog(data).find((item) => item.toLocaleLowerCase('es-ES') === name.toLocaleLowerCase('es-ES'));
    if (existing) {
      setServerError('La institución "' + existing + '" ya está en el catálogo.');
      return;
    }
    // Persist the catalog addition immediately; unlike regular edits, creating
    // a shared institution should not depend on remembering the global Save button.
    const nextData: Tournament = {
      ...data,
      institutions: [...getInstitutionCatalog(data), name],
      updatedAt: Date.now(),
    };
    setPreparedRoomLink(null);
    hasUnsavedRef.current = true;
    setHasUnsavedChanges(true);
    setData(nextData);
    setInstitutionDraft('');
    setServerError('');
    void persist(nextData);
  };
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
    const name = window.prompt('Nombre de la sala física', 'Sala nueva');
    if (!name?.trim()) return;
    const roundIdValue = activeRound || data.rounds[0]?.id || makeId('r');
    const timestamp = Date.now();
    const baseSlug = makeSlug(name.trim());
    let slug = baseSlug;
    let suffix = 2;
    while (data.physicalRooms.some((room) => room.slug === slug)) slug = baseSlug + '-' + suffix++;
    const physical: PhysicalRoom = { id: makeId('physical'), slug, name: name.trim(), active: true, createdAt: timestamp, updatedAt: timestamp };
    const round = data.rounds.find((item) => item.id === roundIdValue);
    const preset = data.formats.find((item) => item.id === round?.defaultFormatId) ?? data.formats[0];
    const phases = (preset?.phases?.length ? preset.phases : resolvePhases(data.formatPhases, data.rooms)).map((phase) => ({ ...phase }));
    const room: Room = {
      id: makeId('assignment'), name: physical.name, roundId: roundIdValue, physicalRoomId: physical.id,
      formatId: '', teamFavorId: '', teamContraId: '', judgeIds: [], status: 'unassigned',
      phases, timer: { ...createTimer(phases), updatedAt: timestamp }, notes: '', updatedAt: timestamp,
    };
    updateData((current) => ({ ...current, physicalRooms: [...current.physicalRooms, physical], rooms: [...current.rooms, room] }));
  };
  const assignExistingPhysicalRoom = () => {
    const roundIdValue = activeRound || data.rounds[0]?.id;
    if (!roundIdValue) { setServerError('Crea primero una ronda.'); return; }
    const available = data.physicalRooms.filter((physical) => !data.rooms.some((room) => room.roundId === roundIdValue && room.physicalRoomId === physical.id));
    if (!available.length) { setServerError('Todas las salas físicas ya tienen asignación en esta ronda.'); return; }
    const promptText = available.map((room, index) => (index + 1) + '. ' + room.name + '  (/sala/' + room.slug + ')').join('\n');
    const selection = window.prompt('Indica el número de la sala física que quieres asignar a ' + (data.rounds.find((round) => round.id === roundIdValue)?.name ?? 'esta ronda') + ':\n\n' + promptText);
    if (!selection) return;
    const index = Number(selection) - 1;
    const physical = Number.isInteger(index) ? available[index] : undefined;
    if (!physical) { setServerError('Selecciona un número válido de la lista.'); return; }
    const timestamp = Date.now();
    const round = data.rounds.find((item) => item.id === roundIdValue);
    const preset = data.formats.find((item) => item.id === round?.defaultFormatId) ?? data.formats[0];
    const phases = (preset?.phases?.length ? preset.phases : resolvePhases(data.formatPhases, data.rooms)).map((phase) => ({ ...phase }));
    const room: Room = {
      id: makeId('assignment'), name: physical.name, roundId: roundIdValue, physicalRoomId: physical.id,
      formatId: '', teamFavorId: '', teamContraId: '', judgeIds: [], status: 'unassigned',
      phases, timer: { ...createTimer(phases), updatedAt: timestamp }, notes: '', updatedAt: timestamp,
    };
    updateData((current) => ({ ...current, rooms: [...current.rooms, room] }));
    setServerError('');
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
      !window.confirm('Esta asignación tiene un cronómetro iniciado o pausado. Cambiarla puede afectar al debate. ¿Confirmas el cambio?')) return;
    updateData((current) => {
      let rooms = current.rooms.map((room) => room.id === id ? withRoomStatus({ ...room, ...patch }, current.minimumJudgesPerRoom ?? 1) : room);
      let physicalRooms = current.physicalRooms;
      if (patch.name !== undefined) {
        const newName = patch.name.trim();
        physicalRooms = current.physicalRooms.map((physical) => physical.id === currentRoom.physicalRoomId
          ? { ...physical, name: newName || physical.name, updatedAt: Date.now() } : physical);
        rooms = rooms.map((room) => room.physicalRoomId === currentRoom.physicalRoomId ? { ...room, name: newName || room.name } : room);
      }
      return { ...current, physicalRooms, rooms };
    });
  };
  const addRound = () => {
    const name = window.prompt('Nombre de la ronda', 'Ronda ' + (data.rounds.length + 1));
    if (!name?.trim()) return;
    const timestamp = Date.now();
    const newRound: Round = { id: makeId('r'), number: data.rounds.length + 1, name: name.trim(), active: false, defaultFormatId: data.formats[0]?.id ?? '' };
    const defaultFormat = data.formats.find((format) => format.id === newRound.defaultFormatId);
    const phases = (defaultFormat?.phases?.length ? defaultFormat.phases : resolvePhases(data.formatPhases, data.rooms)).map((phase) => ({ ...phase }));
    const newAssignments: Room[] = data.physicalRooms.map((physical) => ({
      id: makeId('assignment'),
      name: physical.name,
      roundId: newRound.id,
      physicalRoomId: physical.id,
      formatId: '',
      teamFavorId: '',
      teamContraId: '',
      judgeIds: [],
      status: 'unassigned',
      phases: phases.map((phase) => ({ ...phase })),
      timer: { ...createTimer(phases), updatedAt: timestamp },
      notes: '',
      updatedAt: timestamp,
    }));
    updateData((current) => ({ ...current, rounds: [...current.rounds, newRound], rooms: [...current.rooms, ...newAssignments] }));
    setSelectedRound(newRound.id);
  };

  const removeRoom = (room: Room) => {
    const active = room.timer.status === 'running' || room.timer.status === 'paused';
    const detail = active ? ' El cronómetro está iniciado o pausado.' : '';
    if (!window.confirm('¿Eliminar la asignación de "' + room.name + '" para esta ronda?' + detail + ' El enlace permanente de la sala física seguirá existiendo y podrá reutilizarse en otras rondas.')) return;
    updateData((current) => ({ ...current, rooms: current.rooms.filter((item) => item.id !== room.id) }));
  };
  const removeSelectedRound = () => {
    const round = data.rounds.find((item) => item.id === activeRound);
    if (!round) return;
    if (data.rounds.length <= 1) {
      setServerError('El torneo debe conservar al menos una ronda.');
      return;
    }
    if (round.id === data.activeRoundId) {
      setServerError('No puedes eliminar la ronda activa. Activa otra ronda primero para conservar una activación coherente.');
      return;
    }
    const affectedRooms = data.rooms.filter((room) => room.roundId === round.id);
    const activeRooms = affectedRooms.filter((room) => room.timer.status === 'running' || room.timer.status === 'paused');
    const detail = affectedRooms.length
      ? ' También se eliminarán ' + affectedRooms.length + ' sala(s)' + (activeRooms.length ? ', incluidas ' + activeRooms.length + ' con cronómetros iniciados o pausados' : '') + '.'
      : '';
    if (!window.confirm('¿Eliminar la ronda "' + round.name + '"?' + detail + ' Esta acción no se puede deshacer.')) return;
    const remainingRounds = data.rounds.filter((item) => item.id !== round.id);
    const nextRounds = round.active
      ? remainingRounds.map((item, index) => index === 0 ? { ...item, active: true } : item)
      : remainingRounds;
    updateData((current) => ({
      ...current,
      rounds: nextRounds,
      rooms: current.rooms.filter((room) => room.roundId !== round.id),
    }));
    if (selectedRound === round.id) setSelectedRound(remainingRounds[0]?.id ?? '');
    setServerError('');
  };
  const removeTeam = (team: Team) => {
    const assignedRooms = data.rooms.filter((room) => room.teamFavorId === team.id || room.teamContraId === team.id);
    const running = assignedRooms.some((room) => room.timer.status === 'running' || room.timer.status === 'paused');
    if (running) {
      setServerError('No se puede eliminar "' + team.name + '" porque está asignado a una sala con el cronómetro iniciado o pausado. Detén esos debates y vuelve a intentarlo.');
      return;
    }
    if (!window.confirm('¿Eliminar el equipo "' + team.name + '"? Se quitará de ' + assignedRooms.length + ' asignación(es), si las tiene.')) return;
    updateData((current) => ({
      ...current,
      teams: current.teams.filter((item) => item.id !== team.id),
      rooms: current.rooms.map((room) => withRoomStatus({
        ...room,
        teamFavorId: room.teamFavorId === team.id ? '' : room.teamFavorId,
        teamContraId: room.teamContraId === team.id ? '' : room.teamContraId,
      }, current.minimumJudgesPerRoom ?? 1)),
    }));
  };
  const removeJudge = (judge: Judge) => {
    const assignedRooms = data.rooms.filter((room) => room.judgeIds.includes(judge.id));
    const running = assignedRooms.some((room) => room.timer.status === 'running' || room.timer.status === 'paused');
    if (running) {
      setServerError('No se puede eliminar "' + judge.name + '" porque está asignado a una sala con el cronómetro iniciado o pausado. Detén esos debates y vuelve a intentarlo.');
      return;
    }
    if (!window.confirm('¿Eliminar al juez "' + judge.name + '"? Se quitará de ' + assignedRooms.length + ' asignación(es), si las tiene.')) return;
    updateData((current) => ({
      ...current,
      judges: current.judges.filter((item) => item.id !== judge.id),
      rooms: current.rooms.map((room) => withRoomStatus({
        ...room,
        judgeIds: room.judgeIds.filter((id) => id !== judge.id),
      }, current.minimumJudgesPerRoom ?? 1)),
    }));
  };

  const selectedPreset = data.formats.find((format) => format.id === selectedFormatId) ?? data.formats[0];
  const editingFormatId = selectedPreset?.id ?? '';
  const configuredPhases = selectedPreset?.phases?.length ? selectedPreset.phases : resolvePhases(data.formatPhases, data.rooms);
  const updatePhase = (id: string, patch: Partial<Phase>) => {
    setFormatDirty(true);
    updateData((current) => ({
      ...current,
      formats: current.formats.map((format) => format.id === editingFormatId
        ? { ...format, phases: format.phases.map((phase) => phase.id === id ? { ...phase, ...patch } : phase), version: format.version + 1, updatedAt: Date.now() }
        : format),
    }));
  };
  const movePhase = (index: number, offset: number) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= configuredPhases.length || !selectedPreset) return;
    setFormatDirty(true);
    updateData((current) => ({
      ...current,
      formats: current.formats.map((format) => {
        if (format.id !== editingFormatId) return format;
        const phases = [...format.phases];
        [phases[index], phases[nextIndex]] = [phases[nextIndex], phases[index]];
        return { ...format, phases, version: format.version + 1, updatedAt: Date.now() };
      }),
    }));
  };
  const addPhase = () => {
    if (!selectedPreset) return;
    setFormatDirty(true);
    updateData((current) => ({
      ...current,
      formats: current.formats.map((format) => format.id === editingFormatId
        ? { ...format, phases: [...format.phases, { id: makeId('p'), name: 'Nueva intervención', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 180, type: 'other', warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true }], version: format.version + 1, updatedAt: Date.now() }
        : format),
    }));
  };
  const removePhase = (id: string) => {
    if (configuredPhases.length <= 1) { setServerError('El formato debe tener al menos una intervención.'); return; }
    setFormatDirty(true);
    updateData((current) => ({
      ...current,
      formats: current.formats.map((format) => format.id === editingFormatId
        ? { ...format, phases: format.phases.filter((phase) => phase.id !== id), version: format.version + 1, updatedAt: Date.now() }
        : format),
    }));
  };
  const addFormat = () => {
    const name = window.prompt('Nombre del nuevo formato de debate', 'Nuevo formato');
    if (!name?.trim()) return;
    if (data.formats.some((format) => format.name.trim().toLocaleLowerCase('es-ES') === name.trim().toLocaleLowerCase('es-ES'))) {
      setServerError('Ya existe un formato con ese nombre.');
      return;
    }
    const timestamp = Date.now();
    const format: FormatPreset = {
      id: makeId('format'), name: name.trim(), phases: configuredPhases.map((phase) => ({ ...phase, warningThresholdsSeconds: [...(phase.warningThresholdsSeconds ?? [])] })),
      version: 1, createdAt: timestamp, updatedAt: timestamp,
    };
    updateData((current) => ({ ...current, formats: [...current.formats, format] }));
    setSelectedFormatId(format.id);
    setFormatDirty(false);
    setThresholdDrafts({});
    setServerError('');
  };
  const renameSelectedFormat = () => {
    if (!selectedPreset) return;
    const name = window.prompt('Nombre del formato', selectedPreset.name);
    if (!name?.trim()) return;
    if (data.formats.some((format) => format.id !== selectedPreset.id && format.name.trim().toLocaleLowerCase('es-ES') === name.trim().toLocaleLowerCase('es-ES'))) {
      setServerError('Ya existe otro formato con ese nombre.');
      return;
    }
    updateData((current) => ({ ...current, formats: current.formats.map((format) => format.id === selectedPreset.id ? { ...format, name: name.trim(), version: format.version + 1, updatedAt: Date.now() } : format) }));
    setServerError('');
  };
  const removeSelectedFormat = () => {
    if (!selectedPreset) return;
    if (data.formats.length <= 1) { setServerError('El torneo debe conservar al menos un formato.'); return; }
    const fallback = data.formats.find((format) => format.id !== selectedPreset.id);
    if (!fallback) return;
    const referenceCount = data.rounds.filter((round) => round.defaultFormatId === selectedPreset.id).length
      + data.rooms.filter((room) => room.formatId === selectedPreset.id).length;
    if (!window.confirm('¿Eliminar el formato "' + selectedPreset.name + '"?' + (referenceCount ? ' Se sustituirán ' + referenceCount + ' referencia(s) por el formato "' + fallback.name + '". Los debates ya configurados conservarán su copia de fases hasta la próxima activación.' : ' Los debates ya configurados conservarán su copia de fases.') )) return;
    updateData((current) => ({
      ...current,
      formats: current.formats.filter((format) => format.id !== selectedPreset.id),
      rounds: current.rounds.map((round) => round.defaultFormatId === selectedPreset.id ? { ...round, defaultFormatId: fallback.id } : round),
      rooms: current.rooms.map((room) => room.formatId === selectedPreset.id ? { ...room, formatId: '' } : room),
      formatPhases: current.formatPhases,
    }));
    setSelectedFormatId(fallback.id);
    setFormatDirty(false);
    setThresholdDrafts({});
    setServerError('');
  };
  const setRoundFormat = (roundId: string, formatId: string) => {
    updateData((current) => ({ ...current, rounds: current.rounds.map((round) => round.id === roundId ? { ...round, defaultFormatId: formatId } : round) }));
  };
  const requestRoundActivation = async (roundId: string) => {
    setServerError('');
    try {
      if (hasUnsavedRef.current) {
        const saved = await persist();
        if (!saved) return;
      }
      let preview: RoundActivationPreview;
      if (apiConfigured) {
        if (!session) throw new Error('La sesión ha caducado. Vuelve a iniciar sesión.');
        preview = await getRoundActivationPreview(session.token, roundId);
      } else {
        const target = data.rounds.find((round) => round.id === roundId);
        if (!target) throw new Error('No se encuentra la ronda seleccionada.');
        const activeId = data.activeRoundId || data.rounds.find((round) => round.active)?.id || '';
        const pending = data.rooms.filter((room) => room.roundId === activeId && (room.teamFavorId || room.teamContraId) && room.timer.status !== 'finished').map((room) => ({
          assignmentId: room.id,
          physicalRoomId: room.physicalRoomId,
          roomName: data.physicalRooms.find((physical) => physical.id === room.physicalRoomId)?.name ?? room.name,
          teamFavor: data.teams.find((team) => team.id === room.teamFavorId)?.name ?? 'Equipo sin asignar',
          teamContra: data.teams.find((team) => team.id === room.teamContraId)?.name ?? 'Equipo sin asignar',
          phaseName: room.phases[room.timer.phaseIndex]?.name ?? 'Sin fase',
          status: room.timer.status,
          statusLabel: room.timer.status === 'running' ? 'en marcha' : room.timer.status === 'paused' ? 'pausado' : 'preparado/sin iniciar',
          remainingSeconds: secondsLeft(room.timer, Date.now()),
        }));
        preview = {
          activeRoundId: activeId,
          activeRoundName: data.rounds.find((round) => round.id === activeId)?.name ?? 'Ninguna',
          targetRoundId: target.id,
          targetRoundName: target.name,
          alreadyActive: activeId === target.id,
          pending,
          activationRevision: data.activationRevision,
          serverTime: Date.now(),
        };
      }
      if (preview.alreadyActive) { setServerError('Esa ronda ya está activa.'); return; }
      setActivationPreview(preview);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'No se ha podido preparar la activación de la ronda.');
    }
  };
  const confirmRoundActivation = async (force: boolean) => {
    const preview = activationPreview;
    if (!preview || activatingRound) return;
    setActivatingRound(true);
    setServerError('');
    try {
      let saved: Tournament;
      if (apiConfigured) {
        if (!session) throw new Error('La sesión ha caducado. Vuelve a iniciar sesión.');
        saved = await apiActivateRound(session.token, preview.targetRoundId, force);
      } else {
        const target = data.rounds.find((round) => round.id === preview.targetRoundId);
        if (!target) throw new Error('No se encuentra la ronda seleccionada.');
        const now = Date.now();
        const rooms = data.rooms.map((room) => {
          if (room.roundId === target.id) {
            const format = data.formats.find((item) => item.id === (room.formatId || target.defaultFormatId)) ?? data.formats[0];
            const phases = (format?.phases?.length ? format.phases : room.phases).map((phase) => ({ ...phase }));
            return withRoomStatus({ ...room, phases, timer: { ...createTimer(phases), revision: room.timer.revision + 1, updatedAt: now }, updatedAt: now }, data.minimumJudgesPerRoom ?? 1);
          }
          if (room.roundId === data.activeRoundId && room.timer.status !== 'finished') {
            const timer = room.timer.status === 'running'
              ? transitionTimer(room.timer, room.phases, 'pause')
              : room.timer.status === 'paused' ? { ...room.timer, revision: room.timer.revision + 1, updatedAt: now } : room.timer;
            return withRoomStatus({ ...room, timer, updatedAt: now }, data.minimumJudgesPerRoom ?? 1);
          }
          return room;
        });
        saved = { ...data, activeRoundId: target.id, activationRevision: data.activationRevision + 1, activatedAt: now,
          rounds: data.rounds.map((round) => ({ ...round, active: round.id === target.id })), rooms,
          revision: data.revision + 1, updatedAt: now };
        writeDemo(saved);
      }
      setData(saved);
      hasUnsavedRef.current = false;
      setHasUnsavedChanges(false);
      setFormatDirty(false);
      setRoomFormatMismatch(false);
      setSelectedRound(preview.targetRoundId);
      setActivationPreview(null);
      setLastSyncedAt(Date.now());
      setConnected(true);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'No se ha podido activar la ronda.');
    } finally {
      setActivatingRound(false);
    }
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
      {preparedRoomLink && <div className="notice warning-notice room-link-ready"><Check size={17} /><span>La sala física <b>{preparedRoomLink.roomName}</b> está guardada. Su enlace permanente abre la ronda activa:</span><a className="button primary" href={preparedRoomLink.href} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Abrir cronómetro</a><button className="text-button" onClick={() => setPreparedRoomLink(null)} aria-label="Cerrar enlace preparado"><X size={16} /></button></div>}
      {hasUnsavedChanges && <div className="notice warning-notice"><CircleHelp size={17} /><span>Tienes cambios locales sin guardar. El panel seguirá actualizando los cronómetros sin descartar estas ediciones.</span><button className="text-button" onClick={() => { if (window.confirm('¿Descartar todos los cambios locales y volver a cargar los datos guardados?')) { hasUnsavedRef.current = false; setHasUnsavedChanges(false); setFormatDirty(false); void reloadAdmin(); } }}>Descartar y recargar</button></div>}
      {assignmentWarnings.length > 0 && view !== 'settings' && <div className="notice warning-notice"><CircleHelp size={17} /><span>Hay incidencias en las asignaciones: {assignmentWarnings.slice(0, 2).join(' ')}{assignmentWarnings.length > 2 ? ' +' + (assignmentWarnings.length - 2) + ' más.' : ''}</span></div>}
      {activationPreview && <div className="activation-backdrop" role="presentation">
        <section className="activation-dialog" role="dialog" aria-modal="true" aria-labelledby="activate-round-title">
          <div className="activation-dialog-top"><span className="eyebrow">CONFIRMACIÓN DE CAMBIO DE RONDA</span><button className="icon-button" onClick={() => setActivationPreview(null)} aria-label="Cerrar aviso" disabled={activatingRound}><X size={17} /></button></div>
          <h2 id="activate-round-title">Activar {activationPreview.targetRoundName}</h2>
          <p>Ronda actual: <b>{activationPreview.activeRoundName}</b>. La ronda entrante reiniciará los cronómetros de sus asignaciones según el formato efectivo.</p>
          {activationPreview.pending.length > 0 ? <>
            <div className="notice warning-notice activation-warning"><CircleHelp size={18} /><span><b>{activationPreview.pending.length} debate(s) sin finalizar.</b> Si continúas, los cronómetros de la ronda saliente se congelarán y quedará registro de estos estados.</span></div>
            <div className="pending-debates-list">{activationPreview.pending.map((pending) => <article key={pending.assignmentId} className="pending-debate-item">
              <div className="pending-debate-heading"><b>{pending.roomName}</b><span className={'state-pill ' + (pending.status === 'running' ? 'running' : pending.status === 'paused' ? 'paused' : 'unassigned')}>{pending.statusLabel}</span></div>
              <p><b>{pending.teamFavor}</b> <span>vs.</span> <b>{pending.teamContra}</b></p>
              <div className="pending-debate-meta"><span>Fase: <b>{pending.phaseName}</b></span><span>Tiempo restante: <b>{formatTime(pending.remainingSeconds)}</b></span></div>
            </article>)}</div>
            <p className="activation-footnote">Al confirmar, los debates salientes en marcha se pausarán con el tiempo restante. Las asignaciones entrantes comenzarán preparadas después de mostrar el aviso visual de 20 segundos.</p>
          </> : <div className="notice success-notice"><Check size={17} /><span>No hay debates asignados pendientes de finalizar en la ronda actual.</span></div>}
          <div className="activation-dialog-actions"><button className="button secondary" onClick={() => setActivationPreview(null)} disabled={activatingRound}>Cancelar</button><button className="button primary" onClick={() => void confirmRoundActivation(activationPreview.pending.length > 0)} disabled={activatingRound}>{activatingRound ? 'Activando ronda…' : activationPreview.pending.length > 0 ? 'Activar igualmente' : 'Activar ronda'}</button></div>
        </section>
      </div>}
      {view === 'overview' && <><div className="page-heading"><div><p className="eyebrow">VISTA OPERATIVA</p><h2>Estado del torneo</h2><p className="muted">Seguimiento de debates, asignaciones y cronómetros.</p></div><div className="round-badge"><BookOpen size={17} /><span>Ronda activa: <b>{data.rounds.find((round) => round.active)?.name ?? 'Sin ronda activa'}</b></span></div></div>
      <div className="stat-grid"><Stat label="Salas de la ronda" value={counts.total} icon={<Monitor />} /><Stat label="En debate" value={counts.running} icon={<Activity />} /><Stat label="Preparadas" value={counts.ready} icon={<Check />} /><Stat label="Pendientes" value={counts.unassigned} icon={<Clock3 />} /></div>
      <section className="panel"><div className="panel-title"><div><h3>Estado de las salas</h3><p>Selecciona una sala para abrir su cronómetro público.</p></div><button className="text-button" onClick={() => setView('rooms')}>Gestionar salas <ArrowRight size={15} /></button></div><div className="room-list">{rooms.map((room) => <RoomRow key={room.id} room={room} data={data} now={now + serverOffsetMs} onOpen={() => void openRoom(room.id)} />)}</div>{rooms.length === 0 && <Empty text="No hay salas creadas para esta ronda." />}</section></>}

      {view === 'rooms' && <><div className="page-heading"><div><p className="eyebrow">ASIGNACIÓN</p><h2>Rondas y salas</h2><p className="muted">Los jueces y equipos de cada sala se sincronizan con los cronómetros. Las salas nuevas heredarán el formato definido en Configuración.</p></div><div className="top-actions"><button className="button secondary" onClick={() => setView('settings')}><Settings size={16} /> Configurar intervenciones</button><button className="button secondary" onClick={addRound}><Plus size={16} /> Nueva ronda</button></div></div><div className="round-tabs">{data.rounds.map((round) => <button key={round.id} className={round.id === activeRound ? 'selected' : ''} onClick={() => setSelectedRound(round.id)}>{round.name}{round.id === data.activeRoundId || round.active ? ' · Activa' : ''}</button>)}<button onClick={addRoom}><Plus size={15} /> Sala nueva</button><button onClick={assignExistingPhysicalRoom}><Plus size={15} /> Asignar sala existente</button><button onClick={renameSelectedRound} disabled={!activeRound}>Renombrar ronda</button><button className="button primary" onClick={() => void requestRoundActivation(activeRound)} disabled={!activeRound || activeRound === data.activeRoundId || activatingRound || saving}>{activatingRound ? 'Activando…' : 'Activar ronda'}</button><button className="danger-action" onClick={removeSelectedRound} disabled={!activeRound || activeRound === data.activeRoundId || data.rounds.length <= 1} title="Eliminar ronda y sus asignaciones"><Trash2 size={15} /> Eliminar ronda</button></div><div className="round-format-row"><label>Formato predeterminado de {data.rounds.find((round) => round.id === activeRound)?.name ?? 'la ronda'}<select value={data.rounds.find((round) => round.id === activeRound)?.defaultFormatId ?? ''} onChange={(event) => setRoundFormat(activeRound, event.target.value)}>{data.formats.map((format) => <option key={format.id} value={format.id}>{format.name}</option>)}</select></label><span className="muted">Las salas pueden heredar este formato o elegir una excepción.</span></div><div className="managed-rooms">{rooms.map((room) => <section className="panel room-editor" key={room.id}><div className="panel-title"><div><input className="table-input room-name-input" aria-label="Nombre de la sala" value={room.name} onChange={(event) => updateRoom(room.id, { name: event.target.value })} /><p className="muted">Enlace permanente: /sala/{data.physicalRooms.find((physical) => physical.id === room.physicalRoomId)?.slug ?? room.physicalRoomId}</p></div><div className="room-open-actions"><button className="icon-button" title="Abrir cronómetro" onClick={() => void openRoom(room.id)}><ExternalLink size={16} /></button><button className="text-button" title="Invalidar y regenerar el enlace de control" onClick={() => void openRoom(room.id, true)}>Regenerar enlace</button><button className="icon-button danger-action" title="Eliminar sala" aria-label={'Eliminar sala ' + room.name} onClick={() => removeRoom(room)}><Trash2 size={15} /></button></div></div><div className="assign-grid"><label className="room-format-select">Formato de esta sala<select value={room.formatId} onChange={(event) => updateRoom(room.id, { formatId: event.target.value })}><option value="">Heredar formato de la ronda</option>{data.formats.map((format) => <option key={format.id} value={format.id}>{format.name}</option>)}</select><small>Se aplicará al activar la ronda.</small></label><label>Equipo a favor<select value={room.teamFavorId} onChange={(event) => updateRoom(room.id, { teamFavorId: event.target.value })}><option value="">Pendiente de asignar</option>{data.teams.filter((team) => team.active || team.id === room.teamFavorId || team.id === room.teamContraId).map((team) => <option key={team.id} value={team.id}>{team.name}{team.active ? '' : ' · Inactivo'}</option>)}</select></label><label>Equipo en contra<select value={room.teamContraId} onChange={(event) => updateRoom(room.id, { teamContraId: event.target.value })}><option value="">Pendiente de asignar</option>{data.teams.filter((team) => team.active || team.id === room.teamFavorId || team.id === room.teamContraId).map((team) => <option key={team.id} value={team.id}>{team.name}{team.active ? '' : ' · Inactivo'}</option>)}</select></label></div><div className="judges-select"><b>Jueces asignados</b><div className="check-grid">{data.judges.filter((judge) => judge.active || room.judgeIds.includes(judge.id)).map((judge) => {
          const assigned = room.judgeIds.includes(judge.id);
          const conflict = conflictingTeamForJudge(data, room, judge);
          return <label key={judge.id} className="check-item" title={conflict ? 'Institución incompatible con ' + conflict.name : undefined}><input type="checkbox" checked={assigned} disabled={Boolean(conflict && !assigned)} onChange={(event) => updateRoom(room.id, { judgeIds: event.target.checked ? [...room.judgeIds, judge.id] : room.judgeIds.filter((id) => id !== judge.id) })} />{judge.name}{judge.active ? '' : ' · Inactivo'}{conflict ? ' · Institución incompatible' : ''}</label>;
        })}</div></div><div className="room-editor-footer"><span className={'state-pill ' + room.status}>{room.status === 'ready' ? 'Preparada' : room.status === 'unassigned' ? 'Pendiente' : room.status === 'running' ? 'En curso' : room.status === 'paused' ? 'Pausada' : 'Finalizada'}</span><button className="text-button" onClick={() => void openRoom(room.id)}>Abrir cronómetro <ChevronRight size={15} /></button></div></section>)}</div>{rooms.length === 0 && <Empty text="Añade una sala a esta ronda para comenzar." />}</>}

      {view === 'teams' && <><div className="page-heading"><div><p className="eyebrow">PARTICIPANTES</p><h2>Equipos</h2><p className="muted">Listado de equipos disponibles para enfrentamientos.</p></div><button className="button primary" onClick={addTeam}><Plus size={16} /> Añadir equipo</button></div><section className="panel table-panel"><table><thead><tr><th>Equipo</th><th>Institución</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data.teams.map((team) => <tr key={team.id}><td><input className="table-input" aria-label="Nombre del equipo" value={team.name} onChange={(event) => updateData((current) => ({ ...current, teams: current.teams.map((item) => item.id === team.id ? { ...item, name: event.target.value } : item) }))} /></td><td><select className="table-input institution-select" aria-label="Institución del equipo" value={team.institution} onChange={(event) => updateData((current) => ({ ...current, teams: current.teams.map((item) => item.id === team.id ? { ...item, institution: event.target.value } : item) }))}><option value="">Sin institución asignada</option>{getInstitutionCatalog(data).map((institution) => <option key={institution} value={institution}>{institution}</option>)}</select></td><td><button className={'state-pill ' + (team.active ? 'ready' : 'unassigned')} onClick={() => updateData((current) => ({ ...current, teams: current.teams.map((item) => item.id === team.id ? { ...item, active: !item.active } : item) }))}>{team.active ? 'Activo' : 'Inactivo'}</button></td><td><button className="icon-button danger-action" title="Eliminar equipo" aria-label={'Eliminar equipo ' + team.name} onClick={() => removeTeam(team)}><Trash2 size={15} /></button></td></tr>)}</tbody></table></section></>}

      {view === 'judges' && <><div className="page-heading"><div><p className="eyebrow">PANEL DE JUECES</p><h2>Jueces</h2><p className="muted">Un debate puede incluir varios jueces. Evita duplicar una asignación dentro de la misma ronda.</p></div><button className="button primary" onClick={addJudge}><Plus size={16} /> Añadir juez</button></div><section className="panel table-panel"><table><thead><tr><th>Juez/a</th><th>Institución</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data.judges.map((judge) => <tr key={judge.id}><td><input className="table-input" aria-label="Nombre del juez" value={judge.name} onChange={(event) => updateData((current) => ({ ...current, judges: current.judges.map((item) => item.id === judge.id ? { ...item, name: event.target.value } : item) }))} /></td><td><select className="table-input institution-select" aria-label="Institución del juez" value={judge.institution} onChange={(event) => updateData((current) => ({ ...current, judges: current.judges.map((item) => item.id === judge.id ? { ...item, institution: event.target.value } : item) }))}><option value="">Sin institución asignada</option>{getInstitutionCatalog(data).map((institution) => <option key={institution} value={institution}>{institution}</option>)}</select></td><td><button className={'state-pill ' + (judge.active ? 'ready' : 'unassigned')} onClick={() => updateData((current) => ({ ...current, judges: current.judges.map((item) => item.id === judge.id ? { ...item, active: !item.active } : item) }))}>{judge.active ? 'Activo' : 'Inactivo'}</button></td><td><button className="icon-button danger-action" title="Eliminar juez" aria-label={'Eliminar juez ' + judge.name} onClick={() => removeJudge(judge)}><Trash2 size={15} /></button></td></tr>)}</tbody></table></section></>}

      {view === 'settings' && <><div className="page-heading"><div><p className="eyebrow">CONFIGURACIÓN</p><h2>Formatos y torneo</h2><p className="muted">Administra presets independientes. Las asignaciones existentes conservan su copia de fases hasta que se active su ronda.</p></div><button className="button secondary" onClick={() => { if (!selectedPreset) return; setFormatDirty(true); updateData((current) => ({ ...current, formats: current.formats.map((format) => format.id === selectedPreset.id ? { ...format, phases: LEDU_PHASES.map((phase) => ({ ...phase, warningThresholdsSeconds: [...(phase.warningThresholdsSeconds ?? [])] })), version: format.version + 1, updatedAt: Date.now() } : format) })); }} disabled={!selectedPreset}><RotateCcw size={16} /> Restaurar fases LEDU</button></div>
      <section className="panel settings-panel"><label className="settings-name">Nombre del torneo<input className="table-input" value={data.tournamentName} onChange={(event) => updateData((current) => ({ ...current, tournamentName: event.target.value }))} /></label><label className="settings-name">Mínimo de jueces por sala<input className="table-input" type="number" min={1} max={25} step={1} value={data.minimumJudgesPerRoom ?? 1} onChange={(event) => updateData((current) => ({ ...current, minimumJudgesPerRoom: Math.max(1, Math.min(25, Math.trunc(Number(event.target.value) || 1))) }))} /></label><div className="format-catalog-toolbar"><label>Formato que estás editando<select className="format-select" value={editingFormatId} onChange={(event) => { setSelectedFormatId(event.target.value); setFormatDirty(false); setThresholdDrafts({}); }} disabled={!data.formats.length}>{data.formats.map((format) => <option key={format.id} value={format.id}>{format.name}</option>)}</select></label><div className="format-catalog-actions"><button className="button secondary" onClick={addFormat}><Plus size={15} /> Crear formato</button><button className="button secondary" onClick={renameSelectedFormat} disabled={!selectedPreset}>Renombrar</button><button className="button ghost danger-action" onClick={removeSelectedFormat} disabled={!selectedPreset || data.formats.length <= 1}><Trash2 size={15} /> Eliminar</button></div></div><div className="institution-catalog"><div><h3>Catálogo de instituciones</h3><p className="muted">Las instituciones se gestionan una sola vez y se comparten entre equipos y jueces. Cada persona debe seleccionarla del listado.</p></div><form className="institution-create" onSubmit={(event) => { event.preventDefault(); addInstitution(); }}><input className="table-input" aria-label="Nombre de nueva institución" placeholder="Nombre de una institución nueva" value={institutionDraft} onChange={(event) => setInstitutionDraft(event.target.value)} maxLength={200} /><button className="button secondary" type="submit" disabled={!institutionDraft.trim() || saving}><Plus size={15} />{saving ? 'Guardando…' : 'Añadir institución'}</button></form><div className="institution-chips">{getInstitutionCatalog(data).map((institution) => <span key={institution}>{institution}</span>)}{getInstitutionCatalog(data).length === 0 && <span className="muted">Todavía no hay instituciones definidas.</span>}</div></div><div className="format-summary"><div><b>{configuredPhases.length} intervenciones</b><span>Duración teórica total: {formatTime(configuredPhases.reduce((total, phase) => total + phase.durationSeconds, 0))}</span></div><span className={formatDirty ? 'state-pill paused' : 'state-pill ready'}>{formatDirty ? 'Formato modificado' : 'Formato guardado'}</span></div>
      
      <div className="format-table-wrap"><table className="format-table"><thead><tr><th>#</th><th>Intervención</th><th>Tipo</th><th>Postura</th><th>Quién interviene</th><th>Segundos</th><th>Avisos</th><th>Exceso</th><th>Orden</th></tr></thead><tbody>{configuredPhases.map((phase, index) => <tr key={phase.id}><td>{index + 1}</td><td><input className="table-input" aria-label={'Nombre intervención ' + (index + 1)} value={phase.name} onChange={(event) => updatePhase(phase.id, { name: event.target.value })} /></td><td><select className="format-select" aria-label="Tipo de intervención" value={phase.type ?? 'other'} onChange={(event) => updatePhase(phase.id, { type: event.target.value as Phase['type'] })}><option value="opening">Exposición inicial</option><option value="cross-examination">Examen cruzado</option><option value="rebuttal">Refutación</option><option value="cross-rebuttal">Refutación cruzada</option><option value="conclusion">Conclusión</option><option value="other">Otro</option></select></td><td><select className="format-select" aria-label="Postura" value={phase.side} onChange={(event) => updatePhase(phase.id, { side: event.target.value as Phase['side'] })}><option value="favor">A favor</option><option value="contra">En contra</option></select></td><td><input className="table-input" aria-label="Interviniente" value={phase.speaker} onChange={(event) => updatePhase(phase.id, { speaker: event.target.value })} /></td><td><div className="duration-input"><input type="number" min={1} max={7200} value={phase.durationSeconds} aria-label="Duración en segundos" onChange={(event) => updatePhase(phase.id, { durationSeconds: Math.max(1, Math.min(7200, Number(event.target.value) || 1)) })} /><small>{formatTime(phase.durationSeconds)}</small></div></td><td><input className="threshold-input" aria-label="Umbrales de aviso en segundos" title="Segundos separados por coma" value={thresholdDrafts[phase.id] ?? (phase.warningThresholdsSeconds ?? []).join(', ')} onChange={(event) => { const value = event.target.value; setThresholdDrafts((drafts) => ({ ...drafts, [phase.id]: value })); if (/^\s*$|^\s*\d+\s*(,\s*\d+\s*)*$/.test(value)) updatePhase(phase.id, { warningThresholdsSeconds: value.trim() ? value.split(',').map((item) => Number(item.trim())) : [] }); }} onBlur={() => { const value = thresholdDrafts[phase.id] ?? (phase.warningThresholdsSeconds ?? []).join(', '); updatePhase(phase.id, { warningThresholdsSeconds: value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item >= 0) }); setThresholdDrafts((drafts) => { const next = { ...drafts }; delete next[phase.id]; return next; }); }} /></td><td><label className="overtime-toggle"><input type="checkbox" checked={phase.allowOvertimeDisplay !== false} onChange={(event) => updatePhase(phase.id, { allowOvertimeDisplay: event.target.checked })} />Sí</label></td><td><div className="phase-order"><button className="icon-button" title="Subir intervención" aria-label="Subir intervención" disabled={index === 0} onClick={() => movePhase(index, -1)}><ArrowUp size={14} /></button><button className="icon-button" title="Bajar intervención" aria-label="Bajar intervención" disabled={index === configuredPhases.length - 1} onClick={() => movePhase(index, 1)}><ArrowDown size={14} /></button><button className="icon-button danger-action" title="Eliminar intervención" aria-label="Eliminar intervención" disabled={configuredPhases.length <= 1} onClick={() => removePhase(phase.id)}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div><div className="settings-actions"><button className="button secondary" onClick={addPhase}><Plus size={16} /> Añadir intervención</button><p className="muted">Este preset es una plantilla. Las asignaciones conservarán sus fases actuales hasta que el organizador active la ronda que las contiene.</p></div></section></>}

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
  const fullyAssigned = Boolean(snapshot?.hasAssignment && snapshot.teamFavor && snapshot.teamContra &&
    snapshot.judges.length >= (snapshot.minimumJudgesPerRoom ?? 1) && room?.phases.length);
  const [transitionUntil, setTransitionUntil] = useState(0);
  const lastActivationRevision = useRef<number | null>(null);
  const transitioning = transitionUntil > now;
  const transitionSeconds = Math.max(0, Math.ceil((transitionUntil - now) / 1000));
  const lastLeft = useRef<number | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    const remainingMs = Math.max(0, snapshot.activatedAt + 20_000 - (now + serverOffsetMs));
    if (lastActivationRevision.current === null) {
      lastActivationRevision.current = snapshot.activationRevision;
      if (remainingMs > 0) setTransitionUntil(Date.now() + remainingMs);
      return;
    }
    if (snapshot.activationRevision !== lastActivationRevision.current) {
      lastActivationRevision.current = snapshot.activationRevision;
      setTransitionUntil(remainingMs > 0 ? Date.now() + remainingMs : 0);
      lastLeft.current = null;
    }
  }, [snapshot?.activationRevision, snapshot?.activatedAt, serverOffsetMs]);

  useEffect(() => {
    const previous = lastLeft.current;
    if (!transitioning && soundEnabled && room?.timer.status === 'running' && previous !== null && left < previous) {
      const thresholds = phase?.warningThresholdsSeconds ?? [30, 10];
      if (thresholds.some((threshold) => previous > threshold && left <= threshold) || (previous > 0 && left <= 0)) playTone();
    }
    lastLeft.current = left;
  }, [left, soundEnabled, room?.timer.status, phase?.id, phase?.warningThresholdsSeconds, transitioning]);

  const runAction = (action: TimerAction, confirmation?: string) => {
    if (!controllerEnabled || !fullyAssigned || transitioning) return;
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
    {!snapshot ? <section className="timer-empty"><Monitor size={36} /><h1>Sala no disponible</h1><p>{error || 'La sala física no existe o aún no se ha configurado.'}</p><button className="button secondary" onClick={onRetry}><RefreshCw size={16} /> Reintentar</button></section>
    : !snapshot.hasAssignment ? <section className="timer-empty no-room-assignment"><Monitor size={42} /><p className="eyebrow">{snapshot.tournamentName} · {snapshot.roundName}</p><h1>Sala sin asignación en esta ronda</h1><p>{snapshot.physicalRoomName} conserva su enlace permanente. El panel de organización aún no ha asignado un debate a esta sala para la ronda activa.</p><span className="permanent-room-slug">/sala/{snapshot.roomSlug}</span><button className="button secondary" onClick={onRetry}><RefreshCw size={16} /> Actualizar estado</button></section>
    : transitioning ? <section className="round-transition" aria-live="polite">
        <span className="eyebrow">RONDA ACTIVADA</span>
        <div className="transition-orbit"><Monitor size={38} /></div>
        <h1>Nueva ronda activada</h1>
        <p className="transition-round-name">{snapshot.roundName}</p>
        <p className="transition-room-name">{snapshot.physicalRoomName}</p>
        <div className="transition-team-grid"><div><small>A FAVOR</small><b>{snapshot.teamFavor || 'Pendiente'}</b></div><span>VS</span><div><small>EN CONTRA</small><b>{snapshot.teamContra || 'Pendiente'}</b></div></div>
        <div className="transition-judges"><Gavel size={18} /><span>{snapshot.judges.length ? snapshot.judges.join(' · ') : 'Jueces pendientes de asignación'}</span></div>
        <div className="transition-countdown"><b>{transitionSeconds}</b><span>segundos para comenzar</span></div>
        <p className="transition-help">El cronómetro está preparado y no descontará tiempo hasta que termine este aviso.</p>
      </section>
    : <>
      <section className="timer-heading">
        <p>{snapshot.tournamentName} <span>·</span> {snapshot.roundName}</p>
        <h1>{snapshot.physicalRoomName}</h1>
        <div className="team-versus"><div><small>A FAVOR</small><b>{snapshot.teamFavor || 'Pendiente'}</b></div><span>VS</span><div><small>EN CONTRA</small><b>{snapshot.teamContra || 'Pendiente'}</b></div></div>
        <div className="judge-line"><Gavel size={16} /><span>{snapshot.judges.length ? snapshot.judges.join(' · ') : 'Jueces pendientes de asignación'}</span></div>
      </section>
      <section className="timer-card">
        <div className="timer-status"><span className={'state-pill ' + (timedOut ? 'paused' : room?.timer.status || '')}>{ended ? 'Debate finalizado' : timedOut ? 'Tiempo agotado · exceso de tiempo' : room?.timer.status === 'running' ? 'Intervención en curso' : room?.timer.status === 'paused' ? 'Cronómetro pausado' : 'Preparado para comenzar'}</span><span>INTERVENCIÓN {(room?.timer.phaseIndex ?? 0) + 1} / {room?.phases.length ?? 0}</span></div>
        <div className="phase-heading"><span>{phase?.name ?? 'Debate completado'}</span><b>{phase?.speaker ?? ''} · {phase?.side === 'favor' ? 'A favor' : phase?.side === 'contra' ? 'En contra' : ''}</b></div>
        <div className={'timer-digits ' + ((left <= 30 || timedOut) && room?.timer.status === 'running' ? 'urgent' : '')}>{formatTime(phase?.allowOvertimeDisplay === false && left < 0 ? 0 : left)}</div>
        <div className="timer-track"><div style={{ width: pct + '%' }} /></div>
        {!fullyAssigned && <div className="notice warning-notice timer-assignment-warning"><CircleHelp size={16} /><span>Para iniciar el debate, asigna los dos equipos, al menos {snapshot.minimumJudgesPerRoom ?? 1} juez(es) y un formato válido desde el panel.</span></div>}
        <div className="timer-controls">
          {room?.timer.status === 'running'
            ? <button className="button primary big" onClick={() => runAction('pause')} disabled={!controllerEnabled}><Pause size={19} /> Pausar</button>
            : <button className="button primary big" onClick={() => runAction('start')} disabled={!controllerEnabled || !fullyAssigned || ended}><Play size={19} /> {room?.timer.status === 'paused' ? 'Reanudar' : 'Iniciar intervención'}</button>}
          <button className="button secondary big" onClick={() => runAction('previous', '¿Volver a la intervención anterior? Se detendrá el reloj actual.')} disabled={!controllerEnabled || !room || room.timer.phaseIndex === 0 || ended}><ArrowRight className="reverse-arrow" size={18} /> Anterior</button>
          <button className="button secondary big" onClick={() => runAction('next')} disabled={!controllerEnabled || ended}><ArrowRight size={18} /> Siguiente</button>
          <button className="button ghost big" onClick={() => runAction('reset', '¿Reiniciar únicamente esta intervención?')} disabled={!controllerEnabled || !phase}><RotateCcw size={17} /> Reiniciar turno</button>
          <button className="button ghost big" onClick={() => runAction('finish', '¿Dar por finalizado el debate?')} disabled={!controllerEnabled || ended}><Check size={17} /> Finalizar</button>
        </div>
        <p className="timer-note"><ShieldCheck size={15} /> {controllerEnabled ? 'Este enlace permanente puede controlar el cronómetro de la sala activa.' : 'Modo de solo lectura. Para controlar el reloj, abre la sala desde el panel de organización.'} {lastSyncedAt ? 'Última sincronización: ' + new Date(lastSyncedAt).toLocaleTimeString('es-ES') : 'Esperando la primera sincronización.'}</p>
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
