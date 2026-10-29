import { useMemo, useState, type FormEvent } from 'react';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { SearchableEntityPicker } from '../../components/SearchableEntityPicker';
import {
  applyConflictImport, applyJudgeImport, applyTeamImport, applyVenueImport, parseConflictLines, parseJudgeLines, parseTeamLines, parseVenueLines,
  type ImportPreview, type ImportSummary,
} from '../csv';
import { checkIntegrity } from '../integrity';
import { addRestTeam } from '../pairing';
import { makeTabId, nextRoundNumber, normalizeInstitution, type ConflictLevel, type TabJudge, type TabJudgeConflict, type TabTeam, type TabTournament } from '../types';
import { Empty, Field, IssueList, Notice, type ViewProps } from '../ui';

type Section = 'equipos' | 'jueces' | 'incompatibilidades' | 'salas';
type EditProps = Pick<ViewProps, 'tournament' | 'update' | 'notify'>;

function setMutualJudgeConflicts(judges: TabJudge[], judgeId: string, ids: string[]): TabJudge[] {
  const wanted = new Set(ids.filter((id) => id !== judgeId));
  return judges.map((judge) => {
    if (judge.id === judgeId) return { ...judge, incompatibleJudgeIds: [...wanted].sort() };
    const has = judge.incompatibleJudgeIds.includes(judgeId);
    if (has === wanted.has(judge.id)) return judge;
    return { ...judge, incompatibleJudgeIds: has ? judge.incompatibleJudgeIds.filter((id) => id !== judgeId) : [...judge.incompatibleJudgeIds, judgeId].sort() };
  });
}

/** First round whose debate of this team has no acta yet (or the next round): where a withdrawal usually starts. */
function defaultFallenRound(tournament: TabTournament, teamId: string): number {
  for (const round of [...tournament.rounds].sort((x, y) => x.number - y.number)) {
    const debate = round.debates.find((item) => item.teamIds.includes(teamId));
    if (debate && !debate.result) return round.number;
  }
  return nextRoundNumber(tournament);
}

function BulkImport<T>({ title, help, example, parse, apply, update, notify }: {
  title: string; help: string; example: string;
  parse: (content: string) => ImportPreview<T>;
  apply: (tournament: TabTournament, rows: T[]) => ImportSummary;
  update: ViewProps['update']; notify: ViewProps['notify'];
}) {
  const [content, setContent] = useState('');
  const preview = useMemo(() => (content.trim() ? parse(content) : null), [content, parse]);
  return <details className="tab-bulk">
    <summary>{title}</summary>
    <p className="muted">{help}</p>
    <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={6} placeholder={example} spellCheck={false} />
    {preview && <>
      <p className="muted">{preview.rows.length} fila(s) válidas.</p>
      <IssueList items={preview.errors} />
      <button type="button" className="button primary" disabled={!preview.rows.length} onClick={() => {
        let summary: ImportSummary | null = null;
        const applied = update((current) => { summary = apply(current, preview.rows); return summary.tournament; });
        if (!applied) return;
        const result = summary as ImportSummary | null;
        notify('Importación completada: ' + (result?.added ?? 0) + ' añadidos y ' + (result?.updated ?? 0) + ' actualizados.' + (preview.errors.length ? ' Revisa las ' + preview.errors.length + ' líneas que no se han reconocido.' : ''), preview.errors.length ? 'warning' : 'success');
        setContent('');
      }}><Plus size={16} /> Añadir a la lista</button>
    </>}
  </details>;
}

export function ParticipantsView({ tournament, update, notify }: ViewProps) {
  const [section, setSection] = useState<Section>('equipos');
  const institutions = useMemo(() => [...new Set([...tournament.teams, ...tournament.judges].map((item) => item.institution.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es')), [tournament.teams, tournament.judges]);
  const used = useMemo(() => {
    const debates = tournament.rounds.flatMap((round) => round.debates);
    const draftDebates = tournament.draftRound?.round.debates ?? [];
    return {
      teams: new Set([...debates, ...draftDebates].flatMap((debate) => debate.teamIds)),
      judges: new Set([...debates, ...draftDebates].flatMap((debate) => [...debate.judgeIds, ...(debate.result?.ballots.map((ballot) => ballot.judgeId) ?? [])])),
      venues: new Set([...debates, ...draftDebates].map((debate) => debate.venueId)),
    };
  }, [tournament.rounds, tournament.draftRound]);
  const counts = { equipos: tournament.teams.length, jueces: tournament.judges.length, incompatibilidades: tournament.judgeConflicts.length, salas: tournament.venues.length };
  const labels: Record<Section, string> = { equipos: 'Equipos e integrantes', jueces: 'Jueces', incompatibilidades: 'Incompatibilidades', salas: 'Salas' };

  return <>
    <div className="page-heading"><div><p className="eyebrow">INSCRIPCIÓN</p><h2>Participantes</h2><p className="muted">Equipos con sus integrantes, jueces con su nivel y disponibilidad, incompatibilidades y salas. Compartir institución con un equipo es siempre una incompatibilidad objetiva.</p></div></div>
    <div className="round-tabs">
      {(['equipos', 'jueces', 'incompatibilidades', 'salas'] as const).map((id) => <button key={id} type="button" className={section === id ? 'selected' : ''} onClick={() => setSection(id)}>
        {labels[id]} · {counts[id]}
      </button>)}
    </div>
    <datalist id="tab-institutions">{institutions.map((name) => <option key={name} value={name} />)}</datalist>
    {section === 'equipos' && <TeamsSection tournament={tournament} update={update} notify={notify} usedTeams={used.teams} />}
    {section === 'jueces' && <JudgesSection tournament={tournament} update={update} notify={notify} usedJudges={used.judges} />}
    {section === 'incompatibilidades' && <ConflictsSection tournament={tournament} update={update} notify={notify} />}
    {section === 'salas' && <VenuesSection tournament={tournament} update={update} notify={notify} usedVenues={used.venues} />}
  </>;
}

function TeamsSection({ tournament, update, notify, usedTeams }: EditProps & { usedTeams: Set<string> }) {
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { settings } = tournament;
  const setTeam = (id: string, patch: Partial<TabTeam>) => update((current) => ({ ...current, teams: current.teams.map((team) => (team.id === id ? { ...team, ...patch } : team)) }));
  const active = tournament.teams.filter((team) => team.active).length;
  const realTeams = tournament.teams.filter((team) => team.active && !team.swing).length;
  const lastRound = nextRoundNumber(tournament);
  const roundName = (number: number) => tournament.rounds.find((round) => round.number === number)?.name
    ?? (tournament.draftRound?.round.number === number ? tournament.draftRound.round.name + ' (borrador)' : 'Ronda ' + number + ' (siguiente)');

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (tournament.teams.some((team) => team.name.trim().toLocaleLowerCase('es-ES') === name.trim().toLocaleLowerCase('es-ES'))) { notify('Ya existe un equipo con ese nombre.', 'error'); return; }
    const team: TabTeam = { id: makeTabId('equipo'), name: name.trim(), institution: institution.trim(), active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [] };
    if (update((current) => ({ ...current, teams: [...current.teams, team] }))) {
      setName('');
      setExpanded(team.id);
    }
  };
  const remove = (team: TabTeam) => {
    if (usedTeams.has(team.id)) { notify('«' + team.name + '» ya tiene debates: márcalo como caído o desactívalo en lugar de borrarlo, para conservar sus resultados.', 'error'); return; }
    if (!window.confirm('¿Borrar el equipo «' + team.name + '» y sus integrantes?')) return;
    update((current) => ({
      ...current,
      teams: current.teams.filter((item) => item.id !== team.id),
      speakers: current.speakers.filter((speaker) => speaker.teamId !== team.id),
      groups: current.groups.map((group) => ({ ...group, teamIds: group.teamIds.filter((id) => id !== team.id) })),
      manualOrder: current.manualOrder.filter((id) => id !== team.id),
      judgeConflicts: current.judgeConflicts.filter((conflict) => conflict.teamId !== team.id),
    }), { type: 'team.remove', message: 'Equipo «' + team.name + '» borrado.' });
  };
  const setFallen = (team: TabTeam, round: number | undefined) => {
    if (round !== undefined) {
      const played = tournament.rounds.filter((item) => item.number >= round && item.debates.some((debate) => debate.teamIds.includes(team.id) && debate.result));
      if (played.length && !window.confirm('«' + team.name + '» ya tiene acta en ' + played.map((item) => item.name).join(', ') + '. Desde la ronda ' + round + ' se ignorarán esas actas: pierde y su rival recibe la media de ítems de la ronda. ¿Continuar?')) return;
    }
    update((current) => ({ ...current, teams: current.teams.map((item) => (item.id !== team.id ? item : round === undefined ? (({ fallenFromRound: _fallen, ...rest }) => rest)(item) : { ...item, fallenFromRound: round })) }), {
      type: 'team.fallen',
      message: round === undefined ? '«' + team.name + '» deja de estar caído.' : '«' + team.name + '» marcado como equipo caído desde la ronda ' + round + '.',
    });
  };

  return <>
    <section className="panel">
      <form className="tab-inline-form" onSubmit={add}>
        <Field label="Nuevo equipo"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Málaga A" /></Field>
        <Field label="Institución"><input value={institution} list="tab-institutions" onChange={(event) => setInstitution(event.target.value)} placeholder="Universidad de Málaga" /></Field>
        <button type="submit" className="button primary"><Plus size={16} /> Añadir equipo</button>
      </form>
      <BulkImport title="Pegar una lista de equipos" help="Una línea por equipo: nombre; institución; y, opcionalmente, los nombres de sus integrantes. Puedes copiarla de una hoja de cálculo." example={'Equipo;Institución;Integrante 1;Integrante 2;Integrante 3;Integrante 4\nMálaga A;Universidad de Málaga;Lucía García;Hugo López;Paula Ruiz;Mario Díaz'} parse={parseTeamLines} apply={applyTeamImport} update={update} notify={notify} />
      {settings.expectedTeams > 0 && <p className="muted">{realTeams} de {settings.expectedTeams} equipos previstos.</p>}
      {settings.stage === 'swiss' && active % 2 === 1 && <Notice kind="warning">
        Hay {active} equipos activos: el sistema suizo necesita un número par. Añade un equipo «Descanso»: está caído desde el principio, así que su rival gana y recibe la media de ítems de la ronda, y no aparece en la clasificación.
        <button type="button" className="button secondary" onClick={() => update(addRestTeam, { type: 'team.rest', message: 'Añadido el equipo «Descanso» porque había ' + active + ' equipos activos.' })}><Plus size={14} /> Añadir equipo «Descanso»</button>
      </Notice>}
    </section>
    {!tournament.teams.length && <Empty text="Todavía no hay equipos." />}
    {tournament.teams.map((team) => {
      const speakers = tournament.speakers.filter((speaker) => speaker.teamId === team.id);
      const open = expanded === team.id;
      const fallen = team.fallenFromRound !== undefined;
      return <section key={team.id} className={'panel tab-entity' + (team.active ? '' : ' inactive') + (fallen ? ' tab-fallen' : '')}>
        <div className="tab-entity-row">
          <input className="table-input tab-name-input" aria-label="Nombre del equipo" value={team.name} onChange={(event) => setTeam(team.id, { name: event.target.value })} />
          <input className="table-input" aria-label="Institución" list="tab-institutions" value={team.institution} placeholder="Institución" onChange={(event) => setTeam(team.id, { institution: event.target.value })} />
          <label className="check-item"><input type="checkbox" checked={team.active} onChange={(event) => setTeam(team.id, { active: event.target.checked })} />Activo</label>
          <label className="check-item" title="Pierde todos sus debates desde la ronda indicada; su rival gana con la media de ítems de la ronda. Las rondas anteriores se conservan.">
            <input type="checkbox" checked={fallen} onChange={(event) => setFallen(team, event.target.checked ? defaultFallenRound(tournament, team.id) : undefined)} />Equipo caído
          </label>
          {fallen && <label className="check-item">desde <select aria-label={'Caído desde la ronda (' + team.name + ')'} value={team.fallenFromRound} onChange={(event) => setFallen(team, Number(event.target.value))}>
            {Array.from({ length: Math.max(lastRound, team.fallenFromRound ?? 1) }, (_, i) => i + 1).map((number) => <option key={number} value={number}>{roundName(number)}</option>)}
          </select></label>}
          {settings.ballotMode === 'judges' && <label className="check-item" title="Equipo de relleno: debate pero no clasifica ni puede ganar (UC3M art. 35–36)."><input type="checkbox" checked={team.swing} onChange={(event) => setTeam(team.id, { swing: event.target.checked })} />Swing</label>}
          <label className="check-item" title="Desmárcalo si el reglamento le impide pasar a eliminatorias."><input type="checkbox" checked={team.breakEligible} onChange={(event) => setTeam(team.id, { breakEligible: event.target.checked })} />Puede clasificarse</label>
          <button type="button" className="text-button" aria-expanded={open} onClick={() => setExpanded(open ? null : team.id)}>{speakers.length} integrantes · {team.incompatibleJudgeIds.length} incompat. <ChevronRight size={14} className={open ? 'tab-rotated' : ''} /></button>
          <button type="button" className="icon-button danger-action" aria-label={'Borrar ' + team.name} onClick={() => remove(team)}><Trash2 size={15} /></button>
        </div>
        {open && <div className="tab-entity-details">
          <SpeakersEditor teamId={team.id} tournament={tournament} update={update} />
          <SearchableEntityPicker label={'Jueces con incompatibilidad objetiva con ' + team.name} multiple
            options={tournament.judges.map((judge) => ({ id: judge.id, name: judge.name + (judge.institution ? ' · ' + judge.institution : ''), active: judge.active }))}
            value={team.incompatibleJudgeIds} onChange={(value) => setTeam(team.id, { incompatibleJudgeIds: value as string[] })} />
          <p className="muted">Para incompatibilidades subjetivas o por institución usa la pestaña «Incompatibilidades».</p>
        </div>}
      </section>;
    })}
  </>;
}

function SpeakersEditor({ teamId, tournament, update }: { teamId: string; tournament: TabTournament; update: ViewProps['update'] }) {
  const [name, setName] = useState('');
  const speakers = tournament.speakers.filter((speaker) => speaker.teamId === teamId);
  const used = new Set(tournament.rounds.flatMap((round) => round.debates.flatMap((debate) => [
    ...Object.values(debate.result?.lineup[teamId] ?? {}),
    ...(debate.result?.joint?.speakers[teamId] ?? []).map((row) => row.speakerId),
  ])));
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (update((current) => ({ ...current, speakers: [...current.speakers, { id: makeTabId('orador'), teamId, name: name.trim() }] }))) setName('');
  };
  return <div className="tab-speakers">
    <h4 className="tab-subtitle">Integrantes</h4>
    {speakers.map((speaker) => <div key={speaker.id} className="tab-speaker-row">
      <input className="table-input" aria-label="Nombre del integrante" value={speaker.name} onChange={(event) => update((current) => ({ ...current, speakers: current.speakers.map((item) => (item.id === speaker.id ? { ...item, name: event.target.value } : item)) }))} />
      <button type="button" className="icon-button danger-action" aria-label={'Quitar ' + speaker.name} disabled={used.has(speaker.id)} title={used.has(speaker.id) ? 'Tiene intervenciones en actas' : undefined}
        onClick={() => update((current) => ({ ...current, speakers: current.speakers.filter((item) => item.id !== speaker.id) }))}><Trash2 size={14} /></button>
    </div>)}
    <form className="tab-speaker-row" onSubmit={add}>
      <input className="table-input" aria-label="Nuevo integrante" placeholder="Nombre del integrante" value={name} onChange={(event) => setName(event.target.value)} />
      <button type="submit" className="icon-button" aria-label="Añadir integrante"><Plus size={14} /></button>
    </form>
  </div>;
}

function JudgesSection({ tournament, update, notify, usedJudges }: EditProps & { usedJudges: Set<string> }) {
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const setJudge = (id: string, patch: Partial<TabJudge>) => update((current) => ({ ...current, judges: current.judges.map((judge) => (judge.id === id ? { ...judge, ...patch } : judge)) }));
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const judge: TabJudge = { id: makeTabId('juez'), name: name.trim(), institution: institution.trim(), active: true, rating: 3, canChair: true, incompatibleJudgeIds: [], unavailableRoundIds: [] };
    if (update((current) => ({ ...current, judges: [...current.judges, judge] }))) setName('');
  };
  const remove = (judge: TabJudge) => {
    if (usedJudges.has(judge.id)) { notify(judge.name + ' ya figura en debates o actas: márcalo como no disponible en lugar de borrarlo.', 'error'); return; }
    if (!window.confirm('¿Borrar a ' + judge.name + '?')) return;
    update((current) => ({
      ...current,
      judges: current.judges.filter((item) => item.id !== judge.id).map((item) => ({ ...item, incompatibleJudgeIds: item.incompatibleJudgeIds.filter((id) => id !== judge.id) })),
      teams: current.teams.map((team) => ({ ...team, incompatibleJudgeIds: team.incompatibleJudgeIds.filter((id) => id !== judge.id) })),
      judgeConflicts: current.judgeConflicts.filter((conflict) => conflict.judgeId !== judge.id),
    }), { type: 'judge.remove', message: 'Juez «' + judge.name + '» borrado.' });
  };
  return <>
    <section className="panel">
      <form className="tab-inline-form" onSubmit={add}>
        <Field label="Nuevo juez"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre y apellidos" /></Field>
        <Field label="Institución"><input value={institution} list="tab-institutions" onChange={(event) => setInstitution(event.target.value)} placeholder="Universidad, club o «Independiente»" /></Field>
        <button type="submit" className="button primary"><Plus size={16} /> Añadir juez</button>
      </form>
      <BulkImport title="Pegar una lista de jueces" help="Una línea por juez: nombre; institución; nivel de 1 a 5; puede presidir (sí/no); móvil para WhatsApp. Solo el nombre es obligatorio." example={'Juez;Institución;Nivel;Preside;Móvil\nAna Martín;Independiente;5;sí;600 11 22 33'} parse={parseJudgeLines} apply={applyJudgeImport} update={update} notify={notify} />
      <p className="muted">«Disponible» decide si el juez entra en los próximos sorteos de jueces; desmárcalo si no ha llegado o se ha ido.</p>
    </section>
    {!tournament.judges.length && <Empty text="Todavía no hay jueces." />}
    {tournament.judges.map((judge) => {
      const open = expanded === judge.id;
      const teamConflicts = tournament.teams.filter((team) => team.incompatibleJudgeIds.includes(judge.id)).map((team) => team.id);
      const listed = tournament.judgeConflicts.filter((conflict) => conflict.judgeId === judge.id).length;
      return <section key={judge.id} className={'panel tab-entity' + (judge.active ? '' : ' inactive')}>
        <div className="tab-entity-row">
          <input className="table-input tab-name-input" aria-label="Nombre del juez" value={judge.name} onChange={(event) => setJudge(judge.id, { name: event.target.value })} />
          <input className="table-input" aria-label="Institución" list="tab-institutions" value={judge.institution} placeholder="Institución" onChange={(event) => setJudge(judge.id, { institution: event.target.value })} />
          <input className="table-input tab-phone-input" aria-label={'Móvil de ' + judge.name} type="tel" value={judge.phone ?? ''} placeholder="Móvil (WhatsApp)" onChange={(event) => setJudge(judge.id, { phone: event.target.value })} />
          <label className="check-item">Nivel <select value={judge.rating} onChange={(event) => setJudge(judge.id, { rating: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="check-item"><input type="checkbox" checked={judge.canChair} onChange={(event) => setJudge(judge.id, { canChair: event.target.checked })} />Puede presidir</label>
          <label className="check-item"><input type="checkbox" checked={judge.active} onChange={(event) => setJudge(judge.id, { active: event.target.checked })} />Disponible</label>
          <button type="button" className="text-button" aria-expanded={open} onClick={() => setExpanded(open ? null : judge.id)}>Rondas e incompatibilidades{listed ? ' · ' + listed + ' listadas' : ''} <ChevronRight size={14} className={open ? 'tab-rotated' : ''} /></button>
          <button type="button" className="icon-button danger-action" aria-label={'Borrar ' + judge.name} onClick={() => remove(judge)}><Trash2 size={15} /></button>
        </div>
        {open && <div className="tab-entity-details">
          <div>
            <h4 className="tab-subtitle">Disponible en las rondas ya generadas</h4>
            {tournament.rounds.length ? <div className="check-grid">{tournament.rounds.map((round) => <label key={round.id} className="check-item">
              <input type="checkbox" checked={!judge.unavailableRoundIds.includes(round.id)} onChange={(event) => setJudge(judge.id, {
                unavailableRoundIds: event.target.checked ? judge.unavailableRoundIds.filter((id) => id !== round.id) : [...judge.unavailableRoundIds, round.id],
              })} />{round.name}
            </label>)}</div> : <p className="muted">Las rondas aparecerán aquí cuando se generen.</p>}
          </div>
          <SearchableEntityPicker label="Equipos con incompatibilidad objetiva" multiple options={tournament.teams.map((team) => ({ id: team.id, name: team.name, active: team.active }))} value={teamConflicts}
            onChange={(value) => {
              const ids = new Set(value as string[]);
              update((current) => ({ ...current, teams: current.teams.map((team) => {
                const has = team.incompatibleJudgeIds.includes(judge.id);
                if (has === ids.has(team.id)) return team;
                return { ...team, incompatibleJudgeIds: has ? team.incompatibleJudgeIds.filter((id) => id !== judge.id) : [...team.incompatibleJudgeIds, judge.id] };
              }) }));
            }} />
          <SearchableEntityPicker label="Jueces con los que no puede compartir panel" multiple options={tournament.judges.filter((other) => other.id !== judge.id).map((other) => ({ id: other.id, name: other.name, active: other.active }))}
            value={judge.incompatibleJudgeIds} onChange={(value) => update((current) => ({ ...current, judges: setMutualJudgeConflicts(current.judges, judge.id, value as string[]) }))} />
        </div>}
      </section>;
    })}
  </>;
}

/** Incompatibilities by level: objective (only as a last resort, never as a wing judge) and subjective (avoided). */
function ConflictsSection({ tournament, update, notify }: EditProps) {
  const [judgeId, setJudgeId] = useState('');
  const [target, setTarget] = useState('');
  const [level, setLevel] = useState<ConflictLevel>('subjective');
  const [note, setNote] = useState('');
  const judges = new Map(tournament.judges.map((judge) => [judge.id, judge]));
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const institutionRows = useMemo(() => {
    const rows = new Map<string, { name: string; teams: number; judges: number }>();
    for (const item of [...tournament.teams.map((team) => ({ institution: team.institution, team: true })), ...tournament.judges.map((judge) => ({ institution: judge.institution, team: false }))]) {
      const key = normalizeInstitution(item.institution);
      if (!key) continue;
      const row = rows.get(key) ?? { name: item.institution.trim(), teams: 0, judges: 0 };
      if (item.team) row.teams++;
      else row.judges++;
      rows.set(key, row);
    }
    return [...rows.values()].sort((x, y) => x.name.localeCompare(y.name, 'es'));
  }, [tournament.teams, tournament.judges]);
  const spelling = useMemo(() => checkIntegrity(tournament).warnings.filter((warning) => warning.startsWith('La misma institución')), [tournament]);
  const parse = useMemo(() => (content: string) => parseConflictLines(content, tournament), [tournament]);
  const targetName = (conflict: { teamId?: string; institution?: string }) => (conflict.teamId ? teams.get(conflict.teamId)?.name ?? 'equipo eliminado' : 'institución «' + conflict.institution + '»');
  const levelName = (value: ConflictLevel) => (value === 'objective' ? 'objetiva' : 'subjetiva');

  const add = (event: FormEvent) => {
    event.preventDefault();
    const judge = judges.get(judgeId);
    if (!judge || !target) { notify('Elige el juez y el equipo o la institución.', 'error'); return; }
    const conflict: TabJudgeConflict = { id: makeTabId('incompatibilidad'), judgeId, ...(target.startsWith('team:') ? { teamId: target.slice(5) } : { institution: target.slice(5) }), level, note: note.trim() };
    if (tournament.judgeConflicts.some((item) => item.judgeId === judgeId && item.teamId === conflict.teamId && item.institution === conflict.institution)) { notify('Esa incompatibilidad ya está en la lista: bórrala y vuelve a añadirla para cambiarla.', 'error'); return; }
    if (update((current) => ({ ...current, judgeConflicts: [...current.judgeConflicts, conflict] }), { type: 'conflict.import', message: 'Incompatibilidad ' + levelName(level) + ': ' + judge.name + ' · ' + targetName(conflict) + (conflict.note ? ' (' + conflict.note + ')' : '') + '.' })) {
      setTarget('');
      setNote('');
    }
  };
  const byJudge = tournament.judges.map((judge) => ({ judge, list: tournament.judgeConflicts.filter((conflict) => conflict.judgeId === judge.id) })).filter((entry) => entry.list.length);

  return <>
    <section className="panel">
      <div className="panel-title"><div><h3>Incompatibilidades de jueces</h3><p><b>Objetiva</b>: el juez solo se asigna si el debate se quedaría sin juez, y nunca como vocal. <b>Subjetiva</b>: se evita mientras haya otra opción. Compartir institución con un equipo cuenta siempre como objetiva, sin necesidad de anotarlo.</p></div></div>
      <form className="tab-inline-form" onSubmit={add}>
        <Field label="Juez"><select value={judgeId} onChange={(event) => setJudgeId(event.target.value)}><option value="">Elige…</option>{tournament.judges.map((judge) => <option key={judge.id} value={judge.id}>{judge.name}</option>)}</select></Field>
        <Field label="Con"><select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">Equipo o institución…</option>
          <optgroup label="Equipos">{tournament.teams.map((team) => <option key={team.id} value={'team:' + team.id}>{team.name}</option>)}</optgroup>
          <optgroup label="Instituciones (todos sus equipos)">{institutionRows.filter((row) => row.teams).map((row) => <option key={row.name} value={'inst:' + row.name}>{row.name}</option>)}</optgroup>
        </select></Field>
        <Field label="Tipo"><select value={level} onChange={(event) => setLevel(event.target.value as ConflictLevel)}><option value="subjective">Subjetiva (preferentemente no)</option><option value="objective">Objetiva (solo si no hay otra opción)</option></select></Field>
        <Field label="Nota"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex entrenador, familiar…" /></Field>
        <button type="submit" className="button primary"><Plus size={16} /> Añadir</button>
      </form>
      <BulkImport title="Pegar una lista de incompatibilidades" help="Una línea por incompatibilidad: juez; equipo o institución; objetiva o subjetiva; nota opcional. Los nombres se reconocen sin importar mayúsculas ni tildes; se avisa de los que no existan."
        example={'Juez;Equipo o institución;Tipo;Nota\nAna Martín;Málaga A;subjetiva;Ex entrenadora\nLuis Pérez;Universidad de Granada;objetiva;'} parse={parse} apply={applyConflictImport} update={update} notify={notify} />
    </section>
    {!byJudge.length ? <Empty text="No hay incompatibilidades anotadas (las de institución se aplican solas)." /> : <section className="panel">
      <ul className="tab-list">{byJudge.map(({ judge, list }) => <li key={judge.id} className="tab-conflict-row">
        <div><b>{judge.name}</b><small>{judge.institution || 'sin institución'}</small></div>
        <ul className="tab-conflict-list">{list.map((conflict) => <li key={conflict.id}>
          <span className={'state-pill ' + (conflict.level === 'objective' ? 'tab-invalid' : 'paused')}>{levelName(conflict.level)}</span> {targetName(conflict)}{conflict.note ? ' · ' + conflict.note : ''}
          <button type="button" className="icon-button danger-action" aria-label={'Quitar incompatibilidad de ' + judge.name + ' con ' + targetName(conflict)}
            onClick={() => update((current) => ({ ...current, judgeConflicts: current.judgeConflicts.filter((item) => item.id !== conflict.id) }), { type: 'conflict.import', message: 'Quitada la incompatibilidad ' + levelName(conflict.level) + ' de ' + judge.name + ' con ' + targetName(conflict) + '.' })}><Trash2 size={14} /></button>
        </li>)}</ul>
      </li>)}</ul>
    </section>}
    <section className="panel">
      <div className="panel-title"><div><h3>Instituciones</h3><p>Revisa que cada institución esté escrita igual en equipos y jueces: así se detectan las incompatibilidades por institución.</p></div></div>
      <IssueList items={spelling} />
      {institutionRows.length ? <div className="tournament-table-wrap"><table className="tab-institutions">
        <thead><tr><th>Institución</th><th>Equipos</th><th>Jueces</th></tr></thead>
        <tbody>{institutionRows.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.teams}</td><td>{row.judges}</td></tr>)}</tbody>
      </table></div> : <p className="muted">Todavía no hay instituciones.</p>}
    </section>
  </>;
}

function VenuesSection({ tournament, update, notify, usedVenues }: EditProps & { usedVenues: Set<string> }) {
  const [name, setName] = useState('');
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (update((current) => ({ ...current, venues: [...current.venues, { id: makeTabId('sala'), name: name.trim(), active: true }] }))) setName('');
  };
  return <>
    <section className="panel">
      <form className="tab-inline-form" onSubmit={add}>
        <Field label="Nueva sala"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Aula 1.02" /></Field>
        <button type="submit" className="button primary"><Plus size={16} /> Añadir sala</button>
      </form>
      <BulkImport title="Pegar una lista de salas" help="Una sala por línea." example={'Aula 1\nAula 2'} parse={parseVenueLines} apply={applyVenueImport} update={update} notify={notify} />
      <p className="muted">Las salas importadas desde el panel conservan su identidad, de modo que los emparejamientos se pueden enviar después a sus cronómetros.</p>
    </section>
    {!tournament.venues.length && <Empty text="Todavía no hay salas." />}
    {tournament.venues.length > 0 && <section className="panel">{tournament.venues.map((venue) => <div key={venue.id} className="tab-entity-row">
      <input className="table-input tab-name-input" aria-label="Nombre de la sala" value={venue.name} onChange={(event) => update((current) => ({ ...current, venues: current.venues.map((item) => (item.id === venue.id ? { ...item, name: event.target.value } : item)) }))} />
      <label className="check-item"><input type="checkbox" checked={venue.active} onChange={(event) => update((current) => ({ ...current, venues: current.venues.map((item) => (item.id === venue.id ? { ...item, active: event.target.checked } : item)) }))} />Disponible</label>
      <button type="button" className="icon-button danger-action" aria-label={'Borrar ' + venue.name} onClick={() => {
        if (usedVenues.has(venue.id)) { notify('La sala ya se usa en alguna ronda: márcala como no disponible.', 'error'); return; }
        update((current) => ({ ...current, venues: current.venues.filter((item) => item.id !== venue.id) }));
      }}><Trash2 size={15} /></button>
    </div>)}</section>}
  </>;
}
