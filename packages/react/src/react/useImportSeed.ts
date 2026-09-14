// packages/react/src/react/useImportSeed.ts
import { useReducer, useCallback } from 'react';
import {
  validateSeedPhrase,
  get32ByteSeedFromMnemonic,
  type Identity,
} from '@me2em/core';
import {
  identityFlowReducer,
  initialIdentityFlowState,
} from '../headless/identity-flow.js';
import type { IdentityFlowState, IdentityFlowEvent, IdentityFlowStatus } from '../headless/types.js';
import { useMe2emContext } from './context.js';

export interface UseImportSeedResult {
  status: IdentityFlowStatus;
  identity: Identity | null;
  error: string | null;
  importWords: (words: string[], passphrase?: string) => Promise<void>;
  reset: () => void;
}

export function useImportSeed(): UseImportSeedResult {
  const { activateIdentity, clearIdentity, identity } = useMe2emContext();
  const [state, dispatch] = useReducer<
    React.Reducer<IdentityFlowState, IdentityFlowEvent>
  >(identityFlowReducer, initialIdentityFlowState);

  const importWords = useCallback(
    async (words: string[], passphrase?: string) => {
      const validation = validateSeedPhrase(words);
      if (!validation.isValid) {
        dispatch({ type: 'FAIL', message: validation.error ?? 'Invalid seed phrase' });
        return;
      }
      try {
        const seed = await get32ByteSeedFromMnemonic(words, passphrase ?? '');
        dispatch({ type: 'IMPORT', seed });
        await activateIdentity(seed);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Import failed';
        dispatch({ type: 'FAIL', message });
      }
    },
    [activateIdentity]
  );

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
    clearIdentity();
  }, [clearIdentity]);

  return {
    status: state.status,
    identity,
    error: state.error,
    importWords,
    reset,
  };
}
