// packages/react/src/react/useImportSeed.ts
import { useReducer, useCallback, type Reducer } from 'react';
import {
  validateSeedPhrase,
  get64ByteSeedFromMnemonic,
  type Identity,
} from '@me2em/core';
import {
  identityFlowReducer,
  initialIdentityFlowState,
} from '../headless/identity-flow.js';
import type {
  IdentityFlowState,
  IdentityFlowEvent,
  IdentityFlowStatus,
  Me2emFlowError,
} from '../headless/types.js';
import { useMe2emContext } from './context.js';

export interface UseImportSeedResult {
  status: IdentityFlowStatus;
  identity: Identity | null;
  /** Structured failure (BL-50, v1.1) — match on `code`, not `message`. */
  error: Me2emFlowError | null;
  importWords: (words: string[], passphrase?: string) => Promise<void>;
  /**
   * BL-48 (v1.1): drops the retained seed material from the flow state
   * once the app no longer needs it (after a successful import). No-op
   * from other statuses; the underlying buffer is not zeroed (R6).
   */
  discardSeed: () => void;
  reset: () => void;
}

export function useImportSeed(): UseImportSeedResult {
  const { activateIdentity, clearIdentity, identity } = useMe2emContext();
  const [state, dispatch] = useReducer<
    Reducer<IdentityFlowState, IdentityFlowEvent>
  >(identityFlowReducer, initialIdentityFlowState);

  const importWords = useCallback(
    async (words: string[], passphrase?: string) => {
      const validation = validateSeedPhrase(words);
      if (!validation.isValid) {
        dispatch({
          type: 'FAIL',
          code: 'INVALID_WORDS',
          message: validation.error ?? 'Invalid seed phrase',
        });
        return;
      }
      try {
        const seed = await get64ByteSeedFromMnemonic(words, passphrase ?? '');
        dispatch({ type: 'IMPORT', seed });
        // v1.1 (BL-50): activation failures are no longer swallowed —
        // `activateIdentity` resolves `false` instead of throwing, so
        // the result must be checked to keep status and error honest.
        const ok = await activateIdentity(seed);
        if (!ok) {
          dispatch({
            type: 'FAIL',
            code: 'ACTIVATION_FAILED',
            message: 'Identity activation failed',
          });
        }
      } catch (err) {
        dispatch({
          type: 'FAIL',
          code: 'DERIVATION_FAILED',
          message: err instanceof Error ? err.message : 'Import failed',
        });
      }
    },
    [activateIdentity]
  );

  const discardSeed = useCallback(() => {
    // BL-48 (v1.1): seed hygiene — the app decides when the material
    // is no longer needed (typically right after a successful import).
    dispatch({ type: 'DISCARD_SEED' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
    clearIdentity();
  }, [clearIdentity]);

  return {
    status: state.status,
    identity,
    error: state.error,
    importWords,
    discardSeed,
    reset,
  };
}
