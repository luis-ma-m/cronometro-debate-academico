import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudUpload, RefreshCw } from 'lucide-react';
import { apiConfigured, previewTabulationActa, saveTabulationActa, type PreviewTabulationActaResponse, type SaveTabulationActaResponse } from '../api';
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function ballotCount(source: Record<string, unknown> | null): number {
  const payload = asRecord(source?.sourcePayload);
  const acta = asRecord(payload?.acta);
  const result = asRecord(acta?.result);
  return Array.isArray(result?.ballots) ? result.ballots.length : 0;
}

/** Explicit server comparison and publication; local actas remain usable offline and are never auto-pushed. */
export function OfficialActaPublisher({ tournament, round, debate, result, token, store, notify }: Props) {
  const [preview, setPreview] = useState<PreviewTabulationActaResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [lastSaved, setLastSaved] = useState<SaveTabulationActaResponse | null>(null);
  const context = useMemo(() => outcomeContext(tournament), [tournament]);
  const look = useMemo(() => lookups(tournament), [tournament]);
  const outcome = useMemo(() => computeDebateOutcome(round, { ...debate, result }, context), [round, debate, result, context]);
  const assignmentId = debate.managerAssignmentId;
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

  const compare = async () => {
    if (!token || !assignmentId || !source || !canPublish) return;
    setBusy(true);
    setLastSaved(null);
    try {
      const next = await previewTabulationActa(token, assignmentId, source);
      if (next.assignmentId !== assignmentId || next.tournamentId !== tournament.panelLink?.remoteId) {
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
      notify((error instanceof Error ? error.message : 'No se ha podido publicar el acta.')
        + ' Puedes reintentar: se conservará el mismo identificador de operación.', 'error');
    } finally { setBusy(false); }
  };

  if (!apiConfigured || !tournament.panelLink?.remoteId) return null;
  return <section className="panel tab-official-acta-publisher">
    <div className="panel-title">
      <div><h3>Acta oficial del Gestor</h3><p>La copia local no se publica automáticamente. Compara y confirma la versión oficial por separado.</p></div>
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
              {pendingSave && <span className="muted">Publicación pendiente de confirmar: reintenta para recuperar el ACK.</span>}
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
                <button type="button" className="text-button" onClick={() => { setPreview(null); setPendingSave(null); }}>Cancelar comparación</button>
              </div>
            </div>}
            {lastSaved && <Notice kind="success">Versión oficial {lastSaved.sourceId} guardada. Total de versiones: {lastSaved.totalVersions}; reescrituras: {lastSaved.rewriteCount}.</Notice>}
          </div>}
  </section>;
}
