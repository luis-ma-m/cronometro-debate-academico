import { describe, expect, it } from 'vitest';
import { computeDebateOutcome, outcomeContext } from './results';
import { debate, makeTournament, qualifyingRound, result } from './test-fixtures';
import type { TabTournament } from './types';
import {
  actaCodeMessage, actaLinkMessage, applyReceivedActa, base32Decode, base32Encode, buildActaLink, decodeActaLink, encodeActaCode, findActaCodes,
  readActaCode, receivedIsRegistered, whatsAppNumber, whatsAppUrl, type ActaEntry,
} from './whatsapp';

function aduma(): TabTournament {
  const tournament = makeTournament('aduma', ['a', 'b', 'c', 'd'], ['j1', 'j2', 'j3'], 2);
  tournament.judges[0].phone = '600111222';
  tournament.whatsapp = { deskPhone: '34600999888', baseUrl: 'https://debate.example' };
  tournament.speakers.push({ id: 'a-s5', teamId: 'a', name: 'Quinta integrante con un nombre bastante largo' });
  tournament.rounds = [qualifyingRound(2, [
    { ...debate('d1', 'a', 'b', ['j2', 'j1', 'j3']), chairId: 'j1', venueId: 'v1' },
    { ...debate('d2', 'c', 'd', []), venueId: 'v2' },
  ])];
  return tournament;
}

const linkOf = (tournament: TabTournament) => buildActaLink(tournament, tournament.rounds[0], tournament.rounds[0].debates[0], 'https://debate.example/');

const entry = (extra: Partial<ActaEntry> = {}): ActaEntry => ({
  favor: 'b',
  winner: 'a',
  items: { a: Object.fromEntries(['coherencia', 'veracidad', 'evidencias', 'preguntas', 'tesis', 'presentacion', 'refutacion', 'exordios', 'equilibrio', 'noverbal', 'naturalidad'].map((id) => [id, 4])), b: { coherencia: 3, veracidad: 3.5 } },
  quickTotals: { b: 33 },
  writtenTotals: { a: 44, b: 33 },
  penalties: { a: { warnings: 2, minors: 0, majors: 0, disqualified: false }, b: { warnings: 0, minors: 0, majors: 0, disqualified: false } },
  speakers: { a: [{ speakerId: 'a-s1', score: 8.5, roles: ['introductor', 'concluder'] }, { speakerId: 'a-s2', score: 7, roles: ['first_rebuttal', 'second_rebuttal'] }], b: [] },
  notes: 'Todo correcto. _No_ hubo *incidencias*.',
  signedBy: 'Juez j1',
  sentAt: 1_800_000_000_000,
  ...extra,
});

describe('base32 (WhatsApp-safe)', () => {
  it('round-trips any bytes and tolerates the usual misreadings', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length * 11) % 256);
      const text = base32Encode(bytes);
      expect(text).toMatch(/^[0-9A-HJKMNP-TV-Z]*$/);
      expect(base32Decode(text)).toEqual(bytes);
      expect(base32Decode(text.toLowerCase())).toEqual(bytes);
    }
    expect(base32Decode('0O1IL')).toEqual(base32Decode('00111'));
  });
});

describe('acta link for the judge', () => {
  it('carries the debate, teams, members, jury and rules in a link of plain letters and digits', () => {
    const tournament = aduma();
    const { url, link } = linkOf(tournament);
    expect(url).toMatch(/^https:\/\/debate\.example\/acta#A1-[0-9A-HJKMNP-TV-Z]+-[0-9a-f]{14}$/);
    const decoded = decodeActaLink(url.slice(url.indexOf('#')));
    expect(decoded).toEqual(link);
    expect(decoded).toMatchObject({
      tournament: 'Prueba', round: { number: 2, name: 'Ronda 2', elimination: false }, debate: 'd1', venue: 'Aula 1', desk: '34600999888',
      jury: ['Juez j1', 'Juez j2', 'Juez j3'],
    });
    expect(decoded.teams.map((team) => [team.id, team.members.length])).toEqual([['a', 5], ['b', 4]]);
    expect(decoded.rules.rubric).toHaveLength(11);
    expect(url.length).toBeLessThan(2500);
  });

  it('rejects a cut or altered link with a clear message', () => {
    const { url } = linkOf(aduma());
    const hash = url.slice(url.indexOf('#'));
    expect(() => decodeActaLink(hash.slice(0, -20))).toThrow('incompleto');
    expect(() => decodeActaLink(hash.slice(0, 20) + (hash[20] === 'A' ? 'B' : 'A') + hash.slice(21))).toThrow('incompleto');
    expect(() => decodeActaLink('')).toThrow('incompleto');
  });

  it('writes the message for the chair', () => {
    const tournament = aduma();
    const { url, link } = linkOf(tournament);
    const message = actaLinkMessage(link, url);
    expect(message).toContain('Juez j1');
    expect(message).toContain('Aula 1');
    expect(message).toContain(url);
  });
});

describe('acta code from the judge', () => {
  it('reaches the desk intact through a pasted WhatsApp chat and fills the joint acta', () => {
    const tournament = aduma();
    const { link } = linkOf(tournament);
    const code = encodeActaCode(link, entry());
    expect(code).toMatch(/^ACTA1-[0-9A-HJKMNP-TV-Z]+-[0-9a-f]{14}$/);
    const message = actaCodeMessage(link, entry(), 'gana Equipo a (39 – 33)');
    expect(message).toContain(code);
    const chat = '[10:31, 20/11/2026] Juez j1: ' + message.replace(/\n/g, '\n[10:31, 20/11/2026] Juez j1: ') + '\n[10:32, 20/11/2026] Mesa: recibida 👍';
    expect(findActaCodes(chat)).toEqual([code]);
    const received = readActaCode(tournament, findActaCodes(chat)[0]);
    expect(received.error).toBeNull();
    expect(received).toMatchObject({ roundId: 'r2', debateId: 'd1' });
    expect(received.payload).toEqual({ version: 1, debate: 'd1', round: 2, ...entry() });

    const applied = applyReceivedActa(tournament, received);
    const stored = applied.rounds[0].debates[0];
    expect(stored.favorTeamId).toBe('b');
    expect(stored.result!.joint).toEqual({ winnerTeamId: 'a', items: entry().items, quickTotals: { b: 33 }, writtenTotals: { a: 44, b: 33 }, speakers: entry().speakers });
    expect(stored.result!.notes).toContain('Juez j1');
    const outcome = computeDebateOutcome(applied.rounds[0], stored, outcomeContext(applied));
    expect(outcome).toMatchObject({ status: 'complete', winnerTeamId: 'a' });
    expect(receivedIsRegistered(applied, received)).toBe(true);
    expect(receivedIsRegistered(tournament, received)).toBe(false);
  });

  it('detects an altered code, a code from another tournament and a code for a debate that no longer exists', () => {
    const tournament = aduma();
    const code = encodeActaCode(linkOf(tournament).link, entry());
    const position = 20;
    const altered = code.slice(0, position) + (code[position] === 'A' ? 'B' : 'A') + code.slice(position + 1);
    expect(readActaCode(tournament, altered).error).toMatch(/dañado|alterado/);
    expect(readActaCode({ ...tournament, seed: tournament.seed + 1 }, code).error).toContain('alterado o es de otro torneo');
    expect(readActaCode({ ...tournament, rounds: [] }, code).error).toContain('ningún debate');
    expect(readActaCode(tournament, 'ACTA1-XYZ-0123456789abcd').error).toContain('dañado');
  });

  it('keeps the decision of the organisers and the notes already typed', () => {
    const tournament = aduma();
    tournament.rounds[0].debates[0].result = result([], { override: { winnerTeamId: 'b', reason: 'Reclamación' }, notes: 'Nota de la mesa' });
    const received = readActaCode(tournament, encodeActaCode(linkOf(tournament).link, entry()));
    const stored = applyReceivedActa(tournament, received).rounds[0].debates[0].result!;
    expect(stored.override).toEqual({ winnerTeamId: 'b', reason: 'Reclamación' });
    expect(stored.notes.startsWith('Nota de la mesa')).toBe(true);
    expect(stored.notes).toContain('Todo correcto');
  });

  it('carries only the winner, side and notes in an elimination', () => {
    const tournament = aduma();
    tournament.rounds[0] = { ...tournament.rounds[0], kind: 'elimination' };
    const link = linkOf(tournament).link;
    expect(link.round.elimination).toBe(true);
    const received = readActaCode(tournament, encodeActaCode(link, entry()));
    const stored = applyReceivedActa(tournament, received).rounds[0].debates[0];
    expect(stored.result!.joint).toEqual({ winnerTeamId: 'a', items: {}, speakers: {} });
    expect(computeDebateOutcome(tournament.rounds[0], stored, outcomeContext(tournament))).toMatchObject({ status: 'complete', winnerTeamId: 'a' });
  });

  it('finds each code once, whatever surrounds it', () => {
    const tournament = aduma();
    const first = encodeActaCode(linkOf(tournament).link, entry());
    const second = encodeActaCode(linkOf(tournament).link, entry({ winner: 'b' }));
    expect(findActaCodes('```' + first + '```\n' + first + ' ' + second.toLowerCase().replace('acta1', 'ACTA1'))).toEqual([first, second]);
    expect(findActaCodes('nada por aquí')).toEqual([]);
  });
});

describe('WhatsApp numbers and links', () => {
  it('normalises Spanish and international numbers', () => {
    expect(whatsAppNumber('600 11 22 33')).toBe('34600112233');
    expect(whatsAppNumber('+34 600-11-22-33')).toBe('34600112233');
    expect(whatsAppNumber('0034600112233')).toBe('34600112233');
    expect(whatsAppNumber('+44 7700 900123')).toBe('447700900123');
    expect(whatsAppNumber('')).toBe('');
  });

  it('opens a chat with the number, or lets WhatsApp ask for the chat', () => {
    expect(whatsAppUrl('34600112233', 'Hola y adiós')).toBe('https://wa.me/34600112233?text=Hola%20y%20adi%C3%B3s');
    expect(whatsAppUrl('', 'Hola')).toBe('https://wa.me/?text=Hola');
  });
});
