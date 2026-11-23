// canonical-name.ts

import { AttestationError } from './errors.js';

export const NAME_PATTERN = /^[a-z0-9][a-z0-9._@-]{0,62}$/;

export function normalizeName(raw: string): string {
  if (typeof raw !== 'string') throw new TypeError('Name must be a string');
  const name = raw.normalize('NFKC').toLowerCase().trim();
  if (!NAME_PATTERN.test(name)) {
    throw new AttestationError('MALFORMED', 'FORMAT', `Invalid name: ${JSON.stringify(raw)}`);
  }
  return name;
}

/**
 * Canonicalizes a password/channel context: NFKC → lowercase → trim.
 *
 * Same canonical form as {@link normalizeName} names use, minus the
 * character-set pattern — a context is a caller-defined HKDF label, not
 * a wire identifier. The canonical context is embedded verbatim into the
 * derivation salt (`me2em/secret/{context}`, `me2em/channel/{context}`),
 * so `'  GitHub '`, `'github'` and the fullwidth `'ＧitHub'` all map to
 * the same secret (specs/v1.0.md §1, since the revisions PR-8; the
 * pre-revision rule was lowercase → trim without NFKC).
 *
 * @param raw - Caller-defined context, e.g. `'github'`, `'telemetry-v1'`.
 * @returns The canonical context.
 * @throws TypeError if `raw` is not a string (API misuse).
 * @throws AttestationError `MALFORMED`/`FORMAT` if the context is empty
 *   after canonicalization.
 */
export function normalizeContext(raw: string): string {
  if (typeof raw !== 'string') throw new TypeError('Context must be a string');
  const ctx = raw.normalize('NFKC').toLowerCase().trim();
  if (ctx.length === 0) {
    throw new AttestationError(
      'MALFORMED',
      'FORMAT',
      `Context must not be empty after canonicalization: ${JSON.stringify(raw)}`
    );
  }
  return ctx;
}

// Resource-state components (rc.9, states ТЗ §3.2) ---------------------------
//
// Handle.deriveResourceKey builds its HKDF salt by joining the two
// structured components: `me2em/resource/{resourceType}/{resourceId}`.
// The join is only injective if neither component can contain the
// separator — so both are restricted to the NAME_PATTERN alphabet
// (`/`, `:`, whitespace and control characters are rejected outright),
// with extended length bounds so a 64-character sha256 hex and a
// 36-character UUID fit. The pattern check runs AFTER canonicalization.

/**
 * Resource-type pattern: `[a-z0-9]` starter plus `[a-z0-9._@-]` body,
 * at most 63 characters (same alphabet as {@link NAME_PATTERN}).
 */
export const RESOURCE_TYPE_PATTERN = /^[a-z0-9][a-z0-9._@-]{0,62}$/;

/**
 * Resource-id pattern: the same alphabet, at most 128 characters —
 * a 64-character sha256 hex digest or a 36-character UUID fits;
 * a URI or path does not (hash/UUID/slug first).
 */
export const RESOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._@-]{0,127}$/;

/**
 * Shared mechanics for {@link normalizeResourceType} /
 * {@link normalizeResourceId}: canonicalize via {@link normalizeContext},
 * then enforce the component pattern.
 */
function normalizeResourcePart(
  raw: string,
  pattern: RegExp,
  kind: string
): string {
  const ctx = normalizeContext(raw);
  if (!pattern.test(ctx)) {
    throw new AttestationError(
      'MALFORMED',
      'FORMAT',
      `Invalid ${kind}: ${JSON.stringify(raw)} — must match ${pattern} after canonicalization`
    );
  }
  return ctx;
}

/**
 * Canonicalizes a resource-type component: NFKC → lowercase → trim, then
 * the {@link RESOURCE_TYPE_PATTERN} charset/length check.
 *
 * @param raw - Caller-defined resource type, e.g. `'chat-msg'`, `'file'`.
 * @returns The canonical type (feeds the HKDF salt verbatim).
 * @throws TypeError if `raw` is not a string (API misuse).
 * @throws AttestationError `MALFORMED`/`FORMAT` if the type is empty after
 *   canonicalization or fails the pattern (separators, wrong alphabet).
 */
export function normalizeResourceType(raw: string): string {
  return normalizeResourcePart(raw, RESOURCE_TYPE_PATTERN, 'resourceType');
}

/**
 * Canonicalizes a resource-id component: NFKC → lowercase → trim, then
 * the {@link RESOURCE_ID_PATTERN} charset/length check.
 *
 * @param raw - Caller-defined resource id, e.g. a content sha256 hex, a
 *   UUID or a slug. URIs/paths are rejected — hash/UUID/slug instead.
 * @returns The canonical id (feeds the HKDF salt verbatim).
 * @throws TypeError if `raw` is not a string (API misuse).
 * @throws AttestationError `MALFORMED`/`FORMAT` if the id is empty after
 *   canonicalization or fails the pattern.
 */
export function normalizeResourceId(raw: string): string {
  return normalizeResourcePart(raw, RESOURCE_ID_PATTERN, 'resourceId');
}
