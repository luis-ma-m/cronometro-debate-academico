import type { TabPenalties, TabSettings, WarningConversion } from './types';

export interface EffectivePenalties {
  warnings: number;
  minors: number;
  majors: number;
  /** Points deducted from every judge's gross score (or from the joint acta). */
  deduction: number;
  forfeit: boolean;
}

const count = (value: unknown) => (Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0);

/**
 * LEDU art. 35.a: two warnings make a minor fault, the next two another one, and from the fifth every warning is one.
 * ADUMA art. 39.1: the second warning makes a minor fault and every later warning is another one.
 */
export function minorsFromWarnings(warnings: number, mode: WarningConversion): number {
  const total = count(warnings);
  if (mode === 'ledu') return total < 5 ? Math.floor(total / 2) : total - 2;
  if (mode === 'pairs') return Math.floor(total / 2);
  if (mode === 'aduma') return Math.max(0, total - 1);
  return 0;
}

/**
 * Converted faults replace the ones they come from. 'blocks': every `minorsPerMajor` minors become one major.
 * 'aduma' (art. 40.1): two minors make a major and every later minor is another major.
 */
export function effectivePenalties(penalties: TabPenalties | undefined, settings: TabSettings): EffectivePenalties {
  const warnings = count(penalties?.warnings);
  let minors = count(penalties?.minors) + minorsFromWarnings(warnings, settings.warningConversion);
  let majors = count(penalties?.majors);
  if (settings.minorEscalation === 'aduma') {
    if (minors >= 2) {
      majors += minors - 1;
      minors = 0;
    }
  } else if (settings.minorsPerMajor > 0) {
    const converted = Math.floor(minors / settings.minorsPerMajor);
    majors += converted;
    minors -= converted * settings.minorsPerMajor;
  }
  const forfeit = Boolean(penalties?.disqualified) || (settings.majorMode === 'forfeit' && majors > 0);
  const deduction = settings.scoresIncludePenalties
    ? 0
    : minors * settings.minorPoints + (settings.majorMode === 'points' ? majors * settings.majorPoints : 0);
  return { warnings, minors, majors, deduction, forfeit };
}

/** Warns when converting minors into a major would lower the total deduction. */
export function penaltyConversionWarning(settings: TabSettings): string | null {
  if (settings.majorMode !== 'points' || settings.minorEscalation === 'aduma' || settings.minorsPerMajor <= 0) return null;
  if (settings.majorPoints >= settings.minorsPerMajor * settings.minorPoints) return null;
  return 'Con esta configuración, acumular ' + settings.minorsPerMajor + ' faltas leves en una grave reduce la penalización.';
}
