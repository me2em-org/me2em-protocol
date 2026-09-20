// packages/crypto/src/utils/binary.ts

/**
 * Encodes a Uint8Array to a standard Base64 string.
 *
 * Uses the Web API btoa which expects Latin-1 characters. Each byte is
 * converted to its Latin-1 character before encoding.
 *
 * @param bytes - The byte array to encode.
 * @returns The Base64-encoded string.
 *
 * @example
 * ```ts
 * const b64 = toBase64(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
 * // '3q2+7w=='
 * ```
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a standard Base64 string to a Uint8Array.
 *
 * @param s - The Base64-encoded string.
 * @returns The decoded byte array.
 * @throws {TypeError} If the string is not valid Base64.
 *
 * @example
 * ```ts
 * const bytes = fromBase64('3q2+7w==');
 * // Uint8Array [ 0xde, 0xad, 0xbe, 0xef ]
 * ```
 */
export function fromBase64(s: string): Uint8Array {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes a Uint8Array as a lowercase hexadecimal string.
 *
 * @param bytes - The byte array to encode.
 * @returns The hex string (two chars per byte).
 *
 * @example
 * ```ts
 * const hex = toHex(new Uint8Array([0x0f, 0xff]));
 * // '0fff'
 * ```
 */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Decodes a lowercase or uppercase hexadecimal string to a Uint8Array.
 *
 * @param s - The hex string (even length).
 * @returns The decoded byte array.
 * @throws {Error} If the string has odd length or invalid hex characters.
 *
 * @example
 * ```ts
 * const bytes = fromHex('0fff');
 * // Uint8Array [ 0x0f, 0xff ]
 * ```
 */
export function fromHex(s: string): Uint8Array {
  if (s.length % 2 !== 0) {
    throw new Error('Hex string must have even length');
  }
  const bytes = new Uint8Array(s.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (isNaN(byte)) {
      throw new Error(`Invalid hex character at position ${i * 2}`);
    }
    bytes[i] = byte;
  }
  return bytes;
}

/**
 * Concatenates multiple Uint8Array instances into a single array.
 *
 * @param arrays - The byte arrays to concatenate.
 * @returns A new Uint8Array containing all bytes in order.
 *
 * @example
 * ```ts
 * const a = new Uint8Array([1, 2]);
 * const b = new Uint8Array([3, 4]);
 * const c = concat(a, b);
 * // Uint8Array [ 1, 2, 3, 4 ]
 * ```
 */
export function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Generates cryptographically random bytes using crypto.getRandomValues.
 *
 * @param length - Number of random bytes to generate.
 * @returns A new Uint8Array filled with random bytes.
 *
 * @example
 * ```ts
 * const salt = randomBytes(16);
 * ```
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generates cryptographically random bytes and returns them as a
 * standard Base64 string.
 *
 * Useful for generating salts and nonces that need to be transmitted
 * or stored as strings.
 *
 * @param length - Number of random bytes to generate.
 * @returns Base64-encoded random bytes.
 *
 * @example
 * ```ts
 * const salt = randomBytesB64(16);
 * ```
 */
export function randomBytesB64(length: number): string {
  return toBase64(randomBytes(length));
}

/**
 * Constant-time comparison of two Uint8Arrays.
 *
 * Compares all bytes regardless of early mismatch to prevent timing
 * attacks when checking secrets or authentication tags.
 *
 * @param a - First byte array.
 * @param b - Second byte array.
 * @returns `true` if both arrays are identical in length and content.
 *
 * @example
 * ```ts
 * if (bytesEqual(expected, actual)) {
 *   // authenticated
 * }
 * ```
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
