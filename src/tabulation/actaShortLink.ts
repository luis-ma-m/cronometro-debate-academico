import type { ActaLink } from './whatsapp';

/** Runtime guard for snapshots returned by the public short-link endpoint. */
export function isActaLinkSnapshot(value: unknown): value is ActaLink {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const link = value as Record<string, unknown>;
  const round = link.round;
  const rules = link.rules;
  if ((link.version !== 1 && link.version !== 2)
    || typeof link.tournament !== 'string'
    || typeof link.debate !== 'string' || !link.debate
    || typeof link.key !== 'string' || !link.key
    || typeof link.venue !== 'string'
    || typeof link.desk !== 'string'
    || !round || typeof round !== 'object' || Array.isArray(round)
    || !Number.isSafeInteger((round as Record<string, unknown>).number)
    || ((round as Record<string, unknown>).number as number) < 1
    || ((round as Record<string, unknown>).number as number) > 10000
    || typeof (round as Record<string, unknown>).name !== 'string'
    || typeof (round as Record<string, unknown>).elimination !== 'boolean'
    || !Array.isArray(link.teams) || link.teams.length !== 2
    || !Array.isArray(link.jury) || !link.jury.every((name) => typeof name === 'string')
    || !rules || typeof rules !== 'object' || Array.isArray(rules)) return false;
  const ids = new Set<string>();
  for (const rawTeam of link.teams) {
    if (!rawTeam || typeof rawTeam !== 'object' || Array.isArray(rawTeam)) return false;
    const team = rawTeam as Record<string, unknown>;
    if (typeof team.id !== 'string' || !team.id || ids.has(team.id)
      || typeof team.name !== 'string' || !team.name
      || !Array.isArray(team.members)) return false;
    ids.add(team.id);
    for (const rawMember of team.members) {
      if (!rawMember || typeof rawMember !== 'object' || Array.isArray(rawMember)) return false;
      const member = rawMember as Record<string, unknown>;
      if (typeof member.id !== 'string' || !member.id || ids.has(member.id)
        || typeof member.name !== 'string' || !member.name) return false;
      ids.add(member.id);
    }
  }
  const rubric = (rules as Record<string, unknown>).rubric;
  if (!Array.isArray(rubric) || !rubric.length || rubric.length > 100
    || !rubric.every((item) => !!item && typeof item === 'object' && !Array.isArray(item)
      && typeof (item as Record<string, unknown>).id === 'string'
      && typeof (item as Record<string, unknown>).name === 'string'
      && typeof (item as Record<string, unknown>).section === 'string')) return false;
  return true;
}
