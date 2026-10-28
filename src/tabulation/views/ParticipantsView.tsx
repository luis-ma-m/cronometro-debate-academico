import { useMemo, useState, type FormEvent } from 'react';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { SearchableEntityPicker } from '../../components/SearchableEntityPicker';
import { applyJudgeImport, applyTeamImport, applyVenueImport, parseJudgeLines, parseTeamLines, parseVenueLines, type ImportPreview, type ImportSummary } from '../csv';
import { makeTabId, type TabJudge, type TabTeam, type TabTournament } from '../types';
import { Empty, Field, IssueList, type ViewProps } from '../ui';

type Section = 'equipos' | 'jueces' | 'salas';

function setMutualJudgeConflicts(judges: TabJudge[], judgeId: string, ids: string[]): TabJudge[] {
  const wanted = new Set(ids.filter((id) => id !== judgeId));
  return judges.map((judge) => {
    if (judge.id === judgeId) return { ...judge, incompatibleJudgeIds: [...wanted].sort() };
    const has = judge.incompatibleJudgeIds.includes(judgeId);
    if (has === wanted.has(judge.id)) return judge;
    return { ...judge, incompatibleJudgeIds: has ? judge.incompatibleJudgeIds.filter((id) => id !== judgeId) : [...judge.incompatibleJudgeIds, judgeId].sort() };
  });
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
        update((current) => { summary = apply(current, preview.rows); return summary.tournament; });
        const result = summary as ImportSummary | null;
        notify('Importación completada: ' + (result?.added ?? 0) + ' añadidos y ' + (result?.updated ?? 0) + ' actualizados.');
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
    return {
      teams: new Set(debates.flatMap((debate) => debate.teamIds)),
      judges: new Set(debates.flatMap((debate) => [...debate.judgeIds, ...(debate.result?.ballots.map((ballot) => ballot.judgeId) ?? [])])),
      venues: new Set(debates.map((debate) => debate.venueId)),
    };
  }, [tournament.rounds]);
  const counts = { equipos: tournament.teams.length, jueces: tournament.judges.length, salas: tournament.venues.length };

  return <>
    <div className="page-heading"><div><p className="eyebrow">INSCRIPCIÓN</p><h2>Participantes</h2><p className="muted">Equipos con sus oradores, jueces con su nivel e incompatibilidades, y salas. Un juez nunca se asigna a un debate de su misma institución.</p></div></div>
    <div className="round-tabs">
      {(['equipos', 'jueces', 'salas'] as const).map((id) => <button key={id} type="button" className={section === id ? 'selected' : ''} onClick={() => setSection(id)}>
        {id === 'equipos' ? 'Equipos y oradores' : id === 'jueces' ? 'Jueces' : 'Salas'} · {counts[id]}
      </button>)}
    </div>
    <datalist id="tab-institutions">{institutions.map((name) => <option key={name} value={name} />)}</datalist>
    {section === 'equipos' && <TeamsSection tournament={tournament} update={update} notify={notify} usedTeams={used.teams} />}
    {section === 'jueces' && <JudgesSection tournament={tournament} update={update} notify={notify} usedJudges={used.judges} />}
    {section === 'salas' && <VenuesSection tournament={tournament} update={update} notify={notify} usedVenues={used.venues} />}
  </>;
}

function TeamsSection({ tournament, update, notify, usedTeams }: Pick<ViewProps, 'tournament' | 'update' | 'notify'> & { usedTeams: Set<string> }) {
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const setTeam = (id: string, patch: Partial<TabTeam>) => update((current) => ({ ...current, teams: current.teams.map((team) => (team.id === id ? { ...team, ...patch } : team)) }));
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (tournament.teams.some((team) => team.name.trim().toLocaleLowerCase('es-ES') === name.trim().toLocaleLowerCase('es-ES'))) { notify('Ya existe un equipo con ese nombre.', 'error'); return; }
    const team: TabTeam = { id: makeTabId('equipo'), name: name.trim(), institution: institution.trim(), active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [] };
    update((current) => ({ ...current, teams: [...current.teams, team] }));
    setName('');
    setExpanded(team.id);
  };
  const remove = (team: TabTeam) => {
    if (usedTeams.has(team.id)) { notify('«' + team.name + '» ya tiene debates: desactívalo en lugar de borrarlo para conservar sus resultados.', 'error'); return; }
    if (!window.confirm('¿Borrar el equipo «' + team.name + '» y sus oradores?')) return;
    update((current) => ({
      ...current,
      teams: current.teams.filter((item) => item.id !== team.id),
      speakers: current.speakers.filter((speaker) => speaker.teamId !== team.id),
      groups: current.groups.map((group) => ({ ...group, teamIds: group.teamIds.filter((id) => id !== team.id) })),
      manualOrder: current.manualOrder.filter((id) => id !== team.id),
    }));
  };
  return <>
    <section className="panel">
      <form className="tab-inline-form" onSubmit={add}>
        <Field label="Nuevo equipo"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Málaga A" /></Field>
        <Field label="Institución"><input value={institution} list="tab-institutions" onChange={(event) => setInstitution(event.target.value)} placeholder="Universidad de Málaga" /></Field>
        <button type="submit" className="button primary"><Plus size={16} /> Añadir equipo</button>
      </form>
      <BulkImport title="Pegar una lista de equipos" help="Una línea por equipo: nombre; institución; y, opcionalmente, los nombres de sus oradores. Puedes copiarla de una hoja de cálculo." example={'Equipo;Institución;Orador 1;Orador 2;Orador 3;Orador 4\nMálaga A;Universidad de Málaga;Lucía García;Hugo López;Paula Ruiz;Mario Díaz'} parse={parseTeamLines} apply={applyTeamImport} update={update} notify={notify} />
    </section>
    {!tournament.teams.length && <Empty text="Todavía no hay equipos." />}
    {tournament.teams.map((team) => {
      const speakers = tournament.speakers.filter((speaker) => speaker.teamId === team.id);
      const open = expanded === team.id;
      return <section key={team.id} className={'panel tab-entity' + (team.active ? '' : ' inactive')}>
        <div className="tab-entity-row">
          <input className="table-input tab-name-input" aria-label="Nombre del equipo" value={team.name} onChange={(event) => setTeam(team.id, { name: event.target.value })} />
          <input className="table-input" aria-label="Institución" list="tab-institutions" value={team.institution} placeholder="Institución" onChange={(event) => setTeam(team.id, { institution: event.target.value })} />
          <label className="check-item"><input type="checkbox" checked={team.active} onChange={(event) => setTeam(team.id, { active: event.target.checked })} />Activo</label>
          <label className="check-item" title="Equipo de relleno: debate pero no clasifica ni puede ganar (UC3M art. 35–36)."><input type="checkbox" checked={team.swing} onChange={(event) => setTeam(team.id, { swing: event.target.checked })} />Swing</label>
          <label className="check-item" title="Desmárcalo si el reglamento le impide pasar a eliminatorias."><input type="checkbox" checked={team.breakEligible} onChange={(event) => setTeam(team.id, { breakEligible: event.target.checked })} />Puede clasificarse</label>
          <button type="button" className="text-button" aria-expanded={open} onClick={() => setExpanded(open ? null : team.id)}>{speakers.length} oradores · {team.incompatibleJudgeIds.length} incompat. <ChevronRight size={14} className={open ? 'tab-rotated' : ''} /></button>
          <button type="button" className="icon-button danger-action" aria-label={'Borrar ' + team.name} onClick={() => remove(team)}><Trash2 size={15} /></button>
        </div>
        {open && <div className="tab-entity-details">
          <SpeakersEditor teamId={team.id} tournament={tournament} update={update} />
          <SearchableEntityPicker label={'Jueces incompatibles con ' + team.name} multiple
            options={tournament.judges.map((judge) => ({ id: judge.id, name: judge.name + (judge.institution ? ' · ' + judge.institution : ''), active: judge.active }))}
            value={team.incompatibleJudgeIds} onChange={(value) => setTeam(team.id, { incompatibleJudgeIds: value as string[] })} />
        </div>}
      </section>;
    })}
  </>;
}

function SpeakersEditor({ teamId, tournament, update }: { teamId: string; tournament: TabTournament; update: ViewProps['update'] }) {
  const [name, setName] = useState('');
  const speakers = tournament.speakers.filter((speaker) => speaker.teamId === teamId);
  const used = new Set(tournament.rounds.flatMap((round) => round.debates.flatMap((debate) => Object.values(debate.result?.lineup[teamId] ?? {}))));
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    update((current) => ({ ...current, speakers: [...current.speakers, { id: makeTabId('orador'), teamId, name: name.trim() }] }));
    setName('');
  };
  return <div className="tab-speakers">
    <h4 className="tab-subtitle">Oradores</h4>
    {speakers.map((speaker) => <div key={speaker.id} className="tab-speaker-row">
      <input className="table-input" aria-label="Nombre del orador" value={speaker.name} onChange={(event) => update((current) => ({ ...current, speakers: current.speakers.map((item) => (item.id === speaker.id ? { ...item, name: event.target.value } : item)) }))} />
      <button type="button" className="icon-button danger-action" aria-label={'Quitar ' + speaker.name} disabled={used.has(speaker.id)} title={used.has(speaker.id) ? 'Tiene intervenciones en actas' : undefined}
        onClick={() => update((current) => ({ ...current, speakers: current.speakers.filter((item) => item.id !== speaker.id) }))}><Trash2 size={14} /></button>
    </div>)}
    <form className="tab-speaker-row" onSubmit={add}>
      <input className="table-input" aria-label="Nuevo orador" placeholder="Nombre del orador" value={name} onChange={(event) => setName(event.target.value)} />
      <button type="submit" className="icon-button" aria-label="Añadir orador"><Plus size={14} /></button>
    </form>
  </div>;
}

function JudgesSection({ tournament, update, notify, usedJudges }: Pick<ViewProps, 'tournament' | 'update' | 'notify'> & { usedJudges: Set<string> }) {
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const setJudge = (id: string, patch: Partial<TabJudge>) => update((current) => ({ ...current, judges: current.judges.map((judge) => (judge.id === id ? { ...judge, ...patch } : judge)) }));
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const judge: TabJudge = { id: makeTabId('juez'), name: name.trim(), institution: institution.trim(), active: true, rating: 3, canChair: true, incompatibleJudgeIds: [], unavailableRoundIds: [] };
    update((current) => ({ ...current, judges: [...current.judges, judge] }));
    setName('');
  };
  const remove = (judge: TabJudge) => {
    if (usedJudges.has(judge.id)) { notify(judge.name + ' ya figura en debates o actas: desactívalo en lugar de borrarlo.', 'error'); return; }
    if (!window.confirm('¿Borrar a ' + judge.name + '?')) return;
    update((current) => ({
      ...current,
      judges: current.judges.filter((item) => item.id !== judge.id).map((item) => ({ ...item, incompatibleJudgeIds: item.incompatibleJudgeIds.filter((id) => id !== judge.id) })),
      teams: current.teams.map((team) => ({ ...team, incompatibleJudgeIds: team.incompatibleJudgeIds.filter((id) => id !== judge.id) })),
    }));
  };
  return <>
    <section className="panel">
      <form className="tab-inline-form" onSubmit={add}>
        <Field label="Nuevo juez"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre y apellidos" /></Field>
        <Field label="Institución"><input value={institution} list="tab-institutions" onChange={(event) => setInstitution(event.target.value)} placeholder="Universidad, club o «Independiente»" /></Field>
        <button type="submit" className="button primary"><Plus size={16} /> Añadir juez</button>
      </form>
      <BulkImport title="Pegar una lista de jueces" help="Una línea por juez: nombre; institución; nivel de 1 a 5; puede presidir (sí/no). Solo el nombre es obligatorio." example={'Juez;Institución;Nivel;Preside\nAna Martín;Independiente;5;sí'} parse={parseJudgeLines} apply={applyJudgeImport} update={update} notify={notify} />
    </section>
    {!tournament.judges.length && <Empty text="Todavía no hay jueces." />}
    {tournament.judges.map((judge) => {
      const open = expanded === judge.id;
      const teamConflicts = tournament.teams.filter((team) => team.incompatibleJudgeIds.includes(judge.id)).map((team) => team.id);
      return <section key={judge.id} className={'panel tab-entity' + (judge.active ? '' : ' inactive')}>
        <div className="tab-entity-row">
          <input className="table-input tab-name-input" aria-label="Nombre del juez" value={judge.name} onChange={(event) => setJudge(judge.id, { name: event.target.value })} />
          <input className="table-input" aria-label="Institución" list="tab-institutions" value={judge.institution} placeholder="Institución" onChange={(event) => setJudge(judge.id, { institution: event.target.value })} />
          <label className="check-item">Nivel <select value={judge.rating} onChange={(event) => setJudge(judge.id, { rating: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="check-item"><input type="checkbox" checked={judge.canChair} onChange={(event) => setJudge(judge.id, { canChair: event.target.checked })} />Puede presidir</label>
          <label className="check-item"><input type="checkbox" checked={judge.active} onChange={(event) => setJudge(judge.id, { active: event.target.checked })} />Activo</label>
          <button type="button" className="text-button" aria-expanded={open} onClick={() => setExpanded(open ? null : judge.id)}>Disponibilidad e incompatibilidades <ChevronRight size={14} className={open ? 'tab-rotated' : ''} /></button>
          <button type="button" className="icon-button danger-action" aria-label={'Borrar ' + judge.name} onClick={() => remove(judge)}><Trash2 size={15} /></button>
        </div>
        {open && <div className="tab-entity-details">
          <div>
            <h4 className="tab-subtitle">Disponible en</h4>
            {tournament.rounds.length ? <div className="check-grid">{tournament.rounds.map((round) => <label key={round.id} className="check-item">
              <input type="checkbox" checked={!judge.unavailableRoundIds.includes(round.id)} onChange={(event) => setJudge(judge.id, {
                unavailableRoundIds: event.target.checked ? judge.unavailableRoundIds.filter((id) => id !== round.id) : [...judge.unavailableRoundIds, round.id],
              })} />{round.name}
            </label>)}</div> : <p className="muted">Las rondas aparecerán aquí cuando se generen; por defecto el juez está disponible en todas.</p>}
          </div>
          <SearchableEntityPicker label="Equipos incompatibles" multiple options={tournament.teams.map((team) => ({ id: team.id, name: team.name, active: team.active }))} value={teamConflicts}
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

function VenuesSection({ tournament, update, notify, usedVenues }: Pick<ViewProps, 'tournament' | 'update' | 'notify'> & { usedVenues: Set<string> }) {
  const [name, setName] = useState('');
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    update((current) => ({ ...current, venues: [...current.venues, { id: makeTabId('sala'), name: name.trim(), active: true }] }));
    setName('');
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
