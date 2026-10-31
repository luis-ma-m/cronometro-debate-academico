import { randomSeed } from './random.js';
import { makeTabId, TAB_SCHEMA_VERSION, type PresetId, type TabRubricItem, type TabSettings, type TabTournament } from './types.js';

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
  {
    id: 'aduma',
    label: 'V Torneo Nacional ADUMA',
    description: 'Cuatro rondas suizas a ciegas, acta conjunta con 11 ítems (0–5), cuartos 1.º–8.º… y semifinales según el art. 31.',
  },
];

export const ADUMA_DEFAULT_NAME = 'V Torneo Nacional ADUMA · 10.º aniversario';

/** Item sheet of the ADUMA regulations (annex, "Hoja de ítems"). */
export const ADUMA_RUBRIC: TabRubricItem[] = [
  { id: 'coherencia', name: 'Coherencia', section: 'Fondo', description: '¿Ha tenido sentido lógico y coherente el discurso?' },
  { id: 'veracidad', name: 'Veracidad', section: 'Fondo', description: '¿Se ajustan los argumentos a la materia de debate?' },
  { id: 'evidencias', name: 'Evidencias', section: 'Fondo', description: '¿Son las evidencias de autoridades importantes en la materia?' },
  { id: 'preguntas', name: 'Preguntas', section: 'Fondo', description: '¿Ha usado sus preguntas y respondido las del rival de forma adecuada?' },
  { id: 'tesis', name: 'Tesis y argumentos', section: 'Estructura', description: '¿Ha presentado claramente la tesis y los argumentos?' },
  { id: 'presentacion', name: 'Presentación de evidencias', section: 'Estructura', description: '¿Se han presentado las evidencias adecuadamente?' },
  { id: 'refutacion', name: 'Refutación', section: 'Estructura', description: '¿Hace refutaciones pertinentes y de manera clara y contundente?' },
  { id: 'exordios', name: 'Exordios e impactos', section: 'Estructura', description: 'Los exordios, ¿han llamado la atención? ¿Se han impactado adecuadamente los argumentos?' },
  { id: 'equilibrio', name: 'Equilibrio de equipo', section: 'Forma', description: '¿Hay equilibrio entre los miembros del equipo y demuestran cohesión?' },
  { id: 'noverbal', name: 'Lenguaje no verbal', section: 'Forma', description: '¿Utiliza un lenguaje no verbal que favorece el mensaje?' },
  { id: 'naturalidad', name: 'Naturalidad y expresividad', section: 'Forma', description: '¿Tiene buenas formas y presencia a la hora de exponer?' },
];

/** Settings shared by the presets that predate ADUMA, so their behaviour does not change. */
const CLASSIC_DEFAULTS: Pick<TabSettings, 'ballotMode' | 'rubric' | 'itemMin' | 'itemMax' | 'minorEscalation' | 'oddPanels' | 'conflictPolicy' | 'blindQualifying' | 'expectedTeams' | 'bracketSeedOrder'> = {
  ballotMode: 'judges',
  rubric: [],
  itemMin: 0,
  itemMax: 5,
  minorEscalation: 'blocks',
  oddPanels: true,
  conflictPolicy: 'hard',
  blindQualifying: false,
  expectedTeams: 0,
  bracketSeedOrder: [],
};

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
  ...CLASSIC_DEFAULTS,
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
  ...CLASSIC_DEFAULTS,
};

/** Defaults taken from the Reglamento del V Torneo Nacional ADUMA (arts. 16, 22–25, 29–31, 36–40, 43). */
const ADUMA_SETTINGS: TabSettings = {
  presetId: 'aduma',
  stage: 'swiss',
  groupCount: 4,
  groupAdvance: 2,
  swissRounds: 4,
  avoidSameInstitution: false,
  breakSize: 8,
  bracketMode: 'fixed',
  bracketSeedOrder: [1, 8, 3, 6, 2, 7, 4, 5],
  qualifyingPanelSize: 3,
  eliminationPanelSize: 3,
  qualifyingSideMode: 'draw',
  scoreMin: 0,
  scoreMax: 55,
  scoresIncludePenalties: false,
  trimExtremes: false,
  speakerScores: true,
  speakerScoreMin: 1,
  speakerScoreMax: 10,
  speakerScoreStep: 0.5,
  speakerMetric: 'sum',
  warningConversion: 'aduma',
  minorPoints: 5,
  minorsPerMajor: 2,
  majorMode: 'points',
  majorPoints: 10,
  forfeitLoserPoints: 0,
  forfeitWinnerPoints: 'roundAverage',
  tiebreaks: ['pointsTotal', 'headToHead', 'fewestMajors', 'fewestMinors'],
  tiebreakFallback: 'manual',
  ballotMode: 'joint',
  rubric: ADUMA_RUBRIC,
  itemMin: 0,
  itemMax: 5,
  minorEscalation: 'aduma',
  oddPanels: false,
  conflictPolicy: 'lastResort',
  blindQualifying: true,
  expectedTeams: 20,
};

export function presetSettings(presetId: PresetId): TabSettings {
  const source = presetId === 'uc3m-swiss' ? UC3M_SETTINGS : presetId === 'aduma' ? ADUMA_SETTINGS : LEDU_SETTINGS;
  return {
    ...source,
    tiebreaks: [...source.tiebreaks],
    rubric: source.rubric.map((item) => ({ ...item })),
    bracketSeedOrder: [...source.bracketSeedOrder],
  };
}

export function createTabTournament(name: string, presetId: PresetId, now = Date.now(), seed = randomSeed()): TabTournament {
  return {
    schemaVersion: TAB_SCHEMA_VERSION,
    id: makeTabId('torneo'),
    name: name.trim() || (presetId === 'aduma' ? ADUMA_DEFAULT_NAME : 'Torneo sin nombre'),
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
    judgeConflicts: [],
    logTail: [],
    logSeq: 0,
  };
}
