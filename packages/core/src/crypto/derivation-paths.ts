// packages/core/src/crypto/derivation-paths.ts
//
// Single source of truth for HKDF info strings used across the protocol.
// All derivation functions (Identity, Handle, SubHandle) MUST import their
// info strings from this module to guarantee cryptographic consistency.
//
// Changing any of these strings is a BREAKING CHANGE and requires a new
// protocol version.

import { normalizeName } from '../canonical-name.js';

/**
 * Deterministic derivation paths for the Me2em protocol.
 *
 * All HKDF info strings used to derive Identity, Handle, and SubHandle keys
 * are centralized here. This guarantees that:
 * - `Identity.deriveHandle(name)` and `Handle.deriveSubHandle(subName)`
 *   produce the same key as `Identity.deriveSubHandle(name, subName)`.
 * - Any future change to derivation paths is a single-line edit.
 *
 * @category Cryptographic Constants
 */
export const DERIVATION_PATHS = {
  /**
   * Info string for deriving the root Identity key from the seed.
   * Constant value: `"me2em/identity/v1/root"`.
   */
  identity: 'me2em/identity/v1/root',

  /**
   * Builds the info string for deriving a Handle from an Identity.
   *
   * @param name - The Handle name (will be normalized).
   * @returns The info string, e.g. `"me2em/handle/v1/station-001"`.
   */
  handle: (name: string): string =>
    `me2em/handle/v1/${normalizeName(name)}`,

  /**
   * Builds the info string for deriving a SubHandle from a Handle.
   *
   * @param handleName - The parent Handle name (will be normalized).
   * @param subName - The SubHandle name (will be normalized).
   * @returns The info string, e.g. `"me2em/subhandle/v1/station-001/connector-1"`.
   */
  subhandle: (handleName: string, subName: string): string =>
    `me2em/subhandle/v1/${normalizeName(handleName)}/${normalizeName(subName)}`,
} as const;
