// packages/react/src/headless/import-flow.ts
import { validateSeedPhrase, type SeedStrength } from '@me2em/core';

export type ImportStatus = 'entering' | 'valid' | 'invalid';

export interface ImportState {
  status: ImportStatus;
  words: (string | null)[];
  expectedCount: 12 | 24;
}

export type ImportEvent =
  | { type: 'INIT'; expectedCount: 12 | 24 }
  | { type: 'SET_WORD'; position: number; word: string }
  | { type: 'CLEAR_WORD'; position: number }
  | { type: 'CHECK' }
  | { type: 'RESET' };

export function initImportState(expectedCount: 12 | 24): ImportState {
  return {
    status: 'entering',
    words: Array(expectedCount).fill(null),
    expectedCount,
  };
}

export function importFlowReducer(
  state: ImportState,
  event: ImportEvent
): ImportState {
  const { type } = event;

  if (type === 'INIT') {
    return initImportState(event.expectedCount);
  }

  if (type === 'RESET') {
    return initImportState(state.expectedCount);
  }

  if (type === 'SET_WORD') {
    const { position, word } = event;
    if (position < 0 || position >= state.expectedCount) {
      console.warn(`SET_WORD: position ${position} out of bounds`);
      return state;
    }
    const normalized = word.toLowerCase().trim();
    const newWords = [...state.words] as (string | null)[];
    newWords[position] = normalized;
    return { ...state, words: newWords, status: 'entering' };
  }

  if (type === 'CLEAR_WORD') {
    const { position } = event;
    if (position < 0 || position >= state.expectedCount) {
      console.warn(`CLEAR_WORD: position ${position} out of bounds`);
      return state;
    }
    const newWords = [...state.words] as (string | null)[];
    newWords[position] = null;
    return { ...state, words: newWords, status: 'entering' };
  }

  if (type === 'CHECK') {
    const { words } = state;
    const nullIdx = words.findIndex((w) => w === null);
    if (nullIdx !== -1) {
      return {
        ...state,
        status: 'invalid',
      };
    }
    const result = validateSeedPhrase(words as string[]);
    return {
      ...state,
      status: result.isValid ? 'valid' : 'invalid',
    };
  }

  console.warn(`Unexpected event ${type} in import-flow`);
  return state;
}
