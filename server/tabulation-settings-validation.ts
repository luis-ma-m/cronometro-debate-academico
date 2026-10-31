import { presetSettings } from "../src/tabulation/presets.js";
import type { TabSettings } from "../src/tabulation/types.js";

export class TabulationSettingsValidationError extends Error {
  constructor(message: string) { super(message); this.name = "TabulationSettingsValidationError"; }
}

const DEFAULT_PRESET = "ledu-groups" as const;
const MAX_BYTES = 64 * 1024;

export function validateTabulationSettings(value: unknown): TabSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TabulationSettingsValidationError("Las reglas de tabulación deben ser un objeto válido.");
  }
  const input = value as Record<string, unknown>;
  const defaults = presetSettings(DEFAULT_PRESET) as unknown as Record<string, unknown>;
  const expectedKeys = Object.keys(defaults).sort();
  const actualKeys = Object.keys(input).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    throw new TabulationSettingsValidationError("La versión de las reglas no coincide con el esquema esperado. Actualiza Tabulación antes de guardar.");
  }
  const enums: Record<string, string[]> = {
    presetId: ["ledu-groups", "uc3m-swiss", "aduma", "custom"],
    stage: ["groups", "swiss"], bracketMode: ["fixed", "reseed"],
    qualifyingSideMode: ["draw", "balanced"], speakerMetric: ["sum", "average"],
    warningConversion: ["ledu", "pairs", "aduma", "none"],
    majorMode: ["forfeit", "points"], forfeitWinnerPoints: ["average", "ballots", "roundAverage"],
    tiebreakFallback: ["lots", "manual"], ballotMode: ["judges", "joint"],
    minorEscalation: ["blocks", "aduma"], conflictPolicy: ["hard", "lastResort"],
  };
  for (const [key, allowed] of Object.entries(enums)) {
    if (!allowed.includes(String(input[key]))) throw new TabulationSettingsValidationError("Valor no válido para la regla " + key + ".");
  }
  const ranges: Record<string, [number, number]> = {
    groupCount: [1, 16], groupAdvance: [1, 8], swissRounds: [1, 12], breakSize: [2, 32],
    qualifyingPanelSize: [1, 9], eliminationPanelSize: [1, 9], scoreMin: [0, 1000], scoreMax: [0, 1000],
    speakerScoreMin: [0, 100], speakerScoreMax: [0, 100], speakerScoreStep: [0, 10],
    minorPoints: [0, 1000], minorsPerMajor: [0, 100], majorPoints: [0, 1000],
    forfeitLoserPoints: [0, 1000], itemMin: [0, 1000], itemMax: [0, 1000], expectedTeams: [0, 500],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const number = input[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max) {
      throw new TabulationSettingsValidationError("El valor de " + key + " debe estar entre " + min + " y " + max + ".");
    }
  }
  if ((input.scoreMax as number) <= (input.scoreMin as number) ||
      (input.speakerScoreMax as number) <= (input.speakerScoreMin as number) ||
      (input.itemMax as number) <= (input.itemMin as number)) {
    throw new TabulationSettingsValidationError("Los máximos de puntuación deben ser superiores a los mínimos.");
  }
  const integerRules = ["groupCount", "groupAdvance", "swissRounds", "breakSize", "qualifyingPanelSize", "eliminationPanelSize", "minorsPerMajor", "expectedTeams"];
  for (const key of integerRules) {
    if (!Number.isInteger(input[key])) throw new TabulationSettingsValidationError("La regla " + key + " debe ser un número entero.");
  }
  if ((input.minorsPerMajor as number) < 1) {
    throw new TabulationSettingsValidationError("Debe haber al menos una falta leve por cada bloque de faltas graves.");
  }
  if ((input.speakerScoreStep as number) <= 0) {
    throw new TabulationSettingsValidationError("El intervalo de puntuación de oradores debe ser mayor que cero.");
  }
  if (input.oddPanels === true &&
      ((input.qualifyingPanelSize as number) % 2 === 0 || (input.eliminationPanelSize as number) % 2 === 0)) {
    throw new TabulationSettingsValidationError("La configuración exige paneles impares, pero hay un tamaño de panel par.");
  }
  for (const key of ["avoidSameInstitution", "scoresIncludePenalties", "trimExtremes", "speakerScores", "oddPanels", "blindQualifying"]) {
    if (typeof input[key] !== "boolean") throw new TabulationSettingsValidationError("La regla " + key + " debe ser booleana.");
  }
  if (!Array.isArray(input.tiebreaks) || input.tiebreaks.length > 11 ||
      new Set(input.tiebreaks).size !== input.tiebreaks.length ||
      input.tiebreaks.some((item) => typeof item !== "string" || !["ballots","pointsTotal","pointsAverage","headToHead","headToHeadBallots","headToHeadPoints","speakerPoints","fewestPenalties","fewestMajors","fewestMinors"].includes(item))) {
    throw new TabulationSettingsValidationError("La lista de desempates contiene valores no válidos o duplicados.");
  }
  if (!Array.isArray(input.rubric) || input.rubric.length > 100) throw new TabulationSettingsValidationError("La rúbrica no puede superar 100 ítems.");
  const rubricIds = new Set<string>();
  for (const item of input.rubric) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TabulationSettingsValidationError("Hay un ítem de rúbrica no válido.");
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id) || rubricIds.has(row.id) ||
        typeof row.name !== "string" || !row.name.trim() || row.name.length > 200 ||
        typeof row.section !== "string" || row.section.length > 100 ||
        typeof row.description !== "string" || row.description.length > 1000) {
      throw new TabulationSettingsValidationError("Los ítems de rúbrica necesitan IDs únicos y textos válidos.");
    }
    rubricIds.add(row.id);
  }
  if (!Array.isArray(input.bracketSeedOrder) || input.bracketSeedOrder.length > 32 ||
      new Set(input.bracketSeedOrder).size !== input.bracketSeedOrder.length ||
      input.bracketSeedOrder.some((item) => !Number.isInteger(item) || (item as number) < 1 || (item as number) > 32)) {
    throw new TabulationSettingsValidationError("El orden de cabezas de serie no es válido.");
  }
  const serialized = JSON.stringify(input);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) {
    throw new TabulationSettingsValidationError("Las reglas superan el tamaño máximo permitido.");
  }
  return structuredClone(input) as unknown as TabSettings;
}

