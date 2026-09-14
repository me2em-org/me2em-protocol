// packages/react/test/react/SeedPhraseDisplay.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { SeedPhraseDisplay } from '../../src/react/SeedPhraseDisplay.js';
import '@testing-library/jest-dom/vitest';

const TEST_WORDS = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident'];

describe('SeedPhraseDisplay', () => {
  it('initial: words not visible, reveal button present', () => {
    render(<SeedPhraseDisplay words={TEST_WORDS} />);
    expect(screen.getByTestId('reveal')).toBeInTheDocument();
    expect(screen.queryByTestId('words')).toBeNull();
  });

  it('click reveal → shows 12 li with word texts', () => {
    render(<SeedPhraseDisplay words={TEST_WORDS} />);
    fireEvent.click(screen.getByTestId('reveal'));
    const items = screen.getAllByTestId(/^word-/);
    expect(items).toHaveLength(12);
    TEST_WORDS.forEach((word, i) => {
      expect(items[i]).toHaveTextContent(word);
    });
  });

  it('click copy → clipboard called with join, copy button disabled', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<SeedPhraseDisplay words={TEST_WORDS} />);
    fireEvent.click(screen.getByTestId('reveal'));
    fireEvent.click(screen.getByTestId('copy-all'));

    expect(writeText).toHaveBeenCalledWith(TEST_WORDS.join(' '));
    await waitFor(() => {
      expect(screen.getByTestId('copy-all')).toBeDisabled();
    });
    expect(screen.getByTestId('copy-all')).toHaveTextContent('Copied');
  });

  it('repeated click on disabled copy button does nothing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<SeedPhraseDisplay words={TEST_WORDS} />);
    fireEvent.click(screen.getByTestId('reveal'));
    fireEvent.click(screen.getByTestId('copy-all'));
    await waitFor(() => {
      expect(screen.getByTestId('copy-all')).toBeDisabled();
    });
    const callCount = writeText.mock.calls.length;
    fireEvent.click(screen.getByTestId('copy-all'));
    expect(writeText.mock.calls.length).toBe(callCount);
  });

  it('click dismiss → words hidden, onDismiss called', () => {
    const onDismiss = vi.fn();
    render(<SeedPhraseDisplay words={TEST_WORDS} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('reveal'));
    fireEvent.click(screen.getByTestId('dismiss'));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByTestId('words')).toBeNull();
  });

  it('dismissed state shows stub without reveal button', () => {
    const onDismiss = vi.fn();
    render(<SeedPhraseDisplay words={TEST_WORDS} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('reveal'));
    fireEvent.click(screen.getByTestId('dismiss'));
    expect(screen.queryByTestId('reveal')).toBeNull();
    expect(screen.getByTestId('copy-error')).toBeInTheDocument();
  });

  it('clipboard failure → no COPY dispatch, error shown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('fail')) },
      writable: true,
      configurable: true,
    });

    render(<SeedPhraseDisplay words={TEST_WORDS} />);
    fireEvent.click(screen.getByTestId('reveal'));
    fireEvent.click(screen.getByTestId('copy-all'));

    await waitFor(() => {
      expect(screen.getByTestId('copy-all')).not.toBeDisabled();
    });
  });
});
