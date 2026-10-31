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
 * Deterministic derivation paths for the Me2eM protocol.
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

  /**
   * Info string for peer-to-peer channel key derivation.
   * v2 binds both peers' public keys into the derivation, preventing
   * unknown key-share attacks. The peer keys are appended in sorted
   * order so both parties derive the identical string.
   */
  p2pChannelV2: 'me2em/p2p-channel/v2',

  /**
   * Builds the info string for password (secret) derivation.
   *
   * Revision model (PR-8, D3): revision `1` — the initial revision — and
   * an omitted revision both yield the frozen v1 info string, so the
   * default derivation is byte-identical to the pre-revision protocol.
   * Revision `N ≥ 2` appends a `/rN` path segment and derives a secret
   * that is cryptographically independent of revision 1 for the same
   * context — the sanctioned rotation path (specs/v1.0.md §3, PLAN-LTS
   * §4 derivation-freeze rule).
   *
   * @param revision - Positive integer revision; default `1`.
   * @returns The info string, e.g. `"me2em/secret/v1"` or `"me2em/secret/v1/r2"`.
   *
   * @since 0.8.0
   */
  password: (revision: number = 1): string =>
    revision === 1 ? 'me2em/secret/v1' : `me2em/secret/v1/r${revision}`,

  /**
   * Builds the info string for channel-key derivation.
   *
   * Same revision model as {@link DERIVATION_PATHS.password}: revision
   * `1`/omitted yields the frozen `"me2em/channel/v1"`; revision
   * `N ≥ 2` yields `"me2em/channel/v1/rN"` — an independent key for
   * rotating a compromised channel without changing the context.
   *
   * @param revision - Positive integer revision; default `1`.
   * @returns The info string, e.g. `"me2em/channel/v1"` or `"me2em/channel/v1/r2"`.
   *
   * @since 0.8.0
   */
  channel: (revision: number = 1): string =>
    revision === 1 ? 'me2em/channel/v1' : `me2em/channel/v1/r${revision}`,
} as const;
