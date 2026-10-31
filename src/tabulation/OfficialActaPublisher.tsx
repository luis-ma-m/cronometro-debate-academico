import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudUpload, RefreshCw } from 'lucide-react';
import { ApiError, apiConfigured, previewTabulationActa, type PreviewTabulationActaResponse, type SaveTabulationActaResponse } from '../api';
import { computeDebateOutcome, outcomeContext } from './results';
import { makeTabId, type TabDebate, type TabDebateResult, type TabRound, type TabTournament } from './types';
import { lookups } from './ui';
import { Notice } from './ui';
import type { TabStore } from './store';
import { createIndexedDbSyncOutboxRepository, createSyncOutbox, SYNC_OUTBOX_STATE_EVENT, SYNC_OUTBOX_UPDATED_EVENT } from './syncOutbox';
import { ACTA_SYNC_ACK_EVENT } from './syncDispatcher';

interface Props {
  tournament: TabTournament;
  round: TabRound;
  debate: TabDebate;
  result: TabDebateResult;
  token?: string;
  store: TabStore;
  notify: (message: string, kind?: 'success' | 'warning' | 'error') => void;
}

interface PendingSave {
  operationId: string;
  mode: 'first-save' | 'confirmed';
  input: {
    operationId: string;
    assignmentId: string;
    source: Record<string, unknown>;
    expectedCurrentSourceId: string | null;
    confirmReplace: boolean;
    expectedSettingsRevision: number;
  };
}

function pendingStorageKey(assignmentId: string): string { return 'ledu-tabulation-acta-pending-v1:' + assignmentId; }
function readPendingSave(assignmentId: string): PendingSave | null {
  if (!assignmentId) return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(pendingStorageKey(assignmentId)) ?? 'null') as unknown;
    const value = raw as PendingSave | null;
    if (!value || typeof value !== 'object' || !value.input || value.input.assignmentId !== assignmentId
      || typeof value.input.operationId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value.input.operationId)
      || !value.input.source || typeof value.input.source !== 'object'
      || (value.input.expectedCurrentSourceId !== null && typeof value.input.expectedCurrentSourceId !== 'string')
      || typeof value.input.confirmReplace !== 'boolean'
      || !Number.isSafeInteger(value.input.expectedSettingsRevision)) return null;
    return { ...value, mode: value.mode === 'first-save' ? 'first-save' : 'confirmed' };
  } catch { return null; }
}

async function enqueueActaOperation(tournamentId: string, assignmentId: string, pending: PendingSave, supersedeOperationId?: string | null): Promise<void> {
  const outbox = createSyncOutbox(createIndexedDbSyncOutboxRepository());
  const payload = pending.mode === 'first-save'
    ? { mode: 'first-save', assignmentId, source: pending.input.source }
    : { mode: 'confirmed', input: pending.input };
  await outbox.enqueue({
    operationId: pending.operationId,
    tournamentId,
    entityType: 'acta',
    entityId: assignmentId,
    operation: 'replace-acta',
    baseRevision: pending.input.expectedSettingsRevision,
    payload,
  });
  if (supersedeOperationId && !await outbox.supersede(supersedeOperationId, pending.operationId)) {
    throw new Error('La operación anterior sigue bloqueando la cola. Actualiza su estado y vuelve a resolver el conflicto.');
  }
  window.dispatchEvent(new Event(SYNC_OUTBOX_UPDATED_EVENT));
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const nonRetryableActaCodes = new Set([
  'ACTA_REVISION_CONFLICT', 'ACTA_RULES_REVISION_CONFLICT', 'ACTA_IDENTITY_MISMATCH',
  'ACTA_CONTEXT_INVALID', 'ACTA_IDENTITY_REVIEW_REQUIRED', 'ACTA_REPLACEMENT_CONFIRMATION_REQUIRED',
  'ACTA_REPLACEMENT_CONFIRMATION_INVALID', 'INVALID_ACTA', 'INVALID_ACTA_SOURCE',
  'ACTA_SOURCE_MODE_MISMATCH', 'INVALID_ELIMINATION_RESULT', 'ELIMINATION_RESULT_MISMATCH', 'SCHEMA_TOO_NEW',
]);
function ballotCount(source: Record<string, unknown> | null): number {
  const payload = asRecord(source?.sourcePayload);
  const acta = asRecord(payload?.acta);
  const result = asRecord(acta?.result);
  return Array.isArray(result?.ballots) ? result.ballots.length : 0;
}

/** First official save is attempted automatically; every replacement still requires an explicit diff and confirmation. */
export function OfficialActaPublisher({ tournament, round, debate, result, token, store, notify }: Props) {
  const assignmentId = debate.managerAssignmentId ?? '';
  const [preview, setPreview] = useState<PreviewTabulationActaResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(() => readPendingSave(assignmentId));
  const pendingSaveRef = useRef(pendingSave);
  pendingSaveRef.current = pendingSave;
  const [lastSaved, setLastSaved] = useState<SaveTabulationActaResponse | null>(null);
  const [queueStatus, setQueueStatus] = useState<'pending' | 'sending' | 'conflict' | 'failed' | 'superseded' | null>(null);
  const [supersedeOperationId, setSupersedeOperationId] = useState<string | null>(null);
  const supersededCandidateRef = useRef<PendingSave | null>(null);
  const automaticAttemptRef = useRef('');
  const context = useMemo(() => outcomeContext(tournament), [tournament]);
  const look = useMemo(() => lookups(tournament), [tournament]);
  const outcome = useMemo(() => computeDebateOutcome(round, { ...debate, result }, context), [round, debate, result, context]);
  useEffect(() => {
    setPendingSave(readPendingSave(assignmentId));
    setPreview(null);
    setLastSaved(null);
  }, [assignmentId]);
  useEffect(() => {
    if (!assignmentId) return;
    if (pendingSave?.input.assignmentId === assignmentId) {
      try { window.localStorage.setItem(pendingStorageKey(assignmentId), JSON.stringify(pendingSave)); } catch { /* Server idempotency remains available for this mounted session. */ }
    } else if (!pendingSave) {
      try { window.localStorage.removeItem(pendingStorageKey(assignmentId)); } catch { /* Storage may be disabled. */ }
    }
  }, [assignmentId, pendingSave]);
  useEffect(() => {
    const remoteId = tournament.panelLink?.remoteId;
    if (pendingSave || !remoteId || !assignmentId) return;
    let disposed = false;
    void createSyncOutbox(createIndexedDbSyncOutboxRepository()).list(remoteId).then((rows) => {
      if (disposed) return;
      const queued = rows.find((row) => row.entityType === 'acta' && row.entityId === assignmentId
        && row.operation === 'replace-acta' && row.status !== 'superseded');
      if (!queued) return;
      const payload = asRecord(queued.payload);
      const firstSaveSource = asRecord(payload?.source);
      if (payload?.mode === 'first-save' && firstSaveSource) {
        setPendingSave({
          operationId: queued.operationId,
          mode: 'first-save',
          input: {
            operationId: queued.operationId, assignmentId, source: firstSaveSource,
            expectedCurrentSourceId: null, confirmReplace: false, expectedSettingsRevision: queued.baseRevision,
          },
        });
        return;
      }
      const input = asRecord(payload?.input);
      const confirmedSource = asRecord(input?.source);
      if (payload?.mode === 'confirmed' && input && input.operationId === queued.operationId
        && input.assignmentId === assignmentId && confirmedSource
        && Number.isSafeInteger(input.expectedSettingsRevision)
        && typeof input.confirmReplace === 'boolean'
        && (input.expectedCurrentSourceId === null || typeof input.expectedCurrentSourceId === 'string')) {
        setPendingSave({
          operationId: queued.operationId,
          mode: 'confirmed',
          input: {
            operationId: queued.operationId, assignmentId, source: confirmedSource,
            expectedCurrentSourceId: input.expectedCurrentSourceId as string | null,
            confirmReplace: input.confirmReplace,
            expectedSettingsRevision: input.expectedSettingsRevision as number,
          },
        });
      }
    }).catch(() => { /* IndexedDB remains the source of truth; the sidebar still reports the queue state. */ });
    return () => { disposed = true; };
  }, [assignmentId, pendingSave?.operationId, tournament.panelLink?.remoteId]);

  useEffect(() => {
    const remoteId = tournament.panelLink?.remoteId;
    if (!remoteId || !pendingSave?.operationId) { setQueueStatus(null); return; }
    let disposed = false;
    const refresh = async () => {
      try {
        const rows = await createSyncOutbox(createIndexedDbSyncOutboxRepository()).list(remoteId);
        if (disposed) return;
        setQueueStatus(rows.find((row) => row.operationId === pendingSave.operationId)?.status ?? null);
      } catch { if (!disposed) setQueueStatus(null); }
    };
    const onState = (event: Event) => {
      const rows = (event as CustomEvent<Array<{ operationId: string; status: 'pending' | 'sending' | 'conflict' | 'failed' | 'superseded' }>>).detail;
      if (Array.isArray(rows)) setQueueStatus(rows.find((row) => row.operationId === pendingSave.operationId)?.status ?? null);
    };
    void refresh();
    window.addEventListener(SYNC_OUTBOX_STATE_EVENT, onState);
    return () => { disposed = true; window.removeEventListener(SYNC_OUTBOX_STATE_EVENT, onState); };
  }, [pendingSave?.operationId, tournament.panelLink?.remoteId]);

  useEffect(() => {
    if (!pendingSave || !tournament.panelLink?.remoteId || !assignmentId) return;
    let disposed = false;
    void enqueueActaOperation(tournament.panelLink.remoteId, assignmentId, pendingSave, supersedeOperationId).then(() => {
      if (supersedeOperationId) { setSupersedeOperationId(null); supersededCandidateRef.current = null; }
    }).catch((error) => {
      if (!disposed) notify('El acta sigue guardada localmente, pero no se pudo abrir la cola IndexedDB: ' + (error instanceof Error ? error.message : 'error desconocido') + '.', 'error');
    });
    return () => { disposed = true; };
  }, [assignmentId, pendingSave?.operationId, pendingSave?.mode, tournament.panelLink?.remoteId, supersedeOperationId, notify]);

  useEffect(() => {
    const onAcknowledged = (event: Event) => {
      const detail = (event as CustomEvent<{ operationId?: string; assignmentId?: string; response?: unknown }>).detail;
      if (detail?.assignmentId !== assignmentId || detail.operationId !== pendingSaveRef.current?.operationId) return;
      setPendingSave(null);
      const response = detail.response as SaveTabulationActaResponse | { alreadyCurrent?: boolean; currentSourceId?: string } | undefined;
      if (response && 'sourceId' in response && typeof response.sourceId === 'string') {
        setLastSaved(response as SaveTabulationActaResponse);
        store.log({
          type: (response as SaveTabulationActaResponse).replacedSourceId ? 'acta.official.replace' : 'acta.official.save',
          message: round.name + ' · acta oficial confirmada por la cola offline. Versión ' + (response as SaveTabulationActaResponse).sourceId + '.',
          details: { assignmentId, operationId: detail.operationId, sourceId: (response as SaveTabulationActaResponse).sourceId },
        });
        notify('Acta oficial confirmada por el Gestor.', 'success');
      } else if (response && 'alreadyCurrent' in response && response.alreadyCurrent) {
        notify('El Gestor ya tenía esta misma versión del acta. No se ha creado una reescritura.', 'success');
      }
    };
    window.addEventListener(ACTA_SYNC_ACK_EVENT, onAcknowledged);
    return () => window.removeEventListener(ACTA_SYNC_ACK_EVENT, onAcknowledged);
  }, [assignmentId, notify, round.name, store]);

  const canPublish = Boolean(apiConfigured && token && tournament.panelLink?.remoteId && round.managerRoundId && assignmentId);
  const source = useMemo<Record<string, unknown> | null>(() => {
    if (outcome.status !== 'complete' || !outcome.winnerTeamId) return null;
    const acta: Record<string, unknown> = {
      tournamentId: tournament.id,
      basePanelRevision: tournament.panelLink?.remoteRevision ?? 0,
      basePanelUpdatedAt: tournament.panelLink?.remoteUpdatedAt ?? 0,
      roundId: round.id,
      debateId: debate.id,
      result,
    };
    return {
      sourceMode: round.kind === 'elimination' ? 'elimination' : tournament.settings.ballotMode,
      acta,
      ...(round.kind === 'elimination' ? {
        eliminationResult: {
          winnerTeamId: outcome.winnerTeamId,
          loserTeamId: debate.teamIds.find((id) => id !== outcome.winnerTeamId),
          advancingTeamIds: [outcome.winnerTeamId],
        },
      } : {}),
    };
  }, [outcome, tournament.id, tournament.panelLink?.remoteRevision, tournament.panelLink?.remoteUpdatedAt,
    tournament.settings.ballotMode, round.id, round.kind, debate.id, debate.teamIds, result]);

  useEffect(() => {
    if (!canPublish || !token || !source || lastSaved || outcome.status !== 'complete') return;
    const attemptKey = assignmentId + ':' + JSON.stringify(source);
    let disposed = false;

    const attempt = async () => {
      if (disposed || automaticAttemptRef.current === attemptKey) return;
      automaticAttemptRef.current = attemptKey;
      const existingPending = pendingSaveRef.current?.input.assignmentId === assignmentId
        ? pendingSaveRef.current : readPendingSave(assignmentId);
      if (existingPending) {
        setPendingSave(existingPending);
        return; // The IndexedDB worker owns all remote writes and retries.
      }
      if (!navigator.onLine) {
        const operationId = makeTabId('acta-op');
        const offlinePending: PendingSave = {
          operationId,
          mode: 'first-save',
          input: { operationId, assignmentId, source, expectedCurrentSourceId: null, confirmReplace: false, expectedSettingsRevision: 0 },
        };
        setPendingSave(offlinePending);
        notify('El acta se ha guardado localmente y queda en la cola offline. Al recuperar conexión se comprobará que no exista ya una versión oficial antes de publicarla.', 'warning');
        return;
      }
      setBusy(true);
      try {
        const comparison = await previewTabulationActa(token, assignmentId, source);
        if (disposed) return;
        if (comparison.assignmentId !== assignmentId || comparison.tournamentId !== tournament.panelLink?.remoteId
          || comparison.roundId !== round.managerRoundId || comparison.debateId !== debate.id) {
          throw new Error('La comparación automática no corresponde a esta asignación y torneo.');
        }
        if (comparison.currentSourceId) {
          if (comparison.changes.length === 0) {
            setPreview(null);
            notify('El acta ya coincide con la versión oficial del Gestor. No se ha creado una reescritura.', 'success');
          } else {
            setPreview(comparison);
            notify('Ya existe un acta oficial. Revisa las diferencias y confirma expresamente si quieres sustituirla.', 'warning');
          }
          return;
        }
        const confirmedSource = {
          ...source,
          acta: {
            ...(asRecord(source.acta) ?? {}),
            basePanelRevision: comparison.basePanelRevision,
            basePanelUpdatedAt: comparison.basePanelUpdatedAt,
          },
        };
        const operationId = makeTabId('acta-op');
        const stablePending: PendingSave = {
          operationId,
          mode: 'confirmed',
          input: {
            operationId, assignmentId, source: confirmedSource,
            expectedCurrentSourceId: null, confirmReplace: false,
            expectedSettingsRevision: comparison.settingsRevision,
          },
        };
        setPendingSave(stablePending);
        notify('Primera versión validada. Se ha añadido a la cola duradera para que el worker confirme el guardado sin riesgo de duplicarlo.', 'success');
      } catch (error) {
        if (!disposed) {
          if (error instanceof ApiError && nonRetryableActaCodes.has(error.code)) {
            setPreview(null);
            notify(error.message + ' El acta local se conserva; vuelve a comparar antes de publicar.', 'error');
          } else {
            const operationId = makeTabId('acta-op');
            const offlinePending: PendingSave = {
              operationId,
              mode: 'first-save',
              input: { operationId, assignmentId, source, expectedCurrentSourceId: null, confirmReplace: false, expectedSettingsRevision: 0 },
            };
            setPendingSave(offlinePending);
            notify('No se pudo comparar con el Gestor. El acta local queda en la cola offline; al reconectar se volverá a comprobar que no exista una versión oficial.', 'warning');
          }
        }
      } finally {
        if (!disposed) setBusy(false);
      }
    };

    const onReconnect = () => {
      if (document.visibilityState === 'hidden') return;
      automaticAttemptRef.current = '';
      void attempt();
    };
    window.addEventListener('online', onReconnect);
    window.addEventListener('focus', onReconnect);
    document.addEventListener('visibilitychange', onReconnect);
    return () => {
      disposed = true;
      window.removeEventListener('online', onReconnect);
      window.removeEventListener('focus', onReconnect);
      document.removeEventListener('visibilitychange', onReconnect);
    };
  }, [assignmentId, canPublish, debate.id, lastSaved, notify, outcome.status, round.managerRoundId, round.name, source, store, token, tournament.panelLink?.remoteId]);

  const compare = async () => {
    if (!token || !assignmentId || !source || !canPublish || !tournament.panelLink?.remoteId) return;
    const previous = pendingSave;
    setBusy(true);
    setLastSaved(null);
    try {
      if (previous) {
        const rows = await createSyncOutbox(createIndexedDbSyncOutboxRepository()).list(tournament.panelLink.remoteId);
        const queued = rows.find((row) => row.operationId === previous.operationId);
        if (!queued || (queued.status !== 'conflict' && queued.status !== 'failed')) {
          notify('La operación todavía no está en conflicto ni ha fallado. Reanúdala en lugar de crear una segunda publicación.', 'warning');
          return;
        }
      }
      const next = await previewTabulationActa(token, assignmentId, source);
      if (next.assignmentId !== assignmentId || next.tournamentId !== tournament.panelLink.remoteId
        || next.roundId !== round.managerRoundId || next.debateId !== debate.id) {
        throw new Error('La comparación devuelta no corresponde a esta asignación y torneo.');
      }
      if (previous && next.currentSourceId && next.changes.length === 0) {
        const outbox = createSyncOutbox(createIndexedDbSyncOutboxRepository());
        if (!await outbox.supersede(previous.operationId)) throw new Error('No se pudo archivar el conflicto ya resuelto.');
        setPendingSave(null);
        setPreview(null);
        setQueueStatus(null);
        notify('El Gestor ya contiene exactamente esta acta. Se ha archivado el conflicto sin crear una reescritura.', 'success');
        return;
      }
      if (previous) {
        supersededCandidateRef.current = previous;
        setSupersedeOperationId(previous.operationId);
        setPendingSave(null);
      }
      setPreview(next);
    } catch (error) {
      setPreview(null);
      notify(error instanceof Error ? error.message : 'No se ha podido comparar el acta con el Gestor.', 'error');
    } finally { setBusy(false); }
  };

  const cancelComparison = () => {
    setPreview(null);
    if (supersededCandidateRef.current) {
      setPendingSave(supersededCandidateRef.current);
      setSupersedeOperationId(null);
      supersededCandidateRef.current = null;
    }
  };

  const publish = async () => {
    if (!token || !assignmentId || !preview || !source || !tournament.panelLink?.remoteId) return;
    if (preview.currentSourceId && preview.changes.length === 0) {
      setPreview(null);
      notify('El acta ya coincide con la versión oficial del Gestor. No se ha creado una reescritura.', 'success');
      return;
    }
    if (preview.basePanelRevision < 0 || !Number.isFinite(preview.basePanelUpdatedAt)) {
      notify('La comparación no contiene una revisión válida. Vuelve a comparar.', 'error');
      return;
    }
    const acta = asRecord(source.acta)!;
    const confirmedSource = {
      ...source,
      acta: {
        ...acta,
        basePanelRevision: preview.basePanelRevision,
        basePanelUpdatedAt: preview.basePanelUpdatedAt,
      },
    };
    const operationId = makeTabId('acta-op');
    const stablePending: PendingSave = {
      operationId,
      mode: 'confirmed',
      input: {
        operationId, assignmentId, source: confirmedSource,
        expectedCurrentSourceId: preview.currentSourceId,
        confirmReplace: Boolean(preview.currentSourceId),
        expectedSettingsRevision: preview.settingsRevision,
      },
    };
    setPendingSave(stablePending);
    setPreview(null);
    notify(preview.currentSourceId ? 'Sustitución confirmada y añadida a la cola duradera. Se conservará el mismo operationId durante los reintentos.' : 'Primera publicación añadida a la cola duradera.', 'success');
  };

  const retryPending = async () => {
    if (!pendingSave) return;
    if (queueStatus === 'conflict' || queueStatus === 'failed') { await compare(); return; }
    window.dispatchEvent(new Event(SYNC_OUTBOX_UPDATED_EVENT));
    notify('Se ha solicitado al worker que reanude la misma operación pendiente.', 'success');
  };


  if (!apiConfigured || !tournament.panelLink?.remoteId) return null;
  return <section className="panel tab-official-acta-publisher">
    <div className="panel-title">
      <div><h3>Acta oficial del Gestor</h3><p>El primer guardado se sincroniza automáticamente cuando no existe versión oficial. Toda sustitución requiere comparar y confirmar.</p></div>
      <CloudUpload size={18} />
    </div>
    {!token ? <Notice kind="warning">Inicia sesión en el Panel de organización en esta misma sesión del navegador para publicar actas.</Notice>
      : !round.managerRoundId || !assignmentId ? <Notice kind="info">Este debate aún no tiene una asignación remota vinculada. Publica la ronda y sincroniza su confirmación antes de enviar el acta.</Notice>
        : outcome.status !== 'complete' || !source ? <Notice kind="warning">Completa y guarda un acta válida antes de compararla con el Gestor.</Notice>
          : <div className="tab-official-acta-content">
            <div className="tab-actions">
              <button type="button" className="button secondary" onClick={() => void compare()} disabled={busy || Boolean(pendingSave && queueStatus !== 'conflict' && queueStatus !== 'failed')}>
                <RefreshCw size={15} /> {busy && !pendingSave ? 'Comparando…' : pendingSave && (queueStatus === 'conflict' || queueStatus === 'failed') ? 'Revisar conflicto' : 'Comparar con el acta oficial'}
              </button>
              {pendingSave && <><span className="muted">{'Publicación pendiente: ' + (queueStatus === 'conflict' ? 'conflicto que requiere revisión' : queueStatus === 'failed' ? 'error que requiere corrección' : 'operación persistida en IndexedDB; se reintentará al recuperar conexión')}</span>
                <button type="button" className="button primary" onClick={() => void retryPending()} disabled={busy}>{queueStatus === 'conflict' || queueStatus === 'failed' ? 'Revisar y resolver' : 'Reanudar sincronización'}</button></>}
            </div>
            {preview && <div className="notice tab-info-notice" role="status">
              <b>{preview.currentSourceId ? 'Comparación de sustitución' : 'Primera publicación'}</b>
              <p>Ganador propuesto: <b>{look.teamName(outcome.winnerTeamId ?? '')}</b> · modalidad: {preview.sourceMode} · revisión del Gestor: {preview.basePanelRevision}.</p>
              {preview.currentSource
                ? <p>Versión vigente: {preview.currentSource.id} · {preview.currentSource.sourceMode} · {ballotCount(preview.currentSource)} papeletas · hash {preview.currentSource.sourceHash.slice(0, 12)}…</p>
                : <p>No existe una versión oficial previa para esta asignación.</p>}
              <p>Propuesta: {result.ballots.length} papeletas · {Object.keys(result.penalties).length} equipos con registro de sanciones.</p>
              {preview.currentSourceId && <p><AlertTriangle size={14} /> La confirmación sustituirá la versión vigente y aumentará el contador de reescrituras.</p>}
              {preview.currentSourceId && <div className="tab-acta-diff" aria-label="Diferencias con el acta oficial">
                <b>Cambios detectados ({preview.changes.length}{preview.changes.length === 40 ? '+' : ''})</b>
                {preview.changes.length
                  ? <ul>{preview.changes.slice(0, 12).map((change) => <li key={change.path}>
                      <code>{change.path}</code>: <span>{JSON.stringify(change.before) ?? '—'}</span> → <b>{JSON.stringify(change.after) ?? '—'}</b>
                    </li>)}</ul>
                  : <p>El contenido coincide con la versión oficial.</p>}
              </div>}
              <div className="tab-actions">
                <button type="button" className="button primary" onClick={() => void publish()} disabled={busy}>
                  <CheckCircle2 size={15} /> {busy && pendingSave ? 'Publicando…' : preview.currentSourceId ? 'Confirmar sustitución oficial' : 'Confirmar primera publicación'}
                </button>
                <button type="button" className="text-button" disabled={Boolean(pendingSave)} onClick={cancelComparison}>Cancelar comparación</button>
              </div>
            </div>}
            {lastSaved && <Notice kind="success">Versión oficial {lastSaved.sourceId} guardada. Total de versiones: {lastSaved.totalVersions}; reescrituras: {lastSaved.rewriteCount}.</Notice>}
          </div>}
  </section>;
}
