// packages/react/src/headless/context-crypto.ts
import type { IdentityContextData } from './identity-context-types.js';

function toB64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64(s: string): Uint8Array {
  let base64 = s
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

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
  return { v: 1, salt: toB64(salt), iv: toB64(iv),
           ct: toB64(new Uint8Array(ct)) };
}

export async function decryptContext(
  key: CryptoKey, envelope: ContextEnvelope
): Promise<IdentityContextData> {
  if (envelope.v !== 1) throw new Error('Unsupported envelope version');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(envelope.iv) as BufferSource },
    key, fromB64(envelope.ct) as BufferSource
  );
  return JSON.parse(new TextDecoder().decode(pt)) as IdentityContextData;
}
