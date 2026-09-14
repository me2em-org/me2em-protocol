// packages/react/test/react/SeedPhraseVerify.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { SeedPhraseVerify } from '../../src/react/SeedPhraseVerify.js';
import { buildVerificationGrid } from '../../src/headless/seed-words.js';
import { wordlist } from '@me2em/core';
import '@testing-library/jest-dom/vitest';

const TEST_WORDS = ['abandon', 'ability', 'able', 'about', 'above', 'absent'];

describe('SeedPhraseVerify', () => {
  it('renders grid buttons and progress text', () => {
    const { container } = render(
      <SeedPhraseVerify
        realWords={TEST_WORDS}
        gridSize={10}
        onVerified={vi.fn()}
      />
    );
    expect(screen.getByTestId('progress')).toHaveTextContent(
      /Select word 1 of \d+/
    );
    const buttons = screen.getAllByRole('button', { name: /./ });
    expect(buttons.length).toBeGreaterThanOrEqual(10);
  });

  it('clicks in correct order → onVerified called', async () => {
    const onVerified = vi.fn();
    const { container } = render(
      <SeedPhraseVerify
        realWords={TEST_WORDS}
        gridSize={10}
        onVerified={onVerified}
      />
    );

    // Use headless function to determine correct indices
    const grid = buildVerificationGrid(TEST_WORDS, 10, 42, wordlist);
    const correctIndices = grid.correctIndices;

    for (const idx of correctIndices) {
      const btn = container.querySelector(`[data-testid="cell-${idx}"]`);
      expect(btn).toBeInTheDocument();
      fireEvent.click(btn!);
    }

    await vi.waitFor(() => expect(onVerified).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('clicks in wrong order → onFailed called', async () => {
    const onVerified = vi.fn();
    const onFailed = vi.fn();
    const { container } = render(
      <SeedPhraseVerify
        realWords={TEST_WORDS}
        gridSize={12}
        onVerified={onVerified}
        onFailed={onFailed}
      />
    );

    const grid = buildVerificationGrid(TEST_WORDS, 12, 42, wordlist);
    const correctIndices = new Set(grid.correctIndices);

    // Build wrong selection: pick non-correct indices
    const wrongIndices: number[] = [];
    const totalCells = grid.words.length;
    for (let i = 0; i < totalCells && wrongIndices.length < grid.correctIndices.length; i++) {
      if (!correctIndices.has(i)) {
        wrongIndices.push(i);
      }
    }

    // If not enough decoys, also pick correct indices in wrong positions
    if (wrongIndices.length < grid.correctIndices.length) {
      for (let i = 0; i < totalCells && wrongIndices.length < grid.correctIndices.length; i++) {
        if (!wrongIndices.includes(i)) {
          wrongIndices.push(i);
        }
      }
    }

    for (const idx of wrongIndices) {
      const btn = container.querySelector(`[data-testid="cell-${idx}"]`);
      if (btn && !btn.disabled) {
        fireEvent.click(btn);
      }
    }

    await vi.waitFor(() => expect(onFailed).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.getByTestId('retry')).toBeInTheDocument();
  });

  it('click retry → grid regenerated', async () => {
    const onVerified = vi.fn();
    const onFailed = vi.fn();
    render(
      <SeedPhraseVerify
        realWords={TEST_WORDS}
        gridSize={10}
        onVerified={onVerified}
        onFailed={onFailed}
      />
    );

    const cells = screen.getAllByTestId(/^cell-/);
    for (let i = 0; i < TEST_WORDS.length && i < cells.length; i++) {
      fireEvent.click(cells[i]);
    }

    await vi.waitFor(() => expect(onFailed).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.getByTestId('retry')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('retry'));
    expect(screen.getByTestId('progress')).toHaveTextContent(
      /Select word 1 of \d+/
    );
  });
});
