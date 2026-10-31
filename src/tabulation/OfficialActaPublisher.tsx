import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudUpload, RefreshCw } from 'lucide-react';
import { ApiError, apiConfigured, previewTabulationActa, saveTabulationActa, type PreviewTabulationActaResponse, type SaveTabulationActaResponse } from '../api';
import { computeDebateOutcome, outcomeContext } from './results';
import { makeTabId, type TabDebate, type TabDebateResult, type TabRound, type TabTournament } from './types';
import { lookups } from './ui';
import { Notice } from './ui';
import type { TabStore } from './store';

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
    return value;
  } catch { return null; }
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
      if (disposed || !navigator.onLine || automaticAttemptRef.current === attemptKey) return;
      automaticAttemptRef.current = attemptKey;
      setBusy(true);
      try {
        // A previously persisted operation always wins over a newly built payload.
        // This recovers an ambiguous timeout with the same operationId and exact body.
        const existingPending = pendingSaveRef.current?.input.assignmentId === assignmentId
          ? pendingSaveRef.current : readPendingSave(assignmentId);
        if (existingPending) {
          setPendingSave(existingPending);
          const saved = await saveTabulationActa(token, existingPending.input);
          if (disposed) return;
          setLastSaved(saved);
          setPendingSave(null);
          setPreview(null);
          store.log({
            type: saved.replacedSourceId ? 'acta.official.replace' : 'acta.official.save',
            message: round.name + ' · confirmación oficial recuperada. Versión ' + saved.sourceId + '.',
            details: { assignmentId, sourceId: saved.sourceId, operationId: saved.operationId, winnerTeamId: saved.winnerTeamId },
          });
          notify('Confirmación recuperada con la misma operación. El Gestor conserva la versión oficial ' + saved.sourceId + '.', 'success');
          return;
        }

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

        const acta = asRecord(source.acta);
        if (!acta) throw new Error('La fuente del acta no contiene un acta válida.');
        const confirmedSource = {
          ...source,
          acta: {
            ...acta,
            basePanelRevision: comparison.basePanelRevision,
            basePanelUpdatedAt: comparison.basePanelUpdatedAt,
          },
        };
        const operationId = makeTabId('acta-op');
        const stablePending: PendingSave = {
          operationId,
          input: {
            operationId,
            assignmentId,
            source: confirmedSource,
            expectedCurrentSourceId: null,
            confirmReplace: false,
            expectedSettingsRevision: comparison.settingsRevision,
          },
        };
        // Persist the exact operation before the network write so a reload can recover it idempotently.
        try {
          window.localStorage.setItem(pendingStorageKey(assignmentId), JSON.stringify(stablePending));
        } catch {
          setPendingSave(stablePending);
          notify('El primer acta se ha conservado localmente, pero no se puede persistir la operación de sincronización en este navegador. Libera espacio y reintenta.', 'error');
          return;
        }
        setPendingSave(stablePending);
        const saved = await saveTabulationActa(token, stablePending.input);
        if (disposed) return;
        setLastSaved(saved);
        setPendingSave(null);
        setPreview(null);
        store.log({
          type: 'acta.official.save',
          message: round.name + ' · primera acta sincronizada automáticamente con el Gestor. Versión ' + saved.sourceId + '.',
          details: { assignmentId, sourceId: saved.sourceId, operationId: saved.operationId, winnerTeamId: saved.winnerTeamId },
        });
        notify('Primera versión del acta sincronizada automáticamente con el Gestor.', 'success');
      } catch (error) {
        if (!disposed) {
          if (error instanceof ApiError && nonRetryableActaCodes.has(error.code)) {
            setPendingSave(null);
            setPreview(null);
            notify(error.message + ' El acta local se conserva; vuelve a comparar antes de publicar.', 'error');
          } else {
            notify((error instanceof Error ? error.message : 'No se ha podido sincronizar el primer acta.')
              + ' El acta local se conserva. Se reintentará al recuperar conexión o puedes recuperar la misma operación.', 'warning');
          }
        }
      } finally {
        if (!disposed) setBusy(false);
      }
    };

    void attempt();
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
    if (!token || !assignmentId || !source || !canPublish) return;
    setBusy(true);
    setLastSaved(null);
    try {
      const next = await previewTabulationActa(token, assignmentId, source);
      if (next.assignmentId !== assignmentId || next.tournamentId !== tournament.panelLink?.remoteId
        || next.roundId !== round.managerRoundId || next.debateId !== debate.id) {
        throw new Error('La comparación devuelta no corresponde a esta asignación y torneo.');
      }
      setPreview(next);
      setPendingSave(null);
    } catch (error) {
      setPreview(null);
      notify(error instanceof Error ? error.message : 'No se ha podido comparar el acta con el Gestor.', 'error');
    } finally { setBusy(false); }
  };

  const publish = async () => {
    if (!token || !assignmentId || !preview || !source) return;
    if (preview.basePanelRevision < 0 || !Number.isFinite(preview.basePanelUpdatedAt)) {
      notify('La comparación no contiene una revisión válida. Vuelve a comparar.', 'error');
      return;
    }
    setBusy(true);
    const acta = asRecord(source.acta)!;
    const confirmedSource = {
      ...source,
      acta: {
        ...acta,
        basePanelRevision: preview.basePanelRevision,
        basePanelUpdatedAt: preview.basePanelUpdatedAt,
      },
    };
    const operationId = pendingSave?.input.operationId ?? makeTabId('acta-op');
    const stablePending: PendingSave = pendingSave ?? {
      operationId,
      input: {
        operationId,
        assignmentId,
        source: confirmedSource,
        expectedCurrentSourceId: preview.currentSourceId,
        confirmReplace: Boolean(preview.currentSourceId),
        expectedSettingsRevision: preview.settingsRevision,
      },
    };
    setPendingSave(stablePending);
    try {
      const saved = await saveTabulationActa(token, stablePending.input);
      setLastSaved(saved);
      setPendingSave(null);
      setPreview(null);
      store.log({
        type: saved.replacedSourceId ? 'acta.official.replace' : 'acta.official.save',
        message: round.name + ' · acta oficial publicada en el Gestor. Versión ' + saved.sourceId
          + (saved.rewriteCount ? ' · reescrituras: ' + saved.rewriteCount : '') + '.',
        details: { assignmentId, sourceId: saved.sourceId, operationId: saved.operationId, winnerTeamId: saved.winnerTeamId },
      });
      notify(saved.replacedSourceId ? 'Acta oficial sustituida. Reescrituras acumuladas: ' + saved.rewriteCount + '.' : 'Primera versión del acta publicada oficialmente en el Gestor.', 'success');
    } catch (error) {
      if (error instanceof ApiError && nonRetryableActaCodes.has(error.code)) {
        setPendingSave(null);
        setPreview(null);
        notify(error.message + ' La operación no se ha guardado; vuelve a comparar el acta con el Gestor.', 'error');
      } else {
        notify((error instanceof Error ? error.message : 'No se ha podido publicar el acta.')
          + ' Puedes reintentar: se conservará el mismo identificador de operación.', 'error');
      }
    } finally { setBusy(false); }
  };

  const retryPending = async () => {
    if (!token || !pendingSave) return;
    setBusy(true);
    try {
      const saved = await saveTabulationActa(token, pendingSave.input);
      setLastSaved(saved);
      setPendingSave(null);
      setPreview(null);
      store.log({
        type: saved.replacedSourceId ? 'acta.official.replace' : 'acta.official.save',
        message: round.name + ' · confirmación oficial recuperada. Versión ' + saved.sourceId + '.',
        details: { assignmentId, sourceId: saved.sourceId, operationId: saved.operationId, winnerTeamId: saved.winnerTeamId },
      });
      notify('Confirmación recuperada: el Gestor conserva la versión oficial ' + saved.sourceId + '.', 'success');
    } catch (error) {
      if (error instanceof ApiError && nonRetryableActaCodes.has(error.code)) {
        setPendingSave(null);
        setPreview(null);
        notify(error.message + ' La operación no se ha guardado; vuelve a comparar después de resolver el conflicto.', 'error');
      } else {
        notify((error instanceof Error ? error.message : 'No se ha podido recuperar la confirmación.')
          + ' Se conservará la misma operación para volver a intentarlo.', 'error');
      }
    } finally { setBusy(false); }
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
              <button type="button" className="button secondary" onClick={() => void compare()} disabled={busy || Boolean(pendingSave)}>
                <RefreshCw size={15} /> {busy && !pendingSave ? 'Comparando…' : 'Comparar con el acta oficial'}
              </button>
              {pendingSave && <><span className="muted">Publicación pendiente: la operación está guardada para reintentar incluso después de recargar.</span>
                <button type="button" className="button primary" onClick={() => void retryPending()} disabled={busy}>Reintentar y recuperar confirmación</button></>}
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
                <button type="button" className="text-button" disabled={Boolean(pendingSave)} onClick={() => setPreview(null)}>Cancelar comparación</button>
              </div>
            </div>}
            {lastSaved && <Notice kind="success">Versión oficial {lastSaved.sourceId} guardada. Total de versiones: {lastSaved.totalVersions}; reescrituras: {lastSaved.rewriteCount}.</Notice>}
          </div>}
  </section>;
}
