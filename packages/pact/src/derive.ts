// packages/pact/src/derive.ts
//
// Deterministic Pact Keys (PACTS D3/D38, ТЗ §3.2):
//
//   HKDF-SHA256(ikm = anchorSecretKey, salt = "", L = 32,
//               info = UTF-8("me2em/pact/v1/{pid}/{ch}/g{gen}"))
//
// The context hash `ch` inside the info string makes any divergence of
// the pact context text produce a different key — fail-closed (D4).
// AMEND never touches keys (B-4): generations move only on ROTATE_KEY
// (`gen + 1`; a joiner starts at `gen = 0`).
//
// Anchor material is the RAW PRIVATE KEY of the anchor node obtained
// through core's namespace exports — `crypto.deriveRootKey(seed)` for
// an Identity anchor, `crypto.deriveHandleKey(rootKey, name)` for a
// Handle, `crypto.deriveSubHandleKey(...)` for a SubHandle (PACTS §1,
// Р2). Identity/Handle instances are not accepted: their `#privateKey`
// is intentionally unrecoverable.
//
// The derived key exists only in the caller's memory — the module keeps
// no references; zeroization policy is best-effort as in core.

import { crypto } from '@me2em/core';
import { b64urlDecode } from './codec.js';
import { PactError } from './errors.js';

/** Info-string prefix of pact key derivation (PACTS D38). */
export const PACT_KEY_INFO_PREFIX = 'me2em/pact/v1';

/**
 * Derives the member's pact key for `(pid, ch, gen)`.
 *
 * `pid` — b64url(16); `ch` — b64url(32) = SHA-256 of the canonical
 * context; `gen` — 0 on joining, +1 on every ROTATE_KEY. The public
 * pact key needs no separate derivation (Р1):
 * `pactPub = crypto.getPublicKey(pactKey)`.
 *
 * @param anchorSecretKey - Raw private key of the anchor node (see module header).
 * @param pid - Pact identifier, b64url(16).
 * @param ch - Context hash, b64url(32).
 * @param gen - Key generation, integer ≥ 0.
 * @returns The 32-byte pact private key.
 * @throws {@link PactError} `MALFORMED @ derive` on invalid arguments.
 * @since 1.0.0-rc.1
 */
export function derivePactKey(
  anchorSecretKey: Uint8Array,
  pid: string,
  ch: string,
  gen: number
): Uint8Array {
  if (!(anchorSecretKey instanceof Uint8Array) || anchorSecretKey.length === 0) {
    throw new PactError('MALFORMED', 'derive', 'anchorSecretKey: must be a non-empty Uint8Array');
  }
  if (typeof pid !== 'string') {
    throw new PactError('MALFORMED', 'derive', 'pid: must be a base64url string');
  }
  b64urlDecode(pid, 'pid', 16, 'derive');
  if (typeof ch !== 'string') {
    throw new PactError('MALFORMED', 'derive', 'ch: must be a base64url string');
  }
  b64urlDecode(ch, 'ch', 32, 'derive');
  if (!Number.isSafeInteger(gen) || gen < 0) {
    throw new PactError('MALFORMED', 'derive', `gen: must be an integer ≥ 0, got ${String(gen)}`);
  }
  const info = new TextEncoder().encode(`${PACT_KEY_INFO_PREFIX}/${pid}/${ch}/g${gen}`);
  return crypto.hkdf(anchorSecretKey, new Uint8Array(0), info, 32);
}
