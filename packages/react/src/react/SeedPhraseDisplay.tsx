// packages/react/src/react/SeedPhraseDisplay.tsx
import { useReducer, useState } from 'react';
import {
  displayFlowReducer,
  initialDisplayState,
} from '../headless/display-flow.js';

export interface SeedPhraseDisplayProps {
  /** Seed material is reachable via React DevTools in this window; by design. */
  words: string[];
  onDismiss?: () => void;
  onCopyAllowed?: () => void;
}

/**
 * R8: the permanent/transient line for a failed clipboard write is
 * "can a retry in this window ever succeed?". Without the async
 * Clipboard API (non-secure context, unsupported browser) it cannot —
 * the failure is permanent, the copy-all button is disabled and the
 * user is pointed at manual word selection. With the API present any
 * rejection (lost focus, dismissed permission prompt, OS hiccup)
 * stays transient: the button remains enabled and a fresh attempt
 * may go through.
 */
function clipboardWriteAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  );
}

export function SeedPhraseDisplay({
  words,
  onDismiss,
  onCopyAllowed,
}: SeedPhraseDisplayProps) {
  const [state, dispatch] = useReducer(displayFlowReducer, initialDisplayState);
  const [copyError, setCopyError] = useState<'transient' | 'permanent' | null>(null);

  const { status, copyCount } = state;

  const handleReveal = () => {
    dispatch({ type: 'REVEAL', at: Date.now() });
  };

  const handleCopy = async () => {
    if (status === 'revealed' && copyCount === 0) {
      try {
        await navigator.clipboard.writeText(words.join(' '));
        dispatch({ type: 'COPY', at: Date.now() });
        setCopyError(null);
        onCopyAllowed?.();
      } catch {
        setCopyError(clipboardWriteAvailable() ? 'transient' : 'permanent');
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
      <div data-testid="dismissed">
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
      {copyError && (
        <div data-testid="copy-error" data-kind={copyError}>
          {copyError === 'permanent'
            ? 'Copy unavailable in this context — select the words manually'
            : 'Copy failed — try again'}
        </div>
      )}
      <button
        data-testid="copy-all"
        onClick={handleCopy}
        disabled={copyCount === 1 || copyError === 'permanent'}
      >
        {copyCount === 1 ? 'Copied' : 'Copy all'}
      </button>
      <button data-testid="dismiss" onClick={handleDismiss}>
        Hide
      </button>
    </div>
  );
}
