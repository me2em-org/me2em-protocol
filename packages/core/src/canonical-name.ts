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
