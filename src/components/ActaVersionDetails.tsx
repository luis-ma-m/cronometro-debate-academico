import { useState } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import { getTabulationActaVersion, type TabulationActaVersionDetail } from '../api';

interface Props {
  token: string;
  assignmentId: string;
  versionId: string;
}

/** Lazy, read-only inspection of the immutable source and rules snapshot for an official acta version. */
export function ActaVersionDetails({ token, assignmentId, versionId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<TabulationActaVersionDetail | null>(null);
  const [error, setError] = useState('');

  const toggle = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (detail || loading) return;
    setLoading(true);
    setError('');
    try {
      const value = await getTabulationActaVersion(token, assignmentId, versionId);
      if (value.assignmentId !== assignmentId || value.id !== versionId) {
        throw new Error('El detalle devuelto no corresponde a esta versión y asignación.');
      }
      setDetail(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se ha podido consultar el contenido de esta versión.');
    } finally {
      setLoading(false);
    }
  };

  return <div className="room-acta-version-details">
    <button type="button" className="text-button" onClick={() => void toggle()} aria-expanded={expanded} aria-controls={'acta-version-' + versionId}>
      {loading ? <LoaderCircle size={14} className="spin" /> : expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      {expanded ? 'Ocultar contenido' : 'Consultar contenido y reglas'}
    </button>
    {expanded && <div id={'acta-version-' + versionId}>
      {error && <p className="muted" role="alert">{error}</p>}
      {loading && <p className="muted" role="status">Consultando fuente inmutable…</p>}
      {detail && <>
        <p className="muted">Operación {detail.operationId} · revisión base {detail.baseRevision} · hash {detail.sourceHash}</p>
        <p className="muted">La vista es de solo lectura. La fuente original y el snapshot de reglas se conservan para auditoría.</p>
        <pre>{JSON.stringify({ sourceMode: detail.sourceMode, roundKind: detail.roundKind, sourcePayload: detail.sourcePayload, eliminationResult: detail.eliminationResult, rulesSnapshot: detail.rulesSnapshot }, null, 2)}</pre>
      </>}
    </div>}
  </div>;
}
