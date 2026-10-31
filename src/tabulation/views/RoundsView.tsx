import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Check, ClipboardList, Copy, Dices, Download, FileText, Gavel, MessageCircle, MonitorPlay, MoreHorizontal, Projector, RotateCcw, Search, Send, Shuffle, Sparkles, Star, Trash2, Trophy, Undo2, X } from 'lucide-react';
import { allocateJudgesForRound, judgesConflict, teamConflicts, type RoundProblem } from '../adjudication';
import { computeBreak, tournamentChampion } from '../bracket';
import {
  applyDraftEdit, auditRound, checkRound, confirmDraft, createRoundDraft, diffRounds, draftProblems, editRound, reopenRound, undoDraftEdit, withoutDraft,
  type DraftEdit,
} from '../draft';
import { asciiSlug, latestLogStamp, roundSheet } from '../exports';
import { drawGroups, generateGroupStage, restingTeams } from '../groups';
import type { LogInput } from '../log';
import { drawSides, fallenTeamIds } from '../pairing';
import { buildOutbox, writeOutbox } from '../panelBridge';
import { hashSeed, randomSeed } from '../random';
import { cyrb53 } from '../hash';
import { roundIsComplete, type DebateOutcome } from '../results';
import { roundPdf } from '../roundPdf';
import { buildRoundZip } from '../roundZip';
import { simulateRoundResults } from '../sample';
import { eliminationRounds, qualifyingRounds, type TabDebate, type TabJudge, type TabRound, type TabRoundDraft, type TabTournament } from '../types';
import { copyText, downloadBytes, Empty, IssueList, lookups, Notice, STATUS_LABELS, type ViewProps } from '../ui';
import { actaLinkMessage, buildActaLink, whatsAppNumber, whatsAppUrl } from '../whatsapp';
import { createActaShortLink, listActaShortLinks, revokeActaShortLinks, updateActaShortLinkExpiry, type ActaShortLink } from '../../api';

const DRAFT_TAB = '__borrador__';
type Look = ReturnType<typeof lookups>;
type Compute = (current: TabTournament) => { next: TabTournament; meta: LogInput } | null;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function debateLabel(look: Look, debate: TabDebate, index: number): string {
  return (debate.venueId && look.venues.get(debate.venueId)?.name) || 'Debate ' + (index + 1);
}

/** A number from the public draw is used as is; any other text (a word, a date) is turned into a seed. */
function seedFrom(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return randomSeed();
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : hashSeed(trimmed);
}

export function RoundsView({ tournament, outcomes, update, notify, store, projection, onProject, onNavigate, managerSessionToken }: ViewProps & {
  projection: boolean;
  onProject: () => void;
  onNavigate: (view: string) => void;
}) {
  const draft = tournament.draftRound;
  const [selectedId, setSelectedId] = useState(() => (draft ? DRAFT_TAB : tournament.rounds.at(-1)?.id ?? ''));
  const [screenId, setScreenId] = useState<string | null>(null);
  const [seedText, setSeedText] = useState('');
  const [acknowledged, setAcknowledged] = useState('');
  const look = useMemo(() => lookups(tournament), [tournament]);
  const { settings } = tournament;
  const qualifying = qualifyingRounds(tournament);
  const elimination = eliminationRounds(tournament);
  const qualifyingDone = qualifying.length > 0 && qualifying.every((item) => roundIsComplete(item, outcomes))
    && (settings.stage === 'groups' || qualifying.length >= settings.swissRounds);
  const breakPreview = useMemo(() => (qualifyingDone && !elimination.length && !draft ? computeBreak(tournament, outcomes) : null), [qualifyingDone, elimination.length, draft, tournament, outcomes]);
  const champion = tournamentChampion(tournament, outcomes);
  const showDraft = selectedId === DRAFT_TAB && draft;
  const round = showDraft ? null : tournament.rounds.find((item) => item.id === selectedId) ?? tournament.rounds.at(-1) ?? null;
  const screenRound = screenId ? tournament.rounds.find((item) => item.id === screenId) ?? null : null;
  const canCreate = !draft && !champion && (settings.stage === 'swiss'
    ? (qualifying.length < settings.swissRounds && !elimination.length) || qualifyingDone
    : qualifyingDone);

  /** Computes the change on the freshest saved state and applies it with its log entry. */
  const applyLogged = (compute: Compute): boolean => {
    const current = store.getState().tournament;
    if (!current) return false;
    const first = compute(current);
    if (!first) return false;
    return update((latest) => (latest === current ? first.next : compute(latest)?.next ?? latest), first.meta);
  };

  const newRound = () => {
    const seed = seedFrom(seedText);
    const typed = seedText.trim();
    const result = createRoundDraft(tournament, seed);
    if (result.champion) { notify('El torneo ha terminado. Campeón: ' + look.teamName(result.champion) + '.'); return; }
    if (!result.draft) { notify(result.issues.join(' '), 'error'); return; }
    const created = result.draft;
    const ok = applyLogged((current) => (current.draftRound ? null : {
      next: { ...current, draftRound: created },
      meta: {
        type: 'round.draft',
        message: 'Borrador de ' + created.round.name + ' generado con la semilla ' + seed + (typed ? ' (sorteo público: «' + typed + '»)' : '') + '.',
        details: { seed, kind: created.kind, debates: created.round.debates.map((debate) => ({ teams: debate.teamIds, venue: debate.venueId, judges: debate.judgeIds, chair: debate.chairId })), warnings: result.warnings },
      },
    }));
    if (!ok) return;
    setSeedText('');
    setSelectedId(DRAFT_TAB);
    setScreenId(null);
    notify('Borrador de ' + created.round.name + ' listo: revísalo, cambia lo que haga falta y pulsa «Confirmar ronda».' + (result.warnings.length ? ' ' + result.warnings.join(' ') : ''), result.warnings.length ? 'warning' : 'success');
  };

  const exportZip = (roundId: string, automatic: boolean) => {
    const saved = store.getState().tournament;
    const target = saved?.rounds.find((item) => item.id === roundId);
    if (!saved || !target) return;
    try {
      const log = store.readLog().entries;
      const zip = buildRoundZip(saved, target, log, Date.now());
      downloadBytes(zip.filename, zip.bytes, 'application/zip');
      store.log({ type: 'round.export', message: (automatic ? 'ZIP automático' : 'ZIP') + ' de ' + target.name + ' descargado: ' + zip.filename + '.', details: { stamp: latestLogStamp(log), warnings: zip.warnings } });
      notify((automatic ? target.name + ' confirmada. ' : '') + 'Descargado ' + zip.filename + ': CSV, TXT y PDF para publicar y una copia privada del torneo con su registro.' + (zip.warnings.length ? ' ' + zip.warnings.join(' ') : ''), zip.warnings.length ? 'warning' : 'success');
    } catch (error) {
      store.logError('No se ha podido generar el ZIP de ' + target.name + ': ' + errorText(error));
      notify('No se ha podido generar el ZIP (' + errorText(error) + '). La ronda está guardada: prueba «Descargar ZIP» o exporta una copia desde la barra superior.', 'error');
    }
  };

  const exportPdf = (target: TabRound) => {
    try {
      const bytes = roundPdf(tournament, target, latestLogStamp(store.readLog().entries), Date.now());
      downloadBytes(asciiSlug(tournament.name) + '-' + asciiSlug(target.name) + '.pdf', bytes, 'application/pdf');
    } catch (error) {
      store.logError('No se ha podido generar el PDF de ' + target.name + ': ' + errorText(error));
      notify('No se ha podido generar el PDF (' + errorText(error) + '): usa el TXT o el CSV del ZIP.', 'error');
    }
  };

  const confirm = () => {
    const current = store.getState().tournament;
    const pending = current?.draftRound;
    if (!current || !pending) return;
    const check = draftProblems(current, pending);
    if (check.errors.length) { notify('El borrador tiene errores que impiden confirmarlo: ' + check.errors.join(' '), 'error'); return; }
    if (check.warnings.length && acknowledged !== check.warnings.join('|')) { notify('Revisa los avisos y marca «Confirmo bajo mi responsabilidad» para confirmar.', 'error'); return; }
    const preview = confirmDraft(current, pending.round.id);
    if (preview.errors.length) { notify(preview.errors.join(' '), 'error'); return; }
    store.backup('Antes de confirmar ' + pending.round.name);
    const manual = diffRounds(current, pending.generated, pending.round);
    const ok = applyLogged((latest) => {
      const confirmed = confirmDraft(latest, pending.round.id);
      return confirmed.errors.length || confirmed.alreadyConfirmed ? null : {
        next: confirmed.tournament,
        meta: {
          type: 'round.confirm',
          message: pending.round.name + ' confirmada ' + (manual.length ? 'con ' + manual.length + ' cambio(s) manual(es)' : 'tal como salió del sorteo') + (check.warnings.length ? '; avisos aceptados: ' + check.warnings.length : '') + '.',
          details: {
            seed: pending.seed, manualChanges: manual, acceptedWarnings: check.warnings,
            debates: pending.round.debates.map((debate) => ({ teams: debate.teamIds, venue: debate.venueId, judges: debate.judgeIds, chair: debate.chairId })),
          },
        },
      };
    });
    if (!ok) { notify('No se ha podido confirmar la ronda.', 'error'); return; }
    setAcknowledged('');
    setSelectedId(pending.round.id);
    // Only what is safely stored is exported.
    if (!store.flush() || store.getState().status !== 'saved') {
      notify('La ronda se ha confirmado, pero el navegador no la ha podido guardar: todavía no se exporta. Resuelve el aviso de guardado y pulsa «Descargar ZIP».', 'error');
      return;
    }
    exportZip(pending.round.id, true);
    setScreenId(pending.round.id);
  };

  const editDraft = (edit: DraftEdit) => applyLogged((current) => {
    const pending = current.draftRound;
    if (!pending) return null;
    const result = applyDraftEdit(current, pending, edit);
    return result.change ? { next: { ...current, draftRound: result.draft }, meta: { type: 'draft.edit', message: pending.round.name + ' (borrador) · ' + result.change } } : null;
  });

  const undo = () => applyLogged((current) => {
    const pending = current.draftRound;
    if (!pending) return null;
    const result = undoDraftEdit(current, pending);
    return result.change ? { next: { ...current, draftRound: result.draft }, meta: { type: 'draft.edit', message: pending.round.name + ' (borrador) · ' + result.change } } : null;
  });

  const discard = (pending: TabRoundDraft) => {
    if (!window.confirm('¿Descartar el borrador de ' + pending.round.name + '? Tendrás que generar la ronda de nuevo.')) return;
    if (applyLogged((current) => (current.draftRound ? { next: withoutDraft(current), meta: { type: 'draft.discard', message: 'Borrador de ' + current.draftRound.round.name + ' descartado' + (current.draftRound.editHistory.length ? ' después de cambios manuales' : '') + '.' } } : null))) {
      setSelectedId(tournament.rounds.at(-1)?.id ?? '');
      notify('Borrador descartado.');
    }
  };

  const regenerate = (pending: TabRoundDraft) => {
    if (!window.confirm('¿Volver a sortear ' + pending.round.name + '? Se pierden los cambios manuales de este borrador.')) return;
    const seed = randomSeed();
    const result = createRoundDraft(withoutDraft(tournament), seed);
    if (!result.draft) { notify(result.issues.join(' '), 'error'); return; }
    const created = result.draft;
    if (applyLogged((current) => (current.draftRound?.round.id === pending.round.id ? {
      next: { ...current, draftRound: created },
      meta: { type: 'round.draft', message: 'Borrador de ' + created.round.name + ' vuelto a sortear con la semilla ' + seed + '; se descarta el anterior.', details: { seed, debates: created.round.debates.map((debate) => debate.teamIds) } },
    } : null))) notify('Nuevo sorteo de ' + created.round.name + '.' + (result.warnings.length ? ' ' + result.warnings.join(' ') : ''), result.warnings.length ? 'warning' : 'success');
  };

  const editConfirmed = (roundId: string, edit: DraftEdit) => applyLogged((current) => {
    const target = current.rounds.find((item) => item.id === roundId);
    if (!target) return null;
    if ('debateId' in edit && target.debates.find((debate) => debate.id === edit.debateId)?.result) return null;
    const result = editRound(current, target, edit);
    return result.change ? { next: { ...current, rounds: current.rounds.map((item) => (item.id === roundId ? result.round : item)) }, meta: { type: 'round.edit', message: target.name + ' · ' + result.change } } : null;
  });

  const completeJudges = (target: TabRound) => {
    const applied = applyLogged((current) => {
      const latest = current.rounds.find((item) => item.id === target.id);
      if (!latest) return null;
      // Debates that already have an acta keep their panel.
      const allocation = allocateJudgesForRound(current, latest, { replace: false, seed: randomSeed() });
      const debates = latest.debates.map((debate) => (debate.result ? debate : allocation.debates.find((item) => item.id === debate.id) ?? debate));
      const next = { ...latest, debates };
      const changes = diffRounds(current, latest, next);
      return changes.length ? { next: { ...current, rounds: current.rounds.map((item) => (item.id === target.id ? next : item)) }, meta: { type: 'round.edit', message: target.name + ' · jueces completados automáticamente: ' + changes.join(' ') } } : null;
    });
    notify(applied ? 'Paneles completados con los jueces disponibles.' : 'No hay asientos de juez que se puedan completar.', applied ? 'success' : 'warning');
  };

  const reopen = (target: TabRound) => {
    const result = reopenRound(store.getState().tournament ?? tournament, target.id);
    if (result.errors.length) { notify(result.errors.join(' '), 'error'); return; }
    if (!window.confirm('¿Reabrir ' + target.name + ' como borrador? Podrás cambiarla y volver a confirmarla; al confirmar se descargará un ZIP nuevo que sustituye al anterior.')) return;
    store.backup('Antes de reabrir ' + target.name);
    if (applyLogged((current) => {
      const again = reopenRound(current, target.id);
      return again.errors.length ? null : { next: again.tournament, meta: { type: 'round.reopen', message: target.name + ' reabierta como borrador.' } };
    })) {
      setSelectedId(DRAFT_TAB);
      setScreenId(null);
      notify(target.name + ' vuelve a ser un borrador.' + (result.warnings.length ? ' ' + result.warnings.join(' ') : ''), result.warnings.length ? 'warning' : 'success');
    }
  };

  const removeRound = (target: TabRound) => {
    const withResults = target.debates.filter((debate) => debate.result).length;
    if (!window.confirm('¿Eliminar ' + target.name + '?' + (withResults ? ' Tiene ' + withResults + ' acta(s) que se perderán.' : '') + ' Se guardará antes una copia automática.')) return;
    store.backup('Antes de eliminar ' + target.name);
    if (update((current) => ({
      ...current,
      rounds: current.rounds.filter((item) => item.id !== target.id),
      breakSeeds: current.rounds.some((item) => item.kind === 'elimination' && item.id !== target.id) ? current.breakSeeds : [],
    }), { type: 'round.remove', message: target.name + ' eliminada' + (withResults ? ' con ' + withResults + ' acta(s)' : '') + '.' })) {
      setSelectedId('');
      setScreenId(null);
    }
  };

  const generateGroupRounds = () => {
    const result = generateGroupStage(tournament, randomSeed());
    if (result.issues.length) { notify(result.issues.join(' '), 'error'); return; }
    store.backup('Antes de generar las jornadas');
    if (update((current) => ({ ...current, rounds: [...current.rounds, ...result.rounds] }), { type: 'round.generate', message: 'Jornadas de la liguilla generadas: ' + result.rounds.map((item) => item.name).join(', ') + '.' })) {
      setSelectedId(result.rounds[0]?.id ?? '');
      notify('Jornadas generadas. Asigna ahora los jueces.' + (result.warnings.length ? ' ' + result.warnings.join(' ') : ''), result.warnings.length ? 'warning' : 'success');
    }
  };

  const drawTheGroups = () => {
    if (tournament.groups.length && !window.confirm('¿Volver a sortear los grupos?')) return;
    const teams = tournament.teams.filter((team) => team.active && !team.swing);
    if (teams.length < 2) { notify('Añade al menos dos equipos activos.', 'error'); return; }
    const seed = randomSeed();
    if (update((current) => ({ ...current, groups: drawGroups(teams, current.settings.groupCount, seed) }), { type: 'round.generate', message: 'Grupos sorteados con la semilla ' + seed + '.' })) {
      notify('Grupos sorteados. Puedes mover equipos entre grupos antes de generar las jornadas.');
    }
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
    update((current) => ({ ...current, rounds: current.rounds.map((item) => (item.id === target.id ? { ...item, pushedAt: Date.now() } : item)) }), { type: 'round.export', message: target.name + ' enviada al panel de cronómetros.' });
    notify('Emparejamientos de ' + target.name + ' listos para el panel. En el panel (en este mismo navegador) abre «Rondas y salas», elige la ronda y pulsa «Cargar desde tabulación».' + (warnings.length ? ' ' + warnings.join(' ') : ''), warnings.length ? 'warning' : 'success');
  };

  const audit = (target: TabRound) => {
    const result = auditRound(tournament, target.id);
    notify(result.reproducible
      ? 'Auditoría superada: con la semilla ' + target.seed + ' y las rondas anteriores se obtiene exactamente este emparejamiento.'
      : 'Diferencias con el sorteo de la semilla ' + target.seed + ' (cambios manuales, anotados en el registro, o actas anteriores corregidas después): ' + result.differences.join(' '), result.reproducible ? 'success' : 'warning');
  };

  return <>
    <div className={'page-heading' + (screenRound ? ' tab-no-project' : '')}><div><p className="eyebrow">SORTEO Y EMPAREJAMIENTOS</p><h2>Rondas</h2><p className="muted">{settings.stage === 'groups'
      ? 'Liguilla: se sortean los grupos y se generan todas las jornadas. Después, el cuadro cruza primeros y segundos de grupos distintos.'
      : 'Sistema suizo: «Nueva ronda» prepara un borrador con salas y jueces que puedes cambiar a mano; al confirmarlo se descarga un ZIP con la ronda en CSV, TXT y PDF y se muestra en pantalla.'}</p></div></div>

    {screenRound && <RoundScreen tournament={tournament} round={screenRound} projection={projection} onProject={onProject} onClose={() => setScreenId(null)} />}

    <div className={screenRound ? 'tab-no-project' : ''}>
      {champion && <div className="success-notice tab-champion"><Trophy size={18} /><span>Campeón del torneo: <b>{look.teamName(champion)}</b></span></div>}

      <section className="panel tab-no-project">
        <div className="panel-title"><div><h3>{settings.stage === 'groups' ? 'Liguilla de grupos' : 'Rondas'}</h3>
          <p>{settings.stage === 'groups' ? tournament.groups.length + ' grupos · pasan ' + settings.groupAdvance + ' por grupo' : qualifying.length + ' de ' + settings.swissRounds + ' rondas clasificatorias' + (settings.blindQualifying ? ' · a ciegas' : '') + (elimination.length ? ' · ' + elimination.length + ' eliminatoria(s)' : '')}</p></div>
          {draft && <button type="button" className="button primary" onClick={() => setSelectedId(DRAFT_TAB)}><Check size={16} /> Revisar el borrador de {draft.round.name}</button>}
        </div>
        {settings.stage === 'groups' && !qualifying.length && <div className="tab-actions">
          <button type="button" className="button secondary" onClick={drawTheGroups}><Dices size={16} /> {tournament.groups.length ? 'Volver a sortear' : 'Sortear grupos'}</button>
          {tournament.groups.length > 0 && <button type="button" className="button primary" onClick={generateGroupRounds}><Shuffle size={16} /> Generar jornadas</button>}
        </div>}
        {canCreate && <form className="tab-inline-form" onSubmit={(event) => { event.preventDefault(); newRound(); }}>
          <label className="tab-field"><span>Semilla del sorteo (opcional)</span><input value={seedText} onChange={(event) => setSeedText(event.target.value)} placeholder="Vacío: aleatoria" maxLength={40} /><small>Escribe el número o la palabra del sorteo público para que cualquiera pueda reproducirlo.</small></label>
          <button type="submit" className="button primary"><Shuffle size={16} /> {settings.stage === 'swiss' && qualifying.length < settings.swissRounds ? 'Nueva ronda (Ronda ' + (qualifying.length + 1) + ')' : elimination.length ? 'Nueva eliminatoria' : 'Generar eliminatorias'}</button>
        </form>}
        {settings.stage === 'groups' && <GroupsList tournament={tournament} look={look} editable={!qualifying.length} update={update} />}
      </section>

      {(qualifyingDone || elimination.length > 0) && <section className="panel tab-no-project">
        <div className="panel-title"><div><h3>Eliminatorias</h3><p>{settings.stage === 'groups' ? 'Pasan ' + settings.groupAdvance + ' por grupo' : 'Corte a ' + settings.breakSize + ' equipos'} · {settings.bracketMode === 'fixed' ? 'cuadro fijo' : 're-siembra en cada ronda'}{settings.bracketSeedOrder.length ? ' · orden ' + settings.bracketSeedOrder.join('-') : ''}</p></div></div>
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

      {!tournament.rounds.length && !draft ? <Empty text="Todavía no hay rondas." /> : <>
        <div className="round-tabs tab-no-project">
          {tournament.rounds.map((item) => {
            const fallen = fallenTeamIds(tournament.teams, item.number);
            const held = item.debates.filter((debate) => !debate.teamIds.some((id) => fallen.has(id)));
            const done = held.filter((debate) => outcomes.get(debate.id)?.status === 'complete').length;
            return <button key={item.id} type="button" className={!showDraft && item.id === round?.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>
              {item.name}<span className={'tab-tab-count' + (done === held.length ? ' ok' : '')}>{done === held.length ? '✓' : done + '/' + held.length}</span>
            </button>;
          })}
          {draft && <button type="button" className={'tab-draft-tab' + (showDraft ? ' selected' : '')} onClick={() => setSelectedId(DRAFT_TAB)}>{draft.round.name} · borrador</button>}
        </div>
        {showDraft && draft ? <DraftPanel tournament={tournament} draft={draft} look={look} acknowledged={acknowledged} onAcknowledge={setAcknowledged}
          onEdit={editDraft} onUndo={undo} onConfirm={confirm} onDiscard={() => discard(draft)} onRegenerate={() => regenerate(draft)} />
          : round && <RoundPanel tournament={tournament} round={round} outcomes={outcomes} look={look}
            isLast={round.number === Math.max(...tournament.rounds.map((item) => item.number)) && !draft}
            onEdit={(edit) => editConfirmed(round.id, edit)} onCompleteJudges={() => completeJudges(round)}
            onDrawSides={() => {
              if (!window.confirm('¿Sortear ahora las posturas que faltan? Hazlo solo si el reglamento permite sortearlas desde la organización.')) return;
              const seed = randomSeed();
              update((current) => ({ ...current, rounds: current.rounds.map((item) => (item.id === round.id ? drawSides(item, seed) : item)) }), { type: 'round.edit', message: round.name + ' · posturas sorteadas por la organización (semilla ' + seed + ').' });
            }}
            onZip={() => exportZip(round.id, false)} onPdf={() => exportPdf(round)} onScreen={() => setScreenId(round.id)} onAudit={() => audit(round)}
            onReopen={() => reopen(round)} onRemove={() => removeRound(round)} onSend={() => sendToPanel(round)} onOpenBallots={() => onNavigate('actas')}
            whatsapp={tournament.settings.ballotMode === 'joint' ? <WhatsAppLinks tournament={tournament} round={round} notify={notify} managerSessionToken={managerSessionToken} onSent={(message) => store.log({ type: 'acta.link', message })} /> : null}
            onSimulate={tournament.sample ? () => {
              const result = simulateRoundResults(tournament, round.id);
              update(() => result.tournament, { type: 'acta.save', message: 'Resultados simulados de ' + round.name + ' (torneo de ejemplo).' });
              notify(result.skipped ? result.skipped + ' debate(s) sin jueces no se han simulado.' : 'Resultados simulados para probar la herramienta.', result.skipped ? 'warning' : 'success');
            } : undefined} />}
      </>}
    </div>
  </>;
}

function GroupsList({ tournament, look, editable, update }: { tournament: TabTournament; look: Look; editable: boolean; update: ViewProps['update'] }) {
  if (!tournament.groups.length) return <p className="muted">Sortea los grupos: el sorteo equilibra los tamaños y separa a los equipos de una misma institución siempre que es posible.</p>;
  return <div className="tab-groups">{tournament.groups.map((group) => <div key={group.id} className="tab-group">
    <h4>{group.name}</h4>
    <ul>{group.teamIds.map((teamId) => <li key={teamId}>
      <span>{look.teamName(teamId)}<small>{look.teams.get(teamId)?.institution}</small></span>
      {editable && <select aria-label={'Mover ' + look.teamName(teamId)} value={group.id} onChange={(event) => update((current) => ({
        ...current,
        groups: current.groups.map((item) => ({ ...item, teamIds: item.id === event.target.value ? [...item.teamIds, teamId] : item.teamIds.filter((id) => id !== teamId) })),
      }))}>{tournament.groups.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>}
    </li>)}</ul>
  </div>)}</div>;
}

function DraftPanel({ tournament, draft, look, acknowledged, onAcknowledge, onEdit, onUndo, onConfirm, onDiscard, onRegenerate }: {
  tournament: TabTournament;
  draft: TabRoundDraft;
  look: Look;
  acknowledged: string;
  onAcknowledge: (key: string) => void;
  onEdit: (edit: DraftEdit) => void;
  onUndo: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
  onRegenerate: () => void;
}) {
  const problems = useMemo(() => draftProblems(tournament, draft), [tournament, draft]);
  const changes = useMemo(() => diffRounds(tournament, draft.generated, draft.round), [tournament, draft]);
  const warningKey = problems.warnings.join('|');
  const accepted = !problems.warnings.length || acknowledged === warningKey;
  return <section className="panel tab-round tab-draft">
    <div className="panel-title">
      <div><h3>{draft.round.name} · borrador</h3>
        <p>Semilla {draft.seed} · generado el {new Date(draft.createdAt).toLocaleString('es-ES')} · {changes.length ? changes.length + ' cambio(s) manual(es), todos anotados en el registro' : 'tal como salió del sorteo'}. Nada se publica hasta confirmar.</p></div>
    </div>
    <div className="tab-actions tab-no-project">
      <button type="button" className="button secondary" disabled={!draft.editHistory.length} onClick={onUndo}><Undo2 size={16} /> Deshacer</button>
      <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'allocate', seed: randomSeed() })}><Gavel size={16} /> Reasignar todos los jueces</button>
      <button type="button" className="button ghost" onClick={onRegenerate}><Shuffle size={16} /> Volver a sortear</button>
      <button type="button" className="button ghost danger-action" onClick={onDiscard}><Trash2 size={16} /> Descartar borrador</button>
    </div>
    <DebateTable tournament={tournament} round={draft.round} problems={problems.byDebate} look={look} onEdit={onEdit} />
    {changes.length > 0 && <details className="tab-changes"><summary>Cambios respecto al sorteo ({changes.length})</summary><ul>{changes.map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
    {(problems.errors.length > 0 || problems.warnings.length > 0) && <div className="tab-review">
      {problems.errors.length > 0 && <><h4 className="tab-review-title error">Errores que impiden confirmar ({problems.errors.length})</h4><IssueList items={problems.errors} kind="error" /></>}
      {problems.warnings.length > 0 && <><h4 className="tab-review-title">Avisos para revisar ({problems.warnings.length})</h4><IssueList items={problems.warnings} /></>}
    </div>}
    <p className="muted tab-confirm-hint">Al confirmar se guarda la ronda, se descarga el ZIP (CSV, TXT, PDF y copia privada) y se muestra en pantalla.</p>
    <div className="tab-confirm-bar">
      <div className="tab-confirm-status">
        <span className={'state-pill ' + (problems.errors.length ? 'tab-invalid' : 'ready')}>{problems.errors.length ? problems.errors.length + (problems.errors.length === 1 ? ' error' : ' errores') : 'Sin errores'}</span>
        {problems.warnings.length > 0 && <span className="state-pill paused">{problems.warnings.length + (problems.warnings.length === 1 ? ' aviso' : ' avisos')}</span>}
        {changes.length > 0 && <span className="state-pill">{changes.length + (changes.length === 1 ? ' cambio manual' : ' cambios manuales')}</span>}
      </div>
      {problems.warnings.length > 0 && <label className="check-item tab-acknowledge"><input type="checkbox" checked={accepted} onChange={(event) => onAcknowledge(event.target.checked ? warningKey : '')} />Confirmo bajo mi responsabilidad: he revisado los {problems.warnings.length} aviso(s)</label>}
      <button type="button" className="button primary tab-big-button" disabled={problems.errors.length > 0 || !accepted} onClick={onConfirm}><Check size={18} /> Confirmar ronda</button>
    </div>
  </section>;
}

function RoundPanel({ tournament, round, outcomes, look, isLast, onEdit, onCompleteJudges, onDrawSides, onZip, onPdf, onScreen, onAudit, onReopen, onRemove, onSend, onOpenBallots, onSimulate, whatsapp }: {
  tournament: TabTournament;
  round: TabRound;
  outcomes: Map<string, DebateOutcome>;
  look: Look;
  isLast: boolean;
  onEdit: (edit: DraftEdit) => void;
  onCompleteJudges: () => void;
  onDrawSides: () => void;
  onZip: () => void;
  onPdf: () => void;
  onScreen: () => void;
  onAudit: () => void;
  onReopen: () => void;
  onRemove: () => void;
  onSend: () => void;
  onOpenBallots: () => void;
  onSimulate?: () => void;
  whatsapp: ReactNode;
}) {
  const check = useMemo(() => checkRound(tournament, round), [tournament, round]);
  const resting = round.kind === 'qualifying' && tournament.settings.stage === 'groups' ? restingTeams(tournament, round) : [];
  const missingSides = round.debates.filter((debate) => !debate.favorTeamId).length;
  const withActas = round.debates.filter((debate) => debate.result).length;
  return <section className="panel tab-round">
    <div className="panel-title">
      <div><h3>{round.name}</h3><p>{round.kind === 'elimination' ? 'Eliminatoria' : 'Clasificatoria'}{round.silent ? ' · a ciegas' : ''} · semilla {round.seed} · {round.sideMode === 'draw' ? 'posturas por sorteo en sala' : 'posturas fijadas por la tabulación'}{round.pushedAt ? ' · enviada al panel el ' + new Date(round.pushedAt).toLocaleString('es-ES') : ''}</p></div>
    </div>
    <div className="tab-toolbar tab-no-project">
      <div className="tab-toolbar-group">
        <button type="button" className="button primary" onClick={onScreen}><MonitorPlay size={16} /> Ver en pantalla</button>
        <button type="button" className="button secondary" onClick={onZip}><Download size={16} /> Descargar ZIP</button>
        <button type="button" className="button secondary" onClick={onPdf}><FileText size={16} /> PDF público</button>
      </div>
      <div className="tab-toolbar-group">
        <button type="button" className="button secondary" onClick={onOpenBallots}><ClipboardList size={16} /> Ir a las actas</button>
        <button type="button" className="button secondary" onClick={onCompleteJudges}><Gavel size={16} /> Completar jueces</button>
        {onSimulate && <button type="button" className="button ghost" onClick={onSimulate}><Sparkles size={16} /> Simular resultados</button>}
      </div>
      <details className="tab-menu">
        <summary className="button ghost"><MoreHorizontal size={16} /> Más acciones</summary>
        <div className="tab-menu-list" onClick={closeMenu}>
          {round.sideMode === 'draw' && missingSides > 0 && tournament.settings.ballotMode === 'judges' && <button type="button" onClick={onDrawSides}><Dices size={15} /> Sortear las posturas que faltan</button>}
          <button type="button" onClick={onSend}><Send size={15} /> Enviar al panel de cronómetros</button>
          <button type="button" onClick={onAudit}><Search size={15} /> Auditar el sorteo</button>
          {isLast && !withActas && <button type="button" onClick={onReopen}><RotateCcw size={15} /> Reabrir como borrador</button>}
          {isLast && <><hr /><button type="button" className="danger-action" onClick={onRemove}><Trash2 size={15} /> Eliminar la ronda</button></>}
        </div>
      </details>
    </div>
    <IssueList items={check.errors} kind="error" />
    {whatsapp}
    <DebateTable tournament={tournament} round={round} problems={check.byDebate} look={look} outcomes={outcomes} onEdit={onEdit} />
    {check.warnings.length > 0 && <details className="tab-changes tab-no-project"><summary>Avisos de esta ronda ({check.warnings.length})</summary><IssueList items={check.warnings} /></details>}
    {resting.length > 0 && <p className="muted">Descansan en esta jornada: {resting.map(look.teamName).join(', ')}.</p>}
    {withActas > 0 && <p className="muted tab-no-project">Los debates con acta no se pueden cambiar desde aquí: corrige su jurado en Actas.</p>}
  </section>;
}

/** Closes a «Más acciones» menu once one of its actions is chosen. */
function closeMenu(event: MouseEvent<HTMLDivElement>) {
  if ((event.target as HTMLElement).closest('button')) (event.currentTarget.parentElement as HTMLDetailsElement).open = false;
}

/** Editable table of a draft or a confirmed round: choosing a team or judge already placed elsewhere swaps them. */
function DebateTable({ tournament, round, problems, look, outcomes, onEdit }: {
  tournament: TabTournament;
  round: TabRound;
  problems: Map<string, RoundProblem[]>;
  look: Look;
  outcomes?: Map<string, DebateOutcome>;
  onEdit: (edit: DraftEdit) => void;
}) {
  const fallen = useMemo(() => fallenTeamIds(tournament.teams, round.number), [tournament.teams, round.number]);
  const venues = tournament.venues.filter((venue) => venue.active || round.debates.some((debate) => debate.venueId === venue.id));
  const teams = useMemo(() => [...tournament.teams].filter((team) => team.active || round.debates.some((debate) => debate.teamIds.includes(team.id)))
    .sort((x, y) => x.name.localeCompare(y.name, 'es')), [tournament.teams, round.debates]);
  const judges = useMemo(() => [...tournament.judges].sort((x, y) => x.name.localeCompare(y.name, 'es')), [tournament.judges]);
  const places = useMemo(() => {
    const team = new Map<string, string>();
    const judge = new Map<string, string>();
    round.debates.forEach((debate, index) => {
      debate.teamIds.forEach((id) => team.set(id, debateLabel(look, debate, index)));
      debate.judgeIds.forEach((id) => judge.set(id, debateLabel(look, debate, index)));
    });
    return { team, judge };
  }, [round.debates, look]);
  const listed = tournament.judgeConflicts ?? [];

  const judgeNotes = (judge: TabJudge, debate: TabDebate): string => {
    const notes: string[] = [];
    for (const teamId of debate.teamIds) {
      const team = look.teams.get(teamId);
      if (team) for (const conflict of teamConflicts(judge, team, listed)) notes.push('incomp. ' + (conflict.level === 'objective' ? 'objetiva' : 'subjetiva') + ' (' + conflict.reason + ')');
    }
    if (debate.judgeIds.some((id) => { const other = look.judges.get(id); return other && other.id !== judge.id ? judgesConflict(judge, other) : false; })) notes.push('incompatible con el panel');
    const place = places.judge.get(judge.id);
    if (place && !debate.judgeIds.includes(judge.id)) notes.push('en ' + place + ', se intercambian');
    if (!judge.active) notes.push('no disponible');
    return notes.length ? ' — ' + notes.join('; ') : '';
  };

  return <div className="tournament-table-wrap tab-draw">
    <table>
      <thead><tr><th>Sala</th><th>Equipo 1</th><th>Equipo 2</th><th>Postura</th><th>Jurado (★ principal)</th>{outcomes && <th className="tab-no-print">Acta</th>}</tr></thead>
      <tbody>{round.debates.map((debate, index) => {
        const debateProblems = problems.get(debate.id) ?? [];
        const notHeld = debate.teamIds.some((id) => fallen.has(id));
        const locked = Boolean(debate.result);
        const lockTitle = locked ? 'Tiene acta: corrige el jurado en Actas' : undefined;
        const status = outcomes ? STATUS_LABELS[outcomes.get(debate.id)?.status ?? 'empty'] : null;
        return [<tr key={debate.id} className={debateProblems.some((problem) => problem.severity === 'error') ? 'tab-row-issue' : notHeld ? 'tab-row-muted' : ''}>
          <td>{notHeld && !debate.venueId ? <span className="muted">No se disputa</span> : <>
            <select className="tab-cell-select" aria-label="Sala" value={debate.venueId} disabled={locked} title={lockTitle} onChange={(event) => onEdit({ kind: 'venue', debateId: debate.id, venueId: event.target.value })}>
              <option value="">Sin sala</option>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}{round.debates.some((other) => other.id !== debate.id && other.venueId === venue.id) ? ' (se intercambia)' : ''}</option>)}
            </select>
            <span className="tab-print-only">{look.venueName(debate.venueId)}</span>
          </>}</td>
          {([0, 1] as const).map((slot) => <td key={slot}>
            <select className="tab-cell-select" aria-label={'Equipo ' + (slot + 1) + ' de ' + debateLabel(look, debate, index)} value={debate.teamIds[slot]} disabled={locked} title={lockTitle ?? look.teamName(debate.teamIds[slot])} onChange={(event) => onEdit({ kind: 'team', debateId: debate.id, slot, teamId: event.target.value })}>
              {!look.teams.has(debate.teamIds[slot]) && <option value={debate.teamIds[slot]}>{look.teamName(debate.teamIds[slot])}</option>}
              {teams.map((team) => {
                const place = places.team.get(team.id);
                const note = [fallen.has(team.id) ? 'caído' : '', place && !debate.teamIds.includes(team.id) ? 'en ' + place + ', se intercambian' : '', !place ? 'sin debate' : ''].filter(Boolean).join('; ');
                return <option key={team.id} value={team.id}>{team.name}{note ? ' — ' + note : ''}</option>;
              })}
            </select>
            <span className="tab-print-only">{look.teamName(debate.teamIds[slot])}</span>
          </td>)}
          <td>{notHeld ? '—' : <>
            <select className="tab-cell-select" aria-label="Equipo a favor" value={debate.favorTeamId ?? ''} disabled={locked} title={lockTitle} onChange={(event) => onEdit({ kind: 'side', debateId: debate.id, favorTeamId: event.target.value })}>
              <option value="">{round.sideMode === 'draw' ? 'Sorteo en sala' : 'Por decidir'}</option>
              {debate.teamIds.filter(Boolean).map((teamId) => <option key={teamId} value={teamId}>A favor: {look.teamName(teamId)}</option>)}
            </select>
            <span className="tab-print-only">{debate.favorTeamId ? 'A favor: ' + look.teamName(debate.favorTeamId) : 'Sorteo en sala'}</span>
          </>}</td>
          <td>{notHeld && !debate.judgeIds.length ? <span className="muted">Sin jurado: {debate.teamIds.filter((id) => fallen.has(id)).map(look.teamName).join(' y ')} {debate.teamIds.filter((id) => fallen.has(id)).length > 1 ? 'están caídos' : 'está caído'}</span> :
            <div className="tab-judges">
              {debate.judgeIds.map((judgeId, seat) => <span key={judgeId} className={'tab-judge-chip' + (judgeId === debate.chairId ? ' chair' : '')}>
                <button type="button" className="tab-chip-star tab-no-print" disabled={locked} title="Marcar como juez principal" aria-label={'Marcar a ' + look.judgeName(judgeId) + ' como juez principal'} onClick={() => onEdit({ kind: 'chair', debateId: debate.id, judgeId })}><Star size={12} /></button>
                {judgeId === debate.chairId && <span className="tab-print-only">★ </span>}
                <select className="tab-chip-select" aria-label={'Sustituir a ' + look.judgeName(judgeId)} value={judgeId} disabled={locked} title={lockTitle ?? look.judgeName(judgeId)} onChange={(event) => onEdit({ kind: 'judge', debateId: debate.id, seat, judgeId: event.target.value })}>
                  <option value={judgeId}>{look.judgeName(judgeId)}</option>
                  {judges.filter((judge) => !debate.judgeIds.includes(judge.id)).map((judge) => <option key={judge.id} value={judge.id}>{judge.name}{judgeNotes(judge, debate)}</option>)}
                </select>
                <span className="tab-print-only">{look.judgeName(judgeId)}</span>
                <button type="button" className="tab-chip-remove tab-no-print" disabled={locked} aria-label={'Quitar a ' + look.judgeName(judgeId)} onClick={() => onEdit({ kind: 'judge', debateId: debate.id, seat, judgeId: '' })}><X size={12} /></button>
              </span>)}
              {!locked && <select className="tab-cell-select tab-add-judge tab-no-print" aria-label={'Añadir juez en ' + debateLabel(look, debate, index)} value="" onChange={(event) => {
                if (event.target.value) onEdit({ kind: 'judge', debateId: debate.id, seat: debate.judgeIds.length, judgeId: event.target.value });
              }}>
                <option value="">+ Añadir juez…</option>
                {judges.filter((judge) => !debate.judgeIds.includes(judge.id)).map((judge) => <option key={judge.id} value={judge.id}>{judge.name}{judgeNotes(judge, debate)}</option>)}
              </select>}
            </div>}</td>
          {status && <td className="tab-no-print"><span className={'state-pill ' + status.className}>{notHeld ? 'Sin acta (caído)' : status.label}</span></td>}
        </tr>,
        debateProblems.length > 0 && <tr key={debate.id + '-problems'} className="tab-problem-row tab-no-project tab-no-print"><td colSpan={outcomes ? 6 : 5}>
          <ul className="tab-problems">{debateProblems.map((problem) => <li key={problem.message} className={problem.severity}>{problem.message}</li>)}</ul>
        </td></tr>];
      })}</tbody>
    </table>
  </div>;
}

/** Short links are the online default; the compact A2 snapshot is the offline fallback. */
function WhatsAppLinks({ tournament, round, notify, onSent, managerSessionToken }: {
  tournament: TabTournament; round: TabRound; notify: ViewProps['notify']; onSent: (message: string) => void; managerSessionToken?: string;
}) {
  const baseUrl = (tournament.whatsapp?.baseUrl.trim() || window.location.origin).replace(/\/+$/, '');
  const unreachable = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(baseUrl);
  const desk = whatsAppNumber(tournament.whatsapp?.deskPhone ?? '');
  const [expiryDays, setExpiryDays] = useState(30);
  const [links, setLinks] = useState<ActaShortLink[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expiryDrafts, setExpiryDrafts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [fallbackKeys, setFallbackKeys] = useState<Record<string, string>>({});
  const [refreshError, setRefreshError] = useState('');
  const rows = useMemo(() => {
    const fallen = fallenTeamIds(tournament.teams, round.number);
    const judges = new Map(tournament.judges.map((judge) => [judge.id, judge]));
    return round.debates.filter((debate) => !debate.teamIds.some((id) => fallen.has(id))).map((debate) => {
      const { url, link } = buildActaLink(tournament, round, debate, baseUrl);
      const phone = whatsAppNumber(judges.get(debate.chairId)?.phone ?? '');
      const label = (link.venue || 'Debate') + ' (' + link.teams.map((team) => team.name).join(' – ') + ')';
      return { debate, fallbackUrl: url, link, phone, label };
    });
  }, [tournament, round, baseUrl]);
  const refreshLinks = async () => {
    if (!managerSessionToken) return;
    try { setLinks(await listActaShortLinks(managerSessionToken, tournament.id)); setRefreshError(''); }
    catch (error) { setRefreshError(errorText(error)); }
  };
  useEffect(() => { void refreshLinks(); }, [managerSessionToken, tournament.id]);
  const getUrl = async (row: typeof rows[number]): Promise<{ url: string; online: boolean }> => {
    if (!managerSessionToken || unreachable) return { url: row.fallbackUrl, online: false };
    const snapshotKey = cyrb53(JSON.stringify(row.link));
    const keyName = 'acta-short-link-idem:' + tournament.id + ':' + row.debate.id + ':' + snapshotKey;
    const getKey = () => {
      let key = fallbackKeys[keyName] ?? '';
      try { key = window.localStorage.getItem(keyName) ?? key; } catch { /* storage may be disabled */ }
      if (!key) key = 'acta_' + snapshotKey + '_' + row.link.debate;
      try { window.localStorage.setItem(keyName, key); } catch { /* deterministic key still makes retries idempotent */ }
      return key;
    };
    try {
      let result = await createActaShortLink(managerSessionToken, tournament.id, row.debate.id, row.link, expiryDays, getKey());
      if (result.revokedAt || (result.expiresAt !== null && result.expiresAt <= Date.now())) {
        const rotated = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'retry_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
        setFallbackKeys((current) => ({ ...current, [keyName]: rotated }));
        try { window.localStorage.setItem(keyName, rotated); } catch { /* in-memory key remains stable for this tab */ }
        result = await createActaShortLink(managerSessionToken, tournament.id, row.debate.id, row.link, expiryDays, rotated);
      }
      setLinks((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      return { url: baseUrl + '/acta#S8-' + result.id, online: true };
    } catch (error) {
      notify('No se pudo crear el enlace corto (' + errorText(error) + '). Se utilizará A2 autocontenido, que no necesita backend para abrirse.', 'warning');
      return { url: row.fallbackUrl, online: false };
    }
  };
  const openWhatsApp = async (row: typeof rows[number]) => {
    const popup = window.open('about:blank', '_blank');
    const target = await getUrl(row);
    const message = actaLinkMessage(row.link, target.url);
    const href = whatsAppUrl(row.phone, message);
    if (popup) popup.location.href = href;
    else { notify('El navegador ha bloqueado WhatsApp. Se ha copiado el mensaje si el portapapeles está disponible.', 'warning'); await copyText(message); }
    onSent(round.name + ' · enlace ' + (target.online ? 'corto' : 'A2 offline') + ' del acta de ' + row.label + ' preparado para WhatsApp' + (row.phone ? ' al +' + row.phone : '') + '.');
    if (target.online) void refreshLinks();
  };
  const openActa = async (row: typeof rows[number]) => {
    const popup = window.open('about:blank', '_blank');
    const target = await getUrl(row);
    if (popup) popup.location.href = target.url;
    else window.location.href = target.url;
    if (target.online) void refreshLinks();
  };
  const copyGroup = async () => {
    setBusy(true);
    try {
      const generated = await Promise.all(rows.map(async (row) => {
        const target = await getUrl(row);
        return row.label + (row.link.jury[0] ? ' · ' + row.link.jury[0] : '') + '\n' + target.url;
      }));
      const message = 'Actas de ' + round.name + ' · ' + tournament.name + '. Cada juez principal abre el enlace de su sala, rellena el acta y la envía por WhatsApp a la mesa:\n\n' + generated.join('\n\n');
      const copied = await copyText(message);
      notify(copied ? 'Enlaces copiados: enlaces cortos cuando el backend responde y A2 solo como contingencia.' : 'No se han podido copiar los enlaces.', copied ? 'success' : 'error');
      if (managerSessionToken) void refreshLinks();
    } finally { setBusy(false); }
  };
  const revoke = async (ids: string[], all = false) => {
    const affectedCount = all ? revocableLinks.length : ids.length;
    if (!managerSessionToken || !window.confirm(all
      ? '¿Revocar todos los enlaces de este torneo? Se revocarán ' + affectedCount + ' enlaces. Las actas fuente no se eliminarán.'
      : '¿Revocar ' + affectedCount + ' enlace(s)? Las actas fuente no se eliminarán.')) return;
    setBusy(true);
    try {
      const result = await revokeActaShortLinks(managerSessionToken, tournament.id, ids, all, 'Revocado desde la gestión de enlaces de WhatsApp');
      const affected = links.filter((item) => result.ids.includes(item.id));
      for (const item of affected) {
        const row = rows.find((candidate) => candidate.debate.id === item.debateId);
        if (row) {
          const keyName = 'acta-short-link-idem:' + tournament.id + ':' + row.debate.id + ':' + cyrb53(JSON.stringify(row.link));
          const rotated = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'retry_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
          setFallbackKeys((current) => ({ ...current, [keyName]: rotated }));
          try { window.localStorage.setItem(keyName, rotated); } catch { /* in-memory key remains stable for this tab */ }
        }
      }
      setSelectedIds([]);
      notify('Se han revocado ' + result.revoked + ' enlace(s). Los enlaces ya enviados dejarán de resolverse.', 'success');
      await refreshLinks();
    } catch (error) { notify('No se pudieron revocar los enlaces: ' + errorText(error), 'error'); }
    finally { setBusy(false); }
  };
  const updateExpiry = async (item: ActaShortLink) => {
    if (!managerSessionToken) return;
    setBusy(true);
    try {
      await updateActaShortLinkExpiry(managerSessionToken, tournament.id, item.id, expiryDrafts[item.id] ?? 30);
      notify('Caducidad actualizada para ' + item.id + '.', 'success');
      await refreshLinks();
    } catch (error) { notify('No se pudo actualizar la caducidad: ' + errorText(error), 'error'); }
    finally { setBusy(false); }
  };
  const revocableLinks = links.filter((item) => !item.revokedAt);
  return <details className="tab-whatsapp tab-no-project">
    <summary><MessageCircle size={16} /> Actas por WhatsApp · enlaces cortos de 8 caracteres</summary>
    {unreachable && <Notice kind="warning">Los móviles no pueden abrir {baseUrl}: configura una dirección pública.</Notice>}
    <p className="muted">Con backend y sesión activa se crea un enlace corto de ocho caracteres que guarda el snapshot completo en Neon. Si no hay conexión, se genera el formato A2 autocontenido. Los enlaces cortos necesitan backend para resolverse; A2 puede abrirse sin conexión. El juez enviará el acta por WhatsApp {desk ? 'al +' + desk : 'al chat que elija (configura el móvil de mesa en Reglas)'}.</p>
    <label className="tab-field"><span>Caducidad de los nuevos enlaces</span><select value={expiryDays} onChange={(event) => setExpiryDays(Number(event.target.value))}><option value={1}>1 día</option><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option><option value={365}>365 días</option></select></label>
    {!managerSessionToken && <Notice kind="info">Inicia sesión en el panel de organización para crear y administrar enlaces cortos. Mientras tanto se utilizará A2 offline.</Notice>}
    {refreshError && <Notice kind="warning">No se ha podido cargar el inventario de enlaces: {refreshError}</Notice>}
    <div className="tournament-table-wrap"><table>
      <thead><tr><th>Sala</th><th>Debate</th><th>Juez principal</th><th>Enlace</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.debate.id}>
        <td>{row.link.venue || '—'}</td><td>{row.link.teams[0].name} – {row.link.teams[1].name}</td>
        <td>{row.link.jury[0] ?? 'sin juez'}<small className="tab-cell-sub">{row.phone ? '+' + row.phone : 'sin móvil: WhatsApp pedirá el chat'}</small></td>
        <td className="tab-whatsapp-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => void openWhatsApp(row)}><Send size={14} /> Enviar enlace</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => void openActa(row)}>Abrir el acta</button>
        </td>
      </tr>)}</tbody>
    </table></div>
    <button type="button" className="button ghost" disabled={busy} onClick={() => void copyGroup()}><Copy size={16} /> Copiar todos los enlaces para el grupo de jueces</button>
    {managerSessionToken && <section className="tab-panel" aria-label="Gestión de enlaces cortos">
      <h4>Enlaces cortos de este torneo ({links.length})</h4>
      <p className="muted">La revocación impide nuevas consultas del enlace, pero no elimina las actas ni los mensajes ya recibidos.</p>
      <div className="tab-actions">
        <button type="button" className="button secondary" disabled={busy || !selectedIds.length} onClick={() => void revoke(selectedIds)}>Revocar seleccionados ({selectedIds.length})</button>
        <button type="button" className="button ghost danger-action" disabled={busy || !revocableLinks.length} onClick={() => void revoke([], true)}>Revocar todos los enlaces no revocados</button>
      </div>
      {links.length === 0 ? <p className="muted">Todavía no se han creado enlaces cortos.</p> : <ul className="tab-list">
        {links.map((item) => {
          const expired = item.expiresAt !== null && item.expiresAt <= Date.now();
          const revoked = Boolean(item.revokedAt);
          return <li key={item.id}>
            <label><input type="checkbox" checked={selectedIds.includes(item.id)} disabled={revoked} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /> <code>{item.id}</code> · {item.debateId}</label>
            <small>{revoked ? 'Revocado' : expired ? 'Caducado' : 'Activo'} · caduca {item.expiresAt ? new Date(item.expiresAt).toLocaleString('es-ES') : 'nunca'}</small>
            {item.events?.length ? <details><summary>Historial ({item.events.length})</summary><ul>{item.events.map((event, index) => <li key={index}>{event.eventType === 'created' ? 'Creado' : event.eventType === 'expiry_updated' ? 'Caducidad modificada' : 'Revocado'} · {new Date(event.occurredAt).toLocaleString('es-ES')} · {event.actor}{typeof event.details?.reason === 'string' ? ' · ' + event.details.reason : ''}</li>)}</ul></details> : null}
            {!revoked && <div className="tab-actions">
              <select aria-label={'Nueva caducidad para ' + item.id} value={expiryDrafts[item.id] ?? ''} onChange={(event) => setExpiryDrafts((current) => ({ ...current, [item.id]: Number(event.target.value) }))}>
                <option value="" disabled>Selecciona caducidad</option><option value={1}>1 día</option><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option><option value={365}>365 días</option>
              </select>
              <button type="button" className="text-button" disabled={busy || expiryDrafts[item.id] === undefined} onClick={() => void updateExpiry(item)}>Actualizar caducidad</button>
              <button type="button" className="text-button danger-action" disabled={busy} onClick={() => void revoke([item.id])}>Revocar</button>
            </div>}
          </li>;
        })}
      </ul>}
    </section>}
  </details>;
}

/** Large view of a confirmed round to project: rooms in natural order, teams and jury, never results. */
function RoundScreen({ tournament, round, projection, onProject, onClose }: { tournament: TabTournament; round: TabRound; projection: boolean; onProject: () => void; onClose: () => void }) {
  const sheet = useMemo(() => roundSheet(tournament, round), [tournament, round]);
  return <section className="panel tab-round-screen">
    <div className="panel-title">
      <div><h3>{round.name}</h3><p>{tournament.name}</p></div>
      <div className="tab-actions tab-no-project">
        {!projection && <button type="button" className="button primary" onClick={onProject}><Projector size={16} /> Proyectar</button>}
        <button type="button" className="button secondary" onClick={onClose}><X size={16} /> Cerrar</button>
      </div>
    </div>
    <div className="tab-screen-grid">{sheet.rows.map((row, index) => <article key={index} className={'tab-screen-card' + (row.note.startsWith('No se disputa') ? ' not-held' : '')}>
      <h4>{row.venue || '—'}</h4>
      <p className="tab-screen-teams"><b>{row.teams[0]}</b><span>frente a</span><b>{row.teams[1]}</b></p>
      {row.side && <p className="tab-screen-side">{row.side}</p>}
      {row.chair && <p className="tab-screen-judges">Jurado: {row.chair} (principal){row.wings.length ? ', ' + row.wings.join(', ') : ''}</p>}
      {row.note && <p className="tab-screen-note">{row.note}</p>}
    </article>)}</div>
  </section>;
}
