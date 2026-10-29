import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Save, SkipForward, Star, Trash2 } from 'lucide-react';
import { SPEAKER_POSITIONS } from '../../scoring';
import { computeDebateOutcome, effectivePenalties, outcomeContext } from '../results';
import { SPEAKER_ROLES, type SpeakerRole, type TabDebate, type TabDebateResult, type TabRound, type TabTournament } from '../types';
import { Empty, formatNumber, IssueList, lookups, markUnsaved, parseDecimal, STATUS_LABELS, type ViewProps } from '../ui';
import { JointBallotsView } from './JointBallotsView';

interface RowDraft { judgeId: string; totals: Record<string, string>; speeches: Record<string, Partial<Record<SpeakerRole, string>>>; winnerTeamId: string }
interface PenaltyDraft { warnings: string; minors: string; majors: string; disqualified: boolean }
interface Draft {
  favorTeamId: string;
  chairId: string;
  lineup: TabDebateResult['lineup'];
  rows: RowDraft[];
  penalties: Record<string, PenaltyDraft>;
  overrideOn: boolean;
  overrideWinner: string;
  overrideReason: string;
  notes: string;
}

const ROLE_SHORT: Record<SpeakerRole, string> = { introductor: 'Intro.', first_rebuttal: '1.ª ref.', second_rebuttal: '2.ª ref.', concluder: 'Concl.' };
const asText = (value: number | undefined) => (value === undefined ? '' : String(value).replace('.', ','));

/** Lineup of the team's most recent earlier debate, to save typing when teams keep their speakers. */
function previousLineup(tournament: TabTournament, round: TabRound, teamId: string): Partial<Record<SpeakerRole, string>> {
  const earlier = tournament.rounds.filter((item) => item.number < round.number).sort((x, y) => y.number - x.number);
  for (const item of earlier) {
    const lineup = item.debates.find((debate) => debate.teamIds.includes(teamId))?.result?.lineup[teamId];
    if (lineup && Object.keys(lineup).length) return { ...lineup };
  }
  return {};
}

function draftFor(tournament: TabTournament, round: TabRound, debate: TabDebate): Draft {
  const result = debate.result;
  const ballots = new Map(result?.ballots.map((ballot) => [ballot.judgeId, ballot]));
  const judgeIds = debate.judgeIds.length ? debate.judgeIds : [''];
  return {
    favorTeamId: debate.favorTeamId ?? '',
    chairId: debate.chairId,
    lineup: Object.fromEntries(debate.teamIds.map((teamId) => [teamId, result ? { ...(result.lineup[teamId] ?? {}) } : previousLineup(tournament, round, teamId)])),
    rows: judgeIds.map((judgeId) => {
      const ballot = ballots.get(judgeId);
      return {
        judgeId,
        totals: Object.fromEntries(debate.teamIds.map((teamId) => [teamId, asText(ballot?.totals[teamId])])),
        speeches: Object.fromEntries(debate.teamIds.map((teamId) => [teamId, Object.fromEntries(SPEAKER_ROLES.map((role) => [role, asText(ballot?.speeches[teamId]?.[role])]))])),
        winnerTeamId: ballot?.winnerTeamId ?? '',
      };
    }),
    penalties: Object.fromEntries(debate.teamIds.map((teamId) => {
      const penalty = result?.penalties[teamId];
      return [teamId, { warnings: String(penalty?.warnings ?? 0), minors: String(penalty?.minors ?? 0), majors: String(penalty?.majors ?? 0), disqualified: Boolean(penalty?.disqualified) }];
    })),
    overrideOn: Boolean(result?.override),
    overrideWinner: result?.override?.winnerTeamId ?? '',
    overrideReason: result?.override?.reason ?? '',
    notes: result?.notes ?? '',
  };
}

function applyDraft(debate: TabDebate, draft: Draft): TabDebate {
  const rows = draft.rows.filter((row) => row.judgeId);
  const judgeIds = [...new Set(rows.map((row) => row.judgeId))];
  const count = (text: string) => Math.max(0, Math.floor(parseDecimal(text) ?? 0));
  const result: TabDebateResult = {
    lineup: Object.fromEntries(Object.entries(draft.lineup).map(([teamId, roles]) => [teamId, Object.fromEntries(Object.entries(roles).filter(([, id]) => id))])),
    ballots: rows.map((row) => {
      const totals: Record<string, number> = {};
      const speeches: Record<string, Partial<Record<SpeakerRole, number>>> = {};
      for (const teamId of debate.teamIds) {
        const total = parseDecimal(row.totals[teamId] ?? '');
        if (total !== null) totals[teamId] = total;
        const roles: Partial<Record<SpeakerRole, number>> = {};
        for (const role of SPEAKER_ROLES) {
          const score = parseDecimal(row.speeches[teamId]?.[role] ?? '');
          if (score !== null) roles[role] = score;
        }
        if (Object.keys(roles).length) speeches[teamId] = roles;
      }
      return { judgeId: row.judgeId, totals, speeches, ...(row.winnerTeamId ? { winnerTeamId: row.winnerTeamId } : {}) };
    }),
    penalties: Object.fromEntries(Object.entries(draft.penalties).map(([teamId, penalty]) => [teamId, {
      warnings: count(penalty.warnings), minors: count(penalty.minors), majors: count(penalty.majors), disqualified: penalty.disqualified,
    }])),
    ...(draft.overrideOn && draft.overrideWinner ? { override: { winnerTeamId: draft.overrideWinner, reason: draft.overrideReason } } : {}),
    notes: draft.notes,
    updatedAt: Date.now(),
  };
  return {
    ...debate,
    judgeIds,
    chairId: judgeIds.includes(draft.chairId) ? draft.chairId : judgeIds[0] ?? '',
    favorTeamId: draft.favorTeamId || undefined,
    result,
  };
}

/** Joint acta (ADUMA) or one acta per judge (LEDU, UC3M), as the rules say. */
export function BallotsView(props: ViewProps) {
  return props.tournament.settings.ballotMode === 'joint' ? <JointBallotsView {...props} /> : <JudgeBallotsView {...props} />;
}

function JudgeBallotsView({ tournament, outcomes, update, notify }: ViewProps) {
  const look = useMemo(() => lookups(tournament), [tournament]);
  const context = useMemo(() => outcomeContext(tournament), [tournament]);
  const [roundId, setRoundId] = useState(() => (tournament.rounds.find((round) => round.debates.some((debate) => outcomes.get(debate.id)?.status !== 'complete')) ?? tournament.rounds.at(-1))?.id ?? '');
  const round = tournament.rounds.find((item) => item.id === roundId) ?? tournament.rounds.at(-1);
  const [debateId, setDebateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const debate = round?.debates.find((item) => item.id === debateId) ?? null;
  useEffect(() => {
    markUnsaved('acta', dirty);
    return () => markUnsaved('acta', false);
  }, [dirty]);

  const edit = (mutate: (current: Draft) => Draft) => { setDraft((current) => (current ? mutate(current) : current)); setDirty(true); };
  const open = (target: TabDebate | null, force = false) => {
    if (!force && dirty && !window.confirm('Hay cambios sin guardar en esta acta. ¿Descartarlos?')) return false;
    setDebateId(target?.id ?? null);
    setDraft(target && round ? draftFor(tournament, round, target) : null);
    setDirty(false);
    return true;
  };
  const switchRound = (id: string) => {
    if (dirty && !window.confirm('Hay cambios sin guardar en esta acta. ¿Descartarlos?')) return;
    setRoundId(id);
    setDebateId(null);
    setDraft(null);
    setDirty(false);
  };

  const preview = useMemo(() => (round && debate && draft ? computeDebateOutcome(round, applyDraft(debate, draft), context) : null), [round, debate, draft, context]);

  if (!tournament.rounds.length || !round) return <><Heading /><Empty text="Genera una ronda para registrar sus actas." /></>;

  const save = (goNext: boolean) => {
    if (!debate || !draft) return;
    const next = applyDraft(debate, draft);
    const status = preview?.status ?? 'empty';
    const label = look.venueName(debate.venueId) + ' (' + look.teamName(debate.teamIds[0]) + ' – ' + look.teamName(debate.teamIds[1]) + ')';
    const saved = update((current) => ({ ...current, rounds: current.rounds.map((item) => (item.id === round.id ? { ...item, debates: item.debates.map((entry) => (entry.id === debate.id ? next : entry)) } : item)) }), {
      type: 'acta.save',
      message: round.name + ' · acta de ' + label + ': ' + (status === 'complete' ? 'gana ' + look.teamName(preview?.winnerTeamId ?? '') : 'guardada como ' + STATUS_LABELS[status].label.toLowerCase()) + '.',
      details: { debateId: debate.id, ballots: next.result?.ballots, penalties: next.result?.penalties, override: next.result?.override },
    });
    if (!saved) return;
    setDirty(false);
    notify(status === 'complete' ? 'Acta guardada: gana ' + look.teamName(preview?.winnerTeamId ?? '') + '.' : 'Acta guardada como ' + STATUS_LABELS[status].label.toLowerCase() + '.', status === 'complete' ? 'success' : 'warning');
    if (goNext) {
      const index = round.debates.findIndex((item) => item.id === debate.id);
      const following = round.debates.slice(index + 1).find((item) => outcomes.get(item.id)?.status !== 'complete') ?? round.debates[index + 1] ?? null;
      setDebateId(following?.id ?? null);
      setDraft(following ? draftFor(tournament, round, following) : null);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); save(true); }
  };

  const elimination = round.kind === 'elimination';
  const [a, b] = debate?.teamIds ?? ['', ''];
  const roster = (teamId: string) => tournament.speakers.filter((speaker) => speaker.teamId === teamId);

  return <>
    <Heading />
    <div className="round-tabs">{tournament.rounds.map((item) => <button key={item.id} type="button" className={item.id === round.id ? 'selected' : ''} onClick={() => switchRound(item.id)}>
      {item.name} · {item.debates.filter((entry) => outcomes.get(entry.id)?.status === 'complete').length}/{item.debates.length}
    </button>)}</div>
    <div className="tab-ballots">
      <section className="panel tab-ballot-list">
        <div className="panel-title"><div><h3>Debates de {round.name}</h3><p>{round.kind === 'elimination' ? 'Solo votos de los jueces.' : 'Puntuación de cada juez y voto derivado.'}</p></div></div>
        <ul>{round.debates.map((item) => {
          const status = STATUS_LABELS[outcomes.get(item.id)?.status ?? 'empty'];
          return <li key={item.id}><button type="button" className={item.id === debate?.id ? 'selected' : ''} onClick={() => open(item)}>
            <span><b>{look.venueName(item.venueId)}</b><small>{look.teamName(item.teamIds[0])} – {look.teamName(item.teamIds[1])}</small></span>
            <span className={'state-pill ' + status.className}>{status.label}</span>
          </button></li>;
        })}</ul>
      </section>

      {!debate || !draft ? <section className="panel"><Empty text="Elige un debate para registrar o corregir su acta." /></section> :
        <section className="panel tab-ballot-editor" onKeyDown={onKeyDown}>
          <div className="panel-title"><div><h3>{look.venueName(debate.venueId)} · {look.teamName(a)} – {look.teamName(b)}</h3>
            <p>{dirty ? 'Cambios sin guardar · ' : ''}Ctrl+Enter guarda y pasa al siguiente debate.{!tournament.settings.scoresIncludePenalties && !elimination ? ' Introduce la puntuación bruta de cada acta: las faltas se descuentan automáticamente.' : ''}</p></div></div>

          <fieldset className="tab-fieldset">
            <legend>Postura {round.sideMode === 'draw' ? '(sorteada antes del debate)' : '(fijada por la tabulación)'}</legend>
            <div className="tab-radio-row">
              {[a, b].map((teamId) => <label key={teamId} className="check-item"><input type="radio" name="favor" checked={draft.favorTeamId === teamId} onChange={() => edit((current) => ({ ...current, favorTeamId: teamId }))} />A favor: {look.teamName(teamId)}</label>)}
              <label className="check-item"><input type="radio" name="favor" checked={!draft.favorTeamId} onChange={() => edit((current) => ({ ...current, favorTeamId: '' }))} />Sin registrar</label>
            </div>
          </fieldset>

          {tournament.settings.speakerScores && !elimination && <fieldset className="tab-fieldset">
            <legend>Alineación</legend>
            <div className="tab-lineup">{[a, b].map((teamId) => <div key={teamId}>
              <b>{look.teamName(teamId)}</b>
              {SPEAKER_POSITIONS.map((position) => <label key={position.value} className="tab-field compact"><span>{position.label}</span>
                <select value={draft.lineup[teamId]?.[position.value] ?? ''} onChange={(event) => edit((current) => ({ ...current, lineup: { ...current.lineup, [teamId]: { ...current.lineup[teamId], [position.value]: event.target.value } } }))}>
                  <option value="">—</option>{roster(teamId).map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}
                </select>
              </label>)}
            </div>)}</div>
          </fieldset>}

          <fieldset className="tab-fieldset">
            <legend>Actas de los jueces</legend>
            <div className="tournament-table-wrap">
              <table className="tab-ballot-table">
                <thead><tr><th>Juez</th>{elimination ? <th>Voto</th> : <><th>{look.teamName(a)}</th><th>{look.teamName(b)}</th><th>Voto</th></>}</tr></thead>
                <tbody>{draft.rows.map((row, index) => {
                  const vote = preview?.judgeVotes.find((item) => item.judgeId === row.judgeId);
                  const options = tournament.judges.filter((judge) => judge.id === row.judgeId || (judge.active && !draft.rows.some((other) => other.judgeId === judge.id)));
                  const setRow = (patch: Partial<RowDraft>) => edit((current) => ({ ...current, rows: current.rows.map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
                  return <tr key={index}>
                    <td><div className="tab-judge-cell">
                      <button type="button" className={'tab-chip-star' + (draft.chairId === row.judgeId && row.judgeId ? ' active' : '')} title="Juez principal (decide los empates a votos)" aria-label="Marcar como juez principal" onClick={() => edit((current) => ({ ...current, chairId: row.judgeId }))}><Star size={13} /></button>
                      <select aria-label="Juez" value={row.judgeId} onChange={(event) => edit((current) => ({
                        ...current,
                        chairId: current.chairId === row.judgeId ? event.target.value : current.chairId,
                        rows: current.rows.map((item, i) => (i === index ? { ...item, judgeId: event.target.value } : item)),
                      }))}>
                        <option value="">Elige juez…</option>{options.map((judge) => <option key={judge.id} value={judge.id}>{judge.name}</option>)}
                      </select>
                    </div></td>
                    {elimination ? <td><div className="tab-radio-row">{[a, b].map((teamId) => <label key={teamId} className="check-item"><input type="radio" name={'vote-' + index} checked={row.winnerTeamId === teamId} onChange={() => setRow({ winnerTeamId: teamId })} />{look.teamName(teamId)}</label>)}</div></td> : <>
                      {[a, b].map((teamId) => <td key={teamId}><input className="tab-score-input" inputMode="decimal" aria-label={'Puntos de ' + look.teamName(teamId)} value={row.totals[teamId] ?? ''} onChange={(event) => setRow({ totals: { ...row.totals, [teamId]: event.target.value } })} placeholder={tournament.settings.scoreMin + '–' + tournament.settings.scoreMax} /></td>)}
                      <td className={vote?.tie ? 'tab-vote tie' : 'tab-vote'}>{vote ? (vote.tie ? 'Empate: corrige' : look.teamName(vote.teamId ?? '')) : '—'}</td>
                    </>}
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div className="tab-actions">
              <button type="button" className="text-button" onClick={() => edit((current) => ({ ...current, rows: [...current.rows, { judgeId: '', totals: {}, speeches: {}, winnerTeamId: '' }] }))}>+ Añadir juez al acta</button>
              {draft.rows.length > 1 && <button type="button" className="text-button danger-action" onClick={() => edit((current) => ({ ...current, rows: current.rows.slice(0, -1) }))}>Quitar el último juez</button>}
            </div>
          </fieldset>

          {tournament.settings.speakerScores && !elimination && <fieldset className="tab-fieldset">
            <legend>Notas de oradores ({formatNumber(tournament.settings.speakerScoreMin)}–{formatNumber(tournament.settings.speakerScoreMax)})</legend>
            <div className="tournament-table-wrap">
              <table className="tab-ballot-table">
                <thead><tr><th rowSpan={2}>Juez</th><th colSpan={4}>{look.teamName(a)}</th><th colSpan={4}>{look.teamName(b)}</th></tr>
                  <tr>{[a, b].flatMap((teamId) => SPEAKER_ROLES.map((role) => <th key={teamId + role}>{ROLE_SHORT[role]}</th>))}</tr></thead>
                <tbody>{draft.rows.map((row, index) => <tr key={index}>
                  <td>{row.judgeId ? look.judgeName(row.judgeId) : '—'}</td>
                  {[a, b].flatMap((teamId) => SPEAKER_ROLES.map((role) => <td key={teamId + role}><input className="tab-score-input small" inputMode="decimal" aria-label={ROLE_SHORT[role] + ' de ' + look.teamName(teamId)}
                    value={row.speeches[teamId]?.[role] ?? ''} onChange={(event) => edit((current) => ({
                      ...current,
                      rows: current.rows.map((item, i) => (i === index ? { ...item, speeches: { ...item.speeches, [teamId]: { ...item.speeches[teamId], [role]: event.target.value } } } : item)),
                    }))} /></td>))}
                </tr>)}</tbody>
              </table>
            </div>
          </fieldset>}

          <fieldset className="tab-fieldset">
            <legend>Penalizaciones</legend>
            <div className="tab-penalties">{[a, b].map((teamId) => {
              const penalty = draft.penalties[teamId] ?? { warnings: '0', minors: '0', majors: '0', disqualified: false };
              const effective = effectivePenalties({ warnings: Number(penalty.warnings) || 0, minors: Number(penalty.minors) || 0, majors: Number(penalty.majors) || 0, disqualified: penalty.disqualified }, tournament.settings);
              const setPenalty = (patch: Partial<PenaltyDraft>) => edit((current) => ({ ...current, penalties: { ...current.penalties, [teamId]: { ...penalty, ...patch } } }));
              return <div key={teamId}>
                <b>{look.teamName(teamId)}</b>
                <div className="tab-penalty-inputs">
                  {(['warnings', 'minors', 'majors'] as const).map((field) => <label key={field} className="tab-field compact"><span>{field === 'warnings' ? 'Avisos' : field === 'minors' ? 'Faltas leves' : 'Faltas graves'}</span>
                    <input type="number" min={0} value={penalty[field]} onChange={(event) => setPenalty({ [field]: event.target.value })} /></label>)}
                </div>
                <label className="check-item"><input type="checkbox" checked={penalty.disqualified} onChange={(event) => setPenalty({ disqualified: event.target.checked })} />Pierde por incomparecencia o falta eliminatoria</label>
                <small className="muted">{effective.forfeit ? 'Pierde el debate.' : effective.deduction ? 'Se descuentan ' + formatNumber(effective.deduction) + ' puntos en cada acta.' : 'Sin descuento.'}</small>
              </div>;
            })}</div>
          </fieldset>

          <fieldset className="tab-fieldset">
            <legend>Decisión de la organización</legend>
            <label className="check-item"><input type="checkbox" checked={draft.overrideOn} onChange={(event) => edit((current) => ({ ...current, overrideOn: event.target.checked }))} />Fijar el ganador manualmente (reclamación, doble falta grave…)</label>
            {draft.overrideOn && <div className="tab-form-grid">
              <label className="tab-field"><span>Ganador</span><select value={draft.overrideWinner} onChange={(event) => edit((current) => ({ ...current, overrideWinner: event.target.value }))}><option value="">—</option>{[a, b].map((teamId) => <option key={teamId} value={teamId}>{look.teamName(teamId)}</option>)}</select></label>
              <label className="tab-field"><span>Motivo</span><input value={draft.overrideReason} onChange={(event) => edit((current) => ({ ...current, overrideReason: event.target.value }))} /></label>
            </div>}
            <label className="tab-field"><span>Notas internas</span><textarea rows={2} value={draft.notes} onChange={(event) => edit((current) => ({ ...current, notes: event.target.value }))} /></label>
          </fieldset>

          {preview && <div className={'tab-outcome ' + preview.status}>
            <span className={'state-pill ' + STATUS_LABELS[preview.status].className}>{STATUS_LABELS[preview.status].label}</span>
            {preview.status === 'complete' && <span>Gana <b>{look.teamName(preview.winnerTeamId ?? '')}</b> · votos {preview.lines.map((line) => line.votes).join('–')}
              {!elimination && ' · puntos ' + preview.lines.map((line) => (line.points === null ? 'media' : formatNumber(line.points))).join(' – ')}</span>}
            <IssueList items={preview.issues} kind="error" />
            <IssueList items={preview.warnings} />
          </div>}

          <div className="tab-actions">
            <button type="button" className="button primary" onClick={() => save(true)}><SkipForward size={16} /> Guardar y siguiente</button>
            <button type="button" className="button secondary" onClick={() => save(false)}><Save size={16} /> Guardar</button>
            <button type="button" className="text-button" disabled={!dirty} onClick={() => open(debate, true)}>Descartar cambios</button>
            {debate.result && <button type="button" className="text-button danger-action" onClick={() => {
              if (!window.confirm('¿Borrar el acta de este debate? Quedará anotado en el registro.')) return;
              if (!update((current) => ({ ...current, rounds: current.rounds.map((item) => (item.id === round.id ? { ...item, debates: item.debates.map((entry) => (entry.id === debate.id ? { ...entry, result: undefined } : entry)) } : item)) }),
                { type: 'acta.delete', message: round.name + ' · acta de ' + look.venueName(debate.venueId) + ' (' + look.teamName(a) + ' – ' + look.teamName(b) + ') borrada.' })) return;
              setDraft(draftFor(tournament, round, { ...debate, result: undefined }));
              setDirty(false);
            }}><Trash2 size={14} /> Borrar acta</button>}
          </div>
        </section>}
    </div>
  </>;
}

function Heading() {
  return <div className="page-heading"><div><p className="eyebrow">RESULTADOS</p><h2>Actas</h2><p className="muted">Transcribe el acta de cada juez. El voto de cada juez es para el equipo con más puntos netos; gana el debate quien sume más votos y la nota del debate es la media de los jueces.</p></div></div>;
}
