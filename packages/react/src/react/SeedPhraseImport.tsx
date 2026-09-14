// packages/react/src/react/SeedPhraseImport.tsx
import { useReducer, useCallback, useEffect, useRef } from 'react';
import {
  importFlowReducer,
  initImportState,
  type ImportState,
} from '../headless/import-flow.js';
import { wordlist } from '@me2em/core';

export interface SeedPhraseImportProps {
  expectedCount?: 12 | 24;
  wordlist?: readonly string[];
  onImported: (words: string[]) => void;
}

export function SeedPhraseImport({
  expectedCount: propCount,
  wordlist: propWordlist,
  onImported,
}: SeedPhraseImportProps) {
  const allWords = propWordlist ?? wordlist;

  const [state, dispatch] = useReducer(
    importFlowReducer,
    { expectedCount: propCount ?? 12 } as const,
    (params) => initImportState(params.expectedCount)
  );

  const count = state.expectedCount;

  const prevStatusRef = useRef<ImportState['status']>(state.status);

  const lastImportedRef = useRef<string | null>(null);

  // Auto-check on every word change
  useEffect(() => {
    dispatch({ type: 'CHECK' });
  }, [state.words]);

  // Call onImported once when transitioning to valid
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = state.status;

    if (state.status === 'valid' && prevStatus !== 'valid') {
      const key = (state.words as string[]).join('\0');
      if (lastImportedRef.current !== key) {
        lastImportedRef.current = key;
        onImported(state.words as string[]);
      }
    }
  }, [state.status, state.words, onImported]);

  const handleCountChange = (n: 12 | 24) => {
    dispatch({ type: 'INIT', expectedCount: n });
  };

  const handleWordChange = (position: number, value: string) => {
    dispatch({ type: 'SET_WORD', position, word: value });
  };

  const isWordInvalid = (position: number): boolean => {
    if (state.status !== 'invalid' && state.status !== 'valid') return false;
    const word = state.words[position];
    if (word === null) return false;
    return !allWords.includes(word);
  };

  const isImportEnabled = state.status === 'valid';

  return (
    <div>
      <div>
        <button
          data-testid="count-12"
          onClick={() => handleCountChange(12)}
          disabled={count === 12}
        >
          12 words
        </button>
        <button
          data-testid="count-24"
          onClick={() => handleCountChange(24)}
          disabled={count === 24}
        >
          24 words
        </button>
      </div>
      <div data-testid="inputs">
        {Array.from({ length: count }, (_, i) => (
          <input
            key={i}
            data-testid={`word-${i}`}
            aria-label={`Word ${i + 1}`}
            value={state.words[i] ?? ''}
            onChange={(e) => handleWordChange(i, e.target.value)}
            data-invalid={isWordInvalid(i) ? 'true' : undefined}
          />
        ))}
      </div>
      <button
        data-testid="import"
        disabled={!isImportEnabled}
        onClick={() => dispatch({ type: 'CHECK' })}
      >
        Import
      </button>
    </div>
  );
}
