import { SPEAKER_POSITIONS } from '../scoring';
import { effectivePenalties, type EffectivePenalties } from './penalties';
import { SPEAKER_ROLES, type SpeakerRole, type TabJointActa, type TabPenalties, type TabSettings, type TabSpeaker } from './types';

/**
 * Validation of a joint acta (ADUMA art. 23). Pure and dependency-free so the server can reuse it when judges
 * submit actas from their phones (phase 2).
 */
export interface JointActaContext {
  settings: TabSettings;
  teamIds: [string, string];
  speakers: Map<string, TabSpeaker>;
  elimination: boolean;
  teamName?: (teamId: string) => string;
}

export interface JointTeamTotals {
  gross: number | null;
  deduction: number;
  net: number | null;
  itemsComplete: boolean;
  /** The gross total was typed directly because the item detail is pending. */
  quick: boolean;
  penalties: EffectivePenalties;
}

export interface JointActaCheck {
  /** Wrong data: the acta cannot count until it is corrected. */
  issues: string[];
  /** Data still to be filled in: the acta is incomplete but nothing is wrong. */
  missing: string[];
  warnings: string[];
  totals: Record<string, JointTeamTotals>;
}

const ROLE_LABELS = Object.fromEntries(SPEAKER_POSITIONS.map((position) => [position.value, position.label])) as Record<SpeakerRole, string>;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const onStep = (value: number, min: number, step: number) => step <= 0 || Math.abs((value - min) / step - Math.round((value - min) / step)) < 1e-9;
const format = (value: number) => String(value).replace('.', ',');

export function validateJointActa(acta: TabJointActa | undefined, penalties: Record<string, TabPenalties>, context: JointActaContext): JointActaCheck {
  const { settings, teamIds, elimination } = context;
  const name = context.teamName ?? ((teamId: string) => teamId);
  const issues: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  const totals: Record<string, JointTeamTotals> = {};

  const winner = acta?.winnerTeamId ?? '';
  if (!winner) missing.push('Falta declarar el equipo ganador.');
  else if (!teamIds.includes(winner)) issues.push('El ganador declarado no está en el debate.');

  const { rubric, itemMin, itemMax } = settings;
  const minTotal = rubric.length * itemMin;
  const maxTotal = rubric.length * itemMax;
  for (const teamId of teamIds) {
    const effective = effectivePenalties(penalties[teamId], settings);
    const entry: JointTeamTotals = { gross: null, deduction: effective.deduction, net: null, itemsComplete: false, quick: false, penalties: effective };
    totals[teamId] = entry;
    if (elimination) continue;

    const values = acta?.items[teamId] ?? {};
    let sum = 0;
    for (const item of rubric) {
      const value = values[item.id];
      if (!isNumber(value)) continue;
      sum += value;
      if (value < itemMin || value > itemMax) issues.push(item.name + ' de ' + name(teamId) + ' debe estar entre ' + itemMin + ' y ' + itemMax + '.');
      else if (!Number.isInteger(value)) {
        if (Number.isInteger(value * 2)) warnings.push(item.name + ' de ' + name(teamId) + ' tiene medio punto (' + format(value) + '): compruébalo en el acta.');
        else issues.push(item.name + ' de ' + name(teamId) + ' solo admite enteros o medios puntos.');
      }
    }
    const absent = rubric.filter((item) => !isNumber(values[item.id]));
    if (rubric.length && !absent.length) {
      entry.gross = sum;
      entry.itemsComplete = true;
    } else {
      const quick = acta?.quickTotals?.[teamId];
      if (isNumber(quick)) {
        if (quick < minTotal || quick > maxTotal) issues.push('El total de ' + name(teamId) + ' debe estar entre ' + minTotal + ' y ' + maxTotal + '.');
        else {
          entry.gross = quick;
          entry.quick = true;
          warnings.push('Detalle de ítems pendiente para ' + name(teamId) + ': se usa el total.');
        }
      } else if (rubric.length) missing.push('Faltan ítems de ' + name(teamId) + ': ' + absent.map((item) => item.name).join(', ') + '.');
      else missing.push('Falta el total de ' + name(teamId) + '.');
    }
    if (entry.gross !== null) entry.net = entry.gross - entry.deduction;

    const written = acta?.writtenTotals?.[teamId];
    if (isNumber(written) && entry.gross !== null && written !== entry.gross && written !== entry.net) {
      warnings.push('El total escrito en el acta para ' + name(teamId) + ' (' + format(written) + ') no coincide con el calculado (bruto ' + format(entry.gross) + ', neto ' + format(entry.net ?? entry.gross) + ').');
    }
  }

  if (!elimination && teamIds.includes(winner)) {
    const loser = winner === teamIds[0] ? teamIds[1] : teamIds[0];
    const winnerNet = totals[winner].net;
    const loserNet = totals[loser].net;
    if (winnerNet !== null && loserNet !== null && winnerNet < loserNet) {
      warnings.push('El ganador declarado tiene menos ítems que su rival. Es válido (art. 23: los ítems solo desempatan), pero compruébalo.');
    }
  }

  if (!elimination) {
    for (const teamId of teamIds) {
      const entries = acta?.speakers[teamId] ?? [];
      const seen = new Set<string>();
      const roleOwner = new Map<SpeakerRole, string>();
      for (const row of entries) {
        const speaker = context.speakers.get(row.speakerId);
        if (!speaker || speaker.teamId !== teamId) issues.push('Un orador de la lista de ' + name(teamId) + ' es de otro equipo.');
        if (seen.has(row.speakerId)) issues.push('Un integrante de ' + name(teamId) + ' aparece dos veces.');
        seen.add(row.speakerId);
        if (!isNumber(row.score) || row.score < settings.speakerScoreMin || row.score > settings.speakerScoreMax || !onStep(row.score, settings.speakerScoreMin, settings.speakerScoreStep)) {
          issues.push('Las notas de orador deben estar entre ' + settings.speakerScoreMin + ' y ' + settings.speakerScoreMax + ' (paso ' + format(settings.speakerScoreStep) + ').');
        }
        for (const role of row.roles) {
          if (roleOwner.has(role) && roleOwner.get(role) !== row.speakerId) {
            issues.push('La intervención «' + ROLE_LABELS[role] + '» de ' + name(teamId) + ' está asignada a dos integrantes.');
          }
          roleOwner.set(role, row.speakerId);
        }
      }
      if (entries.length && SPEAKER_ROLES.some((role) => !roleOwner.has(role))) {
        warnings.push('Falta indicar quién hizo alguna de las intervenciones de ' + name(teamId) + '.');
      }
    }
  }

  return { issues: [...new Set(issues)], missing: [...new Set(missing)], warnings: [...new Set(warnings)], totals };
}

/** One line for the half-point notices of many items (each input is already highlighted in the form). */
export function compactActaWarnings(warnings: string[]): string[] {
  const halves = warnings.filter((warning) => warning.includes('tiene medio punto'));
  if (halves.length < 2) return warnings;
  return [halves.length + ' ítems con medio punto: compruébalos en el acta.', ...warnings.filter((warning) => !halves.includes(warning))];
}
