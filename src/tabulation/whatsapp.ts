import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { canonicalJson, cyrb53 } from './hash';
import {
  SPEAKER_ROLES,
  type TabDebate, type TabDebateResult, type TabJointActa, type TabPenalties, type TabRound, type TabSettings, type TabSpeakerEntry, type TabTournament,
} from './types';

/**
 * Actas by WhatsApp, with no server. The link sent to the chair carries everything the judges' page needs; the
 * code the judge sends back carries the acta, signed with a key derived from the tournament and the debate, so the
 * desk detects codes that are cut, altered or meant for another debate. Both use only digits and capital letters,
 * which WhatsApp never turns into italics, bold or links.
 */
export const ACTA_PAGE_PATH = '/acta';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LINK_PATTERN = /^#?A1-([0-9A-Za-z]+)-([0-9a-fA-F]{14})$/;
const CODE_PATTERN = /ACTA1-([0-9A-Za-z]+)-([0-9a-fA-F]{14})(?![0-9A-Za-z])/g;
const BROKEN_LINK = 'El enlace del acta está incompleto o dañado: pide a la mesa de tabulación que te lo vuelva a enviar.';
const BROKEN_CODE = 'El código está dañado o incompleto: pide al juez que lo vuelva a enviar.';

export class ActaFormatError extends Error {}

export type ActaRules = Pick<TabSettings,
  'rubric' | 'itemMin' | 'itemMax' | 'speakerScores' | 'speakerScoreMin' | 'speakerScoreMax' | 'speakerScoreStep'
  | 'warningConversion' | 'minorEscalation' | 'minorPoints' | 'minorsPerMajor' | 'majorMode' | 'majorPoints'>;

/** What the judges' page receives inside its link. */
export interface ActaLink {
  version: 1;
  tournament: string;
  round: { number: number; name: string; elimination: boolean };
  debate: string;
  key: string;
  venue: string;
  teams: Array<{ id: string; name: string; members: Array<{ id: string; name: string }> }>;
  /** Names, chair first. */
  jury: string[];
  rules: ActaRules;
  /** The desk's WhatsApp number; empty lets the judge choose the chat. */
  desk: string;
}

/** What the judge sends back: the acta of the paper, by team id. */
export interface ActaCode {
  version: 1;
  debate: string;
  round: number;
  favor: string;
  winner: string;
  items: Record<string, Record<string, number>>;
  quickTotals?: Record<string, number>;
  writtenTotals?: Record<string, number>;
  penalties: Record<string, TabPenalties>;
  speakers: Record<string, TabSpeakerEntry[]>;
  notes: string;
  signedBy: string;
  sentAt: number;
}

export type ActaEntry = Omit<ActaCode, 'version' | 'debate' | 'round'>;

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Crockford base32: lower case, O for 0 and I or L for 1 are accepted, as people misread them. */
export function base32Decode(text: string): Uint8Array {
  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (const raw of text.toUpperCase()) {
    const char = raw === 'O' ? '0' : raw === 'I' || raw === 'L' ? '1' : raw;
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new ActaFormatError('Carácter no válido.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

function pack(value: unknown): string {
  return base32Encode(deflateSync(strToU8(JSON.stringify(value)), { level: 9 }));
}

function unpack(text: string): unknown {
  return JSON.parse(strFromU8(inflateSync(base32Decode(text))));
}

/** Secret of a debate's acta, derived from data the judges never see (the tournament id and seed). */
export function actaKey(tournament: Pick<TabTournament, 'id' | 'seed'>, debateId: string): string {
  return cyrb53('acta|' + tournament.id + '|' + tournament.seed + '|' + debateId);
}

export function actaRules(settings: TabSettings): ActaRules {
  const { rubric, itemMin, itemMax, speakerScores, speakerScoreMin, speakerScoreMax, speakerScoreStep, warningConversion, minorEscalation, minorPoints, minorsPerMajor, majorMode, majorPoints } = settings;
  // Descriptions stay out of the link to keep it short; the judges' page shows them by item id.
  return {
    rubric: rubric.map(({ id, name, section }) => ({ id, name, section, description: '' })),
    itemMin, itemMax, speakerScores, speakerScoreMin, speakerScoreMax, speakerScoreStep, warningConversion, minorEscalation, minorPoints, minorsPerMajor, majorMode, majorPoints,
  };
}

export function buildActaLink(tournament: TabTournament, round: TabRound, debate: TabDebate, baseUrl: string): { url: string; link: ActaLink } {
  const teams = new Map(tournament.teams.map((team) => [team.id, team.name]));
  const judges = new Map(tournament.judges.map((judge) => [judge.id, judge.name]));
  const jury = [debate.chairId, ...debate.judgeIds.filter((id) => id !== debate.chairId)].filter((id) => id && debate.judgeIds.includes(id));
  const link: ActaLink = {
    version: 1,
    tournament: tournament.name,
    round: { number: round.number, name: round.name, elimination: round.kind === 'elimination' },
    debate: debate.id,
    key: actaKey(tournament, debate.id),
    venue: tournament.venues.find((venue) => venue.id === debate.venueId)?.name ?? '',
    teams: debate.teamIds.map((teamId) => ({
      id: teamId,
      name: teams.get(teamId) ?? 'Equipo',
      members: tournament.speakers.filter((speaker) => speaker.teamId === teamId).map((speaker) => ({ id: speaker.id, name: speaker.name })),
    })),
    jury: jury.map((id) => judges.get(id) ?? 'Juez'),
    rules: actaRules(tournament.settings),
    desk: whatsAppNumber(tournament.whatsapp?.deskPhone ?? ''),
  };
  const data = pack(link);
  return { url: baseUrl.replace(/\/+$/, '') + ACTA_PAGE_PATH + '#A1-' + data + '-' + cyrb53(data), link };
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isLink(value: unknown): value is ActaLink {
  if (!isRecord(value) || value.version !== 1 || !isText(value.debate) || !isText(value.key) || !isText(value.tournament) || !isText(value.venue) || !isText(value.desk)) return false;
  if (!isRecord(value.round) || !isNumber(value.round.number) || !isText(value.round.name) || typeof value.round.elimination !== 'boolean') return false;
  if (!Array.isArray(value.jury) || !value.jury.every(isText) || !isRecord(value.rules) || !Array.isArray(value.rules.rubric)) return false;
  return Array.isArray(value.teams) && value.teams.length === 2 && value.teams.every((team) => isRecord(team) && isText(team.id) && isText(team.name)
    && Array.isArray(team.members) && team.members.every((member) => isRecord(member) && isText(member.id) && isText(member.name)));
}

/** Reads the part of the judges' link after «#». */
export function decodeActaLink(hash: string): ActaLink {
  const match = LINK_PATTERN.exec(hash.trim());
  if (!match || cyrb53(match[1]) !== match[2].toLowerCase()) throw new ActaFormatError(BROKEN_LINK);
  let value: unknown;
  try {
    value = unpack(match[1]);
  } catch {
    throw new ActaFormatError(BROKEN_LINK);
  }
  if (!isLink(value)) throw new ActaFormatError(BROKEN_LINK);
  return value;
}

export function encodeActaCode(link: ActaLink, entry: ActaEntry): string {
  const payload: ActaCode = { version: 1, debate: link.debate, round: link.round.number, ...entry };
  const data = pack(payload);
  return 'ACTA1-' + data + '-' + cyrb53(link.key + '|' + data);
}

/** Every acta code in a pasted text (a few WhatsApp messages or a whole chat), each once. */
export function findActaCodes(text: string): string[] {
  const codes: string[] = [];
  for (const match of text.matchAll(CODE_PATTERN)) {
    const code = 'ACTA1-' + match[1].toUpperCase() + '-' + match[2].toLowerCase();
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

function numberMap(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(isRecord(value) ? value : {}).filter((entry): entry is [string, number] => isNumber(entry[1])));
}

/** Tolerant reader: keeps only well-formed values, so a strange code can never break the tabulation. */
function normalizeActaCode(raw: unknown): ActaCode | null {
  if (!isRecord(raw) || raw.version !== 1 || !isText(raw.debate) || !Number.isInteger(raw.round)) return null;
  const count = (value: unknown) => (isNumber(value) ? Math.max(0, Math.floor(value)) : 0);
  const penalties: Record<string, TabPenalties> = {};
  for (const [teamId, value] of Object.entries(isRecord(raw.penalties) ? raw.penalties : {})) {
    if (isRecord(value)) penalties[teamId] = { warnings: count(value.warnings), minors: count(value.minors), majors: count(value.majors), disqualified: value.disqualified === true };
  }
  const speakers: Record<string, TabSpeakerEntry[]> = {};
  for (const [teamId, rows] of Object.entries(isRecord(raw.speakers) ? raw.speakers : {})) {
    speakers[teamId] = (Array.isArray(rows) ? rows : []).filter((row): row is Record<string, unknown> => isRecord(row) && isText(row.speakerId) && isNumber(row.score))
      .map((row) => ({ speakerId: row.speakerId as string, score: row.score as number, roles: SPEAKER_ROLES.filter((role) => Array.isArray(row.roles) && row.roles.includes(role)).sort((x, y) => (row.roles as unknown[]).indexOf(x) - (row.roles as unknown[]).indexOf(y)) }));
  }
  return {
    version: 1,
    debate: raw.debate,
    round: raw.round as number,
    favor: isText(raw.favor) ? raw.favor : '',
    winner: isText(raw.winner) ? raw.winner : '',
    items: Object.fromEntries(Object.entries(isRecord(raw.items) ? raw.items : {}).map(([teamId, row]) => [teamId, numberMap(row)])),
    ...(isRecord(raw.quickTotals) ? { quickTotals: numberMap(raw.quickTotals) } : {}),
    ...(isRecord(raw.writtenTotals) ? { writtenTotals: numberMap(raw.writtenTotals) } : {}),
    penalties,
    speakers,
    notes: isText(raw.notes) ? raw.notes.slice(0, 2000) : '',
    signedBy: isText(raw.signedBy) ? raw.signedBy.slice(0, 120) : '',
    sentAt: isNumber(raw.sentAt) ? raw.sentAt : 0,
  };
}

export interface ReceivedActa { code: string; payload: ActaCode | null; roundId: string | null; debateId: string | null; error: string | null }

export function readActaCode(tournament: TabTournament, code: string): ReceivedActa {
  const failed = (error: string, place: Pick<ReceivedActa, 'roundId' | 'debateId'> = { roundId: null, debateId: null }): ReceivedActa => ({ code, payload: null, ...place, error });
  const match = /^ACTA1-([0-9A-Za-z]+)-([0-9a-fA-F]{14})$/.exec(code.trim());
  if (!match) return failed(BROKEN_CODE);
  const data = match[1].toUpperCase();
  let payload: ActaCode | null;
  try {
    payload = normalizeActaCode(unpack(data));
  } catch {
    payload = null;
  }
  if (!payload) return failed(BROKEN_CODE);
  const round = tournament.rounds.find((item) => item.debates.some((debate) => debate.id === payload.debate));
  const debate = round?.debates.find((item) => item.id === payload.debate);
  if (!round || !debate) return failed('Este código no es de ningún debate de este torneo (¿se volvió a sortear la ronda?).');
  if (cyrb53(actaKey(tournament, debate.id) + '|' + data) !== match[2].toLowerCase()) {
    return failed('El código no coincide con su debate: está alterado o es de otro torneo.', { roundId: round.id, debateId: debate.id });
  }
  return { code, payload, roundId: round.id, debateId: debate.id, error: null };
}

/** The debate with the received acta. The organisers' decision and the notes already typed are kept. */
function receivedDebate(round: TabRound, debate: TabDebate, payload: ActaCode, now: number): TabDebate {
  const teams = debate.teamIds;
  const ofTeams = <T,>(record: Record<string, T> | undefined): Record<string, T> => Object.fromEntries(Object.entries(record ?? {}).filter(([teamId]) => teams.includes(teamId)));
  const winner = teams.includes(payload.winner) ? payload.winner : '';
  const quickTotals = ofTeams(payload.quickTotals);
  const writtenTotals = ofTeams(payload.writtenTotals);
  const joint: TabJointActa = round.kind === 'elimination'
    ? { winnerTeamId: winner, items: {}, speakers: {} }
    : {
      winnerTeamId: winner,
      items: ofTeams(payload.items),
      ...(Object.keys(quickTotals).length ? { quickTotals } : {}),
      ...(Object.keys(writtenTotals).length ? { writtenTotals } : {}),
      speakers: ofTeams(payload.speakers),
    };
  const juryNote = payload.notes.trim() ? 'Notas del jurado' + (payload.signedBy ? ' (' + payload.signedBy + ')' : '') + ': ' + payload.notes.trim() : '';
  const previous = debate.result?.notes.trim() ?? '';
  const notes = !juryNote || previous.includes(juryNote) ? previous : previous ? previous + '\n' + juryNote : juryNote;
  const result: TabDebateResult = {
    lineup: {},
    ballots: [],
    penalties: round.kind === 'elimination' ? {} : ofTeams(payload.penalties),
    ...(debate.result?.override ? { override: debate.result.override } : {}),
    joint,
    notes,
    updatedAt: now,
  };
  const favor = teams.includes(payload.favor) ? payload.favor : debate.favorTeamId;
  return { ...debate, ...(favor ? { favorTeamId: favor } : {}), result };
}

export function applyReceivedActa(tournament: TabTournament, received: ReceivedActa, now = Date.now()): TabTournament {
  const payload = received.payload;
  if (!payload || received.error) return tournament;
  return {
    ...tournament,
    rounds: tournament.rounds.map((round) => (round.id !== received.roundId ? round : {
      ...round,
      debates: round.debates.map((debate) => (debate.id === received.debateId ? receivedDebate(round, debate, payload, now) : debate)),
    })),
  };
}

/** True when the debate already holds exactly this acta (accepting it again would change nothing). */
export function receivedIsRegistered(tournament: TabTournament, received: ReceivedActa): boolean {
  if (!received.payload || received.error) return false;
  const round = tournament.rounds.find((item) => item.id === received.roundId);
  const debate = round?.debates.find((item) => item.id === received.debateId);
  if (!round || !debate?.result) return false;
  const next = receivedDebate(round, debate, received.payload, debate.result.updatedAt);
  const relevant = (item: TabDebate) => canonicalJson({ favor: item.favorTeamId ?? '', joint: item.result?.joint, penalties: item.result?.penalties });
  return relevant(next) === relevant(debate);
}

/** International digits for wa.me: 600 11 22 33 → 34600112233 (Spanish numbers without prefix). */
export function whatsAppNumber(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9 && /^[6789]/.test(digits)) digits = '34' + digits;
  return digits;
}

export function whatsAppUrl(phone: string, text: string): string {
  return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
}

export function actaLinkMessage(link: ActaLink, url: string): string {
  const [a, b] = link.teams;
  return (link.jury[0] ? 'Hola, ' + link.jury[0] + '. ' : 'Hola. ') + 'Acta de ' + link.round.name + (link.venue ? ' · ' + link.venue : '') + ': ' + a.name + ' – ' + b.name + '.\n'
    + 'Ábrela en el móvil, rellénala con el jurado y pulsa «Enviar por WhatsApp» al final:\n' + url;
}

export function actaCodeMessage(link: ActaLink, entry: ActaEntry, summary: string): string {
  const [a, b] = link.teams;
  return 'Acta · ' + link.round.name + (link.venue ? ' · ' + link.venue : '') + '\n' + a.name + ' – ' + b.name + ': ' + summary
    + (entry.signedBy ? '\nFirma: ' + entry.signedBy : '') + '\n\n' + encodeActaCode(link, entry);
}
