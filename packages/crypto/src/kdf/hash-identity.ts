// packages/crypto/src/kdf/hash-identity.ts
import { throwCryptoError } from '../errors.js';
import { concat } from '../utils/binary.js';

/**
 * Computes session-bound identity material from a raw identity key.
 *
 * This is the "hPK" pattern: a deterministic, one-way derivative of
 * the identity private key that lives in RAM for the duration of a
 * login session and is the root for purpose-scoped key derivation
 * and cache wrapping. The raw private key MUST be wiped immediately
 * after this call (see core/wipe).
 *
 * Domain separation: identityId is mixed in so that identities
 * sharing any downstream material can never collide.
 *
 * @param identityPrivKey - Raw Ed25519 private key (32B).
 * @param identityId - base64url/hex public key string of THIS identity.
 * @returns 32 bytes of SHA-256 hash. RAM-ONLY — never persist, never transmit.
 * @throws {CryptoError} 'KEY/INVALID_LENGTH' if key length ≠ 32.
 *
 * @example
 * ```ts
 * const material = await hashIdentityMaterial(pkBytes, identityIdB64);
 * secureWipe(pkBytes);               // raw key is done
 * const cacheKey = await hkdf(material, freshSalt,
 *   'me2em/crypto/v1/cache-wrap', 32);
 * ```
 */
export async function hashIdentityMaterial(
  identityPrivKey: Uint8Array,
  identityId: string
): Promise<Uint8Array> {
  if (identityPrivKey.length !== 32) {
    throwCryptoError('INVALID_LENGTH', 'KEY', 'Identity private key must be 32 bytes');
  }
  const enc = new TextEncoder();
  const idBytes = enc.encode(identityId);
  const combined = concat(idBytes, identityPrivKey);
  const hashBuf = await crypto.subtle.digest('SHA-256', combined);
  return new Uint8Array(hashBuf);
}
