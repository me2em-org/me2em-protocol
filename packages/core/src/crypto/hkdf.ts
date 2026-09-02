import { hkdf as nobleHkdf } from '@noble/hashes/hkdf.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

/**
 * HKDF-SHA256 wrapper for me2em protocol
 * 
 * @param ikm - Input key material
 * @param salt - Salt (can be empty Uint8Array)
 * @param info - Context info
 * @param length - Output length in bytes
 * @returns Derived key as Uint8Array
 */
export function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  return nobleHkdf(nobleSha256, ikm, salt, info, length);
}

export { nobleSha256 as sha256 };