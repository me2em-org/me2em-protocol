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
  identitySeed: Uint8Array | null;
  error: string | null;
}

export type IdentityFlowEvent =
  | { type: 'GENERATE'; words: string[]; seed: Uint8Array }
  | { type: 'IMPORT'; seed: Uint8Array }
  | { type: 'CONFIRM_WORDS' }
  | { type: 'RESET' }
  | { type: 'FAIL'; message: string };
