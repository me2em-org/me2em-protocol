// packages/react/src/react/useCreateIdentity.ts
import {
  useReducer,
  useCallback,
  type Reducer,
} from 'react';
import {
  generateSeedPhrase,
  get32ByteSeedFromMnemonic,
  type SeedStrength,
  type Identity,
} from '@me2em/core';
import {
  identityFlowReducer,
  initialIdentityFlowState,
} from '../headless/identity-flow.js';
import type { IdentityFlowState, IdentityFlowEvent, IdentityFlowStatus } from '../headless/types.js';
import { useMe2emContext } from './context.js';

export interface UseCreateIdentityResult {
  status: IdentityFlowStatus;
  seedWords: string[] | null;
  identity: Identity | null;
  error: string | null;
  generate: (opts?: { strength?: SeedStrength }) => void;
  confirmWords: () => Promise<void>;
  reset: () => void;
  fail: (message: string) => void;
}

export function useCreateIdentity(): UseCreateIdentityResult {
  const { activateIdentity, clearIdentity, identity } = useMe2emContext();
  const [state, dispatch] = useReducer<
    Reducer<IdentityFlowState, IdentityFlowEvent>
  >(identityFlowReducer, initialIdentityFlowState);

  const generate = useCallback(
    (opts?: { strength?: SeedStrength }) => {
      const words = generateSeedPhrase(opts?.strength ?? 128);
      get32ByteSeedFromMnemonic(words).then((derivedSeed) => {
        dispatch({ type: 'GENERATE', words, seed: derivedSeed });
      }).catch(() => {
        dispatch({ type: 'FAIL', message: 'Failed to generate seed' });
      });
    },
    []
  );

  const confirmWords = useCallback(async () => {
    if (state.status !== 'seed-generated' || !state.identitySeed) return;
    dispatch({ type: 'CONFIRM_WORDS' });
    const ok = await activateIdentity(state.identitySeed);
    if (!ok) {
      dispatch({ type: 'FAIL', message: 'Identity activation failed' });
    }
  }, [state.status, state.identitySeed, activateIdentity]);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
    clearIdentity();
  }, [clearIdentity]);

  const fail = useCallback((message: string) => {
    dispatch({ type: 'FAIL', message });
  }, []);

  return {
    status: state.status,
    seedWords: state.seedWords,
    identity,
    error: state.error,
    generate,
    confirmWords,
    reset,
    fail,
  };
}
