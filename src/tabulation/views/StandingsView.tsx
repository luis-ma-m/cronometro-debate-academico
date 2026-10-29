import { Fragment, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Dices, FileSpreadsheet, Printer, Projector, Trophy } from 'lucide-react';
import { eliminationRoundName, tournamentChampion } from '../bracket';
import { standingsCsv } from '../csv';
import { createRng, randomSeed, shuffle } from '../random';
import { buildGroupStandings, buildSpeakerStandings, buildTeamStandings, type TeamStanding } from '../standings';
import { roundIsComplete } from '../results';
import { eliminationRounds, isFallenAt, nextRoundNumber, qualifyingRounds, TIEBREAK_LABELS } from '../types';
import { downloadFile, Empty, fileSlug, formatNumber, type ViewProps } from '../ui';

export function StandingsView({ tournament, outcomes, update, notify, projection, onProject }: ViewProps & { projection: boolean; onProject: () => void }) {
  const { settings } = tournament;
  const joint = settings.ballotMode === 'joint';
  const rounds = qualifyingRounds(tournament);
  const qualifyingFinished = rounds.length > 0 && rounds.every((round) => roundIsComplete(round, outcomes)) && (settings.stage === 'groups' || rounds.length >= settings.swissRounds);
  // Blind rounds (ADUMA art. 29): nothing is projected until the qualifying phase ends, then everything.
  const blindHidden = projection && settings.blindQualifying && !qualifyingFinished;
  // When projecting, closed rounds (UC3M rounds 4–5) are hidden: standings stop before the first one.
  const firstSilent = rounds.find((round) => round.silent);
  const visibleRounds = blindHidden ? [] : projection && firstSilent && !(settings.blindQualifying && qualifyingFinished) ? rounds.filter((round) => round.number < firstSilent.number) : rounds;
  const [cutoff, setCutoff] = useState<number | 'all'>('all');
  const [expandedRankings, setExpandedRankings] = useState<string[]>([]);
  const upTo = cutoff === 'all' ? visibleRounds.at(-1)?.number : Math.min(cutoff, visibleRounds.at(-1)?.number ?? cutoff);
  const options = { outcomes, upToRoundNumber: upTo };
  const sections = useMemo(() => {
    if (!visibleRounds.length) return [];
    if (tournament.settings.stage === 'groups' && tournament.groups.length) return buildGroupStandings(tournament, options).map(({ group, rows }) => ({ title: group.name, rows }));
    return [{ title: 'Clasificación general', rows: buildTeamStandings(tournament, options) }];
  }, [tournament, outcomes, upTo, visibleRounds.length]);
  const speakerRankings = useMemo(() => (tournament.settings.speakerScores && visibleRounds.length ? buildSpeakerStandings(tournament, options) : []), [tournament, outcomes, upTo, visibleRounds.length]);
  const champion = tournamentChampion(tournament, outcomes);
  const teamName = (id: string) => tournament.teams.find((team) => team.id === id)?.name ?? id;

  const fallenFrom = new Map(tournament.teams.filter((team) => team.fallenFromRound !== undefined).map((team) => [team.id, team.fallenFromRound!]));
  const teamsById = new Map(tournament.teams.map((team) => [team.id, team]));
  const breakStage = eliminationRoundName(Math.max(1, Math.floor(settings.breakSize / 2))).toLowerCase();
  const firstElimination = eliminationRounds(tournament)[0];
  const atEnd = cutoff === 'all' || cutoff >= (rounds.at(-1)?.number ?? 0);
  const provisionalCut = !firstElimination && (!qualifyingFinished || !atEnd);
  /** Swiss break: the teams of the first elimination or, before it, the first `breakSize` that can still break. */
  const qualifiedIds = (rows: TeamStanding[]) => {
    if (settings.stage !== 'swiss' || settings.breakSize < 2) return new Set<string>();
    if (firstElimination && atEnd) return new Set(firstElimination.debates.flatMap((debate) => debate.teamIds));
    const breakRound = nextRoundNumber(tournament);
    return new Set(rows.filter((row) => {
      const team = teamsById.get(row.teamId);
      return Boolean(team?.active && team.breakEligible && !isFallenAt(team, breakRound));
    }).slice(0, settings.breakSize).map((row) => row.teamId));
  };
  const columns = joint ? 7 : 8 + (settings.speakerScores ? 1 : 0);
  const setManualOrder = (block: string[], reason = 'fijado por la organización') => update((current) => ({ ...current, manualOrder: [...current.manualOrder.filter((id) => !block.includes(id)), ...block] }), {
    type: 'standings.order', message: 'Orden de desempate ' + reason + ': ' + block.map(teamName).join(', ') + '.',
  });
  const tiedBlocks = (rows: TeamStanding[]) => {
    const blocks = new Map<number, string[]>();
    for (const row of rows) if (row.tied) blocks.set(row.rank, [...(blocks.get(row.rank) ?? []), row.teamId]);
    return [...blocks.values()];
  };
  const manualBlocks = (rows: TeamStanding[]) => {
    // Teams whose order the organiser already fixed, grouped by consecutive positions so they can be reordered.
    const fixed = rows.filter((row) => tournament.manualOrder.includes(row.teamId));
    return fixed.length > 1 ? [fixed.map((row) => row.teamId)] : [];
  };

  const exportCsv = () => {
    downloadFile('clasificacion-' + fileSlug(tournament.name) + '.csv', standingsCsv(sections, speakerRankings), 'text/csv;charset=utf-8');
  };

  return <>
    <div className="page-heading"><div><p className="eyebrow">RESULTADOS</p><h2>Clasificación</h2>
      <p className="muted tab-no-project">Orden: victorias{settings.tiebreaks.map((key) => ' → ' + (joint && key === 'pointsTotal' ? 'ítems netos' : TIEBREAK_LABELS[key].toLowerCase())).join('')}{tournament.settings.tiebreakFallback === 'lots' ? ' → sorteo' : ' → orden fijado por la organización'}. Solo cuentan rondas clasificatorias con el acta completa.</p></div>
      <div className="top-actions tab-no-project">
        <label className="check-item">Tras <select value={cutoff} onChange={(event) => setCutoff(event.target.value === 'all' ? 'all' : Number(event.target.value))}>
          <option value="all">la última ronda</option>{visibleRounds.map((round) => <option key={round.id} value={round.number}>{round.name}</option>)}
        </select></label>
        <button type="button" className="button secondary" onClick={exportCsv} disabled={!sections.length}><FileSpreadsheet size={16} /> CSV</button>
        <button type="button" className="button secondary" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>
        {!projection && <button type="button" className="button secondary" onClick={onProject}><Projector size={16} /> Proyectar</button>}
      </div>
    </div>
    {champion && <div className="success-notice tab-champion"><Trophy size={18} /><span>Campeón del torneo: <b>{teamName(champion)}</b></span></div>}
    {blindHidden && <section className="panel tab-blind"><h3>Rondas a ciegas</h3><p>La clasificación se publicará al terminar la fase clasificatoria.</p></section>}
    {projection && !blindHidden && firstSilent && visibleRounds.length < rounds.length && <p className="muted">Clasificación hasta antes de {firstSilent.name}: las rondas cerradas no se muestran.</p>}
    {blindHidden ? null : !sections.length ? <Empty text="La clasificación aparecerá cuando haya rondas clasificatorias." /> : <div className={sections.length > 1 ? 'tab-standings-grid' : ''}>
      {sections.map((section) => {
        const ties = tiedBlocks(section.rows);
        const manual = manualBlocks(section.rows);
        const qualified = qualifiedIds(section.rows);
        const cutIndex = section.rows.reduce((last, row, index) => (qualified.has(row.teamId) ? index : last), -1);
        return <section key={section.title} className="panel">
          <div className="panel-title"><div><h3>{section.title}</h3>{tournament.settings.stage === 'groups' && <p>Pasan los {tournament.settings.groupAdvance} primeros.</p>}
            {qualified.size > 0 && <p className="tab-cut-note">Pasan a {breakStage === 'final' ? 'la final' : breakStage} los {settings.breakSize} primeros que pueden clasificarse{provisionalCut ? ' (corte provisional)' : ''}.</p>}</div></div>
          <div className="tournament-table-wrap tab-standings">
            <table>
              <thead><tr><th>Pos.</th><th>Equipo</th><th>V</th><th>D</th>{joint
                ? <><th title="Ítems netos: ítems menos faltas">Ítems</th><th>Graves</th><th>Leves</th></>
                : <><th>Votos</th><th>Puntos</th><th>Media</th>{settings.speakerScores && <th>Oradores</th>}<th title="Graves / leves / avisos">Faltas</th></>}</tr></thead>
              <tbody>{section.rows.map((row, index) => <Fragment key={row.teamId}><tr className={((settings.stage === 'groups' ? row.rank <= settings.groupAdvance : qualified.has(row.teamId)) ? 'tab-qualified' : '') + (fallenFrom.has(row.teamId) ? ' tab-row-muted' : '')}>
                <td><strong>{row.rank}</strong>{row.tied && <span className="tab-tie" title="Empate sin resolver">=</span>}{row.decidedByLots && <span className="tab-tie" title="Desempatado por sorteo">S</span>}</td>
                <td><b>{row.name}</b>{fallenFrom.has(row.teamId) && <span className="state-pill unassigned tab-fallen-pill">caído desde la ronda {fallenFrom.get(row.teamId)}</span>}<small className="tab-cell-sub">{row.institution}</small></td>
                <td>{row.wins}</td><td>{row.losses}</td>
                {joint ? <>
                  <td>{formatNumber(row.points)}{row.pendingPoints > 0 && <span className="tab-tie" title="Media de la ronda pendiente: falta alguna acta de esa ronda">*</span>}</td>
                  <td>{row.majors}</td><td>{row.minors}</td>
                </> : <>
                  <td>{row.ballots}</td>
                  <td>{formatNumber(row.points)}{row.pendingPoints > 0 && <span className="tab-tie" title="Puntos pendientes de una victoria por falta grave">*</span>}</td>
                  <td>{formatNumber(row.pointsAverage)}</td>
                  {settings.speakerScores && <td>{formatNumber(row.speakerPoints)}</td>}
                  <td>{row.majors}/{row.minors}/{row.warnings}</td>
                </>}
              </tr>
              {index === cutIndex && index < section.rows.length - 1 && <tr className="tab-cut"><td colSpan={columns}><span>Corte de {breakStage}{provisionalCut ? ' (provisional)' : ''}</span></td></tr>}
              </Fragment>)}</tbody>
            </table>
          </div>
          {(ties.length > 0 || manual.length > 0) && <div className="tab-ties tab-no-project">
            {ties.map((block) => <div key={block.join()} className="tab-tie-block">
              <span>Empate sin resolver entre {block.map(teamName).join(', ')}.</span>
              <button type="button" className="button secondary" onClick={() => setManualOrder(block)}>Fijar este orden</button>
              <button type="button" className="button ghost" onClick={() => { const seed = randomSeed(); setManualOrder(shuffle(block, createRng(seed)), 'sorteado (semilla ' + seed + ')'); notify('Empate resuelto por sorteo.'); }}><Dices size={14} /> Sortear</button>
            </div>)}
            {manual.map((block) => <div key={'manual-' + block.join()} className="tab-tie-block">
              <span>Orden fijado por la organización:</span>
              {block.map((id, index) => <span key={id} className="tab-manual-item">{teamName(id)}
                <button type="button" className="icon-button" aria-label="Subir" disabled={index === 0} onClick={() => { const next = [...block]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setManualOrder(next); }}><ArrowUp size={12} /></button>
                <button type="button" className="icon-button" aria-label="Bajar" disabled={index === block.length - 1} onClick={() => { const next = [...block]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; setManualOrder(next); }}><ArrowDown size={12} /></button>
              </span>)}
              <button type="button" className="text-button" onClick={() => update((current) => ({ ...current, manualOrder: current.manualOrder.filter((id) => !block.includes(id)) }), { type: 'standings.order', message: 'Quitado el orden manual de ' + block.map(teamName).join(', ') + '.' })}>Quitar</button>
            </div>)}
          </div>}
        </section>;
      })}
    </div>}

    {speakerRankings.length > 0 && <>
      <div className="page-heading"><div><p className="eyebrow">PREMIOS INDIVIDUALES</p><h2>Oradores</h2><p className="muted tab-no-project">{tournament.settings.speakerMetric === 'sum' ? 'Suma' : 'Media'} de las notas de las rondas clasificatorias. «Mejor orador» cuenta una nota por debate (la media de sus turnos); los empates se resuelven a favor del equipo mejor clasificado.</p></div></div>
      <div className="speaker-ranking-grid">{speakerRankings.map((ranking) => <section key={ranking.key} className="panel speaker-ranking-panel">
        <div className="panel-title"><div><h3>{ranking.title}</h3></div></div>
        {ranking.rows.length ? <div className="tournament-table-wrap"><table>
          <thead><tr><th>Pos.</th><th>Orador</th><th>Equipo</th><th>{tournament.settings.speakerMetric === 'sum' ? 'Suma' : 'Media'}</th><th>Notas</th></tr></thead>
          <tbody>{ranking.rows.slice(0, projection || !expandedRankings.includes(ranking.key) ? 10 : undefined).map((row) => <tr key={row.speakerId} className={joint && ranking.key === 'all' && row.rank <= 2 ? 'tab-qualified' : ''}>
            <td><strong>{row.rank}</strong></td>
            <td>{row.name}{joint && ranking.key === 'all' && row.rank <= 2 && <span className="state-pill ready tab-fallen-pill" title="ADUMA art. 43">final de discursos</span>}
              {row.fallenRivalDebates > 0 && <span className="tab-tie" title={'Su equipo se enfrentó a un equipo caído: tiene ' + row.fallenRivalDebates + ' debate(s) menos puntuado(s). Lo decide el comité.'}>†</span>}</td>
            <td>{row.teamName}</td><td>{formatNumber(row.value)}</td><td>{row.count}</td>
          </tr>)}</tbody>
        </table></div> : <p className="muted tournament-empty">Sin notas todavía.</p>}
        {ranking.rows.length > 10 && !projection && <button type="button" className="text-button tab-no-print" onClick={() => setExpandedRankings((current) => (current.includes(ranking.key) ? current.filter((key) => key !== ranking.key) : [...current, ranking.key]))}>
          {expandedRankings.includes(ranking.key) ? 'Ver solo los 10 primeros' : 'Ver todos (' + ranking.rows.length + ')'}
        </button>}
      </section>)}</div>
    </>}
  </>;
}
