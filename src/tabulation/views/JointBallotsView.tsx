import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { applyReceivedActa, findActaCodes, readActaCode, receivedIsRegistered } from '../whatsapp';
import { OfficialActaPublisher } from '../OfficialActaPublisher';
import { CheckCheck, MessageCircle, Save, SkipForward, Star, Trash2 } from 'lucide-react';
import { SPEAKER_POSITIONS } from '../../scoring';
import { compactActaWarnings, validateJointActa } from '../acta';
import { computeDebateOutcome, effectivePenalties, outcomeContext } from '../results';
import { isFallenAt, SPEAKER_ROLES, type SpeakerRole, type TabDebate, type TabDebateResult, type TabJointActa, type TabRound, type TabTournament } from '../types';
import { Empty, formatNumber, IssueList, lookups, markUnsaved, Notice, parseDecimal, STATUS_LABELS, type ViewProps } from '../ui';

interface PenaltyDraft { warnings: string; minors: string; majors: string; disqualified: boolean }
interface SpeakerDraft { score: string; roles: SpeakerRole[] }
interface JointDraft {
  favorTeamId: string;
  winnerTeamId: string;
  judgeIds: string[];
  chairId: string;
  quick: boolean;
  items: Record<string, Record<string, string>>;
  quickTotals: Record<string, string>;
  writtenTotals: Record<string, string>;
  penalties: Record<string, PenaltyDraft>;
  speakers: Record<string, Record<string, SpeakerDraft>>;
  overrideOn: boolean;
  overrideWinner: string;
  overrideReason: string;
  notes: string;
}

const ROLE_LABELS = Object.fromEntries(SPEAKER_POSITIONS.map((position) => [position.value, position.label])) as Record<SpeakerRole, string>;
const asText = (value: number | undefined) => (value === undefined ? '' : String(value).replace('.', ','));
const count = (text: string) => Math.max(0, Math.floor(parseDecimal(text) ?? 0));

/** Positions each member held in the team's latest earlier acta, to save typing when they repeat. */
function previousRoles(tournament: TabTournament, round: TabRound, teamId: string): Record<string, SpeakerDraft> {
  const earlier = tournament.rounds.filter((item) => item.number < round.number).sort((x, y) => y.number - x.number);
  for (const item of earlier) {
    const rows = item.debates.find((debate) => debate.teamIds.includes(teamId))?.result?.joint?.speakers[teamId];
    if (rows?.length) return Object.fromEntries(rows.map((row) => [row.speakerId, { score: '', roles: [...row.roles] }]));
  }
  return {};
}

function draftFor(tournament: TabTournament, round: TabRound, debate: TabDebate): JointDraft {
  const result = debate.result;
  const joint = result?.joint;
  const totals = (values: Record<string, number> | undefined) => Object.fromEntries(debate.teamIds.map((teamId) => [teamId, asText(values?.[teamId])]));
  return {
    favorTeamId: debate.favorTeamId ?? '',
    winnerTeamId: joint?.winnerTeamId ?? '',
    judgeIds: [...debate.judgeIds],
    chairId: debate.chairId,
    quick: Boolean(joint?.quickTotals && !Object.values(joint.items).some((items) => Object.keys(items).length)),
    items: Object.fromEntries(debate.teamIds.map((teamId) => [teamId, Object.fromEntries(Object.entries(joint?.items[teamId] ?? {}).map(([id, value]) => [id, asText(value)]))])),
    quickTotals: totals(joint?.quickTotals),
    writtenTotals: totals(joint?.writtenTotals),
    penalties: Object.fromEntries(debate.teamIds.map((teamId) => {
      const penalty = result?.penalties[teamId];
      return [teamId, { warnings: String(penalty?.warnings ?? 0), minors: String(penalty?.minors ?? 0), majors: String(penalty?.majors ?? 0), disqualified: Boolean(penalty?.disqualified) }];
    })),
    speakers: Object.fromEntries(debate.teamIds.map((teamId) => [teamId, joint
      ? Object.fromEntries((joint.speakers[teamId] ?? []).map((row) => [row.speakerId, { score: asText(row.score), roles: [...row.roles] }]))
      : previousRoles(tournament, round, teamId)])),
    overrideOn: Boolean(result?.override),
    overrideWinner: result?.override?.winnerTeamId ?? '',
    overrideReason: result?.override?.reason ?? '',
    notes: result?.notes ?? '',
  };
}

function numbers(values: Record<string, string>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).map(([key, text]) => [key, parseDecimal(text)]).filter((entry): entry is [string, number] => entry[1] !== null));
}

function applyJoint(debate: TabDebate, draft: JointDraft, elimination: boolean): TabDebate {
  const quickTotals = numbers(draft.quickTotals);
  const writtenTotals = numbers(draft.writtenTotals);
  const joint: TabJointActa = {
    winnerTeamId: draft.winnerTeamId,
    items: elimination ? {} : Object.fromEntries(debate.teamIds.map((teamId) => [teamId, numbers(draft.items[teamId] ?? {})])),
    ...(!elimination && draft.quick && Object.keys(quickTotals).length ? { quickTotals } : {}),
    ...(!elimination && Object.keys(writtenTotals).length ? { writtenTotals } : {}),
    speakers: elimination ? {} : Object.fromEntries(debate.teamIds.map((teamId) => [teamId, Object.entries(draft.speakers[teamId] ?? {}).flatMap(([speakerId, entry]) => {
      const score = parseDecimal(entry.score);
      return score === null ? [] : [{ speakerId, score, roles: SPEAKER_ROLES.filter((role) => entry.roles.includes(role)) }];
    })])),
  };
  const judgeIds = [...new Set(draft.judgeIds.filter(Boolean))];
  const result: TabDebateResult = {
    lineup: {},
    ballots: [],
    penalties: Object.fromEntries(debate.teamIds.map((teamId) => {
      const penalty = draft.penalties[teamId] ?? { warnings: '0', minors: '0', majors: '0', disqualified: false };
      return [teamId, { warnings: count(penalty.warnings), minors: count(penalty.minors), majors: count(penalty.majors), disqualified: penalty.disqualified }];
    })),
    ...(draft.overrideOn && draft.overrideWinner ? { override: { winnerTeamId: draft.overrideWinner, reason: draft.overrideReason } } : {}),
    joint,
    notes: draft.notes,
    updatedAt: Date.now(),
  };
  return { ...debate, judgeIds, chairId: judgeIds.includes(draft.chairId) ? draft.chairId : judgeIds[0] ?? '', favorTeamId: draft.favorTeamId || undefined, result };
}

/** Joint acta (ADUMA art. 23): the jury declares the winner; items, faults and speaker scores follow the paper. */
export function JointBallotsView({ tournament, outcomes, update, notify, store, managerSessionToken }: ViewProps) {
  const look = useMemo(() => lookups(tournament), [tournament]);
  const context = useMemo(() => outcomeContext(tournament), [tournament]);
  const { settings } = tournament;
  const fallenIn = (round: TabRound, debate: TabDebate) => debate.teamIds.filter((id) => isFallenAt(look.teams.get(id), round.number));
  const pendingRound = tournament.rounds.find((round) => round.debates.some((debate) => outcomes.get(debate.id)?.status !== 'complete'));
  const [roundId, setRoundId] = useState(() => (pendingRound ?? tournament.rounds.at(-1))?.id ?? '');
  const round = tournament.rounds.find((item) => item.id === roundId) ?? tournament.rounds.at(-1);
  const [debateId, setDebateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<JointDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const debate = round?.debates.find((item) => item.id === debateId) ?? null;
  useEffect(() => {
    markUnsaved('acta', dirty);
    return () => markUnsaved('acta', false);
  }, [dirty]);

  const elimination = round?.kind === 'elimination';
  const preview = useMemo(() => (round && debate && draft ? computeDebateOutcome(round, applyJoint(debate, draft, elimination), context) : null), [round, debate, draft, context, elimination]);
  const totals = useMemo(() => {
    if (!round || !debate || !draft || elimination) return null;
    const applied = applyJoint(debate, draft, false).result!;
    return validateJointActa(applied.joint, applied.penalties, { settings, teamIds: debate.teamIds, speakers: context.speakers, elimination: false, teamName: look.teamName }).totals;
  }, [round, debate, draft, elimination, settings, context, look]);

  if (!tournament.rounds.length || !round) return <><Heading /><Empty text="Confirma una ronda para registrar sus actas." /></>;

  const edit = (mutate: (current: JointDraft) => JointDraft) => { setDraft((current) => (current ? mutate(current) : current)); setDirty(true); };
  const open = (target: TabDebate | null, force = false) => {
    if (!force && dirty && !window.confirm('Hay cambios sin guardar en esta acta. ¿Descartarlos?')) return;
    setDebateId(target?.id ?? null);
    setDraft(target ? draftFor(tournament, round, target) : null);
    setDirty(false);
  };
  const switchRound = (id: string) => {
    if (dirty && !window.confirm('Hay cambios sin guardar en esta acta. ¿Descartarlos?')) return;
    setRoundId(id);
    setDebateId(null);
    setDraft(null);
    setDirty(false);
  };
  const label = (target: TabDebate) => look.venueName(target.venueId) + ' (' + look.teamName(target.teamIds[0]) + ' – ' + look.teamName(target.teamIds[1]) + ')';
  const setDebateIn = (next: TabDebate | ((current: TabDebate) => TabDebate)) => (current: TabTournament) => ({
    ...current,
    rounds: current.rounds.map((item) => (item.id === round.id ? { ...item, debates: item.debates.map((entry) => (entry.id === debateId ? (typeof next === 'function' ? next(entry) : next) : entry)) } : item)),
  });

  const save = (goNext: boolean) => {
    if (!debate || !draft) return;
    const next = applyJoint(debate, draft, elimination);
    const status = preview?.status ?? 'empty';
    const summary = status === 'complete'
      ? 'gana ' + look.teamName(preview?.winnerTeamId ?? '') + (totals ? ' (' + debate.teamIds.map((teamId) => look.teamName(teamId) + ' ' + formatNumber(totals[teamId]?.net ?? null)).join(', ') + ')' : '')
      : 'guardada como ' + STATUS_LABELS[status].label.toLowerCase();
    const saved = update(setDebateIn(next), {
      type: 'acta.save',
      message: round.name + ' · acta de ' + label(debate) + ': ' + summary + '.',
      details: { debateId: debate.id, winner: next.result?.joint?.winnerTeamId, override: next.result?.override, penalties: next.result?.penalties, totals, warnings: preview?.warnings },
    });
    if (!saved) return;
    setDirty(false);
    notify(status === 'complete' ? 'Acta guardada: gana ' + look.teamName(preview?.winnerTeamId ?? '') + '.' : 'Acta guardada como ' + STATUS_LABELS[status].label.toLowerCase() + '.', status === 'complete' && !preview?.warnings.length ? 'success' : 'warning');
    if (goNext) {
      const index = round.debates.findIndex((item) => item.id === debate.id);
      const following = round.debates.slice(index + 1).find((item) => outcomes.get(item.id)?.status !== 'complete' && !fallenIn(round, item).length) ?? null;
      setDebateId(following?.id ?? null);
      setDraft(following ? draftFor(tournament, round, following) : null);
    }
  };
  const remove = () => {
    if (!debate || !window.confirm('¿Borrar el acta de este debate? Quedará anotado en el registro.')) return;
    if (update(setDebateIn((entry) => ({ ...entry, result: undefined })), { type: 'acta.delete', message: round.name + ' · acta de ' + label(debate) + ' borrada.' })) {
      setDraft(draftFor(tournament, round, { ...debate, result: undefined }));
      setDirty(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); save(true); }
  };
  /** Enter moves down the column of items, as on the paper. */
  const nextItem = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[data-column="' + event.currentTarget.dataset.column + '"]')];
    inputs[inputs.indexOf(event.currentTarget) + 1]?.focus();
  };

  const fallen = debate ? fallenIn(round, debate) : [];
  const heldDebates = round.debates.filter((item) => !fallenIn(round, item).length);
  const completeDebates = heldDebates.filter((item) => outcomes.get(item.id)?.status === 'complete').length;
  let sectionNumber = 0;
  const section = () => <span className="tab-section-number">{++sectionNumber}</span>;
  const partialTotal = (teamId: string) => Object.values(draft?.items[teamId] ?? {}).reduce((total, text) => total + (parseDecimal(text) ?? 0), 0);
  const ordered = debate ? (draft?.favorTeamId && debate.teamIds.includes(draft.favorTeamId) ? [draft.favorTeamId, debate.teamIds.find((id) => id !== draft.favorTeamId)!] : [...debate.teamIds]) : [];
  const sideLabel = (teamId: string) => (draft?.favorTeamId ? (teamId === draft.favorTeamId ? 'A favor' : 'En contra') : '');
  const sections = [...new Set(settings.rubric.map((item) => item.section))];
  const roster = (teamId: string) => tournament.speakers.filter((speaker) => speaker.teamId === teamId);
  const itemClass = (text: string) => {
    const value = parseDecimal(text);
    if (!text.trim()) return '';
    return value === null || value < settings.itemMin || value > settings.itemMax || !Number.isInteger(value * 2) ? ' tab-input-error' : !Number.isInteger(value) ? ' tab-input-warning' : '';
  };

  return <>
    <Heading />
    <WhatsAppInbox tournament={tournament} update={update} notify={notify} look={look} />
    <div className="round-tabs">{tournament.rounds.map((item) => {
      const held = item.debates.filter((entry) => !fallenIn(item, entry).length);
      const done = held.filter((entry) => outcomes.get(entry.id)?.status === 'complete').length;
      return <button key={item.id} type="button" className={item.id === round.id ? 'selected' : ''} onClick={() => switchRound(item.id)}>
        {item.name}<span className={'tab-tab-count' + (done === held.length ? ' ok' : '')}>{done}/{held.length}</span>
      </button>;
    })}</div>
    <div className="tab-ballots">
      <section className="panel tab-ballot-list">
        <div className="panel-title"><div><h3>Debates de {round.name}</h3><p>{completeDebates} de {heldDebates.length} actas completas{elimination ? ' · eliminatoria: solo el ganador' : ''}</p></div></div>
        <div className={'tab-progressbar' + (completeDebates === heldDebates.length ? ' complete' : '')} role="progressbar" aria-label="Actas completas" aria-valuemin={0} aria-valuemax={heldDebates.length} aria-valuenow={completeDebates}>
          <span style={{ width: (heldDebates.length ? Math.round(completeDebates * 100 / heldDebates.length) : 100) + '%' }} />
        </div>
        <ul>{round.debates.map((item) => {
          const down = fallenIn(round, item);
          const status = STATUS_LABELS[outcomes.get(item.id)?.status ?? 'empty'];
          return <li key={item.id}><button type="button" className={item.id === debate?.id ? 'selected' : ''} onClick={() => open(item)}>
            <span><b>{look.venueName(item.venueId)}</b><small>{look.teamName(item.teamIds[0])} – {look.teamName(item.teamIds[1])}</small></span>
            <span className={'state-pill ' + (down.length ? 'unassigned' : status.className)}>{down.length ? 'Caído' : status.label}</span>
          </button></li>;
        })}</ul>
      </section>

      {!debate || !draft ? <section className="panel"><Empty text="Elige un debate para registrar o corregir su acta." /></section> :
        <section className="panel tab-ballot-editor" onKeyDown={onKeyDown}>
          <div className="panel-title"><div><h3>{look.venueName(debate.venueId)} · {look.teamName(debate.teamIds[0])} – {look.teamName(debate.teamIds[1])}</h3>
            <p>Sigue el orden del papel. Enter baja por la columna de ítems; Ctrl+Enter guarda y pasa al siguiente debate.</p></div></div>

          {fallen.length > 0 && <Notice kind="info">No se disputa: {fallen.map(look.teamName).join(' y ')} {fallen.length > 1 ? 'están caídos: los dos pierden y nadie recibe ítems.' : 'está caído: su rival gana y recibe la media de ítems de la ronda.'} No hace falta acta salvo que la organización decida otra cosa.</Notice>}

          {!fallen.length && <>
            <fieldset className="tab-fieldset">
              <legend>{section()}Postura (sorteada en la sala)</legend>
              <div className="tab-radio-row">
                {debate.teamIds.map((teamId) => <label key={teamId} className="check-item"><input type="radio" name="favor" checked={draft.favorTeamId === teamId} onChange={() => edit((current) => ({ ...current, favorTeamId: teamId }))} />A favor: {look.teamName(teamId)}</label>)}
                <label className="check-item"><input type="radio" name="favor" checked={!draft.favorTeamId} onChange={() => edit((current) => ({ ...current, favorTeamId: '' }))} />Sin registrar</label>
              </div>
            </fieldset>

            {!elimination && <fieldset className="tab-fieldset">
              <legend>{section()}Hoja de ítems ({formatNumber(settings.itemMin)}–{formatNumber(settings.itemMax)} por ítem)</legend>
              <label className="check-item"><input type="checkbox" checked={draft.quick} onChange={(event) => edit((current) => ({ ...current, quick: event.target.checked }))} />Modo rápido: solo ganador y totales (el detalle de ítems se completa después)</label>
              {!draft.quick ? <div className="tournament-table-wrap">
                <table className="tab-ballot-table tab-items-table">
                  <thead><tr><th>Ítem</th>{ordered.map((teamId) => <th key={teamId}>{sideLabel(teamId) && <small>{sideLabel(teamId)}</small>}{look.teamName(teamId)}</th>)}</tr></thead>
                  <tbody>{sections.map((section) => <Fragment key={section}>
                    <tr className="tab-section-row"><th colSpan={3}>{section}</th></tr>
                    {settings.rubric.filter((item) => item.section === section).map((item) => <tr key={item.id}>
                      <td title={item.description}>{item.name}</td>
                      {ordered.map((teamId) => <td key={teamId}><input className={'tab-score-input small' + itemClass(draft.items[teamId]?.[item.id] ?? '')} inputMode="decimal" data-column={teamId}
                        aria-label={item.name + ' de ' + look.teamName(teamId)} value={draft.items[teamId]?.[item.id] ?? ''} onKeyDown={nextItem}
                        onChange={(event) => edit((current) => ({ ...current, items: { ...current.items, [teamId]: { ...current.items[teamId], [item.id]: event.target.value } } }))} /></td>)}
                    </tr>)}
                  </Fragment>)}
                  <tr className="tab-total-row"><td>Total de ítems</td>{ordered.map((teamId) => <td key={teamId}>{formatNumber(partialTotal(teamId))}</td>)}</tr>
                  </tbody>
                </table>
              </div> : <div className="tab-form-grid">{ordered.map((teamId) => <label key={teamId} className="tab-field"><span>Total de ítems de {look.teamName(teamId)}</span>
                <input inputMode="decimal" value={draft.quickTotals[teamId] ?? ''} placeholder={settings.rubric.length * settings.itemMin + '–' + settings.rubric.length * settings.itemMax}
                  onChange={(event) => edit((current) => ({ ...current, quickTotals: { ...current.quickTotals, [teamId]: event.target.value } }))} /></label>)}</div>}
            </fieldset>}

            {!elimination && <fieldset className="tab-fieldset">
              <legend>{section()}Faltas y totales</legend>
              <div className="tab-penalties">{ordered.map((teamId) => {
                const penalty = draft.penalties[teamId] ?? { warnings: '0', minors: '0', majors: '0', disqualified: false };
                const effective = effectivePenalties({ warnings: count(penalty.warnings), minors: count(penalty.minors), majors: count(penalty.majors), disqualified: penalty.disqualified }, settings);
                const total = totals?.[teamId];
                const setPenalty = (patch: Partial<PenaltyDraft>) => edit((current) => ({ ...current, penalties: { ...current.penalties, [teamId]: { ...penalty, ...patch } } }));
                return <div key={teamId}>
                  <b>{look.teamName(teamId)}</b>
                  <div className="tab-penalty-inputs">
                    {(['warnings', 'minors', 'majors'] as const).map((field) => <label key={field} className="tab-field compact"><span>{field === 'warnings' ? 'Avisos' : field === 'minors' ? 'Faltas leves' : 'Faltas graves'}</span>
                      <input type="number" min={0} value={penalty[field]} onChange={(event) => setPenalty({ [field]: event.target.value })} /></label>)}
                  </div>
                  <small className="muted">Cuentan como {effective.minors} leve(s) y {effective.majors} grave(s){effective.deduction ? ': −' + formatNumber(effective.deduction) + ' ítems' : ''}.</small>
                  <p className="tab-net">Ítems: {formatNumber(total?.gross ?? null)} · faltas −{formatNumber(total?.deduction ?? 0)} · <b>neto {formatNumber(total?.net ?? null)}</b></p>
                  <label className="tab-field compact"><span>Total escrito en el acta</span><input inputMode="decimal" value={draft.writtenTotals[teamId] ?? ''} onChange={(event) => edit((current) => ({ ...current, writtenTotals: { ...current.writtenTotals, [teamId]: event.target.value } }))} /></label>
                </div>;
              })}</div>
            </fieldset>}

            <fieldset className="tab-fieldset">
              <legend>{section()}Equipo ganador (declarado por el jurado)</legend>
              <div className="tab-radio-row">{debate.teamIds.map((teamId) => <label key={teamId} className="check-item tab-winner-option"><input type="radio" name="winner" checked={draft.winnerTeamId === teamId} onChange={() => edit((current) => ({ ...current, winnerTeamId: teamId }))} />{look.teamName(teamId)}</label>)}</div>
            </fieldset>

            <fieldset className="tab-fieldset">
              <legend>{section()}Jurado que firma el acta</legend>
              <div className="tab-judges">
                {draft.judgeIds.map((judgeId) => <span key={judgeId} className={'tab-judge-chip' + (judgeId === draft.chairId ? ' chair' : '')}>
                  <button type="button" className="tab-chip-star" title="Juez principal" aria-label={'Marcar a ' + look.judgeName(judgeId) + ' como juez principal'} onClick={() => edit((current) => ({ ...current, chairId: judgeId }))}><Star size={12} /></button>
                  {look.judgeName(judgeId)}
                  <button type="button" className="tab-chip-remove" aria-label={'Quitar a ' + look.judgeName(judgeId)} onClick={() => edit((current) => ({ ...current, judgeIds: current.judgeIds.filter((id) => id !== judgeId) }))}>×</button>
                </span>)}
                <select className="tab-cell-select tab-add-judge" aria-label="Añadir juez al acta" value="" onChange={(event) => { const judgeId = event.target.value; if (judgeId) edit((current) => ({ ...current, judgeIds: [...current.judgeIds, judgeId], chairId: current.chairId || judgeId })); }}>
                  <option value="">+ Añadir juez…</option>{tournament.judges.filter((judge) => !draft.judgeIds.includes(judge.id)).map((judge) => <option key={judge.id} value={judge.id}>{judge.name}</option>)}
                </select>
              </div>
            </fieldset>

            {!elimination && settings.speakerScores && <fieldset className="tab-fieldset">
              <legend>{section()}Puntos de orador ({formatNumber(settings.speakerScoreMin)}–{formatNumber(settings.speakerScoreMax)}) y posiciones</legend>
              <div className="tab-speaker-blocks">{ordered.map((teamId) => <div key={teamId}>
                <b>{look.teamName(teamId)}</b>
                {!roster(teamId).length ? <p className="muted">Este equipo no tiene integrantes: añádelos en Participantes.</p> : <table className="tab-ballot-table">
                  <thead><tr><th>Integrante</th><th>Nota</th>{SPEAKER_ROLES.map((role) => <th key={role}>{ROLE_LABELS[role]}</th>)}</tr></thead>
                  <tbody>{roster(teamId).map((speaker) => {
                    const entry = draft.speakers[teamId]?.[speaker.id] ?? { score: '', roles: [] };
                    const setEntry = (patch: Partial<SpeakerDraft>) => edit((current) => ({ ...current, speakers: { ...current.speakers, [teamId]: { ...current.speakers[teamId], [speaker.id]: { ...entry, ...patch } } } }));
                    return <tr key={speaker.id}>
                      <td>{speaker.name}</td>
                      <td><input className="tab-score-input small" inputMode="decimal" aria-label={'Nota de ' + speaker.name} value={entry.score} onChange={(event) => setEntry({ score: event.target.value })} /></td>
                      {SPEAKER_ROLES.map((role) => <td key={role}><input type="checkbox" aria-label={ROLE_LABELS[role] + ': ' + speaker.name} checked={entry.roles.includes(role)}
                        onChange={(event) => setEntry({ roles: event.target.checked ? [...entry.roles, role] : entry.roles.filter((item) => item !== role) })} /></td>)}
                    </tr>;
                  })}</tbody>
                </table>}
              </div>)}</div>
            </fieldset>}
          </>}

          <fieldset className="tab-fieldset">
            <legend>{section()}Notas y decisión de la organización</legend>
            <label className="tab-field"><span>Notas del acta (incidencias, observaciones del jurado, reclamaciones…)</span><textarea rows={3} value={draft.notes} onChange={(event) => edit((current) => ({ ...current, notes: event.target.value }))} /></label>
            <label className="check-item"><input type="checkbox" checked={draft.overrideOn} onChange={(event) => edit((current) => ({ ...current, overrideOn: event.target.checked }))} />Fijar el ganador manualmente (reclamación, decisión del comité…)</label>
            {draft.overrideOn && <div className="tab-form-grid">
              <label className="tab-field"><span>Ganador</span><select value={draft.overrideWinner} onChange={(event) => edit((current) => ({ ...current, overrideWinner: event.target.value }))}><option value="">—</option>{debate.teamIds.map((teamId) => <option key={teamId} value={teamId}>{look.teamName(teamId)}</option>)}</select></label>
              <label className="tab-field"><span>Motivo</span><input value={draft.overrideReason} onChange={(event) => edit((current) => ({ ...current, overrideReason: event.target.value }))} /></label>
            </div>}
          </fieldset>

          {preview && (preview.issues.length > 0 || preview.missing.length > 0 || preview.warnings.length > 0) && <div className={'tab-outcome ' + preview.status}>
            <IssueList items={preview.issues} kind="error" />
            <IssueList items={preview.missing} />
            <IssueList items={compactActaWarnings(preview.warnings)} />
          </div>}

          <div className="tab-editor-bar">
            <div className="tab-editor-status">
              {preview && <span className={'state-pill ' + STATUS_LABELS[preview.status].className}>{STATUS_LABELS[preview.status].label}</span>}
              {preview?.status === 'complete' && (preview.noWinner ? <span>Los dos equipos pierden sin ítems.</span> : <span>Gana <b>{look.teamName(preview.winnerTeamId ?? '')}</b>{!elimination && preview.lines.length ? ' · ítems netos ' + preview.lines.map((line) => (line.points === null ? 'media de la ronda' : formatNumber(line.points))).join(' – ') : ''}</span>)}
              {dirty && <span className="tab-unsaved">Cambios sin guardar</span>}
            </div>
            {!dirty && debate.result && <OfficialActaPublisher tournament={tournament} round={round} debate={debate} result={debate.result} token={managerSessionToken} store={store} notify={notify} />}
            <div className="tab-actions">
              {debate.result && <button type="button" className="text-button danger-action" onClick={remove}><Trash2 size={14} /> Borrar acta</button>}
              <button type="button" className="text-button" disabled={!dirty} onClick={() => open(debate, true)}>Descartar cambios</button>
              <button type="button" className="button secondary" onClick={() => save(false)}><Save size={16} /> Guardar</button>
              <button type="button" className="button primary" onClick={() => save(true)}><SkipForward size={16} /> Guardar y siguiente</button>
            </div>
          </div>
        </section>}
    </div>
  </>;
}

/** Actas sent by the judges from their phones: pasted from WhatsApp, checked and accepted one by one. */
function WhatsAppInbox({ tournament, update, notify, look }: Pick<ViewProps, 'tournament' | 'update' | 'notify'> & { look: ReturnType<typeof lookups> }) {
  const [text, setText] = useState('');
  const context = useMemo(() => outcomeContext(tournament), [tournament]);
  const entries = useMemo(() => {
    const received = findActaCodes(text).map((code) => readActaCode(tournament, code));
    const newest = new Map<string, number>();
    for (const item of received) if (item.payload && !item.error) newest.set(item.debateId!, Math.max(newest.get(item.debateId!) ?? 0, item.payload.sentAt));
    return received.map((item) => {
      const round = tournament.rounds.find((entry) => entry.id === item.roundId) ?? null;
      const debate = round?.debates.find((entry) => entry.id === item.debateId) ?? null;
      if (!item.payload || item.error || !round || !debate) return { item, round, debate, outcome: null, registered: false, replaces: false, older: false };
      const applied = applyReceivedActa(tournament, item);
      const next = applied.rounds.find((entry) => entry.id === round.id)!.debates.find((entry) => entry.id === debate.id)!;
      const registered = receivedIsRegistered(tournament, item);
      return {
        item, round, debate, outcome: computeDebateOutcome(round, next, context), registered,
        replaces: Boolean(debate.result) && !registered, older: item.payload.sentAt < (newest.get(debate.id) ?? 0),
      };
    });
  }, [text, tournament, context]);
  type Entry = (typeof entries)[number];
  const label = (entry: Entry) => (entry.round?.name ?? '') + ' · ' + (entry.debate ? look.venueName(entry.debate.venueId) + ' (' + look.teamName(entry.debate.teamIds[0]) + ' – ' + look.teamName(entry.debate.teamIds[1]) + ')' : '');
  const summary = (entry: Entry) => (entry.outcome?.status === 'complete' && entry.outcome.winnerTeamId
    ? 'gana ' + look.teamName(entry.outcome.winnerTeamId) + (entry.round?.kind === 'elimination' ? '' : ' (' + entry.outcome.lines.map((line) => formatNumber(line.points)).join(' – ') + ' ítems netos)')
    : STATUS_LABELS[entry.outcome?.status ?? 'empty'].label.toLowerCase());

  const accept = (entry: Entry, ask = true): boolean => {
    const payload = entry.item.payload;
    if (!payload || !entry.round || !entry.debate) return false;
    if (ask && entry.replaces && !window.confirm('Este debate ya tenía un acta distinta (quizá transcrita del papel). ¿Sustituirla por la recibida por WhatsApp? Quedará anotado.')) return false;
    if (ask && entry.older && !window.confirm('Entre los mensajes pegados hay un acta más reciente de este mismo debate. ¿Aceptar esta igualmente?')) return false;
    return update((current) => applyReceivedActa(current, readActaCode(current, entry.item.code)), {
      type: 'acta.import',
      message: label(entry) + ': acta recibida por WhatsApp' + (payload.signedBy ? ', firmada por ' + payload.signedBy : '') + '; ' + summary(entry) + (entry.replaces ? '; sustituye a la anterior' : '') + '.',
      details: { code: entry.item.code.slice(-14), sentAt: payload.sentAt, signedBy: payload.signedBy, issues: entry.outcome?.issues, warnings: entry.outcome?.warnings },
    });
  };
  const ready = entries.filter((entry) => entry.outcome?.status === 'complete' && !entry.registered && !entry.replaces && !entry.older);

  return <details className="panel tab-whatsapp-inbox" open={entries.length > 0 || undefined}>
    <summary><MessageCircle size={16} /> Actas recibidas por WhatsApp</summary>
    <p className="muted">Copia los mensajes de los jueces en WhatsApp (puedes seleccionar varios o pegar el chat entero) y pégalos aquí. Cada acta se comprueba antes de aceptarla y queda en el registro.</p>
    <textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} placeholder="Pega aquí los mensajes con «ACTA1-…»" aria-label="Mensajes de WhatsApp con actas" spellCheck={false} />
    {text.trim() && !entries.length && <p className="muted">No hay ningún código de acta en el texto pegado.</p>}
    {entries.length > 0 && <ul className="tab-inbox">{entries.map((entry) => <li key={entry.item.code} className={entry.item.error ? 'error' : ''}>
      {entry.item.error ? <><b>Código …{entry.item.code.slice(-6)}</b><span className="tab-inbox-error">{entry.item.error}</span></> : <>
        <div>
          <b>{label(entry)}</b>
          <span>{summary(entry)}{entry.item.payload?.signedBy ? ' · firma: ' + entry.item.payload.signedBy : ''}{entry.item.payload?.sentAt ? ' · ' + new Date(entry.item.payload.sentAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          <ul className="tab-problems">
            {(entry.outcome?.issues ?? []).map((issue) => <li key={issue} className="error">{issue}</li>)}
            {compactActaWarnings(entry.outcome?.warnings ?? []).map((warning) => <li key={warning} className="warning">{warning}</li>)}
          </ul>
        </div>
        <span className={'state-pill ' + (entry.registered ? 'ready' : entry.replaces || entry.older ? 'paused' : 'unassigned')}>{entry.registered ? 'Ya registrada' : entry.older ? 'Hay una más reciente' : entry.replaces ? 'Sustituye la guardada' : 'Nueva'}</span>
        {!entry.registered && <button type="button" className="button secondary" onClick={() => { if (accept(entry)) notify('Acta aceptada: ' + label(entry) + '.'); }}>Aceptar</button>}
      </>}
    </li>)}</ul>}
    {ready.length > 1 && <button type="button" className="button primary" onClick={() => {
      const accepted = ready.filter((entry) => accept(entry, false)).length;
      notify(accepted + ' actas aceptadas.');
    }}><CheckCheck size={16} /> Aceptar las {ready.length} nuevas sin incidencias</button>}
  </details>;
}

function Heading() {
  return <div className="page-heading"><div><p className="eyebrow">RESULTADOS</p><h2>Actas</h2><p className="muted">Transcribe el acta conjunta de cada debate: el jurado declara el ganador y los ítems netos (ítems menos faltas) sirven para desempatar. Cada acta guardada queda anotada en el registro.</p></div></div>;
}
