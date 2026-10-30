import { useMemo, useState } from 'react';
import { suggestPanelEntityMatches, type PanelEntityKind, type PanelHandoff } from './panelBridge';
import type { PanelEntityIdMap, TabTournament } from './types';

type SelectionState = Record<PanelEntityKind, Record<string, string>>;

const KINDS: PanelEntityKind[] = ['teams', 'speakers', 'judges', 'venues'];
const LABELS: Record<PanelEntityKind, string> = {
  teams: 'Equipos',
  speakers: 'Oradores',
  judges: 'Jueces',
  venues: 'Salas',
};

function emptySelections(handoff: PanelHandoff): SelectionState {
  return {
    teams: Object.fromEntries(handoff.teams.map((item) => [item.id, '__new__'])),
    speakers: Object.fromEntries(handoff.speakers.map((item) => [item.id, '__new__'])),
    judges: Object.fromEntries(handoff.judges.map((item) => [item.id, '__new__'])),
    venues: Object.fromEntries(handoff.venues.map((item) => [item.id, '__new__'])),
  };
}

export function PanelLinkReview({ tournament, handoff, onCancel, onConfirm }: {
  tournament: TabTournament;
  handoff: PanelHandoff;
  onCancel: () => void;
  onConfirm: (idMap: PanelEntityIdMap) => void;
}) {
  const [selections, setSelections] = useState<SelectionState>(() => emptySelections(handoff));
  const [error, setError] = useState('');
  const suggestions = useMemo(() => suggestPanelEntityMatches(tournament, handoff), [tournament, handoff]);

  const localItems = {
    teams: tournament.teams,
    speakers: tournament.speakers,
    judges: tournament.judges,
    venues: tournament.venues,
  };
  const remoteItems = {
    teams: handoff.teams,
    speakers: handoff.speakers,
    judges: handoff.judges,
    venues: handoff.venues,
  };

  const confirm = () => {
    const idMap: PanelEntityIdMap = { teams: {}, speakers: {}, judges: {}, venues: {} };
    for (const kind of KINDS) {
      const usedLocalIds = new Set<string>();
      for (const [remoteId, localId] of Object.entries(selections[kind])) {
        if (localId === '__new__') continue;
        if (usedLocalIds.has(localId)) {
          setError('No puedes vincular dos entidades remotas con la misma entidad local en «' + LABELS[kind] + '». Revisa las selecciones.');
          return;
        }
        usedLocalIds.add(localId);
        idMap[kind][localId] = remoteId;
      }
    }
    onConfirm(idMap);
  };

  const renderKind = (kind: PanelEntityKind) => (
    <section className="panel" key={kind}>
      <div className="panel-title"><div><h4>{LABELS[kind]} ({remoteItems[kind].length})</h4><p>Selecciona una entidad local o indica que debe crearse una nueva. Las sugerencias nunca se aceptan automáticamente.</p></div></div>
      {remoteItems[kind].length ? <div className="tab-form-grid">
        {remoteItems[kind].map((remote) => {
          const matches = suggestions.filter((item) => item.kind === kind && item.remoteId === remote.id);
          const suggestion = matches.length === 1 ? matches[0] : undefined;
          const selected = selections[kind][remote.id] ?? '__new__';
          return <label className="tab-field" key={remote.id}>
            <span>{remote.name}</span>
            <select value={selected} onChange={(event) => {
              setSelections((current) => ({ ...current, [kind]: { ...current[kind], [remote.id]: event.target.value } }));
              setError('');
            }}>
              <option value="__new__">Crear nueva entidad local</option>
              {localItems[kind].map((local) => <option value={local.id} key={local.id}>{local.name} · {local.id}</option>)}
            </select>
            <small>{matches.length > 1
              ? matches.length + ' posibles coincidencias; selecciona manualmente.'
              : suggestion
                ? 'Posible coincidencia: ' + (localItems[kind].find((item) => item.id === suggestion.localId)?.name ?? suggestion.localId) + (suggestion.reason === 'same-id' ? ' (mismo ID)' : ' (nombre' + (suggestion.reason === 'name-and-institution' ? ' e institución' : '') + ')')
                : 'Sin coincidencia sugerida. Se creará una entidad local salvo que selecciones otra.'}</small>
          </label>;
        })}
      </div> : <p className="muted">No hay {LABELS[kind].toLocaleLowerCase('es-ES')} en el snapshot remoto.</p>}
    </section>
  );

  return <section className="tab-link-review">
    <div className="panel">
      <div className="panel-title"><div><h3>Revisión de vinculación</h3><p>Vas a vincular «{tournament.name}» con «{handoff.tournamentName}». La identidad remota es {handoff.tournamentId ?? 'no verificada'}.</p></div></div>
      <p>Los IDs locales actuales se conservarán. Las entidades que dejes en «Crear nueva» recibirán un ID local nuevo. No se borrarán equipos, oradores, jueces, salas, rondas ni actas locales.</p>
      <p className="muted">Comprueba especialmente los homónimos y las instituciones. Las coincidencias solo son sugerencias; la decisión final es manual.</p>
    </div>
    {KINDS.map(renderKind)}
    {error && <ul className="tab-issues error"><li>{error}</li></ul>}
    <div className="tab-actions">
      <button type="button" className="button primary" onClick={confirm}>Confirmar vinculación e importar</button>
      <button type="button" className="button secondary" onClick={onCancel}>Cancelar</button>
    </div>
  </section>;
}
