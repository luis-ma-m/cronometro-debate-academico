import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Check, CircleCheck, Copy, Send, TriangleAlert } from 'lucide-react';
import { SPEAKER_POSITIONS } from '../scoring';
import { compactActaWarnings, validateJointActa } from './acta';
import { effectivePenalties } from './penalties';
import { ADUMA_RUBRIC, presetSettings } from './presets';
import { SPEAKER_ROLES, type SpeakerRole, type TabJointActa, type TabPenalties, type TabSettings, type TabSpeaker } from './types';
import { copyText, formatNumber, parseDecimal } from './ui';
import { actaCodeMessage, decodeActaLink, whatsAppUrl, type ActaEntry, type ActaLink } from './whatsapp';
import { resolveActaShortLink } from '../api';

interface PhoneDraft {
  favor: string;
  winner: string;
  quick: boolean;
  items: Record<string, Record<string, string>>;
  quickTotals: Record<string, string>;
  writtenTotals: Record<string, string>;
  penalties: Record<string, { warnings: string; minors: string; majors: string }>;
  speakers: Record<string, Record<string, { score: string; roles: SpeakerRole[] }>>;
  notes: string;
  signedBy: string;
  sentAt: number | null;
}

const ROLE_LABELS = Object.fromEntries(SPEAKER_POSITIONS.map((position) => [position.value, position.label])) as Record<SpeakerRole, string>;
const DESCRIPTIONS = new Map(ADUMA_RUBRIC.map((item) => [item.id, item.description]));
const draftKey = (link: ActaLink) => 'ledu-acta-borrador-v1:' + link.debate;
const count = (text: string) => Math.max(0, Math.floor(parseDecimal(text) ?? 0));

function emptyDraft(link: ActaLink): PhoneDraft {
  return { favor: '', winner: '', quick: false, items: {}, quickTotals: {}, writtenTotals: {}, penalties: {}, speakers: {}, notes: '', signedBy: link.jury[0] ?? '', sentAt: null };
}

/** The draft survives closing the browser or losing the connection: it lives on the phone until it is sent. */
function loadDraft(link: ActaLink): PhoneDraft {
  try {
    const stored = JSON.parse(window.localStorage.getItem(draftKey(link)) ?? 'null') as Partial<PhoneDraft> | null;
    return stored && typeof stored === 'object' ? { ...emptyDraft(link), ...stored } : emptyDraft(link);
  } catch {
    return emptyDraft(link);
  }
}

function numbers(values: Record<string, string> | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([key, text]) => [key, parseDecimal(text)]).filter((entry): entry is [string, number] => entry[1] !== null));
}

function toEntry(link: ActaLink, draft: PhoneDraft, sentAt: number): ActaEntry {
  const elimination = link.round.elimination;
  const teamIds = link.teams.map((team) => team.id);
  const written = numbers(draft.writtenTotals);
  return {
    favor: draft.favor,
    winner: draft.winner,
    items: elimination ? {} : Object.fromEntries(teamIds.map((teamId) => [teamId, numbers(draft.items[teamId])])),
    ...(!elimination && draft.quick ? { quickTotals: numbers(draft.quickTotals) } : {}),
    ...(!elimination && Object.keys(written).length ? { writtenTotals: written } : {}),
    penalties: elimination ? {} : Object.fromEntries(teamIds.map((teamId): [string, TabPenalties] => {
      const penalty = draft.penalties[teamId];
      return [teamId, { warnings: count(penalty?.warnings ?? ''), minors: count(penalty?.minors ?? ''), majors: count(penalty?.majors ?? ''), disqualified: false }];
    })),
    speakers: elimination || !link.rules.speakerScores ? {} : Object.fromEntries(teamIds.map((teamId) => [teamId, Object.entries(draft.speakers[teamId] ?? {}).flatMap(([speakerId, row]) => {
      const score = parseDecimal(row.score);
      return score === null ? [] : [{ speakerId, score, roles: SPEAKER_ROLES.filter((role) => row.roles.includes(role)) }];
    })])),
    notes: draft.notes.trim(),
    signedBy: draft.signedBy.trim(),
    sentAt,
  };
}

/** Number of a section of the acta, replaced by a tick once the section is filled in. */
function Step({ number, done }: { number: number; done: boolean }) {
  return <span className={'acta-step' + (done ? ' done' : '')} aria-hidden="true">{done ? <Check size={14} strokeWidth={3} /> : number}</span>;
}

/** Page opened from the WhatsApp link: one debate's acta, filled on the phone and sent back by WhatsApp. */
export default function JudgeActaApp() {
  const [hash,setHash]=useState(()=>window.location.hash);
  const [parsed,setParsed]=useState<{link:ActaLink|null;error:string|null;loading:boolean}>({link:null,error:null,loading:true});
  useEffect(()=>{const onHashChange=()=>setHash(window.location.hash);window.addEventListener('hashchange',onHashChange);return()=>window.removeEventListener('hashchange',onHashChange);},[]);
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      const short=/^#S8-([0-9A-HJKMNP-TV-Z]{8})$/i.exec(hash.trim());
      if(short){setParsed({link:null,error:null,loading:true});try{const resolved=await resolveActaShortLink(short[1].toUpperCase());if(active)setParsed({link:resolved.snapshot as ActaLink,error:null,loading:false});}catch(error){if(active)setParsed({link:null,error:error instanceof Error?error.message:'No se ha podido recuperar el acta.',loading:false});}return;}
      try{setParsed({link:decodeActaLink(hash),error:null,loading:false});}catch(error){setParsed({link:null,error:error instanceof Error?error.message:'El enlace no es válido.',loading:false});}
    };
    void load();return()=>{active=false;};
  },[hash]);
  if(parsed.loading)return <main className="acta-shell"><section className="acta-card"><h1>Recuperando el acta…</h1><p>Consultando el snapshot original del enlace.</p></section></main>;
  if(!parsed.link)return <main className="acta-shell"><section className="acta-card acta-error" role="alert"><TriangleAlert size={22}/><h1>No se puede abrir el acta</h1><p>{parsed.error}</p></section></main>;
  return <JudgeActa key={parsed.link.debate} link={parsed.link}/>;
}

function JudgeActa({ link }: { link: ActaLink }) {
  const [draft, setDraft] = useState<PhoneDraft>(() => loadDraft(link));
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    try {
      window.localStorage.setItem(draftKey(link), JSON.stringify(draft));
    } catch { /* Private mode: the form still works while the page is open. */ }
  }, [draft, link]);
  useEffect(() => {
    document.title = 'Acta · ' + link.round.name + (link.venue ? ' · ' + link.venue : '');
  }, [link]);

  const elimination = link.round.elimination;
  const settings: TabSettings = useMemo(() => ({ ...presetSettings('aduma'), ...link.rules }), [link]);
  const teamName = (teamId: string) => link.teams.find((team) => team.id === teamId)?.name ?? 'Equipo';
  const ordered = draft.favor && link.teams.some((team) => team.id === draft.favor)
    ? [link.teams.find((team) => team.id === draft.favor)!, link.teams.find((team) => team.id !== draft.favor)!]
    : link.teams;
  const speakers = useMemo(() => new Map<string, TabSpeaker>(link.teams.flatMap((team) => team.members.map((member) => [member.id, { id: member.id, teamId: team.id, name: member.name }] as [string, TabSpeaker]))), [link]);
  const edit = (mutate: (current: PhoneDraft) => PhoneDraft) => setDraft((current) => ({ ...mutate(current), sentAt: null }));

  // The acta's time changes with its content only, so sending it again yields the same code.
  const content = JSON.stringify({ ...draft, sentAt: null });
  const editedAt = useMemo(() => Date.now(), [content]);
  const entry = useMemo(() => toEntry(link, draft, editedAt), [link, draft, editedAt]);
  const check = useMemo(() => {
    const acta: TabJointActa = { winnerTeamId: entry.winner, items: entry.items, ...(entry.quickTotals ? { quickTotals: entry.quickTotals } : {}), ...(entry.writtenTotals ? { writtenTotals: entry.writtenTotals } : {}), speakers: entry.speakers };
    return validateJointActa(acta, entry.penalties, { settings, teamIds: [link.teams[0].id, link.teams[1].id], speakers, elimination, teamName });
  }, [entry, settings, link, speakers, elimination]);
  const ready = !check.issues.length && !check.missing.length;
  const summary = !entry.winner ? '' : 'gana ' + teamName(entry.winner) + (elimination ? '' : ' (' + link.teams.map((team) => formatNumber(check.totals[team.id]?.net ?? null)).join(' – ') + ' ítems netos)');
  const message = actaCodeMessage(link, entry, summary);
  const sections = [...new Set(link.rules.rubric.map((item) => item.section))];

  /** Enter moves down the column of items, as on the paper. */
  const nextItem = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[data-column="' + event.currentTarget.dataset.column + '"]')];
    inputs[inputs.indexOf(event.currentTarget) + 1]?.focus();
  };
  const itemClass = (text: string) => {
    if (!text.trim()) return '';
    const value = parseDecimal(text);
    return value === null || value < settings.itemMin || value > settings.itemMax || !Number.isInteger(value * 2) ? ' tab-input-error' : '';
  };
  const filled = (text: string | undefined) => parseDecimal(text ?? '') !== null;
  const itemsDone = draft.quick
    ? link.teams.every((team) => filled(draft.quickTotals[team.id]))
    : link.teams.every((team) => link.rules.rubric.every((item) => filled(draft.items[team.id]?.[item.id]) && !itemClass(draft.items[team.id]?.[item.id] ?? '')));
  const scores = link.teams.flatMap((team) => team.members.map((member) => draft.speakers[team.id]?.[member.id]?.score));
  const scored = scores.filter(filled).length;
  const steps = [
    Boolean(draft.favor),
    ...(elimination ? [] : [itemsDone]),
    Boolean(draft.winner),
    ...(!elimination && link.rules.speakerScores ? [scores.length > 0 && scored === scores.length] : []),
  ];
  const stepsDone = steps.filter(Boolean).length;
  let stepNumber = 0;
  const step = (done: boolean) => <Step number={++stepNumber} done={done} />;

  return <main className="acta-shell">
    <header className="acta-header">
      <p className="eyebrow">{link.tournament}</p>
      <h1>{link.round.name}{link.venue ? ' · ' + link.venue : ''}</h1>
      <p className="acta-teams">{link.teams[0].name} <span>frente a</span> {link.teams[1].name}</p>
      {link.jury.length > 0 && <p className="muted">Jurado: {link.jury[0]} (principal){link.jury.length > 1 ? ', ' + link.jury.slice(1).join(', ') : ''}</p>}
    </header>

    <div className="acta-topbar">
      <div><b>{link.venue || link.round.name}</b><span>{link.teams[0].name} – {link.teams[1].name}</span></div>
      <span className={'state-pill ' + (ready ? 'ready' : check.issues.length ? 'tab-invalid' : '')}>{ready ? 'Lista para enviar' : check.issues.length ? 'Revisa los errores' : stepsDone + ' de ' + steps.length + ' apartados'}</span>
      <i style={{ width: Math.round(stepsDone * 100 / steps.length) + '%' }} />
    </div>

    <section className="acta-card">
      <h2>{step(Boolean(draft.favor))}Postura (sorteada en la sala)</h2>
      <div className="acta-options">{link.teams.map((team) => <label key={team.id} className="acta-option"><input type="radio" name="favor" checked={draft.favor === team.id} onChange={() => edit((current) => ({ ...current, favor: team.id }))} />A favor: {team.name}</label>)}</div>
    </section>

    {!elimination && <section className="acta-card">
      <h2>{step(itemsDone)}Hoja de ítems ({formatNumber(settings.itemMin)}–{formatNumber(settings.itemMax)})</h2>
      <label className="acta-option"><input type="checkbox" checked={draft.quick} onChange={(event) => edit((current) => ({ ...current, quick: event.target.checked }))} />Solo los totales (sin el detalle de ítems)</label>
      {draft.quick ? <div className="acta-pairs">{ordered.map((team) => <label key={team.id}><span>Total de {team.name}</span>
        <input inputMode="decimal" value={draft.quickTotals[team.id] ?? ''} onChange={(event) => edit((current) => ({ ...current, quickTotals: { ...current.quickTotals, [team.id]: event.target.value } }))} /></label>)}</div>
        : <div className="acta-items">
          <span />{ordered.map((team) => <b key={team.id}>{draft.favor ? (team.id === draft.favor ? 'A favor' : 'En contra') : team.name}</b>)}
          {sections.map((section) => <Fragment key={section}>
            <h3>{section}</h3>
            {link.rules.rubric.filter((item) => item.section === section).map((item) => <Fragment key={item.id}>
              <span title={DESCRIPTIONS.get(item.id)}>{item.name}{DESCRIPTIONS.get(item.id) && <small>{DESCRIPTIONS.get(item.id)}</small>}</span>
              {ordered.map((team) => <input key={team.id} className={itemClass(draft.items[team.id]?.[item.id] ?? '')} inputMode="decimal" data-column={team.id} onKeyDown={nextItem}
                aria-label={item.name + ' de ' + team.name} value={draft.items[team.id]?.[item.id] ?? ''}
                onChange={(event) => edit((current) => ({ ...current, items: { ...current.items, [team.id]: { ...current.items[team.id], [item.id]: event.target.value } } }))} />)}
            </Fragment>)}
          </Fragment>)}
          <b>Total</b>{ordered.map((team) => <b key={team.id}>{formatNumber(check.totals[team.id]?.gross ?? null)}</b>)}
        </div>}
    </section>}

    {!elimination && <section className="acta-card">
      <h2>{step(false)}Faltas <small>si las hubo</small></h2>
      {ordered.map((team) => {
        const penalty = draft.penalties[team.id] ?? { warnings: '', minors: '', majors: '' };
        const effective = effectivePenalties({ warnings: count(penalty.warnings), minors: count(penalty.minors), majors: count(penalty.majors), disqualified: false }, settings);
        const set = (field: keyof typeof penalty, value: string) => edit((current) => ({ ...current, penalties: { ...current.penalties, [team.id]: { ...penalty, [field]: value } } }));
        return <div key={team.id} className="acta-penalties">
          <b>{team.name}</b>
          <div className="acta-pairs three">
            {(['warnings', 'minors', 'majors'] as const).map((field) => <label key={field}><span>{field === 'warnings' ? 'Avisos' : field === 'minors' ? 'Leves' : 'Graves'}</span>
              <input inputMode="numeric" aria-label={(field === 'warnings' ? 'Avisos' : field === 'minors' ? 'Faltas leves' : 'Faltas graves') + ' de ' + team.name} value={penalty[field]} onChange={(event) => set(field, event.target.value)} placeholder="0" /></label>)}
          </div>
          <small className="muted">Cuentan como {effective.minors} leve(s) y {effective.majors} grave(s){effective.deduction ? ': −' + formatNumber(effective.deduction) + ' ítems' : ''}. Neto: <b>{formatNumber(check.totals[team.id]?.net ?? null)}</b></small>
          <label className="acta-inline"><span>Total escrito en el papel</span><input inputMode="decimal" value={draft.writtenTotals[team.id] ?? ''} onChange={(event) => edit((current) => ({ ...current, writtenTotals: { ...current.writtenTotals, [team.id]: event.target.value } }))} /></label>
        </div>;
      })}
    </section>}

    <section className="acta-card">
      <h2>{step(Boolean(draft.winner))}Equipo ganador (decisión del jurado)</h2>
      <div className="acta-options big">{link.teams.map((team) => <label key={team.id} className="acta-option"><input type="radio" name="winner" checked={draft.winner === team.id} onChange={() => edit((current) => ({ ...current, winner: team.id }))} />{team.name}</label>)}</div>
    </section>

    {!elimination && link.rules.speakerScores && <section className="acta-card">
      <h2>{step(scores.length > 0 && scored === scores.length)}Puntos de orador ({formatNumber(settings.speakerScoreMin)}–{formatNumber(settings.speakerScoreMax)})</h2>
      {ordered.map((team) => <div key={team.id} className="acta-speakers">
        <b>{team.name}</b>
        {team.members.map((member) => {
          const row = draft.speakers[team.id]?.[member.id] ?? { score: '', roles: [] };
          const set = (patch: Partial<typeof row>) => edit((current) => ({ ...current, speakers: { ...current.speakers, [team.id]: { ...current.speakers[team.id], [member.id]: { ...row, ...patch } } } }));
          return <div key={member.id} className="acta-speaker">
            <label className="acta-inline"><span>{member.name}</span><input inputMode="decimal" aria-label={'Nota de ' + member.name} value={row.score} onChange={(event) => set({ score: event.target.value })} /></label>
            <div className="acta-roles">{SPEAKER_ROLES.map((role) => <label key={role}><input type="checkbox" checked={row.roles.includes(role)} aria-label={ROLE_LABELS[role] + ': ' + member.name}
              onChange={(event) => set({ roles: event.target.checked ? [...row.roles, role] : row.roles.filter((item) => item !== role) })} />{ROLE_LABELS[role]}</label>)}</div>
          </div>;
        })}
      </div>)}
    </section>}

    <section className="acta-card">
      <h2>{step(false)}Notas y firma</h2>
      <textarea rows={3} aria-label="Notas del acta" value={draft.notes} placeholder="Incidencias, observaciones del jurado…" onChange={(event) => edit((current) => ({ ...current, notes: event.target.value }))} />
      <label className="acta-inline"><span>Firma (juez principal)</span><input aria-label="Firma" value={draft.signedBy} onChange={(event) => edit((current) => ({ ...current, signedBy: event.target.value }))} /></label>
    </section>

    <section className="acta-card acta-send">
      <h2>{step(ready)}Revisar y enviar</h2>
      <dl className="acta-summary">
        <div><dt>Ganador</dt><dd>{entry.winner ? teamName(entry.winner) : <em>sin declarar</em>}</dd></div>
        {!elimination && <div><dt>Ítems netos</dt><dd>{ordered.map((team) => team.name + ': ' + formatNumber(check.totals[team.id]?.net ?? null)).join(' · ')}</dd></div>}
        <div><dt>Postura</dt><dd>{draft.favor ? 'A favor: ' + teamName(draft.favor) : <em>sin marcar</em>}</dd></div>
        {!elimination && link.rules.speakerScores && <div><dt>Oradores</dt><dd>{scored === scores.length ? 'Todos con nota' : <em>{scored} de {scores.length} con nota</em>}</dd></div>}
        <div><dt>Firma</dt><dd>{draft.signedBy.trim() || <em>sin firma</em>}</dd></div>
      </dl>
      {check.issues.length > 0 && <ul className="tab-problems">{check.issues.map((issue) => <li key={issue} className="error">{issue}</li>)}</ul>}
      {check.missing.length > 0 && <ul className="tab-problems">{check.missing.map((item) => <li key={item} className="warning">{item}</li>)}</ul>}
      {ready && check.warnings.length > 0 && <ul className="tab-problems">{compactActaWarnings(check.warnings).map((item) => <li key={item} className="warning">{item}</li>)}</ul>}
      {draft.sentAt && <p className="acta-sent"><CircleCheck size={16} /> Enviada a las {new Date(draft.sentAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}. Si cambias algo, vuelve a enviarla.</p>}
      {ready
        ? <a className="button primary acta-send-button" href={whatsAppUrl(link.desk, message)} target="_blank" rel="noreferrer"
          onClick={() => setDraft((current) => ({ ...current, sentAt: Date.now() }))}><Send size={18} /> Enviar por WhatsApp</a>
        : <button type="button" className="button primary acta-send-button" disabled><Send size={18} /> Enviar por WhatsApp</button>}
      {ready && <button type="button" className="text-button" onClick={() => void copyText(message).then((ok) => setCopied(ok))}><Copy size={14} /> {copied ? 'Mensaje copiado: pégalo en el chat de la mesa' : 'Copiar el mensaje'}</button>}
      <p className="muted">El acta se guarda en este móvil hasta que la envíes. El papel firmado sigue siendo el acta oficial.</p>
    </section>
  </main>;
}
