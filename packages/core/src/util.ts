// util.ts
//
// Shared utility functions for the Me2eM protocol.

import { base64urlnopad } from '@scure/base';

/**
 * Node.js console/inspect hook (`util.inspect.custom`), referenced by
 * `Symbol.for` so that no `node:util` import — and therefore no Node
 * dependency — leaks into browser bundles. In non-Node runtimes the
 * symbol simply has no meaning and the method is never called.
 */
export const INSPECT_SYMBOL = Symbol.for('nodejs.util.inspect.custom');

/**
 * Encodes a Uint8Array to a URL-safe Base64 string (no padding).
 *
 * Implemented on top of the audited `@scure/base` codec (A3) — a crypto
 * library must not hand-roll its own base64 alphabet handling. The
 * output is byte-identical to the previous hand-rolled encoder
 * (unpadded URL-safe Base64), so token serialization does not change.
 *
 * @param bytes - The bytes to encode.
 * @returns The unpadded URL-safe Base64 string (`''` for empty input).
 */
export function base64urlEncode(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}

/**
 * Decodes a URL-safe Base64 string to a Uint8Array.
 *
 * Implemented on top of the audited `@scure/base` codec (A3). Throws a
 * generic `Error` on inputs with characters outside the URL-safe
 * alphabet or an impossible length — token parsers wrap this call and
 * translate failures into `AttestationError` `MALFORMED`/`FORMAT`.
 *
 * @param input - The unpadded URL-safe Base64 string.
 * @returns The decoded bytes.
 */
export function base64urlDecode(input: string): Uint8Array {
  return base64urlnopad.decode(input);
}

/**
 * RFC 4122 version-4 UUID with a runtime-portability fallback (PR-7):
 * uses `crypto.randomUUID` where available (Node ≥14.17, modern
 * browsers) and otherwise builds the UUID from
 * `crypto.getRandomValues` bytes with the version/variant bits set.
 * Keeps `Attestation.issue` and `Session.create` working on runtimes
 * without `randomUUID` (older React Native JS engines, non-secure
 * browser contexts).
 *
 * @returns A random UUID in the canonical 8-4-4-4-12 hex form.
 */
export function randomUUID(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  );
}

/**
 * `JSON.parse` hardened against prototype pollution (PR-7): parsing
 * aborts when any key named `__proto__` appears in the payload, so a
 * hostile token can never plant properties on `Object.prototype` —
 * neither directly (the parse is aborted) nor via later spreads of the
 * parsed value into fresh objects.
 *
 * @param input - The JSON text to parse.
 * @returns The parsed value.
 * @throws {SyntaxError} On invalid JSON or a forbidden `__proto__` key.
 */
export function safeJsonParse(input: string): unknown {
  return JSON.parse(input, (key: string, value: unknown) => {
    if (key === '__proto__') {
      throw new SyntaxError('payload contains the forbidden key "__proto__"');
    }
    return value;
  });
}
