import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import { formatLogTime, logToCsv, type LogVerification } from '../log';
import { downloadFile, Empty, Field, fileSlug, IssueList, Notice, type ViewProps } from '../ui';

const TYPE_LABELS: Record<string, string> = {
  'tournament.create': 'Torneo creado',
  'tournament.import': 'Importación',
  edit: 'Edición',
  'round.draft': 'Borrador generado',
  'draft.edit': 'Cambio en el borrador',
  'draft.discard': 'Borrador descartado',
  'round.confirm': 'Ronda confirmada',
  'round.export': 'Exportación de ronda',
  'round.reopen': 'Ronda reabierta',
  'round.edit': 'Cambio en una ronda',
  'round.remove': 'Ronda eliminada',
  'round.generate': 'Jornadas generadas',
  'acta.save': 'Acta',
  'acta.delete': 'Acta borrada',
  'team.fallen': 'Equipo caído',
  'team.rest': 'Equipo «Descanso»',
  'conflict.import': 'Incompatibilidades',
  'standings.order': 'Orden manual',
  'backup.restore': 'Copia restaurada',
  'storage.quota': 'Almacenamiento',
  'export.copy': 'Copia exportada',
  'conflict.overwrite': 'Conflicto entre pestañas',
  error: 'Error',
};
const SHOWN = 300;

export function LogView({ tournament, store }: ViewProps) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [verification, setVerification] = useState<(LogVerification & { issues: string[] }) | null>(null);
  // The tournament changes on every save, which is also when the log grows.
  const { entries, issues } = useMemo(() => store.readLog(), [store, tournament]);
  const types = useMemo(() => [...new Set(entries.map((entry) => entry.type))].sort(), [entries]);
  const needle = query.trim().toLocaleLowerCase('es-ES');
  const filtered = entries
    .filter((entry) => (!type || entry.type === type) && (!needle || (entry.message + ' ' + entry.operator + ' ' + JSON.stringify(entry.details ?? '')).toLocaleLowerCase('es-ES').includes(needle)))
    .reverse();
  const visible = showAll ? filtered : filtered.slice(0, SHOWN);
  const stamp = new Date().toISOString().slice(0, 10);

  return <>
    <div className="page-heading"><div><p className="eyebrow">AUDITORÍA</p><h2>Registro</h2>
      <p className="muted">Todo lo que cambia queda anotado, con fecha, operador y una huella encadenada: si alguien modifica o borra una entrada, la verificación lo detecta. Las entradas «pendientes» se guardan con el torneo y se sellan en segundos.</p></div>
      <div className="top-actions">
        <button type="button" className="button primary" onClick={() => setVerification(store.verifyLog())}><ShieldCheck size={16} /> Verificar registro</button>
        <button type="button" className="button secondary" onClick={() => downloadFile('registro-' + fileSlug(tournament.name) + '-' + stamp + '.csv', logToCsv(entries), 'text/csv;charset=utf-8')}><FileSpreadsheet size={16} /> CSV</button>
        <button type="button" className="button secondary" onClick={() => downloadFile('registro-' + fileSlug(tournament.name) + '-' + stamp + '.json', JSON.stringify(entries, null, 2), 'application/json')}><Download size={16} /> JSON</button>
      </div>
    </div>
    {issues.length > 0 && <Notice kind="warning">{issues.join(' ')}</Notice>}
    {verification && (verification.ok
      ? <Notice kind="success" onClose={() => setVerification(null)}>El registro verifica: {entries.length - verification.pending} entradas selladas{verification.segments > 1 ? ' en ' + verification.segments + ' tramos (hubo un fallo de almacenamiento o de verificación entre ellos)' : ''}{verification.pending ? ' y ' + verification.pending + ' pendientes de sellar' : ''}.</Notice>
      : <div className="notice error-notice" role="alert"><span>La verificación ha encontrado problemas. Exporta el registro tal como está y avisa a la organización.</span><IssueList items={verification.problems} kind="error" /></div>)}
    <section className="panel">
      <div className="tab-form-grid">
        <Field label="Buscar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Equipo, juez, sala, operador…" /></Field>
        <Field label="Tipo"><select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">Todos ({entries.length})</option>
          {types.map((item) => <option key={item} value={item}>{TYPE_LABELS[item] ?? item}</option>)}
        </select></Field>
      </div>
      {!filtered.length ? <Empty text={entries.length ? 'Ninguna entrada coincide con la búsqueda.' : 'El registro está vacío.'} /> : <div className="tournament-table-wrap tab-log">
        <table>
          <thead><tr><th>N.º</th><th>Fecha</th><th>Operador</th><th>Tipo</th><th>Qué ha pasado</th><th>Huella</th></tr></thead>
          <tbody>{visible.map((entry) => <tr key={entry.seq} className={entry.type === 'error' ? 'tab-row-issue' : ''}>
            <td>{entry.seq}</td>
            <td className="tab-nowrap">{formatLogTime(entry.at)}</td>
            <td>{entry.operator || '—'}</td>
            <td>{TYPE_LABELS[entry.type] ?? entry.type}</td>
            <td>{entry.message}{entry.details !== undefined && <details className="tab-log-details"><summary>Detalle</summary><pre>{JSON.stringify(entry.details, null, 2)}</pre></details>}</td>
            <td className="tab-hash">{entry.hash ? entry.hash : <span className="muted">pendiente</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {filtered.length > SHOWN && <button type="button" className="text-button" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Ver solo las ' + SHOWN + ' más recientes' : 'Ver las ' + filtered.length + ' entradas'}</button>}
    </section>
  </>;
}
