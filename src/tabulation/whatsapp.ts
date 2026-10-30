import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { canonicalJson, cyrb53 } from './hash';
import { presetSettings } from './presets';
import {
  SPEAKER_ROLES,
  type TabDebate, type TabDebateResult, type TabJointActa, type TabPenalties, type TabRound, type TabSettings, type TabSpeaker, type TabSpeakerEntry, type TabTournament,
} from './types';

/**
 * Actas by WhatsApp, with no server. The link sent to the chair carries what the judges' page cannot know: the names
 * of the teams, their members and the jury, and the rules only where they differ from the ADUMA reglamento. The code
 * the judge sends back carries the acta, signed with a key derived from the tournament and the debate, so the desk
 * detects codes that are cut, altered, meant for another debate or written before the debate changed. Both use only
 * letters and digits, which WhatsApp never turns into italics, bold or strikethrough.
 *
 * Formats: A2 links and ACTA2 codes (compact: teams, members and items by position, base62). The first ones (A1,
 * ACTA1: ids and full rules, base32) are still read, so links sent before keep working.
 */
export const ACTA_PAGE_PATH = '/acta';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Characters that encode a group of 0–8 bytes (a whole group of 8 takes 11). */
const GROUP_CHARS = [0, 2, 3, 5, 6, 7, 9, 10, 11];
const LINK_V1 = /^#?A1-([0-9A-Za-z]+)-([0-9a-fA-F]{14})$/;
const LINK_V2 = /^#?A2-([0-9A-Za-z]+)-([0-9a-fA-F]{8})$/; // Legacy links remain valid.
const LINK_V2_COMPACT = /^#?A2([0-9A-Za-z]+)$/;
const CODE_V1 = /^ACTA1-([0-9A-Za-z]+)-([0-9a-fA-F]{14})$/;
const CODE_V2 = /^ACTA2-([0-9A-Za-z]+)-([0-9a-fA-F]{14})$/;
const CODES = /ACTA([12])-([0-9A-Za-z]+)-([0-9a-fA-F]{14})(?![0-9A-Za-z])/g;
/** Team ids inside the judges' page of a compact link: the order of the debate. */
const TEAM_KEYS = ['A', 'B'];
const BROKEN_LINK = 'El enlace del acta está incompleto o dañado: pide a la mesa de tabulación que te lo vuelva a enviar.';
const BROKEN_CODE = 'El código está dañado o incompleto: pide al juez que lo vuelva a enviar.';
const NO_DEBATE = 'Este código no es de ningún debate de este torneo: está dañado o alterado, o su ronda se volvió a sortear.';

export class ActaFormatError extends Error {}

export type ActaRules = Pick<TabSettings,
  'rubric' | 'itemMin' | 'itemMax' | 'speakerScores' | 'speakerScoreMin' | 'speakerScoreMax' | 'speakerScoreStep'
  | 'warningConversion' | 'minorEscalation' | 'minorPoints' | 'minorsPerMajor' | 'majorMode' | 'majorPoints'>;

/** What the judges' page receives inside its link. */
export interface ActaLink {
  /** 1: first format, with ids; 2: compact, with teams and members by position. */
  version: 1 | 2;
  /** Empty in compact links. */
  tournament: string;
  round: { number: number; name: string; elimination: boolean };
  /** The debate id (first format) or a short reference to it (compact). It also names the phone's draft. */
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

/** What the judge sends back, as the desk reads it: the acta of the paper, by team id. */
export interface ActaCode {
  /** Format of the code it came in. */
  version: 1 | 2;
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

/** Letters and digits only, 11 characters for every 8 bytes (base32 needs 13). */
export function base62Encode(bytes: Uint8Array): string {
  let out = '';
  for (let start = 0; start < bytes.length; start += 8) {
    const group = bytes.subarray(start, start + 8);
    let value = 0n;
    for (const byte of group) value = (value << 8n) | BigInt(byte);
    let text = '';
    for (let index = 0; index < GROUP_CHARS[group.length]; index++) {
      text = BASE62[Number(value % 62n)] + text;
      value /= 62n;
    }
    out += text;
  }
  return out;
}

export function base62Decode(text: string): Uint8Array {
  const out: number[] = [];
  for (let start = 0; start < text.length; start += 11) {
    const chunk = text.slice(start, start + 11);
    const length = GROUP_CHARS.indexOf(chunk.length);
    if (length < 1) throw new ActaFormatError('Longitud no válida.');
    let value = 0n;
    for (const char of chunk) {
      const digit = BASE62.indexOf(char);
      if (digit < 0) throw new ActaFormatError('Carácter no válido.');
      value = value * 62n + BigInt(digit);
    }
    if (value >> BigInt(length * 8)) throw new ActaFormatError('Valor no válido.');
    for (let index = length - 1; index >= 0; index--) out.push(Number((value >> BigInt(index * 8)) & 255n));
  }
  return Uint8Array.from(out);
}

function pack(value: unknown, encode: (bytes: Uint8Array) => string = base32Encode): string {
  return encode(deflateSync(strToU8(JSON.stringify(value)), { level: 9 }));
}

function unpack(text: string, decode: (text: string) => Uint8Array = base32Decode): unknown {
  return JSON.parse(strFromU8(inflateSync(decode(text))));
}

/** Secret of a debate's acta (first format), derived from data the judges never see (the tournament id and seed). */
export function actaKey(tournament: Pick<TabTournament, 'id' | 'seed'>, debateId: string): string {
  return cyrb53('acta|' + tournament.id + '|' + tournament.seed + '|' + debateId);
}

/** What compact links and codes rely on: the order of the teams, of their members and of the items. */
function debateContext(tournament: TabTournament, debate: TabDebate): { teamIds: string[]; members: TabSpeaker[][]; rubric: string[] } {
  return {
    teamIds: debate.teamIds,
    members: debate.teamIds.map((teamId) => tournament.speakers.filter((speaker) => speaker.teamId === teamId)),
    rubric: tournament.settings.rubric.map((item) => item.id),
  };
}

/**
 * Secret of a compact acta. It also covers the order the positions refer to, so a code written before the teams,
 * members or items of its debate changed no longer matches instead of landing on the wrong speaker or item.
 */
function compactKey(tournament: TabTournament, debate: TabDebate): string {
  const { teamIds, members, rubric } = debateContext(tournament, debate);
  return cyrb53('acta2|' + tournament.id + '|' + tournament.seed + '|' + debate.id + '|' + canonicalJson([teamIds, members.map((list) => list.map((speaker) => speaker.id)), rubric]));
}

/** Short reference to a debate inside compact links and codes. */
function debateRef(tournament: Pick<TabTournament, 'id'>, debateId: string): string {
  return cyrb53('ref|' + tournament.id + '|' + debateId).slice(0, 8);
}

export function actaRules(settings: TabSettings): ActaRules {
  const { rubric, itemMin, itemMax, speakerScores, speakerScoreMin, speakerScoreMax, speakerScoreStep, warningConversion, minorEscalation, minorPoints, minorsPerMajor, majorMode, majorPoints } = settings;
  // Descriptions stay out of the link to keep it short; the judges' page shows them by item id.
  return {
    rubric: rubric.map(({ id, name, section }) => ({ id, name, section, description: '' })),
    itemMin, itemMax, speakerScores, speakerScoreMin, speakerScoreMax, speakerScoreStep, warningConversion, minorEscalation, minorPoints, minorsPerMajor, majorMode, majorPoints,
  };
}

const ADUMA_RULES = actaRules(presetSettings('aduma'));

/** The rules that differ from the ADUMA reglamento: usually none, so the link does not carry them. */
function rulesDiff(rules: ActaRules): Partial<ActaRules> {
  return Object.fromEntries(Object.entries(rules).filter(([key, value]) => canonicalJson(value) !== canonicalJson(ADUMA_RULES[key as keyof ActaRules])));
}

/** The ADUMA rules with the differences of a link, keeping only known rules of the right type. */
function rulesFrom(diff: unknown): ActaRules {
  const rules: Record<string, unknown> = { ...ADUMA_RULES };
  for (const [key, value] of Object.entries(isRecord(diff) ? diff : {})) {
    const base = rules[key];
    if (key === 'rubric') {
      if (Array.isArray(value) && value.length && value.every((item) => isRecord(item) && isText(item.id) && isText(item.name) && isText(item.section))) {
        rules.rubric = value.map((item: Record<string, string>) => ({ id: item.id, name: item.name, section: item.section, description: '' }));
      }
    } else if (base !== undefined && typeof value === typeof base && (typeof value !== 'number' || Number.isFinite(value))) rules[key] = value;
  }
  return rules as unknown as ActaRules;
}

/** Link for the chair of a debate, in the compact format. */
export function buildActaLink(tournament: TabTournament, round: TabRound, debate: TabDebate, baseUrl: string): { url: string; link: ActaLink } {
  const teams = new Map(tournament.teams.map((team) => [team.id, team.name]));
  const judges = new Map(tournament.judges.map((judge) => [judge.id, judge.name]));
  const jury = [debate.chairId, ...debate.judgeIds.filter((id) => id !== debate.chairId)].filter((id) => id && debate.judgeIds.includes(id));
  const { teamIds, members } = debateContext(tournament, debate);
  const compact = [
    round.number,
    round.kind === 'elimination' ? 1 : 0,
    round.name === 'Ronda ' + round.number ? '' : round.name,
    debateRef(tournament, debate.id),
    compactKey(tournament, debate),
    tournament.venues.find((venue) => venue.id === debate.venueId)?.name ?? '',
    teamIds.map((teamId, index) => [teams.get(teamId) ?? 'Equipo', members[index].map((speaker) => speaker.name)]),
    jury.map((id) => judges.get(id!) ?? 'Juez'),
    whatsAppNumber(tournament.whatsapp?.deskPhone ?? ''),
    rulesDiff(actaRules(tournament.settings)),
  ];
  const data = pack(compact, base62Encode);
  // Keep the fragment alphanumeric and contiguous: WhatsApp iOS otherwise stops auto-linking at the first hyphen.\n  // The final 8 characters are the checksum, so no separator is needed.\n  return { url: baseUrl.replace(/\\/+$/, '') + ACTA_PAGE_PATH + '#A2' + data + cyrb53(data).slice(0, 8), link: linkFromCompact(compact)! };
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The judges' page view of a compact link: teams A and B, members A0, A1… in the order of the desk. */
function linkFromCompact(value: unknown): ActaLink | null {
  if (!Array.isArray(value) || value.length < 10) return null;
  const [number, elimination, name, ref, key, venue, teams, jury, desk, rules] = value as unknown[];
  if (!Number.isInteger(number) || (elimination !== 0 && elimination !== 1) || !isText(name) || !isText(ref) || !isText(key) || !isText(venue) || !isText(desk)) return null;
  if (!Array.isArray(jury) || !jury.every(isText)) return null;
  if (!Array.isArray(teams) || teams.length !== 2) return null;
  if (!teams.every((team) => Array.isArray(team) && isText(team[0]) && Array.isArray(team[1]) && team[1].every(isText))) return null;
  return {
    version: 2,
    tournament: '',
    round: { number: number as number, name: name || 'Ronda ' + number, elimination: elimination === 1 },
    debate: ref,
    key,
    venue,
    teams: (teams as [string, string[]][]).map(([teamName, names], index) => ({
      id: TEAM_KEYS[index],
      name: teamName,
      members: names.map((memberName, position) => ({ id: TEAM_KEYS[index] + position, name: memberName })),
    })),
    jury,
    rules: rulesFrom(rules),
    desk,
  };
}

function isLink(value: unknown): value is ActaLink {
  if (!isRecord(value) || value.version !== 1 || !isText(value.debate) || !isText(value.key) || !isText(value.tournament) || !isText(value.venue) || !isText(value.desk)) return false;
  if (!isRecord(value.round) || !isNumber(value.round.number) || !isText(value.round.name) || typeof value.round.elimination !== 'boolean') return false;
  if (!Array.isArray(value.jury) || !value.jury.every(isText) || !isRecord(value.rules) || !Array.isArray(value.rules.rubric)) return false;
  return Array.isArray(value.teams) && value.teams.length === 2 && value.teams.every((team) => isRecord(team) && isText(team.id) && isText(team.name)
    && Array.isArray(team.members) && team.members.every((member) => isRecord(member) && isText(member.id) && isText(member.name)));
}

/** Reads the part of the judges' link after «#», in either format. */
export function decodeActaLink(hash: string): ActaLink {
  const normalized = hash.trim();
  const compact = LINK_V2.exec(normalized);
  const compactWithoutSeparators = LINK_V2_COMPACT.exec(normalized);
  if (compact || compactWithoutSeparators) {
    // New WhatsApp-safe links carry data + checksum as one alphanumeric fragment.
    // Keep accepting the previous A2 form so already-sent messages do not break.
    const data = compact ? compact[1] : compactWithoutSeparators![1].slice(0, -8);
    const checksum = compact ? compact[2] : compactWithoutSeparators![1].slice(-8);
    if (!data || cyrb53(data).slice(0, 8) !== checksum.toLowerCase()) throw new ActaFormatError(BROKEN_LINK);
    let link: ActaLink | null = null;
    try {
      link = linkFromCompact(unpack(data, base62Decode));
    } catch { /* Reported below. */ }
    if (!link) throw new ActaFormatError(BROKEN_LINK);
    return link;
  }
  const match = LINK_V1.exec(hash.trim());
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

/** The code the judge sends back, in the format of the link it was opened from. */
export function encodeActaCode(link: ActaLink, entry: ActaEntry): string {
  if (link.version === 2) {
    const data = pack(compactActa(link, entry), base62Encode);
    return 'ACTA2-' + data + '-' + cyrb53(link.key + '|' + data);
  }
  const payload: ActaCode = { version: 1, debate: link.debate, round: link.round.number, ...entry };
  const data = pack(payload);
  return 'ACTA1-' + data + '-' + cyrb53(link.key + '|' + data);
}

/**
 * The acta of a compact link: [round, debate, side, winner, items, quick totals, written totals, faults, speakers,
 * notes, signature, time]. Teams and members go by their position in the link, items in the order of the sheet and
 * the positions of each speaker as a bit mask; 0 marks what an elimination or the acta does not carry.
 */
function compactActa(link: ActaLink, entry: ActaEntry): unknown[] {
  const teamIndex = (id: string) => link.teams.findIndex((team) => team.id === id);
  const perTeam = (record: Record<string, number> | undefined) => (record ? link.teams.map((team) => record[team.id] ?? null) : 0);
  const sheet = !link.round.elimination;
  return [
    link.round.number,
    link.debate,
    teamIndex(entry.favor),
    teamIndex(entry.winner),
    sheet ? link.teams.map((team) => link.rules.rubric.map((item) => entry.items[team.id]?.[item.id] ?? null)) : 0,
    sheet ? perTeam(entry.quickTotals) : 0,
    sheet ? perTeam(entry.writtenTotals) : 0,
    sheet ? link.teams.map((team) => {
      const penalty = entry.penalties[team.id];
      return [penalty?.warnings ?? 0, penalty?.minors ?? 0, penalty?.majors ?? 0];
    }) : 0,
    sheet ? link.teams.map((team) => (entry.speakers[team.id] ?? [])
      .map((row) => [team.members.findIndex((member) => member.id === row.speakerId), row.score, SPEAKER_ROLES.reduce((mask, role, index) => (row.roles.includes(role) ? mask | (1 << index) : mask), 0)])
      .filter(([position]) => position >= 0)) : 0,
    entry.notes,
    entry.signedBy,
    Math.round(entry.sentAt / 1000),
  ];
}

/** Every acta code in a pasted text (a few WhatsApp messages or a whole chat), each once. */
export function findActaCodes(text: string): string[] {
  const codes: string[] = [];
  for (const match of text.matchAll(CODES)) {
    // The first format is base32 and ignores case; the compact one does not.
    const code = 'ACTA' + match[1] + '-' + (match[1] === '1' ? match[2].toUpperCase() : match[2]) + '-' + match[3].toLowerCase();
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

/**
 * A compact acta back in the desk's terms, through the current order of its debate (the signature already proved it
 * is the order the judge saw). Like the first format, only well-formed values are kept.
 */
function actaFromCompact(raw: unknown[], round: TabRound, debate: TabDebate, tournament: TabTournament): ActaCode {
  const { teamIds, members, rubric } = debateContext(tournament, debate);
  const team = (value: unknown) => (value === 0 || value === 1 ? teamIds[value] ?? '' : '');
  const count = (value: unknown) => (isNumber(value) ? Math.max(0, Math.floor(value)) : 0);
  /** Per team id, for the teams whose entry is a list. */
  const perTeam = <T,>(value: unknown, read: (list: unknown[], index: number) => T): Record<string, T> => Object.fromEntries(
    teamIds.flatMap((teamId, index) => (Array.isArray(value) && Array.isArray(value[index]) ? [[teamId, read(value[index], index)]] : [])),
  );
  const totals = (value: unknown): Record<string, number> | undefined => (Array.isArray(value)
    ? Object.fromEntries(teamIds.flatMap((teamId, index) => (isNumber(value[index]) ? [[teamId, value[index] as number]] : [])))
    : undefined);
  const quickTotals = totals(raw[5]);
  const writtenTotals = totals(raw[6]);
  return {
    version: 2,
    debate: debate.id,
    round: round.number,
    favor: team(raw[2]),
    winner: team(raw[3]),
    items: perTeam(raw[4], (list) => Object.fromEntries(rubric.flatMap((itemId, index) => (isNumber(list[index]) ? [[itemId, list[index] as number]] : [])))),
    ...(quickTotals ? { quickTotals } : {}),
    ...(writtenTotals ? { writtenTotals } : {}),
    penalties: perTeam(raw[7], (list): TabPenalties => ({ warnings: count(list[0]), minors: count(list[1]), majors: count(list[2]), disqualified: false })),
    speakers: perTeam(raw[8], (list, index) => list.flatMap((row): TabSpeakerEntry[] => {
      if (!Array.isArray(row) || !Number.isInteger(row[0]) || !isNumber(row[1])) return [];
      const speaker = members[index][row[0] as number];
      const mask = Number.isInteger(row[2]) ? row[2] as number : 0;
      return speaker ? [{ speakerId: speaker.id, score: row[1] as number, roles: SPEAKER_ROLES.filter((_, bit) => mask & (1 << bit)) }] : [];
    })),
    notes: isText(raw[9]) ? raw[9].slice(0, 2000) : '',
    signedBy: isText(raw[10]) ? raw[10].slice(0, 120) : '',
    sentAt: isNumber(raw[11]) ? raw[11] * 1000 : 0,
  };
}

export interface ReceivedActa { code: string; payload: ActaCode | null; roundId: string | null; debateId: string | null; error: string | null }

export function readActaCode(tournament: TabTournament, code: string): ReceivedActa {
  const failed = (error: string, place: Pick<ReceivedActa, 'roundId' | 'debateId'> = { roundId: null, debateId: null }): ReceivedActa => ({ code, payload: null, ...place, error });
  const compact = CODE_V2.exec(code.trim());
  if (compact) {
    let raw: unknown = null;
    try {
      raw = unpack(compact[1], base62Decode);
    } catch { /* Reported below. */ }
    if (!Array.isArray(raw) || !Number.isInteger(raw[0]) || !isText(raw[1])) return failed(BROKEN_CODE);
    const round = tournament.rounds.find((item) => item.number === raw[0]);
    const debate = round?.debates.find((item) => debateRef(tournament, item.id) === raw[1]);
    if (!round || !debate) return failed(NO_DEBATE);
    if (cyrb53(compactKey(tournament, debate) + '|' + compact[1]) !== compact[2].toLowerCase()) {
      return failed('El código no coincide con su debate: está alterado o es de otro torneo, o el debate ha cambiado (equipos, integrantes u hoja de ítems) desde que se envió el enlace. Reenvía el enlace al juez.', { roundId: round.id, debateId: debate.id });
    }
    return { code, payload: actaFromCompact(raw, round, debate, tournament), roundId: round.id, debateId: debate.id, error: null };
  }
  const match = CODE_V1.exec(code.trim());
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
  if (!round || !debate) return failed(NO_DEBATE);
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

/** The link goes on its own line right at the start, so WhatsApp shows it whole and as a link. */
export function actaLinkMessage(link: ActaLink, url: string): string {
  const [a, b] = link.teams;
  return (link.jury[0] ? link.jury[0] + ': acta' : 'Acta') + ' de ' + link.round.name + (link.venue ? ' · ' + link.venue : '') + '\n'
    + url + '\n'
    + a.name + ' – ' + b.name + '. Rellénala con el jurado y pulsa «Enviar por WhatsApp» al final.';
}

export function actaCodeMessage(link: ActaLink, entry: ActaEntry, summary: string): string {
  const [a, b] = link.teams;
  return 'Acta · ' + link.round.name + (link.venue ? ' · ' + link.venue : '') + '\n' + a.name + ' – ' + b.name + ': ' + summary
    + (entry.signedBy ? '\nFirma: ' + entry.signedBy : '') + '\n\n' + encodeActaCode(link, entry);
}
