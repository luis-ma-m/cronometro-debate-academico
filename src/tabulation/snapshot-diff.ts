/** Compares persisted tournament content while ignoring revision and timestamps used only for sync bookkeeping. */
export function findSnapshotDifferences(local: unknown, remote: unknown): SnapshotDifference[] {
  const differences: SnapshotDifference[] = [];
  const ignored = new Set(['revision', 'updatedAt', 'createdAt', 'logTail', 'logSeq']);
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
    }
    return JSON.stringify(value);
  };
  const visit = (left: unknown, right: unknown, path: string, depth: number) => {
    if (stable(left) === stable(right)) return;
    if (depth > 8) {
      differences.push({ path, localValue: left, remoteValue: right });
      return;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      const a = Array.isArray(left) ? left : [];
      const b = Array.isArray(right) ? right : [];
      const keyed = [...a, ...b].every((item) => item && typeof item === 'object' && 'id' in item);
      if (!keyed) {
        differences.push({ path, localValue: left, remoteValue: right });
        return;
      }
      const byId = (items: unknown[]) => new Map(items.map((item) => [String((item as { id: unknown }).id), item]));
      const am = byId(a), bm = byId(b);
      for (const id of [...new Set([...am.keys(), ...bm.keys()])].sort()) {
        visit(am.get(id), bm.get(id), path + '[' + id + ']', depth + 1);
      }
      return;
    }
    if (left && typeof left === 'object' && right && typeof right === 'object') {
      const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !ignored.has(key)).sort();
      for (const key of keys) visit(a[key], b[key], path ? path + '.' + key : key, depth + 1);
      return;
    }
    differences.push({ path, localValue: left, remoteValue: right });
  };
  visit(local, remote, '', 0);
  return differences;
}

