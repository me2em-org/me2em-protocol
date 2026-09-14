// packages/react/src/react/PassphraseInput.tsx
import { useState, useCallback } from 'react';

export interface PassphraseInputProps {
  onPassphraseChange: (p: string) => void;
  showWarnings?: boolean;
}

export function PassphraseInput({
  onPassphraseChange,
  showWarnings = true,
}: PassphraseInputProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.normalize('NFKC');
      onPassphraseChange(value);
    },
    [onPassphraseChange]
  );

  return (
    <div>
      <input
        type="password"
        data-testid="passphrase"
        aria-label="BIP39 passphrase"
        onChange={handleChange}
      />
      {showWarnings && (
        <div data-testid="warning">
          Passphrase is case-sensitive and NOT recoverable. A different
          passphrase silently derives a different wallet.
        </div>
      )}
    </div>
  );
}
