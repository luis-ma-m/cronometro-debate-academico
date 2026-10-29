import { describe, expect, it } from 'vitest';
import { compactActaWarnings, validateJointActa, type JointActaContext } from './acta';
import { ADUMA_RUBRIC, presetSettings } from './presets';
import { emptyPenalties, type TabJointActa, type TabPenalties, type TabSpeaker } from './types';

const settings = presetSettings('aduma');
const speakers = new Map<string, TabSpeaker>([
  ['a1', { id: 'a1', teamId: 'a', name: 'Ana' }],
  ['a2', { id: 'a2', teamId: 'a', name: 'Álvaro' }],
  ['b1', { id: 'b1', teamId: 'b', name: 'Bea' }],
]);
const context = (elimination = false): JointActaContext => ({ settings, teamIds: ['a', 'b'], speakers, elimination });
const items = (value: number) => Object.fromEntries(ADUMA_RUBRIC.map((item) => [item.id, value]));
const acta = (extra: Partial<TabJointActa> = {}): TabJointActa => ({ winnerTeamId: 'a', items: { a: items(4), b: items(3) }, speakers: {}, ...extra });
const none: Record<string, TabPenalties> = {};

describe('validateJointActa', () => {
  it('sums the eleven items and deducts the penalties of each team', () => {
    const check = validateJointActa(acta(), { b: { ...emptyPenalties(), minors: 1 } }, context());
    expect(check.issues).toEqual([]);
    expect(check.missing).toEqual([]);
    expect(check.totals.a).toMatchObject({ gross: 44, deduction: 0, net: 44, itemsComplete: true, quick: false });
    expect(check.totals.b).toMatchObject({ gross: 33, deduction: 5, net: 28 });
  });

  it('reports what is still missing instead of failing', () => {
    const partial = acta({ winnerTeamId: '', items: { a: { ...items(4), refutacion: undefined as unknown as number }, b: items(3) } });
    const check = validateJointActa(partial, none, context());
    expect(check.issues).toEqual([]);
    expect(check.missing.join(' ')).toContain('ganador');
    expect(check.missing.join(' ')).toContain('Refutación');
    expect(check.totals.a.gross).toBeNull();
  });

  it('rejects items outside 0–5 and accepts half points with a warning', () => {
    expect(validateJointActa(acta({ items: { a: { ...items(4), coherencia: 6 }, b: items(3) } }), none, context()).issues.join(' ')).toContain('0 y 5');
    expect(validateJointActa(acta({ items: { a: { ...items(4), coherencia: 2.25 }, b: items(3) } }), none, context()).issues.join(' ')).toContain('medios puntos');
    const half = validateJointActa(acta({ items: { a: { ...items(4), coherencia: 3.5 }, b: items(3) } }), none, context());
    expect(half.issues).toEqual([]);
    expect(half.warnings.join(' ')).toContain('medio punto');
    expect(half.totals.a.gross).toBe(43.5);
  });

  it('accepts quick totals when the item detail is pending', () => {
    const check = validateJointActa(acta({ items: {}, quickTotals: { a: 41, b: 38 } }), none, context());
    expect(check.issues).toEqual([]);
    expect(check.missing).toEqual([]);
    expect(check.totals.a).toMatchObject({ gross: 41, quick: true, itemsComplete: false });
    expect(check.warnings.join(' ')).toContain('pendiente');
    expect(validateJointActa(acta({ items: {}, quickTotals: { a: 70, b: 38 } }), none, context()).issues.join(' ')).toContain('0 y 55');
  });

  it('warns when the total written on the paper matches neither the gross nor the net total', () => {
    const penalties = { a: { ...emptyPenalties(), minors: 1 } };
    expect(validateJointActa(acta({ writtenTotals: { a: 44 } }), penalties, context()).warnings).toEqual([]);
    expect(validateJointActa(acta({ writtenTotals: { a: 39 } }), penalties, context()).warnings).toEqual([]);
    expect(validateJointActa(acta({ writtenTotals: { a: 42 } }), penalties, context()).warnings.join(' ')).toContain('total escrito');
  });

  it('flags a declared winner with fewer items as information only (art. 23)', () => {
    const check = validateJointActa(acta({ winnerTeamId: 'b' }), none, context());
    expect(check.issues).toEqual([]);
    expect(check.warnings.join(' ')).toContain('menos ítems');
  });

  it('checks speakers: team, scale, and one speaker per intervention', () => {
    const ok = validateJointActa(acta({ speakers: { a: [
      { speakerId: 'a1', score: 8.5, roles: ['introductor', 'concluder'] },
      { speakerId: 'a2', score: 7, roles: ['first_rebuttal', 'second_rebuttal'] },
    ] } }), none, context());
    expect(ok.issues).toEqual([]);
    expect(validateJointActa(acta({ speakers: { a: [{ speakerId: 'b1', score: 8, roles: ['introductor'] }] } }), none, context()).issues.join(' ')).toContain('otro equipo');
    expect(validateJointActa(acta({ speakers: { a: [{ speakerId: 'a1', score: 11, roles: ['introductor'] }] } }), none, context()).issues.join(' ')).toContain('1 y 10');
    const twice = validateJointActa(acta({ speakers: { a: [
      { speakerId: 'a1', score: 8, roles: ['introductor'] },
      { speakerId: 'a2', score: 7, roles: ['introductor'] },
    ] } }), none, context());
    expect(twice.issues.join(' ')).toContain('dos integrantes');
    expect(validateJointActa(acta({ speakers: { a: [{ speakerId: 'a1', score: 8, roles: ['introductor'] }] } }), none, context()).warnings.join(' ')).toContain('intervenciones');
  });

  it('only needs the winner in elimination rounds', () => {
    const check = validateJointActa({ winnerTeamId: 'b', items: {}, speakers: {} }, none, context(true));
    expect(check).toMatchObject({ issues: [], missing: [] });
    expect(validateJointActa({ winnerTeamId: 'x', items: {}, speakers: {} }, none, context(true)).issues.join(' ')).toContain('no está en el debate');
  });
});

describe('compactActaWarnings', () => {
  it('groups the half-point notices of many items into one line and keeps the rest', () => {
    const halves = ['Coherencia de A tiene medio punto (4,5): compruébalo en el acta.', 'Veracidad de B tiene medio punto (3,5): compruébalo en el acta.'];
    expect(compactActaWarnings([...halves, 'Otro aviso.'])).toEqual(['2 ítems con medio punto: compruébalos en el acta.', 'Otro aviso.']);
    expect(compactActaWarnings([halves[0], 'Otro aviso.'])).toEqual([halves[0], 'Otro aviso.']);
  });
});
