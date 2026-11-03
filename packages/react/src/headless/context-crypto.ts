// packages/react/src/headless/context-crypto.ts
import { base64urlEncode, base64urlDecode } from '@me2em/core';
import type { IdentityContextData } from './identity-context-types.js';

// Base64url encoding for ContextEnvelope fields goes through the audited
// @scure/base codec re-exported by @me2em/core (audit A3 / R4) — one
// base64 implementation across packages, no hand-rolled alphabet handling.
// Envelope fields are always unpadded: the only writer is encryptContext
// below, so base64urlDecode's strict no-padding rule never bites.

export interface ContextEnvelope {
  v: 1;
  /** fresh HKDF salt этого логина (b64). Нужен только при
   * первичной деривации; persisted CryptoKey переживает
   * перезапуск без него. */
  salt: string;
  iv: string;   // b64, 12B
  ct: string;   // b64, ciphertext || GCM tag
}

/**
 * Derives a fresh, per-login cache key from login-time secret
 * material and wraps it as a NON-EXTRACTABLE persisted CryptoKey.
 * Raw key bytes exist only transiently during importKey.
 *
 * @param loginMaterial - high-entropy bytes available at login
 *   (derived from the seed while it is still in memory).
 * @param salt - FRESH random bytes for this login. Never reuse a
 *   salt across logins: the whole point is that a compromised
 *   cacheKey from session N is useless in session N+1.
 */
export async function deriveCacheKey(
  loginMaterial: Uint8Array,
  salt: Uint8Array
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw', loginMaterial as BufferSource, 'HKDF', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode('me2em/cache-wrap/v1') },
    base, 256
  );
  return crypto.subtle.importKey(
    'raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
  );
}

export async function encryptContext(
  key: CryptoKey, data: IdentityContextData
): Promise<ContextEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const pt = new TextEncoder().encode(JSON.stringify(data));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource }, key, pt
  );
  return { v: 1, salt: base64urlEncode(salt), iv: base64urlEncode(iv),
           ct: base64urlEncode(new Uint8Array(ct)) };
}

export async function decryptContext(
  key: CryptoKey, envelope: ContextEnvelope
): Promise<IdentityContextData> {
  if (envelope.v !== 1) throw new Error('Unsupported envelope version');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64urlDecode(envelope.iv) as BufferSource },
    key, base64urlDecode(envelope.ct) as BufferSource
  );
  return JSON.parse(new TextDecoder().decode(pt)) as IdentityContextData;
}
