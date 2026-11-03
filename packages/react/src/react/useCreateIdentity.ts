// packages/react/src/react/useCreateIdentity.ts
import {
  useReducer,
  useCallback,
  type Reducer,
} from 'react';
import {
  generateSeedPhrase,
  get64ByteSeedFromMnemonic,
  type SeedStrength,
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
  Me2emFlowErrorCode,
} from '../headless/types.js';
import { useMe2emContext } from './context.js';

export interface UseCreateIdentityResult {
  status: IdentityFlowStatus;
  seedWords: string[] | null;
  identity: Identity | null;
  /** Structured failure (BL-50, v1.1) — match on `code`, not `message`. */
  error: Me2emFlowError | null;
  generate: (opts?: { strength?: SeedStrength }) => void;
  confirmWords: () => Promise<void>;
  /**
   * BL-48 (v1.1): drops the retained seed material from the flow state
   * once the app no longer needs it (after `confirmWords`). No-op from
   * other statuses; the underlying buffer is not zeroed (R6).
   */
  discardSeed: () => void;
  reset: () => void;
  /** Surface an app-driven failure; `code` defaults to `APP_FAILURE`. */
  fail: (message: string, code?: Me2emFlowErrorCode) => void;
}

export function useCreateIdentity(): UseCreateIdentityResult {
  const { activateIdentity, clearIdentity, identity } = useMe2emContext();
  const [state, dispatch] = useReducer<
    Reducer<IdentityFlowState, IdentityFlowEvent>
  >(identityFlowReducer, initialIdentityFlowState);

  const generate = useCallback(
    (opts?: { strength?: SeedStrength }) => {
      const words = generateSeedPhrase(opts?.strength ?? 128);
      get64ByteSeedFromMnemonic(words).then((derivedSeed) => {
        dispatch({ type: 'GENERATE', words, seed: derivedSeed });
      }).catch(() => {
        dispatch({
          type: 'FAIL',
          code: 'GENERATE_FAILED',
          message: 'Failed to generate seed',
        });
      });
    },
    []
  );

  const confirmWords = useCallback(async () => {
    if (state.status !== 'seed-generated' || !state.identitySeed) return;
    dispatch({ type: 'CONFIRM_WORDS' });
    const ok = await activateIdentity(state.identitySeed);
    if (!ok) {
      dispatch({
        type: 'FAIL',
        code: 'ACTIVATION_FAILED',
        message: 'Identity activation failed',
      });
    }
  }, [state.status, state.identitySeed, activateIdentity]);

  const discardSeed = useCallback(() => {
    // BL-48 (v1.1): seed hygiene — the app decides when the material
    // is no longer needed (typically right after `confirmWords`).
    dispatch({ type: 'DISCARD_SEED' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
    clearIdentity();
  }, [clearIdentity]);

  const fail = useCallback((message: string, code?: Me2emFlowErrorCode) => {
    dispatch({ type: 'FAIL', message, code });
  }, []);

  return {
    status: state.status,
    seedWords: state.seedWords,
    identity,
    error: state.error,
    generate,
    confirmWords,
    discardSeed,
    reset,
    fail,
  };
}
