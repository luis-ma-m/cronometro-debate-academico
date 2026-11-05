export interface AssignedActaJudge {
  id: string;
  name: string;
}

export type ActaSignerMatch =
  | { kind: 'chair'; judgeId: string; judgeName: string }
  | { kind: 'panel'; judgeId: string; judgeName: string }
  | { kind: 'unmatched' };

const IGNORED_TOKENS = new Set(['dr', 'dra', 'don', 'dona', 'juez', 'jueza', 'profesor', 'profesora']);

/** Normalises accents, punctuation and spacing without changing the source name shown to organisers. */
function nameTokens(value: string): string[] {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !IGNORED_TOKENS.has(token));
}

function tokenMatches(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 3) return false;
  return left.startsWith(right) || right.startsWith(left);
}

function matchScore(signerTokens: string[], judgeTokens: string[]): { count: number; score: number } {
  const remaining = [...judgeTokens];
  let count = 0;
  for (const token of signerTokens) {
    const index = remaining.findIndex((candidate) => tokenMatches(token, candidate));
    if (index >= 0) {
      count++;
      remaining.splice(index, 1);
    }
  }
  return { count, score: signerTokens.length ? count / signerTokens.length + (judgeTokens.length ? count / judgeTokens.length * 0.2 : 0) : 0 };
}

/**
 * Identifies the signer only when the name gives enough evidence. A unique first name is accepted; partial names
 * with multiple tokens must match at least two tokens. Ambiguous or weak matches are deliberately reported as
 * unmatched instead of silently attributing an acta to the wrong member of the jury.
 */
export function matchActaSigner(signedBy: string, judges: AssignedActaJudge[], chairId: string): ActaSignerMatch {
  const signerTokens = nameTokens(signedBy);
  if (!signerTokens.length || !judges.length) return { kind: 'unmatched' };

  const candidates = judges.map((judge) => ({
    judge,
    ...matchScore(signerTokens, nameTokens(judge.name)),
  })).filter((candidate) => candidate.count > 0);

  if (signerTokens.length === 1) {
    if (candidates.length !== 1) return { kind: 'unmatched' };
  } else {
    const credible = candidates.filter((candidate) => candidate.count >= 2 && candidate.count / signerTokens.length >= 0.6);
    if (!credible.length) return { kind: 'unmatched' };
    credible.sort((a, b) => b.score - a.score);
    if (credible.length > 1 && Math.abs(credible[0].score - credible[1].score) < 0.001) return { kind: 'unmatched' };
    const best = credible[0];
    return best.judge.id === chairId
      ? { kind: 'chair', judgeId: best.judge.id, judgeName: best.judge.name }
      : { kind: 'panel', judgeId: best.judge.id, judgeName: best.judge.name };
  }

  const best = candidates[0].judge;
  return best.id === chairId
    ? { kind: 'chair', judgeId: best.id, judgeName: best.name }
    : { kind: 'panel', judgeId: best.id, judgeName: best.name };
}
