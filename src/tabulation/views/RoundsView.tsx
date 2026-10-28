import { useMemo, useState } from 'react';
import { Dices, Gavel, Printer, Send, Shuffle, Sparkles, Star, Trash2, Trophy, X } from 'lucide-react';
import { allocateJudges, judgeTeamConflict, judgesConflict, roundIssues } from '../adjudication';
import { computeBreak, generateFirstElimination, generateNextElimination, tournamentChampion } from '../bracket';
import { drawGroups, generateGroupStage, restingTeams } from '../groups';
import { assignVenues, drawSides, generateSwissRound } from '../pairing';
import { buildOutbox, writeOutbox } from '../panelBridge';
import { randomSeed } from '../random';
import { roundIsComplete } from '../results';
import { simulateRoundResults } from '../sample';
import type { TabStore } from '../store';
import { eliminationRounds, qualifyingRounds, type TabDebate, type TabRound, type TabTournament } from '../types';
import { Empty, IssueList, lookups, STATUS_LABELS, type ViewProps } from '../ui';

export function RoundsView({ tournament, outcomes, update, notify, store, onNavigate }: ViewProps & { store: TabStore; onNavigate: (view: string) => void }) {
  const [selectedId, setSelectedId] = useState(() => tournament.rounds.at(-1)?.id ?? '');
  const round = tournament.rounds.find((item) => item.id === selectedId) ?? tournament.rounds.at(-1);
  const look = useMemo(() => lookups(tournament), [tournament]);
  const { settings } = tournament;
  const qualifying = qualifyingRounds(tournament);
  const elimination = eliminationRounds(tournament);
  const qualifyingDone = qualifying.length > 0 && qualifying.every((item) => roundIsComplete(item, outcomes))
    && (settings.stage === 'groups' || qualifying.length >= settings.swissRounds);
  const breakPreview = useMemo(() => (qualifyingDone && !elimination.length ? computeBreak(tournament, outcomes) : null), [qualifyingDone, elimination.length, tournament, outcomes]);
  const champion = tournamentChampion(tournament, outcomes);

  const addRounds = (rounds: TabRound[], warnings: string[], extra: Partial<TabTournament> = {}) => {
    store.backup('Antes de generar ' + rounds.map((item) => item.name).join(', '));
    update((current) => ({ ...current, ...extra, rounds: [...current.rounds, ...rounds] }));
    setSelectedId(rounds[0].id);
    notify(rounds.map((item) => item.name).join(', ') + ' generada' + (rounds.length > 1 ? 's' : '') + '. Asigna ahora los jueces.' + (warnings.length ? ' ' + warnings.join(' ') : ''), warnings.length ? 'warning' : 'success');
  };

  const generateQualifying = () => {
    if (settings.stage === 'groups') {
      const result = generateGroupStage(tournament, randomSeed());
      if (result.issues.length) { notify(result.issues.join(' '), 'error'); return; }
      addRounds(result.rounds, result.warnings);
      return;
    }
    const result = generateSwissRound(tournament, randomSeed());
    if (!result.round) { notify(result.issues.join(' '), 'error'); return; }
    addRounds([result.round], result.warnings);
  };

  const generateElimination = () => {
    const result = elimination.length ? generateNextElimination(tournament, randomSeed()) : generateFirstElimination(tournament, randomSeed());
    if (result.champion) { notify('El torneo ha terminado. Campeón: ' + look.teamName(result.champion) + '.'); return; }
    if (!result.round) { notify(result.issues.join(' '), 'error'); return; }
    addRounds([result.round], [], { breakSeeds: result.breakSeeds });
  };

  const drawTheGroups = () => {
    if (tournament.groups.length && !window.confirm('¿Volver a sortear los grupos?')) return;
    const teams = tournament.teams.filter((team) => team.active && !team.swing);
    if (teams.length < 2) { notify('Añade al menos dos equipos activos.', 'error'); return; }
    update((current) => ({ ...current, groups: drawGroups(teams, current.settings.groupCount, randomSeed()) }));
    notify('Grupos sorteados. Puedes mover equipos entre grupos antes de generar las jornadas.');
  };

  const setRound = (roundId: string, mutate: (round: TabRound) => TabRound) =>
    update((current) => ({ ...current, rounds: current.rounds.map((item) => (item.id === roundId ? mutate(item) : item)) }));
  const setDebate = (roundId: string, debateId: string, patch: Partial<TabDebate>) =>
    setRound(roundId, (item) => ({ ...item, debates: item.debates.map((debate) => (debate.id === debateId ? { ...debate, ...patch } : debate)) }));

  const lastRound = tournament.rounds.at(-1);
  const removeRound = (target: TabRound) => {
    const withResults = target.debates.some((debate) => debate.result);
    if (!window.confirm('¿Eliminar ' + target.name + '?' + (withResults ? ' Tiene actas registradas que se perderán.' : '') + ' Se guardará antes una copia automática.')) return;
    store.backup('Antes de eliminar ' + target.name);
    update((current) => ({
      ...current,
      rounds: current.rounds.filter((item) => item.id !== target.id),
      breakSeeds: current.rounds.some((item) => item.kind === 'elimination' && item.id !== target.id) ? current.breakSeeds : [],
    }));
    setSelectedId('');
  };

  const redoPairing = (target: TabRound) => {
    if (!window.confirm('¿Rehacer el emparejamiento de ' + target.name + ' con un nuevo sorteo?')) return;
    const without = { ...tournament, rounds: tournament.rounds.filter((item) => item.id !== target.id) };
    const result = generateSwissRound(without, randomSeed());
    if (!result.round) { notify(result.issues.join(' '), 'error'); return; }
    store.backup('Antes de rehacer ' + target.name);
    const replacement = { ...result.round, id: target.id, number: target.number, name: target.name };
    update((current) => ({ ...current, rounds: current.rounds.map((item) => (item.id === target.id ? replacement : item)) }));
    notify(target.name + ' emparejada de nuevo.' + (result.warnings.length ? ' ' + result.warnings.join(' ') : ''), result.warnings.length ? 'warning' : 'success');
  };

  const sendToPanel = (target: TabRound) => {
    const { outbox, issues, warnings } = buildOutbox(tournament, target.id);
    if (!outbox) { notify(issues.join(' '), 'error'); return; }
    try {
      writeOutbox(window.localStorage, outbox);
    } catch {
      notify('No hay espacio en el navegador para preparar el envío.', 'error');
      return;
    }
    setRound(target.id, (item) => ({ ...item, pushedAt: Date.now() }));
    notify('Emparejamientos de ' + target.name + ' listos para el panel. En el panel (en este mismo navegador) abre «Rondas y salas», elige la ronda y pulsa «Cargar desde tabulación».' + (warnings.length ? ' ' + warnings.join(' ') : ''), warnings.length ? 'warning' : 'success');
  };

  return <>
    <div className="page-heading tab-no-project"><div><p className="eyebrow">SORTEO Y EMPAREJAMIENTOS</p><h2>Rondas</h2><p className="muted">{settings.stage === 'groups'
      ? 'Liguilla: se sortean los grupos y se generan todas las jornadas. Después, el cuadro cruza primeros y segundos de grupos distintos.'
      : 'Sistema suizo: la primera ronda se sortea; las siguientes emparejan por clasificación (1.º–2.º, 3.º–4.º…) sin repetir rival y beneficiando al mejor clasificado.'}</p></div></div>

    {champion && <div className="success-notice tab-champion"><Trophy size={18} /><span>Campeón del torneo: <b>{look.teamName(champion)}</b></span></div>}

    <section className="panel tab-no-project">
      <div className="panel-title"><div><h3>{settings.stage === 'groups' ? 'Liguilla de grupos' : 'Rondas clasificatorias'}</h3>
        <p>{settings.stage === 'groups' ? tournament.groups.length + ' grupos · pasan ' + settings.groupAdvance + ' por grupo' : qualifying.length + ' de ' + settings.swissRounds + ' rondas generadas'}</p></div>
        <div className="tab-actions">
          {settings.stage === 'groups' && !qualifying.length && <button type="button" className="button secondary" onClick={drawTheGroups}><Dices size={16} /> {tournament.groups.length ? 'Volver a sortear' : 'Sortear grupos'}</button>}
          {(settings.stage === 'swiss' ? qualifying.length < settings.swissRounds : !qualifying.length && tournament.groups.length > 0) && !elimination.length &&
            <button type="button" className="button primary" onClick={generateQualifying}><Shuffle size={16} /> {settings.stage === 'groups' ? 'Generar jornadas' : 'Generar ronda ' + (qualifying.length + 1)}</button>}
        </div>
      </div>
      {settings.stage === 'groups' && (tournament.groups.length ? <div className="tab-groups">{tournament.groups.map((group) => <div key={group.id} className="tab-group">
        <h4>{group.name}</h4>
        <ul>{group.teamIds.map((teamId) => <li key={teamId}>
          <span>{look.teamName(teamId)}<small>{look.teams.get(teamId)?.institution}</small></span>
          {!qualifying.length && <select aria-label={'Mover ' + look.teamName(teamId)} value={group.id} onChange={(event) => update((current) => ({
            ...current,
            groups: current.groups.map((item) => ({ ...item, teamIds: item.id === event.target.value ? [...item.teamIds, teamId] : item.teamIds.filter((id) => id !== teamId) })),
          }))}>{tournament.groups.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>}
        </li>)}</ul>
      </div>)}</div> : <p className="muted">Sortea los grupos: el sorteo equilibra los tamaños y separa a los equipos de una misma institución siempre que es posible.</p>)}
    </section>

    {(qualifyingDone || elimination.length > 0) && <section className="panel tab-no-project">
      <div className="panel-title"><div><h3>Eliminatorias</h3><p>{settings.stage === 'groups' ? 'Pasan ' + settings.groupAdvance + ' por grupo' : 'Corte a ' + settings.breakSize + ' equipos'} · {settings.bracketMode === 'fixed' ? 'cuadro fijo' : 're-siembra en cada ronda'} · solo votos de los jueces</p></div>
        {!champion && <button type="button" className="button primary" onClick={generateElimination} disabled={Boolean(breakPreview?.issues.length)}><Trophy size={16} /> {elimination.length ? 'Generar siguiente eliminatoria' : 'Generar eliminatorias'}</button>}
      </div>
      {breakPreview && <>
        <IssueList items={breakPreview.issues} kind="error" />
        {breakPreview.qualifiers.length > 0 && <ol className="tab-seeds">{breakPreview.qualifiers.map((item) => <li key={item.teamId}>
          <b>{item.seed}.</b> {look.teamName(item.teamId)}{item.groupIndex !== null && <small> · {tournament.groups[item.groupIndex]?.name} ({item.groupPosition}.º)</small>}
        </li>)}</ol>}
      </>}
      {elimination.length > 0 && <div className="tab-bracket">{elimination.map((item) => <div key={item.id} className="tab-bracket-round">
        <h4>{item.name}</h4>
        {[...item.debates].sort((x, y) => (x.bracketSlot ?? 0) - (y.bracketSlot ?? 0)).map((debate) => {
          const winner = outcomes.get(debate.id)?.winnerTeamId;
          return <div key={debate.id} className="tab-bracket-match">{debate.teamIds.map((teamId) => <span key={teamId} className={winner === teamId ? 'winner' : winner ? 'loser' : ''}>{look.teamName(teamId)}</span>)}</div>;
        })}
      </div>)}</div>}
    </section>}

    {!tournament.rounds.length ? <Empty text="Todavía no hay rondas generadas." /> : <>
      <div className="round-tabs tab-no-project">{tournament.rounds.map((item) => <button key={item.id} type="button" className={item.id === round?.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>
        {item.name}{roundIsComplete(item, outcomes) ? ' ✓' : ''}
      </button>)}</div>
      {round && <RoundPanel tournament={tournament} round={round} outcomes={outcomes} look={look} setRound={setRound} setDebate={setDebate} notify={notify}
        isLast={round.id === lastRound?.id} onRemove={() => removeRound(round)}
        onRedo={round.kind === 'qualifying' && settings.stage === 'swiss' && round.id === lastRound?.id && !round.debates.some((debate) => debate.result) ? () => redoPairing(round) : undefined}
        onSend={() => sendToPanel(round)} onSimulate={tournament.sample ? () => {
          const result = simulateRoundResults(tournament, round.id);
          update(() => result.tournament);
          notify(result.skipped ? result.skipped + ' debate(s) sin jueces no se han simulado.' : 'Resultados simulados para probar la herramienta.', result.skipped ? 'warning' : 'success');
        } : undefined}
        onOpenBallots={() => onNavigate('actas')} />}
    </>}
  </>;
}

function RoundPanel({ tournament, round, outcomes, look, setRound, setDebate, notify, isLast, onRemove, onRedo, onSend, onSimulate, onOpenBallots }: {
  tournament: TabTournament;
  round: TabRound;
  outcomes: ViewProps['outcomes'];
  look: ReturnType<typeof lookups>;
  setRound: (roundId: string, mutate: (round: TabRound) => TabRound) => void;
  setDebate: (roundId: string, debateId: string, patch: Partial<TabDebate>) => void;
  notify: ViewProps['notify'];
  isLast: boolean;
  onRemove: () => void;
  onRedo?: () => void;
  onSend: () => void;
  onSimulate?: () => void;
  onOpenBallots: () => void;
}) {
  const issues = useMemo(() => roundIssues(tournament, round), [tournament, round]);
  const resting = round.kind === 'qualifying' ? restingTeams(tournament, round) : [];
  const usedJudges = new Set(round.debates.flatMap((debate) => debate.judgeIds));
  const activeVenues = tournament.venues.filter((venue) => venue.active || round.debates.some((debate) => debate.venueId === venue.id));
  const teams = tournament.teams.filter((team) => team.active || round.debates.some((debate) => debate.teamIds.includes(team.id)));
  const missingSides = round.debates.filter((debate) => !debate.favorTeamId).length;
  const totalIssues = [...issues.values()].reduce((total, list) => total + list.length, 0);

  const allocate = (replace: boolean) => {
    if (replace && round.debates.some((debate) => debate.judgeIds.length) && !window.confirm('¿Sustituir todos los jueces asignados en ' + round.name + '?')) return;
    const result = allocateJudges(tournament, round.id, { replace });
    setRound(round.id, (item) => ({ ...item, debates: item.debates.map((debate) => result.debates.find((next) => next.id === debate.id) ?? debate) }));
    notify(result.warnings.length ? result.warnings.join(' ') : 'Jueces asignados sin conflictos.', result.warnings.length ? 'warning' : 'success');
  };

  return <section className="panel tab-round">
    <div className="panel-title">
      <div><h3>{round.name}</h3><p>{round.kind === 'elimination' ? 'Eliminatoria · solo votos' : 'Clasificatoria'} · {round.sideMode === 'draw' ? 'posturas por sorteo' : 'posturas fijadas por la tabulación'}{round.pushedAt ? ' · enviada al panel el ' + new Date(round.pushedAt).toLocaleString('es-ES') : ''}</p></div>
      <div className="tab-actions tab-no-project">
        <label className="check-item">Jueces por debate <select value={round.panelSize} onChange={(event) => setRound(round.id, (item) => ({ ...item, panelSize: Number(event.target.value) }))}>{[1, 3, 5, 7].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        <label className="check-item" title="Ronda cerrada: sus resultados no se muestran al proyectar la clasificación."><input type="checkbox" checked={round.silent} onChange={(event) => setRound(round.id, (item) => ({ ...item, silent: event.target.checked }))} />Ronda cerrada</label>
      </div>
    </div>
    <div className="tab-actions tab-no-project">
      <button type="button" className="button primary" onClick={() => allocate(false)}><Gavel size={16} /> Asignar jueces</button>
      <button type="button" className="button secondary" onClick={() => allocate(true)}>Reasignar todos</button>
      <button type="button" className="button secondary" onClick={() => setRound(round.id, (item) => ({ ...item, debates: assignVenues(tournament, item.debates) }))}>Asignar salas</button>
      {round.sideMode === 'draw' && missingSides > 0 && <button type="button" className="button secondary" onClick={() => {
        if (!window.confirm('¿Sortear ahora la postura de ' + missingSides + ' debate(s)? Hazlo solo si el reglamento permite sortearlas desde la organización.')) return;
        setRound(round.id, (item) => drawSides(item, randomSeed()));
      }}><Dices size={16} /> Sortear posturas</button>}
      <button type="button" className="button secondary" onClick={onSend}><Send size={16} /> Enviar al panel</button>
      <button type="button" className="button secondary" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>
      <button type="button" className="button ghost" onClick={onOpenBallots}>Ir a las actas</button>
      {onSimulate && <button type="button" className="button ghost" onClick={onSimulate}><Sparkles size={16} /> Simular resultados</button>}
      {onRedo && <button type="button" className="button ghost" onClick={onRedo}><Shuffle size={16} /> Rehacer emparejamiento</button>}
      {isLast && <button type="button" className="button ghost danger-action" onClick={onRemove}><Trash2 size={16} /> Eliminar ronda</button>}
    </div>
    {totalIssues > 0 && <p className="tab-issue-count tab-no-project">{totalIssues} incidencia(s) en esta ronda: revísalas en la tabla.</p>}
    <div className="tournament-table-wrap tab-draw">
      <table>
        <thead><tr><th>Sala</th><th>Equipo</th><th>Equipo</th><th>A favor</th><th>Jueces (★ principal)</th><th className="tab-no-print">Acta</th></tr></thead>
        <tbody>{round.debates.map((debate) => {
          const outcome = outcomes.get(debate.id);
          const status = STATUS_LABELS[outcome?.status ?? 'empty'];
          const debateIssues = issues.get(debate.id) ?? [];
          const teamOptions = (slot: 0 | 1) => teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>).concat(
            debate.teamIds[slot] && !teams.some((team) => team.id === debate.teamIds[slot]) ? [<option key="missing" value={debate.teamIds[slot]}>{look.teamName(debate.teamIds[slot])}</option>] : []);
          const setTeam = (slot: 0 | 1, teamId: string) => {
            const teamIds: [string, string] = slot === 0 ? [teamId, debate.teamIds[1]] : [debate.teamIds[0], teamId];
            setDebate(round.id, debate.id, { teamIds, favorTeamId: debate.favorTeamId && teamIds.includes(debate.favorTeamId) ? debate.favorTeamId : undefined });
          };
          return <tr key={debate.id} className={debateIssues.length ? 'tab-row-issue' : ''}>
            <td>
              <select className="tab-cell-select" aria-label="Sala" value={debate.venueId} onChange={(event) => setDebate(round.id, debate.id, { venueId: event.target.value })}>
                <option value="">Sin sala</option>{activeVenues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
              </select>
              <span className="tab-print-only">{look.venueName(debate.venueId)}</span>
            </td>
            {([0, 1] as const).map((slot) => <td key={slot}>
              <select className="tab-cell-select" aria-label={'Equipo ' + (slot + 1)} value={debate.teamIds[slot]} onChange={(event) => setTeam(slot, event.target.value)}>
                <option value="">—</option>{teamOptions(slot)}
              </select>
              <span className="tab-print-only">{look.teamName(debate.teamIds[slot])}</span>
            </td>)}
            <td>
              <select className="tab-cell-select" aria-label="Equipo a favor" value={debate.favorTeamId ?? ''} onChange={(event) => setDebate(round.id, debate.id, { favorTeamId: event.target.value || undefined })}>
                <option value="">{round.sideMode === 'draw' ? 'Por sortear' : '—'}</option>
                {debate.teamIds.filter(Boolean).map((teamId) => <option key={teamId} value={teamId}>{look.teamName(teamId)}</option>)}
              </select>
              <span className="tab-print-only">{debate.favorTeamId ? look.teamName(debate.favorTeamId) : 'Por sortear'}</span>
            </td>
            <td>
              <div className="tab-judges">
                {debate.judgeIds.map((judgeId) => <span key={judgeId} className={'tab-judge-chip' + (judgeId === debate.chairId ? ' chair' : '')}>
                  <button type="button" className="tab-chip-star tab-no-print" title="Marcar como juez principal" aria-label={'Marcar a ' + look.judgeName(judgeId) + ' como juez principal'} onClick={() => setDebate(round.id, debate.id, { chairId: judgeId })}><Star size={12} /></button>
                  {judgeId === debate.chairId && <span className="tab-print-only">★ </span>}
                  {look.judgeName(judgeId)}
                  <button type="button" className="tab-chip-remove tab-no-print" aria-label={'Quitar a ' + look.judgeName(judgeId)} onClick={() => {
                    const judgeIds = debate.judgeIds.filter((id) => id !== judgeId);
                    setDebate(round.id, debate.id, { judgeIds, chairId: debate.chairId === judgeId ? judgeIds[0] ?? '' : debate.chairId });
                  }}><X size={12} /></button>
                </span>)}
                <select className="tab-cell-select tab-add-judge tab-no-print" aria-label="Añadir juez" value="" onChange={(event) => {
                  const judgeId = event.target.value;
                  if (!judgeId) return;
                  setDebate(round.id, debate.id, { judgeIds: [...debate.judgeIds, judgeId], chairId: debate.chairId || judgeId });
                }}>
                  <option value="">+ Añadir juez…</option>
                  {tournament.judges.filter((judge) => judge.active && !debate.judgeIds.includes(judge.id)).map((judge) => {
                    const reasons = [
                      ...debate.teamIds.map((teamId) => look.teams.get(teamId)).filter((team): team is NonNullable<typeof team> => Boolean(team)).map((team) => judgeTeamConflict(judge, team)),
                      debate.judgeIds.some((id) => { const other = look.judges.get(id); return other ? judgesConflict(judge, other) : false; }) ? 'incompatible con el panel' : null,
                      usedJudges.has(judge.id) ? 'ya asignado en esta ronda' : null,
                      judge.unavailableRoundIds.includes(round.id) ? 'no disponible' : null,
                    ].filter(Boolean);
                    return <option key={judge.id} value={judge.id}>{judge.name}{reasons.length ? ' — ' + reasons.join(', ') : ''}</option>;
                  })}
                </select>
              </div>
            </td>
            <td className="tab-no-print"><span className={'state-pill ' + status.className}>{status.label}</span></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {[...issues.entries()].some(([, list]) => list.length) && <div className="tab-no-project tab-no-print">{round.debates.map((debate) => {
      const list = issues.get(debate.id) ?? [];
      return list.length ? <div key={debate.id} className="tab-debate-issues"><b>{look.venueName(debate.venueId)} · {look.teamName(debate.teamIds[0])} – {look.teamName(debate.teamIds[1])}</b><IssueList items={list} /></div> : null;
    })}</div>}
    {resting.length > 0 && <p className="muted">Descansan en esta jornada: {resting.map(look.teamName).join(', ')}.</p>}
  </section>;
}
