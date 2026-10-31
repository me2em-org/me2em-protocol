// errors.ts
//
// Unified error model for @me2em/core (PR-7): every failure the library
// throws is an {@link AttestationError} carrying a stable
// machine-readable `code` and the verification `level` that produced it.
// Integrators match on `code`/`level`, never on message text
// (specs/v1.0.md §7.2).

/**
 * Machine-readable failure codes for the {@link AttestationError} type.
 *
 * Verification-mode codes (see specs/v1.0.md §7.2): `MALFORMED`,
 * `BAD_SIGNATURE`, `EXPIRED`, `NOT_YET_VALID`, `REVOKED`,
 * `PATH_MISMATCH`, `NAME_NOT_PERMITTED`, `SCOPE_EXCEEDED`,
 * `AUDIENCE_NOT_PERMITTED`, `TTL_EXCEEDED`, `CHAIN_INCOMPLETE`,
 * `SUBJECT_MISMATCH`, `SESSION_OUTLIVES_ATTESTATION`.
 *
 * Library-level codes outside the verification table: `MAX_DEPTH_EXCEEDED`
 * (derivation-tree limit — a leaf {@link SubHandle} cannot derive
 * children) and `DISPOSED` (a capability method was called on a disposed
 * {@link Identity}/{@link Handle}).
 */
export type AttestationErrorCode =
  | 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'NOT_YET_VALID'
  | 'REVOKED' | 'PATH_MISMATCH' | 'NAME_NOT_PERMITTED'
  | 'SCOPE_EXCEEDED' | 'AUDIENCE_NOT_PERMITTED' | 'TTL_EXCEEDED'
  | 'CHAIN_INCOMPLETE' | 'SUBJECT_MISMATCH' | 'SESSION_OUTLIVES_ATTESTATION'
  | 'MAX_DEPTH_EXCEEDED' | 'DISPOSED';

/**
 * The layer that produced an {@link AttestationError}.
 *
 * `ROOT` / `HANDLE_ATTESTATION` / `SUB_ATTESTATION` identify the
 * attestation-chain level; `SESSION` identifies the session token or
 * session-constraint layer; `FORMAT` identifies structural/usage
 * failures detected before any signature or trust material is consulted
 * (token shape, field validation, derivation-tree and lifecycle rules).
 */
export type AttestationLevel =
  | 'ROOT' | 'HANDLE_ATTESTATION' | 'SUB_ATTESTATION' | 'SESSION' | 'FORMAT';

/**
 * The single error type thrown by @me2em/core: a failure with a stable
 * `code`, the `level` that produced it and a message prefixed with
 * `[<level>/<code>]` for human diagnostics.
 *
 * Every failure — including token parsing, issuance validation and
 * `Session.verifyStateless` — throws this type; there is no plain-`Error`
 * path left in the package. `DisposedError` is a subclass with the
 * `DISPOSED` code, so a single `catch (e) { if (e instanceof
 * AttestationError) … }` covers the whole surface.
 *
 * @example
 * ```ts
 * import { AttestationError } from '@me2em/core';
 *
 * try {
 *   await Session.verifyAttested(token, rootPub, chain, 'ev-app.com');
 * } catch (e) {
 *   if (e instanceof AttestationError) {
 *     // e.g. code 'SCOPE_EXCEEDED', level 'SESSION'
 *     log.warn(`${e.level}/${e.code}`);
 *   }
 *   throw new Error('Unauthorized');
 * }
 * ```
 *
 * @category Errors
 */
export class AttestationError extends Error {
  /** Stable machine-readable failure code — match on this, not on messages. */
  public readonly code: AttestationErrorCode;
  /** Layer that produced the failure (see {@link AttestationLevel}). */
  public readonly level: AttestationLevel;

  /**
   * @param code - Machine-readable failure code.
   * @param level - Layer that produced the failure.
   * @param msg - Human-readable description; the thrown message is
   *   prefixed with `[<level>/<code>]`.
   */
  constructor(code: AttestationErrorCode, level: AttestationLevel, msg: string) {
    super(`[${level}/${code}] ${msg}`);
    this.name = 'AttestationError';
    this.code = code;
    this.level = level;
  }
}
