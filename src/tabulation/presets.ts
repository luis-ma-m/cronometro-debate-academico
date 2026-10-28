import { randomSeed } from './random';
import { makeTabId, TAB_SCHEMA_VERSION, type PresetId, type TabSettings, type TabTournament } from './types';

export const PRESET_OPTIONS: Array<{ id: Exclude<PresetId, 'custom'>; label: string; description: string }> = [
  {
    id: 'ledu-groups',
    label: 'LEDU · liguilla de grupos',
    description: 'Reglamento LEDU 2024: grupos todos contra todos, cuartos, semifinales y final; actas 0–100 por juez, posturas por sorteo.',
  },
  {
    id: 'uc3m-swiss',
    label: 'Sistema suizo (tipo UC3M)',
    description: 'Cinco rondas emparejadas por clasificación (1.º–2.º, 3.º–4.º…), corte a cuartos 1v8 con semifinales re-sembradas; actas sobre 20.',
  },
];

/** Defaults taken from the LEDU 2024 regulations (arts. 26–36). */
const LEDU_SETTINGS: TabSettings = {
  presetId: 'ledu-groups',
  stage: 'groups',
  groupCount: 4,
  groupAdvance: 2,
  swissRounds: 5,
  avoidSameInstitution: true,
  breakSize: 8,
  bracketMode: 'fixed',
  qualifyingPanelSize: 3,
  eliminationPanelSize: 3,
  qualifyingSideMode: 'draw',
  scoreMin: 0,
  scoreMax: 100,
  scoresIncludePenalties: false,
  trimExtremes: true,
  speakerScores: true,
  speakerScoreMin: 0,
  speakerScoreMax: 10,
  speakerScoreStep: 0.5,
  speakerMetric: 'sum',
  warningConversion: 'ledu',
  minorPoints: 7,
  minorsPerMajor: 3,
  majorMode: 'forfeit',
  majorPoints: 0,
  forfeitLoserPoints: 25,
  forfeitWinnerPoints: 'average',
  tiebreaks: ['headToHead', 'headToHeadBallots', 'headToHeadPoints', 'pointsAverage', 'fewestPenalties'],
  tiebreakFallback: 'manual',
};

/** Defaults taken from the XVI Torneo Nacional UC3M regulations (arts. 13–41). */
const UC3M_SETTINGS: TabSettings = {
  presetId: 'uc3m-swiss',
  stage: 'swiss',
  groupCount: 4,
  groupAdvance: 2,
  swissRounds: 5,
  avoidSameInstitution: true,
  breakSize: 8,
  bracketMode: 'reseed',
  qualifyingPanelSize: 3,
  eliminationPanelSize: 3,
  qualifyingSideMode: 'balanced',
  scoreMin: 0,
  scoreMax: 20,
  scoresIncludePenalties: false,
  trimExtremes: false,
  speakerScores: true,
  speakerScoreMin: 1,
  speakerScoreMax: 5,
  speakerScoreStep: 1,
  speakerMetric: 'sum',
  warningConversion: 'pairs',
  minorPoints: 2,
  minorsPerMajor: 2,
  majorMode: 'points',
  majorPoints: 5,
  forfeitLoserPoints: 0,
  forfeitWinnerPoints: 'ballots',
  tiebreaks: ['pointsTotal', 'headToHead', 'speakerPoints', 'fewestPenalties'],
  tiebreakFallback: 'lots',
};

export function presetSettings(presetId: PresetId): TabSettings {
  const source = presetId === 'uc3m-swiss' ? UC3M_SETTINGS : LEDU_SETTINGS;
  return { ...source, tiebreaks: [...source.tiebreaks] };
}

export function createTabTournament(name: string, presetId: PresetId, now = Date.now(), seed = randomSeed()): TabTournament {
  return {
    schemaVersion: TAB_SCHEMA_VERSION,
    id: makeTabId('torneo'),
    name: name.trim() || 'Torneo sin nombre',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    seed,
    settings: presetSettings(presetId),
    teams: [],
    speakers: [],
    judges: [],
    venues: [],
    groups: [],
    rounds: [],
    breakSeeds: [],
    manualOrder: [],
  };
}
