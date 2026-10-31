import { describe, expect, it } from 'vitest';
import v1 from './fixtures/acta-v1.json';
import { computeDebateOutcome, outcomeContext } from './results';
import { createSampleTournament } from './sample';
import { actaV1Tournament, debate, makeTournament, qualifyingRound, result } from './test-fixtures';
import type { TabTournament } from './types';
import { confirmDraft, createRoundDraft } from './draft';
import {
  actaCodeMessage, actaLinkMessage, actaRules, applyReceivedActa, base32Decode, base32Encode, base62Decode, base62Encode, buildActaLink, decodeActaLink,
  encodeActaCode, findActaCodes, readActaCode, receivedIsRegistered, whatsAppNumber, whatsAppUrl, type ActaEntry, type ActaLink,
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

/** The acta as the desk stores it: teams and members by their ids. */
const entry = (extra: Partial<ActaEntry> = {}): ActaEntry => ({
  favor: 'b',
  winner: 'a',
  items: { a: Object.fromEntries(['coherencia', 'veracidad', 'evidencias', 'preguntas', 'tesis', 'presentacion', 'refutacion', 'exordios', 'equilibrio', 'noverbal', 'naturalidad'].map((id) => [id, 4])), b: { coherencia: 3, veracidad: 3.5 } },
  quickTotals: { b: 33 },
  writtenTotals: { a: 44, b: 33 },
  penalties: { a: { warnings: 2, minors: 0, majors: 0, disqualified: false }, b: { warnings: 0, minors: 0, majors: 0, disqualified: false } },
  speakers: { a: [{ speakerId: 'a-s1', score: 8.5, roles: ['introductor', 'concluder'] }, { speakerId: 'a-s5', score: 7, roles: ['first_rebuttal', 'second_rebuttal'] }], b: [] },
  notes: 'Todo correcto. _No_ hubo *incidencias*.',
  signedBy: 'Juez j1',
  sentAt: 1_800_000_000_000,
  ...extra,
});

/** The same acta as the judges' page fills it from the link: teams and members by their position. */
function onPhone(tournament: TabTournament, link: ActaLink, acta: ActaEntry): ActaEntry {
  const teamIds = tournament.rounds[0].debates[0].teamIds;
  const team = (id: string) => link.teams[teamIds.indexOf(id)]?.id ?? '';
  const member = (teamId: string, speakerId: string) => {
    const position = tournament.speakers.filter((speaker) => speaker.teamId === teamId).findIndex((speaker) => speaker.id === speakerId);
    return link.teams[teamIds.indexOf(teamId)].members[position].id;
  };
  const byTeam = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).map(([id, value]) => [team(id), value]));
  return {
    ...acta,
    favor: team(acta.favor),
    winner: team(acta.winner),
    items: byTeam(acta.items),
    ...(acta.quickTotals ? { quickTotals: byTeam(acta.quickTotals) } : {}),
    ...(acta.writtenTotals ? { writtenTotals: byTeam(acta.writtenTotals) } : {}),
    penalties: byTeam(acta.penalties),
    speakers: Object.fromEntries(Object.entries(acta.speakers).map(([id, rows]) => [team(id), rows.map((row) => ({ ...row, speakerId: member(id, row.speakerId) }))])),
  };
}

const codeOf = (tournament: TabTournament, acta = entry()) => {
  const { link } = linkOf(tournament);
  return encodeActaCode(link, onPhone(tournament, link, acta));
};

describe('base32 (first format)', () => {
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

describe('base62 (letters and digits only)', () => {
  it('round-trips any bytes', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 97 + length * 13 + (i % 3 ? 255 : 0)) % 256);
      const text = base62Encode(bytes);
      expect(text).toMatch(/^[0-9A-Za-z]*$/);
      expect(text.length).toBeLessThanOrEqual(Math.ceil(length / 8) * 11);
      expect(base62Decode(text)).toEqual(bytes);
    }
  });

  it('rejects text that no bytes produce', () => {
    for (const text of ['0', '0000', '0123456789A0', 'zz', 'zzzzzzzzzzz', 'ab-c', 'ñ0']) expect(() => base62Decode(text), text).toThrow();
  });
});

describe('acta link for the judge', () => {
  it('carries only the names the page needs, in a link of letters and digits', () => {
    const tournament = aduma();
    const { url, link } = linkOf(tournament);
    expect(url).toMatch(/^https:\/\/debate\.example\/acta#A2[0-9A-Za-z]+$/);
    const fragment = url.slice(url.indexOf('#'));
    expect(fragment).not.toContain('-');
    const decoded = decodeActaLink(fragment);
    expect(decoded).toEqual(link);

    // Previously sent A2 links used separators. They must remain valid after
    // switching newly generated links to the WhatsApp-safe contiguous format.
    const payloadAndChecksum = fragment.slice(3);
    const legacyFragment = `A2-${payloadAndChecksum.slice(0, -8)}-${payloadAndChecksum.slice(-8)}`;
    expect(decodeActaLink(legacyFragment)).toEqual(link);
    expect(decoded).toMatchObject({ version: 2, round: { number: 2, name: 'Ronda 2', elimination: false }, venue: 'Aula 1', desk: '34600999888', jury: ['Juez j1', 'Juez j2', 'Juez j3'] });
    expect(decoded.teams.map((team) => [team.name, team.members.map((member) => member.name)])).toEqual([
      ['Equipo a', ['Orador 1 de a', 'Orador 2 de a', 'Orador 3 de a', 'Orador 4 de a', 'Quinta integrante con un nombre bastante largo']],
      ['Equipo b', ['Orador 1 de b', 'Orador 2 de b', 'Orador 3 de b', 'Orador 4 de b']],
    ]);
    expect(decoded.rules).toEqual(actaRules(tournament.settings));
    // Ids, the tournament name and the ADUMA rules stay out of the link.
    expect(url).not.toContain('a-s1');
    expect(url.length).toBeLessThan(300);
  });

  it('stays short for every debate of a real round, so WhatsApp shows it whole and as a link', () => {
    let tournament = createSampleTournament('aduma');
    tournament = { ...tournament, whatsapp: { deskPhone: '600112233', baseUrl: 'https://cronometro-debate-academico.vercel.app' } };
    const { draft } = createRoundDraft(tournament, 7, 1);
    tournament = confirmDraft({ ...tournament, draftRound: draft! }, draft!.round.id).tournament;
    const round = tournament.rounds[0];
    for (const item of round.debates) {
      const { url, link } = buildActaLink(tournament, round, item, tournament.whatsapp!.baseUrl);
      expect(url.length).toBeLessThan(420);
      expect(actaLinkMessage(link, url).length).toBeLessThan(560);
    }
  });

  it('names the round only when it is not «Ronda N», and carries the rules only where they differ from the ADUMA reglamento', () => {
    const tournament = aduma();
    const plain = linkOf(tournament).url;
    tournament.settings = { ...tournament.settings, itemMin: 1 };
    tournament.rounds[0] = { ...tournament.rounds[0], kind: 'elimination', name: 'Cuartos de final' };
    const { url } = linkOf(tournament);
    const decoded = decodeActaLink(url.slice(url.indexOf('#')));
    expect(decoded.rules).toEqual(actaRules(tournament.settings));
    expect(decoded.round).toEqual({ number: 2, name: 'Cuartos de final', elimination: true });
    expect(url.length - plain.length).toBeLessThan(40);
  });

  it('rejects a cut or altered link with a clear message', () => {
    const { url } = linkOf(aduma());
    const hash = url.slice(url.indexOf('#'));
    expect(() => decodeActaLink(hash.slice(0, -20))).toThrow('incompleto');
    expect(() => decodeActaLink(hash.slice(0, 20) + (hash[20] === 'A' ? 'B' : 'A') + hash.slice(21))).toThrow('incompleto');
    expect(() => decodeActaLink('')).toThrow('incompleto');
  });

  it('still opens links in the first format', () => {
    expect(decodeActaLink(v1.hash)).toMatchObject({ version: 1, debate: 'd1', venue: 'Aula 1', round: { number: 2 } });
  });

  it('writes a short message with the link on a line of its own', () => {
    const { url, link } = linkOf(aduma());
    const message = actaLinkMessage(link, url);
    expect(message.split('\n')).toContain(url);
    expect(message.indexOf(url)).toBeLessThan(80);
    expect(message).toContain('Juez j1');
    expect(message).toContain('Aula 1');
  });
});

describe('acta code from the judge', () => {
  it('reaches the desk intact through a pasted WhatsApp chat and fills the joint acta', () => {
    const tournament = aduma();
    const { link } = linkOf(tournament);
    const phone = onPhone(tournament, link, entry());
    const code = encodeActaCode(link, phone);
    expect(code).toMatch(/^ACTA2-[0-9A-Za-z]+-[0-9a-f]{14}$/);
    expect(code.length).toBeLessThan(260);
    const message = actaCodeMessage(link, phone, 'gana Equipo a (39 – 33)');
    expect(message).toContain(code);
    const chat = '[10:31, 20/11/2026] Juez j1: ' + message.replace(/\n/g, '\n[10:31, 20/11/2026] Juez j1: ') + '\n[10:32, 20/11/2026] Mesa: recibida 👍';
    expect(findActaCodes(chat)).toEqual([code]);
    const received = readActaCode(tournament, findActaCodes(chat)[0]);
    expect(received.error).toBeNull();
    expect(received).toMatchObject({ roundId: 'r2', debateId: 'd1' });
    expect(received.payload).toEqual({ version: 2, debate: 'd1', round: 2, ...entry() });

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
    const code = codeOf(tournament);
    const position = 20;
    const altered = code.slice(0, position) + (code[position] === 'A' ? 'B' : 'A') + code.slice(position + 1);
    expect(readActaCode(tournament, altered).error).toMatch(/dañado|alterado/);
    expect(readActaCode({ ...tournament, seed: tournament.seed + 1 }, code).error).toContain('alterado o es de otro torneo');
    expect(readActaCode({ ...tournament, rounds: [] }, code).error).toContain('ningún debate');
    expect(readActaCode(tournament, 'ACTA2-XYZ-0123456789abcd').error).toContain('dañado');
  });

  it('refuses a code written before the teams, members or items of its debate changed, as positions would point elsewhere', () => {
    const tournament = aduma();
    const code = codeOf(tournament);
    const withDebate = (changes: Partial<TabTournament['rounds'][number]['debates'][number]>): TabTournament => ({
      ...tournament,
      rounds: [{ ...tournament.rounds[0], debates: [{ ...tournament.rounds[0].debates[0], ...changes }, tournament.rounds[0].debates[1]] }],
    });
    const fewer = { ...tournament, speakers: tournament.speakers.filter((speaker) => speaker.id !== 'a-s2') };
    const swapped = withDebate({ teamIds: ['b', 'a'] });
    const sheet = { ...tournament, settings: { ...tournament.settings, rubric: [...tournament.settings.rubric].reverse() } };
    for (const changed of [fewer, swapped, sheet]) expect(readActaCode(changed, code).error).toContain('ha cambiado');
    // Members of other teams, the jury or the room do not matter.
    const other = { ...withDebate({ judgeIds: ['j2'], chairId: 'j2', venueId: 'v2' }), speakers: [...tournament.speakers, { id: 'c-s5', teamId: 'c', name: 'Nueva' }] };
    expect(readActaCode(other, code).error).toBeNull();
  });

  it('keeps the decision of the organisers and the notes already typed', () => {
    const tournament = aduma();
    tournament.rounds[0].debates[0].result = result([], { override: { winnerTeamId: 'b', reason: 'Reclamación' }, notes: 'Nota de la mesa' });
    const received = readActaCode(tournament, codeOf(tournament));
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
    const received = readActaCode(tournament, encodeActaCode(link, onPhone(tournament, link, entry())));
    expect(received.payload).toMatchObject({ favor: 'b', winner: 'a', items: {}, penalties: {}, speakers: {}, notes: entry().notes });
    const stored = applyReceivedActa(tournament, received).rounds[0].debates[0];
    expect(stored.result!.joint).toEqual({ winnerTeamId: 'a', items: {}, speakers: {} });
    expect(computeDebateOutcome(tournament.rounds[0], stored, outcomeContext(tournament))).toMatchObject({ status: 'complete', winnerTeamId: 'a' });
  });

  it('finds each code once, whatever surrounds it, in both formats', () => {
    const tournament = aduma();
    const first = codeOf(tournament);
    const second = codeOf(tournament, entry({ winner: 'b' }));
    expect(findActaCodes('```' + first + '```\n' + first + ' ' + second + '\n' + v1.code.toLowerCase().replace('acta1', 'ACTA1'))).toEqual([first, second, v1.code]);
    expect(findActaCodes('nada por aquí')).toEqual([]);
  });

  it('still accepts codes in the first format', () => {
    const tournament = actaV1Tournament();
    const received = readActaCode(tournament, v1.code);
    expect(received.error).toBeNull();
    expect(received.payload).toEqual({ version: 1, debate: 'd1', round: 2, ...v1.entry });
    expect(encodeActaCode(decodeActaLink(v1.hash), v1.entry as ActaEntry)).toBe(v1.code);
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
