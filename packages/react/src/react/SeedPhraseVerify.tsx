// packages/react/src/react/SeedPhraseVerify.tsx
import { useReducer, useCallback, useState, useEffect, useRef } from 'react';
import {
  verifyFlowReducer,
  initVerifyState,
  type VerifyState,
} from '../headless/verify-flow.js';
import { wordlist } from '@me2em/core';

export interface SeedPhraseVerifyProps {
  realWords: string[];
  gridSize?: number;
  wordlist?: readonly string[];
  onVerified: () => void;
  onFailed?: (attempts: number) => void;
}

const DEFAULT_GRID_SIZE_OFFSET = 8;

export function SeedPhraseVerify({
  realWords,
  gridSize,
  wordlist: propWordlist,
  onVerified,
  onFailed,
}: SeedPhraseVerifyProps) {
  const grid = gridSize ?? realWords.length + DEFAULT_GRID_SIZE_OFFSET;
  const allWords = propWordlist ?? wordlist;
  const baseSeed = 42;

  const [state, dispatch] = useReducer(
    verifyFlowReducer,
    {
      realWords,
      gridSize: grid,
      randomSeed: baseSeed,
      allWords,
    } as const,
    (params) => initVerifyState(params.realWords, params.gridSize, params.randomSeed, params.allWords)
  );

  const [retryCount, setRetryCount] = useState(0);

  const { status, grid: gridData, selected } = state;

  // Guard against re-entrant callbacks after status change
  const notifiedRef = useRef(false);

  const handleSelect = useCallback(
    (index: number) => {
      if (status === 'correct' || status === 'incorrect') return;
      if (selected.length >= gridData.correctIndices.length) return;
      dispatch({ type: 'SELECT', index });
    },
    [status, selected.length, gridData.correctIndices.length]
  );

  // Single effect: auto-check when enough words selected, then notify result
  useEffect(() => {
    if (notifiedRef.current) return;

    // Auto-check when enough words selected
    if (
      selected.length === gridData.correctIndices.length &&
      selected.length > 0 &&
      status === 'collecting'
    ) {
      dispatch({ type: 'CHECK' });
      // After dispatch, status will change synchronously in the reducer
      // but the new state won't be reflected until next render.
      // We need to check the pending result in the next effect cycle.
      return;
    }

    // Handle result after status update
    if (status === 'correct') {
      notifiedRef.current = true;
      onVerified();
    } else if (status === 'incorrect') {
      notifiedRef.current = true;
      onFailed?.(state.attempts);
    }
  }, [selected.length, gridData.correctIndices.length, status, state.attempts, onVerified, onFailed]);

  const handleRetry = () => {
    notifiedRef.current = false;
    setRetryCount((c) => c + 1);
    dispatch({
      type: 'RESET',
      realWords,
      gridSize: grid,
      randomSeed: baseSeed + retryCount + 1,
      allWords,
    });
  };

  return (
    <div>
      <div data-testid="progress">
        Select word {selected.length + 1} of {realWords.length}
      </div>
      <ol data-testid="grid">
        {gridData.words.map((word, i) => {
          const isSelected = selected.includes(i);
          const isDisabled =
            isSelected || status === 'correct' || status === 'incorrect';
          return (
            <li key={i}>
              <button
                data-testid={`cell-${i}`}
                data-word={word}
                disabled={isDisabled}
                onClick={() => handleSelect(i)}
              >
                {word}
              </button>
            </li>
          );
        })}
      </ol>
      {status === 'incorrect' && (
        <button data-testid="retry" onClick={handleRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
