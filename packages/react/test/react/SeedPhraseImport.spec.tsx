// packages/react/test/react/SeedPhraseImport.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { SeedPhraseImport } from '../../src/react/SeedPhraseImport.js';
import { generateSeedPhrase, wordlist, validateSeedPhrase } from '@me2em/core';
import '@testing-library/jest-dom/vitest';

describe('SeedPhraseImport', () => {
  it('renders 12 inputs with Import disabled', () => {
    render(<SeedPhraseImport expectedCount={12} onImported={vi.fn()} />);
    const inputs = screen.getAllByTestId(/^word-/);
    expect(inputs).toHaveLength(12);
    expect(screen.getByTestId('import')).toBeDisabled();
  });

  it('enters valid phrase → Import enabled, click → onImported', async () => {
    const onImported = vi.fn();
    const words = generateSeedPhrase(128);

    render(<SeedPhraseImport expectedCount={12} onImported={onImported} />);

    for (let i = 0; i < 12; i++) {
      const input = screen.getByTestId(`word-${i}`);
      fireEvent.change(input, { target: { value: words[i] } });
    }

    const importBtn = screen.getByTestId('import');
    expect(importBtn).toBeEnabled();
    fireEvent.click(importBtn);
    expect(onImported).toHaveBeenCalledWith(words.map(w => w.toLowerCase()));
  });

  it('repeated click on valid phrase does not call onImported again', async () => {
    const onImported = vi.fn();
    const words = generateSeedPhrase(128);

    render(<SeedPhraseImport expectedCount={12} onImported={onImported} />);

    for (let i = 0; i < 12; i++) {
      const input = screen.getByTestId(`word-${i}`);
      fireEvent.change(input, { target: { value: words[i] } });
    }

    const importBtn = screen.getByTestId('import');
    fireEvent.click(importBtn);
    const firstCallCount = onImported.mock.calls.length;
    fireEvent.click(importBtn);
    expect(onImported.mock.calls.length).toBe(firstCallCount);
  });

  it('enters word not in wordlist → input data-invalid="true", Import disabled', () => {
    render(<SeedPhraseImport expectedCount={12} onImported={vi.fn()} />);

    for (let i = 0; i < 11; i++) {
      const input = screen.getByTestId(`word-${i}`);
      fireEvent.change(input, { target: { value: 'abandon' } });
    }

    const lastInput = screen.getByTestId('word-11');
    fireEvent.change(lastInput, { target: { value: 'notaword' } });

    const lastInputEl = screen.getByTestId('word-11');
    expect(lastInputEl).toHaveAttribute('data-invalid', 'true');
    expect(screen.getByTestId('import')).toBeDisabled();
  });

  it('click count-24 → 24 inputs', () => {
    render(<SeedPhraseImport expectedCount={12} onImported={vi.fn()} />);

    fireEvent.click(screen.getByTestId('count-24'));
    const inputs = screen.getAllByTestId(/^word-/);
    expect(inputs).toHaveLength(24);
  });

  it('bit checksum (valid words, wrong order) → Import disabled', () => {
    // ⚠️ DETERMINISTIC PHRASE — do not "randomize" this test.
    //
    // A previous version swapped words[0]/words[1] of a RANDOM
    // generateSeedPhrase(128) phrase. That is flaky by construction:
    // a 12-word BIP39 phrase is 128 entropy + 4 CHECKSUM bits, so a
    // random two-word swap survives the checksum with probability
    // ≈ 2^-4 (measured 6.10% over 20k trials) — and then the Import
    // button is CORRECTLY enabled (the swapped phrase is valid),
    // failing the assertion. CI hit this on the #39/#40 first runs.
    //
    // This fixed pair is a verified-valid mnemonic whose (0,1)-swap
    // breaks the checksum — the premise "valid words, wrong order"
    // holds ALWAYS, not 15 runs out of 16. The premise pins below
    // fail loudly if the wordlist or the validator ever drifts.
    const swapped = [
      'marriage', 'cost', 'because', 'elbow', 'battle', 'belt',
      'ginger', 'suggest', 'carpet', 'cruise', 'car', 'sausage',
    ];

    // Premise: every word is a real BIP39 word, and the swapped
    // sequence is checksum-invalid — this test exercises the CHECKSUM
    // gate, not the wordlist gate.
    for (const w of swapped) expect(wordlist).toContain(w);
    expect(validateSeedPhrase(swapped).isValid).toBe(false);

    render(<SeedPhraseImport expectedCount={12} onImported={vi.fn()} />);

    for (let i = 0; i < 12; i++) {
      const input = screen.getByTestId(`word-${i}`);
      fireEvent.change(input, { target: { value: swapped[i] } });
    }

    expect(screen.getByTestId('import')).toBeDisabled();
  });
});
