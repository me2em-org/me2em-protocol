export type IdentityFlowStatus =
  | 'idle'
  | 'seed-generated'
  | 'verified'
  | 'ready'
  | 'imported'
  | 'error';

/**
 * Machine-readable cause of a flow failure (BL-50, v1.1 — early break
 * accepted 2026-11-04): `GENERATE_FAILED` — seed generation itself
 * failed; `INVALID_WORDS` — the submitted phrase failed BIP39
 * validation; `DERIVATION_FAILED` — the seed could not be derived from
 * the (validated) words; `ACTIVATION_FAILED` — the provider rejected
 * the derived seed (`activateIdentity` resolved `false`);
 * `APP_FAILURE` — the default for app-driven `FAIL` dispatches.
 */
export type Me2emFlowErrorCode =
  | 'GENERATE_FAILED'
  | 'INVALID_WORDS'
  | 'DERIVATION_FAILED'
  | 'ACTIVATION_FAILED'
  | 'APP_FAILURE';

/**
 * Structured flow failure. Match on `code`, never on `message`
 * (specs/v1.0.md §7.2).
 */
export interface Me2emFlowError {
  /** Machine-readable cause. */
  code: Me2emFlowErrorCode;
  /** Human-readable description. */
  message: string;
}

export interface IdentityFlowState {
  status: IdentityFlowStatus;
  seedWords: string[] | null;
  /**
   * Raw seed material, retained in state after 'verified'/'imported'
   * by design — the flow does NOT self-consume it (BL-48): headless
   * consumers may still read it at this point. Reachable via devtools
   * in this window (R15 category). The explicit `discardSeed()`
   * action (v1.1) nulls this field when the app decides the material
   * is no longer needed; zeroing the underlying buffer stays the
   * app's job (mixed caller/library ownership, R6).
   */
  identitySeed: Uint8Array | null;
  /** Structured failure (BL-50): match on `code`, not on `message`. */
  error: Me2emFlowError | null;
}

export type IdentityFlowEvent =
  | { type: 'GENERATE'; words: string[]; seed: Uint8Array }
  | { type: 'IMPORT'; seed: Uint8Array }
  | { type: 'CONFIRM_WORDS' }
  /**
   * BL-48 (v1.1): app-initiated seed hygiene. Valid from
   * 'verified'/'imported' — nulls {@link IdentityFlowState.identitySeed}
   * and keeps the status. No-op elsewhere (the words are still on
   * screen in 'seed-generated'; `RESET` is the abort path there).
   */
  | { type: 'DISCARD_SEED' }
  | { type: 'RESET' }
  | { type: 'FAIL'; message: string; code?: Me2emFlowErrorCode };
