// packages/react/src/react/SeedPhraseDisplay.tsx
import { useReducer } from 'react';
import {
  displayFlowReducer,
  initialDisplayState,
  type DisplayStatus,
} from '../headless/display-flow.js';

export interface SeedPhraseDisplayProps {
  words: string[];
  onDismiss?: () => void;
  onCopyAllowed?: () => void;
}

export function SeedPhraseDisplay({
  words,
  onDismiss,
  onCopyAllowed,
}: SeedPhraseDisplayProps) {
  const [state, dispatch] = useReducer(displayFlowReducer, initialDisplayState);

  const { status, copyCount } = state;

  const handleReveal = () => {
    dispatch({ type: 'REVEAL', at: Date.now() });
  };

  const handleCopy = async () => {
    if (status === 'revealed' && copyCount === 0) {
      try {
        await (navigator as any).clipboard.writeText(words.join(' '));
        dispatch({ type: 'COPY', at: Date.now() });
        onCopyAllowed?.();
      } catch {
        // clipboard unavailable — show error, do not dispatch COPY
      }
    }
  };

  const handleDismiss = () => {
    dispatch({ type: 'DISMISS' });
    onDismiss?.();
  };

  if (status === 'hidden') {
    return (
      <button data-testid="reveal" onClick={handleReveal}>
        Reveal
      </button>
    );
  }

  if (status === 'dismissed') {
    return (
      <div data-testid="copy-error">
        Phrase dismissed
      </div>
    );
  }

  return (
    <div>
      <ol data-testid="words">
        {words.map((word, i) => (
          <li
            key={i}
            data-testid={`word-${i}`}
            data-position={i}
          >
            {word}
          </li>
        ))}
      </ol>
      <button
        data-testid="copy-all"
        onClick={handleCopy}
        disabled={copyCount === 1}
      >
        {copyCount === 1 ? 'Copied' : 'Copy all'}
      </button>
      <button data-testid="dismiss" onClick={handleDismiss}>
        Hide
      </button>
    </div>
  );
}
