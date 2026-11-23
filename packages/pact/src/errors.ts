// packages/pact/src/errors.ts
//
// The single error type of @me2em/pact (PACTS D36): a failure with a
// stable machine-readable `code` (ТЗ §5 — the table is normative) and
// the `context` that produced it. Message style — `CODE @ CONTEXT`
// (same convention as core, no level axis: the pact surface is flat).

/** Machine-readable failure codes of the pact surface (ТЗ §5 E1 — normative). */
export type PactErrorCode =
  | 'MALFORMED'
  | 'FORK_DETECTED'
  | 'INVALID_QUORUM'
  | 'REVOKED'
  | 'SKEW'
  | 'UNKNOWN_EVENT_TYPE'
  | 'ANCHOR_MISMATCH'
  | 'WEIGHT_MISMATCH'
  | 'IDP_UNRESOLVABLE'
  | 'PAYLOAD_TOO_LARGE'
  | 'SIGNATURE_INVALID';

/** The layer that produced a {@link PactError}. */
export type PactErrorContext =
  | 'codec' | 'derive' | 'verify' | 'assemble'
  | 'store' | 'export' | 'import' | 'transport';

/**
 * The single error type thrown by @me2em/pact: a failure with a stable
 * `code` (ТЗ §5) and the `context` that produced it; the message is
 * prefixed with `CODE @ CONTEXT` for human diagnostics. Consumers
 * match on `code`/`context`, never on message text.
 *
 * @example
 * ```ts
 * import { PactError } from '@me2em/pact';
 *
 * try {
 *   await store.append(head, event);
 * } catch (e) {
 *   if (e instanceof PactError) {
 *     // e.g. code 'FORK_DETECTED', context 'store'
 *     log.warn(`${e.code} @ ${e.context}`);
 *   }
 * }
 * ```
 *
 * @category Errors
 */
export class PactError extends Error {
  /** Stable machine-readable failure code — match on this, not on messages. */
  public readonly code: PactErrorCode;
  /** Layer that produced the failure (see {@link PactErrorContext}). */
  public readonly context: PactErrorContext;

  /**
   * @param code - Machine-readable failure code (ТЗ §5).
   * @param context - Layer that produced the failure.
   * @param msg - Human-readable description; the thrown message is
   *   prefixed with `CODE @ CONTEXT`.
   */
  constructor(code: PactErrorCode, context: PactErrorContext, msg: string) {
    super(`${code} @ ${context}: ${msg}`);
    this.name = 'PactError';
    this.code = code;
    this.context = context;
  }
}
