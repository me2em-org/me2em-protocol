export type IdentityFlowStatus =
  | 'idle'
  | 'seed-generated'
  | 'verified'
  | 'ready'
  | 'imported'
  | 'error';

export interface IdentityFlowState {
  status: IdentityFlowStatus;
  seedWords: string[] | null;
  /**
   * Raw seed material, retained in state after 'verified'/'imported'
   * by design — the flow does NOT self-consume it (BL-48): headless
   * consumers may still read it at this point. Reachable via devtools
   * in this window (R15 category). An explicit `discardSeed()` action
   * is the planned v1.1 opt-in; until then the app owns dropping it.
   */
  identitySeed: Uint8Array | null;
  error: string | null;
}

export type IdentityFlowEvent =
  | { type: 'GENERATE'; words: string[]; seed: Uint8Array }
  | { type: 'IMPORT'; seed: Uint8Array }
  | { type: 'CONFIRM_WORDS' }
  | { type: 'RESET' }
  | { type: 'FAIL'; message: string };
