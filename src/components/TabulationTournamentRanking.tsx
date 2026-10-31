import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Team } from '../domain';
import { normalizeTabTournament } from '../tabulation/normalize';
import { INDEX_KEY, tournamentKey } from '../tabulation/store';
import { buildGroupStandings, buildSpeakerStandings, buildTeamStandings } from '../tabulation/standings';
import { computeTournamentOutcomes, roundIsComplete } from '../tabulation/results';
import { qualifyingRounds, TIEBREAK_LABELS, type TabTournament } from '../tabulation/types';
import { formatNumber } from '../tabulation/ui';

type StorageReader = Pick<Storage, 'getItem'>;
type StoredIndex = { tournaments?: Array<{ id?: unknown; updatedAt?: unknown }> } | null;

export function readLinkedTabulationTournament(storage: StorageReader, remoteId?: string): TabTournament | null {
  if (!remoteId) return null;
  try {
    const index = JSON.parse(storage.getItem(INDEX_KEY) ?? 'null') as StoredIndex;
    const entries = Array.isArray(index?.tournaments) ? [...index.tournaments] : [];
    entries.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
    for (const entry of entries) {
      if (typeof entry.id !== 'string' || !entry.id) continue;
      try {
        const raw = storage.getItem(tournamentKey(entry.id));
        if (!raw) continue;
        const normalized = normalizeTabTournament(JSON.parse(raw));
        if (normalized.tournament.panelLink?.remoteId === remoteId) return normalized.tournament;
      } catch {
        // One damaged local tournament must not hide another valid linked tournament.
      }
    }
  } catch {
    return null;
  }
  return null;
}

function useLinkedTabulationTournament(remoteId?: string): TabTournament | null {
  const [linked, setLinked] = useState<TabTournament | null>(null);
  useEffect(() => {
    if (!remoteId) { setLinked(null); return; }
    const refresh = () => setLinked(readLinkedTabulationTournament(window.localStorage, remoteId));
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === INDEX_KEY || event.key?.startsWith('ledu-tabulacion-v1:')) refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [remoteId]);
  return linked;
}

function RankingExpand({ total, expanded, onToggle, label }: { total: number; expanded: boolean; onToggle: () => void; label: string }) {
  if (total <= 5) return null;
  return <button type="button" className="text-button ranking-expand-button" aria-expanded={expanded} onClick={onToggle}>
    {expanded ? 'Ver menos' : 'Ver más (' + (total - 5) + ' ' + label + ')'}
  </button>;
}

export function TabulationTournamentRanking({ remoteId, managerTeams, fallback }: {
  remoteId?: string;
  managerTeams: Pick<Team, 'id' | 'name'>[];
  fallback: ReactNode;
}) {
  const tournament = useLinkedTabulationTournament(remoteId);
  const [expandedTeams, setExpandedTeams] = useState<string[]>([]);
  const [expandedSpeakers, setExpandedSpeakers] = useState<string[]>([]);
  const outcomes = useMemo(() => tournament ? computeTournamentOutcomes(tournament) : new Map(), [tournament]);
  const rounds = useMemo(() => tournament ? qualifyingRounds(tournament) : [], [tournament]);
  const qualifyingFinished = Boolean(tournament && rounds.length > 0
    && rounds.every((round) => roundIsComplete(round, outcomes))
    && (tournament.settings.stage === 'groups' || rounds.length >= tournament.settings.swissRounds));
  const blindHidden = Boolean(tournament?.settings.blindQualifying && !qualifyingFinished);
  const visibleRounds = blindHidden ? [] : rounds;
  const upToRoundNumber = visibleRounds.at(-1)?.number;
  const sections = useMemo(() => {
    if (!tournament || !visibleRounds.length) return [];
    const options = { outcomes, upToRoundNumber };
    if (tournament.settings.stage === 'groups' && tournament.groups.length) {
      return buildGroupStandings(tournament, options).map(({ group, rows }) => ({ title: group.name, rows }));
    }
    return [{ title: 'Clasificación general', rows: buildTeamStandings(tournament, options) }];
  }, [tournament, outcomes, upToRoundNumber, visibleRounds.length]);
  const speakerRankings = useMemo(() => tournament && tournament.settings.speakerScores && visibleRounds.length
    ? buildSpeakerStandings(tournament, { outcomes, upToRoundNumber }) : [], [tournament, outcomes, upToRoundNumber, visibleRounds.length]);
  const managerTeamsById = useMemo(() => new Map(managerTeams.map((team) => [team.id, team.name])), [managerTeams]);
  const localToRemote = tournament?.panelLink?.idMap?.teams ?? {};
  const canonicalTeamId = (localId: string) => localToRemote[localId] ?? localId;
  const canonicalTeamName = (localId: string, fallbackName: string) => managerTeamsById.get(canonicalTeamId(localId)) ?? fallbackName;
  const unmappedTeams = tournament ? tournament.teams.filter((team) => !managerTeamsById.has(canonicalTeamId(team.id))).length : 0;
  const joint = tournament?.settings.ballotMode === 'joint';
  const columns = joint ? 7 : 8 + (tournament?.settings.speakerScores ? 1 : 0);

  if (!tournament) return <>{fallback}</>;

  const tiebreaks = tournament.settings.tiebreaks.map((key) => TIEBREAK_LABELS[key].toLowerCase());
  return <section className="panel tabulation-manager-ranking">
    <div className="panel-title"><div><h3>Clasificación de Tabulación</h3>
      <p>Motor oficial de Tabulación · revisión del Gestor {tournament.panelLink?.remoteRevision ?? '—'} · orden: victorias{tiebreaks.map((item) => ' → ' + item).join('')}</p>
    </div></div>
    <p className="muted">La clasificación se calcula desde las actas y reglas guardadas en Tabulación. Se actualiza al guardar cambios en la pestaña de Tabulación de este navegador.</p>
    {unmappedTeams > 0 && <p className="notice warning-notice">{unmappedTeams} equipo(s) de Tabulación no tienen correspondencia con entidades del Gestor. Se conservan en la clasificación local; revisa la vinculación.</p>}
    {blindHidden
      ? <div className="notice"><span>La fase clasificatoria está configurada a ciegas. La clasificación se mostrará cuando todas las rondas clasificatorias estén completas.</span></div>
      : !sections.length
        ? <p className="muted">La clasificación aparecerá cuando haya rondas clasificatorias.</p>
        : <div className={sections.length > 1 ? 'tab-standings-grid' : ''}>
          {sections.map((section) => {
            const expanded = expandedTeams.includes(section.title);
            const visible = expanded ? section.rows : section.rows.slice(0, 5);
            return <section className="panel" key={section.title}>
              <div className="panel-title"><div><h4>{section.title}</h4>
                {tournament.settings.stage === 'groups' && <p>Pasan los {tournament.settings.groupAdvance} primeros.</p>}
              </div></div>
              <div className="tournament-table-wrap tab-standings">
                <table><thead><tr><th>Pos.</th><th>Equipo</th><th>V</th><th>D</th>{joint
                  ? <><th>Ítems netos</th><th>Graves</th><th>Leves</th></>
                  : <><th>Votos</th><th>Puntos</th><th>Media</th>{tournament.settings.speakerScores && <th>Oradores</th>}<th>Faltas</th></>}
                </tr></thead><tbody>{visible.map((row) => <tr key={row.teamId}>
                  <td><strong>{row.rank}</strong>{row.tied && <span className="tab-tie" title="Empate sin resolver">=</span>}{row.decidedByLots && <span className="tab-tie" title="Desempatado por sorteo">S</span>}</td>
                  <td><b>{canonicalTeamName(row.teamId, row.name)}</b><small className="tab-cell-sub">{row.institution}</small></td>
                  <td>{row.wins}</td><td>{row.losses}</td>
                  {joint ? <><td>{formatNumber(row.points)}{row.pendingPoints > 0 && <span className="tab-tie" title="Puntos pendientes">*</span>}</td><td>{row.majors}</td><td>{row.minors}</td></>
                    : <><td>{row.ballots}</td><td>{formatNumber(row.points)}{row.pendingPoints > 0 && <span className="tab-tie" title="Puntos pendientes">*</span>}</td><td>{formatNumber(row.pointsAverage)}</td>{tournament.settings.speakerScores && <td>{formatNumber(row.speakerPoints)}</td>}<td>{row.majors}/{row.minors}/{row.warnings}</td></>}
                </tr>)}</tbody></table>
              </div>
              <RankingExpand total={section.rows.length} expanded={expanded} label="equipos" onToggle={() => setExpandedTeams((current) => expanded ? current.filter((item) => item !== section.title) : [...current, section.title])}/>
            </section>;
          })}
        </div>}
    {speakerRankings.length > 0 && <div className="speaker-ranking-grid">
      {speakerRankings.map((category) => {
        const expanded = expandedSpeakers.includes(category.key);
        const visible = expanded ? category.rows : category.rows.slice(0, 5);
        return <section className="panel speaker-ranking-panel" key={category.key}>
          <div className="panel-title"><div><h4>{category.title}</h4><p>Valor: {tournament.settings.speakerMetric === 'sum' ? 'suma' : 'media'} · puntuaciones válidas: {category.rows.length}</p></div></div>
          {category.rows.length
            ? <><div className="tournament-table-wrap"><table><thead><tr><th>Pos.</th><th>Orador</th><th>Equipo</th><th>Valor</th><th>Debates</th></tr></thead><tbody>{visible.map((row) => <tr key={row.speakerId}><td><strong>{row.rank}</strong>{row.tied && <span className="tab-tie">=</span>}</td><td>{row.name}</td><td>{canonicalTeamName(row.teamId, row.teamName)}</td><td>{formatNumber(row.value)}</td><td>{row.count}</td></tr>)}</tbody></table></div><RankingExpand total={category.rows.length} expanded={expanded} label="oradores" onToggle={() => setExpandedSpeakers((current) => expanded ? current.filter((item) => item !== category.key) : [...current, category.key])}/></>
            : <p className="muted tournament-empty">Todavía no hay puntuaciones aplicables a este ranking.</p>}
        </section>;
      })}
    </div>}
  </section>;
}
