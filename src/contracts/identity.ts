/**
 * Canonical identity contracts shared by the Gestión and Tabulación modules.
 *
 * These types deliberately do not merge their domain models. They provide a
 * stable identity boundary so adapters can translate specialized models
 * without matching records by display name or relying on unchecked casts.
 *
 * IDs remain opaque strings for backwards compatibility with persisted data.
 */
export type EntityKind =
  | 'tournament'
  | 'institution'
  | 'team'
  | 'speaker'
  | 'judge'
  | 'physical-room'
  | 'round'
  | 'debate'
  | 'assignment';

declare const canonicalIdBrand: unique symbol;
declare const sourceIdBrand: unique symbol;

export type CanonicalId<K extends EntityKind> = string & {
  readonly [canonicalIdBrand]: K;
};

export type SourceId<K extends EntityKind> = string & {
  readonly [sourceIdBrand]: K;
};

export type IdentitySource = 'manager' | 'tabulation' | 'legacy';

export interface EntityIdentity<K extends EntityKind> {
  readonly kind: K;
  readonly canonicalId: CanonicalId<K>;
  readonly source: IdentitySource;
  /** Original ID in the source model; retained for traceability and adapters. */
  readonly sourceId: SourceId<K>;
}

export class IdentityContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityContractError';
  }
}

/**
 * Validate an opaque persisted identifier without changing it. Whitespace-only
 * IDs and control characters are rejected, but legacy punctuation is allowed.
 */
function validateOpaqueId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200
    || value.trim().length === 0 || /[\\u0000-\\u001f\\u007f]/.test(value)) {
    throw new IdentityContractError(label + ' debe ser una cadena no vacía de hasta 200 caracteres y sin caracteres de control.');
  }
  return value;
}

export function canonicalId<K extends EntityKind>(kind: K, value: unknown): CanonicalId<K> {
  return validateOpaqueId(value, 'El ID canónico de ' + kind) as CanonicalId<K>;
}

export function sourceId<K extends EntityKind>(kind: K, value: unknown): SourceId<K> {
  return validateOpaqueId(value, 'El ID de origen de ' + kind) as SourceId<K>;
}

export function entityIdentity<K extends EntityKind>(
  kind: K,
  canonical: unknown,
  source: IdentitySource,
  original: unknown,
): EntityIdentity<K> {
  if (source !== 'manager' && source !== 'tabulation' && source !== 'legacy') {
    throw new IdentityContractError('El origen de identidad no está soportado.');
  }
  return Object.freeze({
    kind,
    canonicalId: canonicalId(kind, canonical),
    source,
    sourceId: sourceId(kind, original),
  });
}

/**
 * Resolve only an explicitly persisted ID mapping. Deliberately no name,
 * institution-name, ordering, or fuzzy fallback is provided.
 */
export function resolveMappedIdentity<K extends EntityKind>(
  kind: K,
  mapping: Readonly<Record<string, string>>,
  originalId: unknown,
): CanonicalId<K> | null {
  const source = sourceId(kind, originalId);
  const mapped = mapping[source];
  return mapped === undefined ? null : canonicalId(kind, mapped);
}

/** Runtime guard for untrusted identity DTOs received across a module/API boundary. */
export function parseEntityIdentity<K extends EntityKind>(
  expectedKind: K,
  value: unknown,
): EntityIdentity<K> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IdentityContractError('La identidad debe ser un objeto.');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== expectedKind) {
    throw new IdentityContractError('El tipo de entidad no coincide con el contrato esperado.');
  }
  return entityIdentity(
    expectedKind,
    candidate.canonicalId,
    candidate.source as IdentitySource,
    candidate.sourceId,
  );
}
