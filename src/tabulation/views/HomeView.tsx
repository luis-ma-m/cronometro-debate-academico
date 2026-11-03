import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowRight, Check, ClipboardList, Database, Download, Flag, Gavel, Plus, RotateCcw, ShieldCheck, Sparkles, Stethoscope, Trash2, Trophy, Upload, Users } from 'lucide-react';
import { readManagerSession } from '../../contracts/managerSession';
import { acknowledgeApplicationDelivery, claimPanelHandoff, claimPanelPublishAck, createDeliveryConsumerId, releaseApplicationDelivery } from '../../contracts/applicationDeliveryAdapters';
import { tournamentChampion } from '../bracket';
import { PanelLinkReview } from '../PanelLinkReview';
import { parseBackupFile } from '../emergency';
import { downloadEmergencyCopy } from '../ErrorBoundary';
import { checkIntegrity, type IntegrityReport } from '../integrity';
import { type LogVerification } from '../log';
import { TabDataError } from '../normalize';
import { buildPanelHandoff, clearHandoff, HANDOFF_KEY, mergeHandoff, readHandoff, readPanelPublishAcknowledgements, removePanelPublishAcknowledgements, PANEL_PUBLISH_ACK_KEY, tournamentFromHandoff, type PanelHandoff } from '../panelBridge';
import { getTournament, replaceActiveTournament } from '../../api';
import { ApiError } from '../../api';
import { buildLocalPanelBase, comparePanelRevisions, hasRemoteCursorAdvanced } from '../reconciliation';
import { clearPendingPanelReconciliation, readPanelSyncBase, readPendingPanelReconciliation, writePanelSyncBase, writePendingPanelReconciliation } from '../panelSync';
import { ADUMA_DEFAULT_NAME, createTabTournament, PRESET_OPTIONS, presetSettings } from '../presets';
import { roundIsComplete, type DebateOutcome } from '../results';
import { createSampleTournament } from '../sample';
import { INDEX_KEY, MAX_BACKUPS, tournamentKey, type TabStore, type TabStoreState } from '../store';
import { eliminationRounds, isFallenAt, makeTabId, qualifyingRounds, type PresetId, type TabTournament, type PanelEntityIdMap } from '../types';
import { BUILD_INFO, exportTournamentCopy, Field, formatNumber, IssueList, Notice, type NoticeKind } from '../ui';

function findLinkedLocalTournamentId(remoteId: string): string | null {
  try {
    const index = JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? 'null') as { tournaments?: Array<{ id?: unknown }> } | null;
    for (const entry of index?.tournaments ?? []) {
      if (typeof entry.id !== 'string') continue;
      const raw = JSON.parse(window.localStorage.getItem(tournamentKey(entry.id)) ?? 'null') as { panelLink?: { remoteId?: unknown } } | null;
      if (raw?.panelLink?.remoteId === remoteId) return entry.id;
    }
  } catch { /* A damaged local entry must not block the current manager snapshot. */ }
  return null;
}

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
  const [queuedHandoff, setQueuedHandoff] = useState<Awaited<ReturnType<typeof claimPanelHandoff>>>(null);
  const [manualHandoff, setManualHandoff] = useState<PanelHandoff | null>(null);
  const tabulationDeliveryConsumer = useRef<string | null>(null);
  const [showLinkReview, setShowLinkReview] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [pendingReconciliation, setPendingReconciliation] = useState<{ base: PanelHandoff; remote: PanelHandoff; detectedAt: number } | null>(null);
  const [backupVersion, setBackupVersion] = useState(0);
  const [diagnosis, setDiagnosis] = useState<{ integrity: IntegrityReport; log: LogVerification & { issues: string[] } } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const managerBootstrapAttempt = useRef('');
  const handoff = useMemo(() => queuedHandoff?.payload ?? manualHandoff ?? readHandoff(window.localStorage), [queuedHandoff?.deliveryId, manualHandoff, handoffVersion, state.tournaments]);
  const backups = useMemo(() => store.listBackups(), [store, tournament?.id, tournament?.revision, backupVersion]);
  useEffect(() => {
    if (state.readOnly || queuedHandoff) return;
    let disposed = false;
    let running = false;
    const claim = async () => {
      if (disposed || running || document.visibilityState === 'hidden') return;
      running = true;
      try {
        if (!tabulationDeliveryConsumer.current) tabulationDeliveryConsumer.current = createDeliveryConsumerId('tabulation');
        const delivery = await claimPanelHandoff(tabulationDeliveryConsumer.current);
        if (!disposed && delivery) setQueuedHandoff(delivery);
      } catch (error) {
        if (!disposed) setSyncStatus(error instanceof Error ? error.message : 'No se pudo leer la cola de entregas.');
      } finally { running = false; }
    };
    void claim();
    const interval = window.setInterval(() => void claim(), 15000);
    const onFocus = () => void claim();
    const onOnline = () => void claim();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [state.readOnly, queuedHandoff?.deliveryId]);

  const acknowledgeHandoffDelivery = async (): Promise<boolean> => {
    if (queuedHandoff) {
      const consumer = tabulationDeliveryConsumer.current;
      if (!consumer || !await acknowledgeApplicationDelivery(queuedHandoff.deliveryId, consumer).catch(() => false)) return false;
    }
    const legacy = readHandoff(window.localStorage);
    if (!queuedHandoff || (legacy?.createdAt === queuedHandoff.payload.createdAt
      && legacy?.tournamentId === queuedHandoff.payload.tournamentId)) clearHandoff(window.localStorage);
    setQueuedHandoff(null);
    setManualHandoff(null);
    setHandoffVersion((value) => value + 1);
    return true;
  };

  useEffect(() => {
    if (state.readOnly) return;
    const token = readManagerSession(window.localStorage)?.token ?? null;
    if (!token) return;
    const attemptKey = token + ':' + handoffVersion;
    if (managerBootstrapAttempt.current === attemptKey) return;
    managerBootstrapAttempt.current = attemptKey;
    let disposed = false;
    const bootstrapFromManager = async () => {
      try {
        const manager = await getTournament(token);
        if (disposed || !manager.remoteId) return;
        const existingId = findLinkedLocalTournamentId(manager.remoteId);
        if (existingId) {
          if (existingId !== tournament?.id) store.open(existingId);
          clearHandoff(window.localStorage);
          setSyncStatus('Torneo vinculado cargado desde el Gestor. Se comprobará su revisión vigente.');
          return;
        }
        const snapshot = buildPanelHandoff(manager);
        // A local tournament without a canonical link must not force a manual
        // identity-mapping workflow. Import the active manager tournament
        // automatically when the local tournament is only an empty workspace.
        // If it already contains tournament data, ask before switching the
        // active workspace; keep a recoverable backup before doing so.
        if (tournament) {
          const hasProgress = tournament.rounds.length > 0 || Boolean(tournament.draftRound)
            || tournament.teams.length > 0 || tournament.speakers.length > 0
            || tournament.judges.length > 0 || tournament.venues.length > 0;
          const belongsToAnotherTournament = Boolean(
            tournament.panelLink?.remoteId && tournament.panelLink.remoteId !== manager.remoteId,
          );
          if (hasProgress && !tournament.panelLink) {
            // Keep an active local tournament intact and offer the reviewed
            // identity-linking flow instead of asking to replace it with a
            // fresh manager snapshot. This is the recovery path for drafts
            // that must be published without losing local round history.
            setManualHandoff(snapshot);
            setShowLinkReview(true);
            setSyncStatus('El torneo local contiene actividad y no está vinculado. Revisa las correspondencias para vincularlo con Gestión sin sustituir sus rondas ni borradores.');
            return;
          }
          if (hasProgress) {
            const reason = belongsToAnotherTournament
              ? 'El torneo abierto está vinculado a otra identidad de Gestión.'
              : 'El torneo abierto contiene datos o actividad que se sustituirán en la vista activa.';
            const confirmed = window.confirm(
              reason + '\n\nSe activará «' + manager.tournamentName + '» desde Gestión. ' +
              'Antes se guardará una copia recuperable del torneo local actual, que seguirá disponible en este navegador. ¿Continuar?',
            );
            if (!confirmed) {
              setManualHandoff(null);
              setSyncStatus('Se ha conservado el torneo local. No se ha cambiado el vínculo ni se han sobrescrito sus datos.');
              return;
            }
            if (!store.backup('Antes de cargar desde Gestión: ' + manager.tournamentName)) {
              setSyncStatus('No se pudo crear una copia de seguridad del torneo local. No se ha cambiado el torneo activo.');
              notify('No se ha podido crear una copia de seguridad. Libera espacio o exporta una copia antes de cargar el torneo de Gestión.', 'error');
              return;
            }
          }
        }
        const created = tournamentFromHandoff(snapshot, 'ledu-groups');
        store.create(created);
        if (!store.flush()) {
          notify('Se ha importado el torneo del Gestor, pero no se ha podido confirmar su guardado local. No cierres esta pestaña hasta resolverlo.', 'error');
          return;
        }
        writePanelSyncBase(window.localStorage, created.id, snapshot);
        clearHandoff(window.localStorage);
        setHandoffVersion((value) => value + 1);
        setSyncStatus('Torneo inicial creado automáticamente con la información vigente del Gestor.');
        notify('Tabulación ha cargado automáticamente el torneo y los participantes actuales del Gestor.');
      } catch (error) {
        if (!disposed) {
          managerBootstrapAttempt.current = '';
          setSyncStatus(error instanceof ApiError && error.code === 'UNAUTHORIZED'
            ? 'Inicia sesión en el Gestor para cargar el torneo vigente.'
            : 'No se pudo cargar el torneo del Gestor. Se conserva cualquier copia local y se reintentará al recuperar conexión.');
        }
      }
    };
    void bootstrapFromManager();
    const retry = () => { managerBootstrapAttempt.current = ''; setHandoffVersion((value) => value + 1); };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    return () => {
      disposed = true;
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
    };
  }, [state.readOnly, handoffVersion, tournament?.id, store, notify]);

  useEffect(() => {
    // The panel may send its participants while this page is open.
    const onStorage = (event: StorageEvent) => { if (event.key === HANDOFF_KEY) setHandoffVersion((value) => value + 1); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  useEffect(() => {
    setDiagnosis(null);
    setPendingReconciliation(tournament?.panelLink?.remoteId
      ? readPendingPanelReconciliation(window.localStorage, tournament.id) : null);
    setSyncStatus('');
  }, [tournament?.id]);

  useEffect(() => {
    if (!tournament || state.readOnly) return;
    const applyAcknowledgements = () => {
      const pending = readPanelPublishAcknowledgements(window.localStorage)
        .filter((ack) => ack.tabTournamentId === tournament.id);
      if (!pending.length) return;
      const applied: string[] = [];
      const updates = pending.filter((ack) => tournament.rounds.some((round) => round.id === ack.tabulationRoundId));
      if (!updates.length) return;
      const changed = store.update((current) => ({
        ...current,
        rounds: current.rounds.map((round) => {
          const ack = updates.find((item) => item.tabulationRoundId === round.id);
          if (!ack) return round;
          const assignmentMap = new Map(ack.debateAssignments.map((item) => [item.tabulationDebateId, item.assignmentId]));
          return {
            ...round,
            managerRoundId: ack.managerRoundId,
            debates: round.debates.map((debate) => {
              const assignmentId = assignmentMap.get(debate.id);
              return assignmentId ? { ...debate, managerAssignmentId: assignmentId } : debate;
            }),
          };
        }),
        panelLink: current.panelLink ? {
          ...current.panelLink,
          remoteRevision: Math.max(current.panelLink.remoteRevision ?? 0, ...updates.map((ack) => ack.revision)),
          remoteUpdatedAt: Math.max(current.panelLink.remoteUpdatedAt ?? 0, ...updates.flatMap((ack) => typeof ack.updatedAt === 'number' ? [ack.updatedAt] : [])),
        } : current.panelLink,
      }), { type: 'panel.round.ack', message: 'Correspondencias de debates confirmadas por el Gestor y guardadas en Tabulación.' });
      if (changed && store.flush()) {
        applied.push(...updates.map((ack) => ack.operationId));
        removePanelPublishAcknowledgements(window.localStorage, applied);
        setSyncStatus('Publicación confirmada: se han vinculado los debates con sus asignaciones del Gestor.');
      } else {
        setSyncStatus('El Gestor confirmó la publicación, pero no se pudo guardar el mapping local. La confirmación se conserva para reintentar.');
      }
    };
    applyAcknowledgements();
    const onStorage = (event: StorageEvent) => {
      if (event.key === PANEL_PUBLISH_ACK_KEY) applyAcknowledgements();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [tournament, state.readOnly, store]);

  useEffect(() => {
    if (!tournament || state.readOnly) return;
    let disposed = false;
    let running = false;
    const consume = async () => {
      if (disposed || running || !tabulationDeliveryConsumer.current) return;
      running = true;
      let delivery: Awaited<ReturnType<typeof claimPanelPublishAck>> = null;
      const consumer = tabulationDeliveryConsumer.current;
      try {
        delivery = await claimPanelPublishAck(consumer);
        if (!delivery) return;
        const ack = delivery.payload;
        if (readPanelPublishAcknowledgements(window.localStorage).some((item) => item.operationId === ack.operationId)) {
          await releaseApplicationDelivery(delivery.deliveryId, consumer);
          return;
        }
        const round = tournament.rounds.find((item) => item.id === ack.tabulationRoundId);
        if (ack.tabTournamentId !== tournament.id || !round) {
          await releaseApplicationDelivery(delivery.deliveryId, consumer);
          return;
        }
        const map = new Map(ack.debateAssignments.map((item) => [item.tabulationDebateId, item.assignmentId]));
        const applied = round.managerRoundId === ack.managerRoundId
          && round.debates.every((debate) => !map.has(debate.id) || debate.managerAssignmentId === map.get(debate.id));
        if (!applied) {
          const changed = store.update((current) => ({
            ...current,
            rounds: current.rounds.map((item) => item.id !== ack.tabulationRoundId ? item : ({
              ...item, managerRoundId: ack.managerRoundId,
              debates: item.debates.map((debate) => map.has(debate.id)
                ? { ...debate, managerAssignmentId: map.get(debate.id)! } : debate),
            })),
            panelLink: current.panelLink ? {
              ...current.panelLink,
              remoteRevision: Math.max(current.panelLink.remoteRevision ?? 0, ack.revision),
              remoteUpdatedAt: Math.max(current.panelLink.remoteUpdatedAt ?? 0, ack.updatedAt ?? 0),
            } : current.panelLink,
          }), { type: 'panel.round.ack', message: 'ACK de publicación recuperado desde la cola duradera.' });
          if (!changed || !store.flush()) {
            await releaseApplicationDelivery(delivery.deliveryId, consumer);
            setSyncStatus('El ACK está recibido, pero no se ha podido guardar localmente; se reintentará.');
            return;
          }
        }
        if (await acknowledgeApplicationDelivery(delivery.deliveryId, consumer)) {
          removePanelPublishAcknowledgements(window.localStorage, [ack.operationId]);
          setSyncStatus('Publicación confirmada y ACK persistido en Tabulación.');
        }
      } catch (error) {
        if (delivery) await releaseApplicationDelivery(delivery.deliveryId, consumer).catch(() => false);
        if (!disposed) setSyncStatus(error instanceof Error ? error.message : 'No se pudo recuperar el ACK.');
      } finally { running = false; }
    };
    void consume();
    const interval = window.setInterval(() => void consume(), 15000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [tournament, state.readOnly, store]);

  useEffect(() => {
    if (!tournament || !tournament.panelLink?.remoteId || state.readOnly) return;
    const linkedRemoteId = tournament.panelLink.remoteId;
    let disposed = false;
    let running = false;
    let activeController: AbortController | null = null;
    const pull = async () => {
      if (disposed || running || document.visibilityState === 'hidden' || !navigator.onLine) return;
      let token = '';
      const session = readManagerSession(window.localStorage);
      if (!session) {
        setSyncStatus('Inicia sesión en el Gestor para sincronizar este torneo.');
        return;
      }
      token = session.token;
      running = true;
      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10000);
      try {
        const remoteTournament = await getTournament(token, controller.signal);
        if (disposed) return;
        if (remoteTournament.remoteId !== linkedRemoteId) {
          setSyncStatus('La identidad remota del Gestor ha cambiado. Se ha bloqueado la sincronización para evitar mezclar torneos. Revisa el vínculo manualmente.');
          return;
        }
        const remote = buildPanelHandoff(remoteTournament);
        const storedBase = readPanelSyncBase(window.localStorage, tournament.id);
        const isLegacyBaseline = !storedBase;
        const base = storedBase ?? buildLocalPanelBase(tournament);
        if (!base) {
          setSyncStatus('No se puede reconstruir la base de comparación. Vuelve a vincular el torneo mediante revisión manual.');
          return;
        }
        if (base.tournamentId !== linkedRemoteId) {
          setSyncStatus('La base de sincronización pertenece a otra identidad remota. Se ha bloqueado la reconciliación.');
          return;
        }
        const remoteRevisionAdvanced = hasRemoteCursorAdvanced(base, remote);
        const existingPending = readPendingPanelReconciliation(window.localStorage, tournament.id);
        if (existingPending) {
          setPendingReconciliation(existingPending);
          setSyncStatus('Hay cambios remotos pendientes de revisión.');
          return;
        }
        const diff = comparePanelRevisions(tournament, base, remote);
        if (isLegacyBaseline && diff.changes.some((item) => item.change !== 'unchanged')) {
          const pending = { base, remote, detectedAt: Date.now() };
          writePendingPanelReconciliation(window.localStorage, tournament.id, pending);
          setPendingReconciliation(pending);
          setSyncStatus('Este vínculo no tenía snapshot base persistido. Revisa manualmente el primer diff antes de sincronizar.');
          return;
        }
        if (!remoteRevisionAdvanced && diff.changes.every((item) => item.change === 'unchanged')) {
          setSyncStatus('Al día · revisión remota ' + (base.revision ?? 0));
          return;
        }
        if (diff.hasConflicts || diff.requiresHistoricalReview) {
          const pending = { base, remote, detectedAt: Date.now() };
          writePendingPanelReconciliation(window.localStorage, tournament.id, pending);
          setPendingReconciliation(pending);
          setSyncStatus('Cambios remotos requieren revisión: ' + diff.changes.filter((item) => item.change === 'conflict' || item.change === 'historical-review').length + ' elemento(s).');
          return;
        }
        const changed = diff.changes.some((item) => item.change !== 'unchanged');
        if (!changed) {
          const metadataUpdated = store.update((current) => ({
            ...current,
            panelLink: current.panelLink ? {
              ...current.panelLink,
              remoteRevision: remote.revision ?? current.panelLink.remoteRevision,
              remoteUpdatedAt: remote.updatedAt ?? current.panelLink.remoteUpdatedAt,
            } : current.panelLink,
          }), { type: 'panel.sync.cursor', message: 'Revisión remota confirmada sin cambios de entidades.' });
          if (!metadataUpdated || !store.flush()) {
            setSyncStatus('No se pudo guardar la revisión remota confirmada; se volverá a consultar.');
            return;
          }
          writePanelSyncBase(window.localStorage, tournament.id, remote);
          setSyncStatus('Al día · revisión remota ' + (remote.revision ?? 0));
          return;
        }
        if (!store.backup('Antes de sincronizar revisión remota ' + remote.revision)) {
          setSyncStatus('No se pudo crear una copia previa. Exporta una copia antes de sincronizar.');
          return;
        }
        const merged = mergeHandoff(tournament, remote);
        if (merged.issues.length) {
          setSyncStatus('Sincronización detenida: ' + merged.issues.join(' '));
          return;
        }
        if (!store.update(() => merged.tournament, { type: 'panel.sync.pull', message: 'Sincronización remota aplicada (revisión ' + remote.revision + '): ' + merged.added + ' altas y ' + merged.updated + ' actualizaciones.' })) {
          setSyncStatus('No se pudo guardar la sincronización local. No se ha avanzado la revisión base.');
          return;
        }
        if (!store.flush()) {
          setSyncStatus('La sincronización está aplicada en memoria, pero no se ha confirmado su guardado local. La revisión base no se ha avanzado.');
          return;
        }
        writePanelSyncBase(window.localStorage, tournament.id, remote);
        setSyncStatus('Sincronizado · revisión remota ' + (remote.revision ?? 0));
        notify('Cambios compatibles del Gestor sincronizados: ' + merged.added + ' altas y ' + merged.updated + ' actualizaciones.');
      } catch (error) {
        if (!disposed) setSyncStatus(error instanceof ApiError && error.code === 'UNAUTHORIZED'
          ? 'La sesión del Gestor ha caducado. Inicia sesión de nuevo.'
          : 'No se ha podido consultar el Gestor. Los datos locales permanecen intactos; se reintentará.');
      } finally {
        window.clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        running = false;
      }
    };
    void pull();
    const interval = window.setInterval(() => void pull(), 30000);
    const onOnline = () => void pull();
    const onFocus = () => void pull();
    const onVisibility = () => { if (document.visibilityState === 'visible') void pull(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      activeController?.abort();
      window.clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tournament, state.readOnly, store, notify]);

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

  const create = async (sample: boolean) => {
    if (readOnlyNotice()) return;
    if (sample) {
      store.create(createSampleTournament(presetId));
      setName('');
      notify('Torneo de ejemplo creado para probar la herramienta.');
      onNavigate('rondas');
      return;
    }
    const session = readManagerSession(window.localStorage);
    if (!session?.token) {
      notify('Para crear un torneo sincronizado, inicia sesión primero en Gestión. No se ha sustituido ningún dato.', 'error');
      return;
    }
    let manager;
    try {
      manager = await getTournament(session.token);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo comprobar el torneo activo de Gestión.', 'error');
      return;
    }
    const nextName = name.trim() || 'Nuevo torneo';
    const confirmed = window.confirm(
      'Vas a sustituir el torneo activo «' + manager.tournamentName + '» por «' + nextName + '». ' +
      'Se guardará un archivo recuperable del torneo anterior. Sus rondas, salas, asignaciones, cronómetros y actas dejarán de estar activos. ¿Continuar?',
    );
    if (!confirmed) return;

    if (!store.backup('Antes de sustituir el torneo activo')) {
      notify('No se ha podido crear una copia local de seguridad. No se ha iniciado la sustitución.', 'error');
      return;
    }
    const draft = createTabTournament(nextName, presetId);
    store.create(draft);
    if (!store.flush()) {
      notify('No se ha podido guardar el borrador local. La sustitución remota no se ha iniciado.', 'error');
      return;
    }
    try {
      const result = await replaceActiveTournament(
        session.token,
        manager.revision,
        nextName,
        presetSettings(presetId),
        makeTabId('replace'),
      );
      store.update((current) => current.id !== draft.id ? current : ({
        ...current,
        panelLink: {
          tournamentName: result.tournament.tournamentName,
          linkedAt: Date.now(),
          remoteId: result.tournament.remoteId,
          remoteRevision: result.tournament.revision,
          remoteUpdatedAt: result.tournament.updatedAt,
          identityMode: 'local-canonical',
          idMap: { teams: {}, speakers: {}, judges: {}, venues: {} },
        },
      }), { type: 'tournament.link', message: 'Nuevo torneo vinculado a la identidad canónica de Gestión', details: { remoteId: result.tournament.remoteId, archiveId: result.archiveId } });
      writePanelSyncBase(window.localStorage, draft.id, buildPanelHandoff(result.tournament));
      if (!store.flush()) {
        notify('Gestión ha creado el nuevo torneo y archivado el anterior, pero no se ha podido confirmar el vínculo local. Conserva esta pestaña abierta y recupera el borrador desde las copias locales.', 'error');
        return;
      }
      setName('');
      notify('Nuevo torneo creado y vinculado a Gestión. El anterior queda archivado como ' + result.archiveId + '.');
      onNavigate('reglas');
    } catch (error) {
      notify((error instanceof Error ? error.message : 'No se pudo sustituir el torneo en Gestión.') +
        ' El borrador local y la copia previa se conservan; el torneo remoto anterior no se ha modificado si la operación falló.', 'error');
    }
  };

  const createAduma = async (sample: boolean) => {
    if (readOnlyNotice()) return;
    if (sample) {
      const created = { ...createSampleTournament('aduma'), name: 'Ensayo ADUMA (equipos de ejemplo)' };
      store.create(created);
      notify('Ensayo creado con 20 equipos, 30 jueces y 10 salas de ejemplo: genera rondas y simula resultados sin tocar el torneo real.');
      onNavigate('rondas');
      return;
    }

    const session = readManagerSession(window.localStorage);
    if (!session?.token) {
      notify('Para crear un torneo ADUMA sincronizado, inicia sesión primero en Gestión. No se ha creado ningún torneo local sin vínculo.', 'error');
      return;
    }
    let manager;
    try {
      manager = await getTournament(session.token);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo comprobar el torneo activo de Gestión.', 'error');
      return;
    }
    const confirmed = window.confirm(
      'Vas a crear «' + ADUMA_DEFAULT_NAME + '» en Gestión y sustituir el torneo activo «' +
      manager.tournamentName + '». Gestión archivará el torneo anterior. Tabulación guardará una copia local del torneo que tengas abierto. ¿Continuar?',
    );
    if (!confirmed) return;
    if (tournament && !store.backup('Antes de crear ADUMA y sustituir el torneo activo')) {
      notify('No se ha podido crear una copia local de seguridad. No se ha iniciado la sustitución.', 'error');
      return;
    }

    try {
      const result = await replaceActiveTournament(
        session.token,
        manager.revision,
        ADUMA_DEFAULT_NAME,
        presetSettings('aduma'),
        makeTabId('replace'),
      );
      const created = createTabTournament(ADUMA_DEFAULT_NAME, 'aduma');
      store.create(created);
      store.update((current) => current.id !== created.id ? current : ({
        ...current,
        panelLink: {
          tournamentName: result.tournament.tournamentName,
          linkedAt: Date.now(),
          remoteId: result.tournament.remoteId,
          remoteRevision: result.tournament.revision,
          remoteUpdatedAt: result.tournament.updatedAt,
          identityMode: 'local-canonical',
          idMap: { teams: {}, speakers: {}, judges: {}, venues: {} },
        },
      }), { type: 'tournament.link', message: 'Torneo ADUMA creado y vinculado automáticamente a Gestión', details: {
        remoteId: result.tournament.remoteId, archiveId: result.archiveId,
      } });
      writePanelSyncBase(window.localStorage, created.id, buildPanelHandoff(result.tournament));
      if (!store.flush()) {
        notify('Gestión ha creado ADUMA y archivado el torneo anterior, pero Tabulación no ha podido confirmar el vínculo local. Recarga para recuperar el torneo desde Gestión.', 'error');
        return;
      }
      notify('Torneo ADUMA creado y vinculado automáticamente. El torneo anterior queda archivado como ' + result.archiveId + '. Añade ahora equipos, jueces, incompatibilidades y salas.');
      onNavigate('participantes');
    } catch (error) {
      notify((error instanceof Error ? error.message : 'No se pudo crear ADUMA en Gestión.') +
        ' No se ha creado una copia local sin vínculo.', 'error');
    }
  };

  const createFromPanel = async () => {
    if (!handoff || readOnlyNotice()) return;
    const created = tournamentFromHandoff(handoff, presetId);
    store.create(created);
    if (!store.flush()) { notify('El torneo se ha creado en memoria, pero no se ha confirmado su guardado local. La entrega seguirá pendiente.', 'error'); return; }
    if (handoff.tournamentId) writePanelSyncBase(window.localStorage, created.id, handoff);
    if (!await acknowledgeHandoffDelivery()) { notify('El torneo se ha guardado, pero no se pudo confirmar la entrega. Se recuperará al vencer el lease.', 'warning'); return; }
    notify('Torneo creado y vinculado con la identidad del panel. Revisa las reglas, los niveles de los jueces y quién puede presidir.');
    onNavigate('reglas');
  };

  const mergeFromPanel = async () => {
    if (!handoff || !tournament) return;
    const merged = mergeHandoff(tournament, handoff);
    if (merged.issues.length) { notify(merged.issues.join(' '), 'error'); return; }
    store.backup('Antes de actualizar desde el panel');
    if (!store.update(() => merged.tournament, { type: 'tournament.import', message: 'Participantes actualizados desde el panel: ' + merged.added + ' nuevos y ' + merged.updated + ' modificados.' })) {
      notify('No se han podido aplicar los datos del panel en esta pestaña.', 'error');
      return;
    }
    if (!store.flush()) { notify('No se ha podido confirmar el guardado local. La entrega seguirá pendiente.', 'error'); return; }
    if (handoff.tournamentId) {
      writePanelSyncBase(window.localStorage, tournament.id, handoff);
      clearPendingPanelReconciliation(window.localStorage, tournament.id);
      setPendingReconciliation(null);
    }
    if (!await acknowledgeHandoffDelivery()) { notify('Los participantes se han guardado, pero no se pudo confirmar la entrega. Se recuperará al vencer el lease.', 'warning'); return; }
    notify('Participantes actualizados: ' + merged.added + ' nuevos y ' + merged.updated + ' modificados.' + (merged.warnings.length ? ' ' + merged.warnings.join(' ') : ''), merged.warnings.length ? 'warning' : 'success');
  };

  const linkExistingFromPanel = async (idMap: PanelEntityIdMap) => {
    if (!handoff || !tournament || readOnlyNotice()) return;
    const merged = mergeHandoff(tournament, handoff, Date.now(), idMap);
    if (merged.issues.length) { notify(merged.issues.join(' '), 'error'); return; }
    if (!store.backup('Antes de vincular con el panel')) {
      notify('No se ha podido crear la copia de seguridad previa. Libera espacio o exporta una copia antes de vincular.', 'error');
      return;
    }
    if (!store.update(() => merged.tournament, { type: 'tournament.link', message: 'Torneo local vinculado al panel mediante correspondencias revisadas.' })) {
      notify('No se ha podido guardar la vinculación. Los datos locales no se han modificado.', 'error');
      return;
    }
    if (!store.flush()) { notify('No se ha podido confirmar el guardado local de la vinculación. No se ha avanzado la revisión base.', 'error'); return; }
    writePanelSyncBase(window.localStorage, tournament.id, handoff);
    clearPendingPanelReconciliation(window.localStorage, tournament.id);
    setPendingReconciliation(null);
    if (!await acknowledgeHandoffDelivery()) { notify('El vínculo se ha guardado, pero no se pudo confirmar la entrega. Se recuperará al vencer el lease.', 'warning'); return; }
    setShowLinkReview(false);
    notify('Torneo vinculado. Se han conservado los IDs locales y se han importado las entidades remotas no vinculadas.', 'success');
  };

  const applyPendingRemote = () => {
    if (!tournament || !pendingReconciliation || state.readOnly) return;
    if (!window.confirm('Se aplicarán los datos del Gestor a equipos, oradores, jueces y salas. Se guardará una copia previa. Los cambios del Gestor prevalecen sobre los datos compartidos; no se borrarán entidades locales ni rondas/actas. ¿Continuar?')) return;
    if (!store.backup('Antes de resolver conflicto remoto ' + pendingReconciliation.remote.revision)) {
      notify('No se pudo crear una copia de seguridad. Exporta una copia antes de resolver el conflicto.', 'error');
      return;
    }
    const merged = mergeHandoff(tournament, pendingReconciliation.remote);
    if (merged.issues.length) { notify(merged.issues.join(' '), 'error'); return; }
    if (!store.update(() => merged.tournament, { type: 'panel.sync.resolve', message: 'Conflictos revisados y resueltos aceptando la revisión remota ' + pendingReconciliation.remote.revision + '.' })) {
      notify('No se pudo guardar la resolución. La revisión remota sigue pendiente.', 'error');
      return;
    }
    if (!store.flush()) {
      notify('La resolución está aplicada en memoria, pero no se ha confirmado su guardado local. La revisión seguirá pendiente.', 'error');
      return;
    }
    writePanelSyncBase(window.localStorage, tournament.id, pendingReconciliation.remote);
    clearPendingPanelReconciliation(window.localStorage, tournament.id);
    setPendingReconciliation(null);
    setSyncStatus('Conflicto resuelto · revisión remota ' + pendingReconciliation.remote.revision);
    notify('Revisión remota aplicada. La copia anterior y el registro local se conservan.');
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
  const pendingDiff = tournament && pendingReconciliation ? comparePanelRevisions(tournament, pendingReconciliation.base, pendingReconciliation.remote) : null;

  return <>
    <div className="page-heading"><div><p className="eyebrow">INICIO</p><h2>Tabulación del torneo</h2><p className="muted">Emparejamientos, jueces, actas, clasificación y eliminatorias para debate académico. Todo se calcula y se guarda en este navegador, sin servidor.</p></div></div>

    {tournament?.panelLink?.remoteId && <section className="panel tab-handoff">
      <div className="panel-title"><div><h3>Sincronización con el Gestor</h3><p>{syncStatus || 'Consultando revisiones remotas…'} · Identidad {tournament.panelLink.remoteId}</p></div></div>
      {pendingReconciliation && <>
        <Notice kind="warning">Hay una revisión remota nueva ({pendingReconciliation.remote.revision}) que requiere decisión. La versión local no se ha sobrescrito.</Notice>
        <p className="muted">Base: revisión {pendingReconciliation.base.revision} · Detectada: {new Date(pendingReconciliation.detectedAt).toLocaleString('es-ES')}. Al aceptar se crea una copia local y se aplican los datos compartidos del Gestor; las rondas y actas de Tabulación se preservan.</p>
        <ul className="tab-list">{(pendingDiff?.changes ?? []).filter((item) => item.change !== 'unchanged').map((item) => <li key={item.kind + ':' + item.remoteId}>
          <div><b>{item.kind} · {item.label}</b><small>Tipo: {item.change} · Campos: {item.fields.join(', ') || 'alta remota'}</small>
            <small>Local: {JSON.stringify(item.local)}</small><small>Gestor: {JSON.stringify(item.remote)}</small></div>
        </li>)}</ul>
        <div className="tab-actions"><button type="button" className="button primary" disabled={state.readOnly} onClick={applyPendingRemote}>Revisar y aplicar cambios del Gestor</button></div>
      </>}
    </section>}

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
        <button type="button" className="text-button" onClick={() => { void (async () => { if (!await acknowledgeHandoffDelivery()) { notify('No se pudo confirmar el descarte; la entrega seguirá pendiente.', 'error'); return; } setShowLinkReview(false); })(); }}>Descartar</button>
      </div>
    </section>}
    {showLinkReview && tournament && handoff?.tournamentId && !tournament.panelLink && <PanelLinkReview key={handoff.createdAt + '-' + handoff.tournamentId}
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
