// packages/react/test/react/PassphraseInput.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { PassphraseInput } from '../../src/react/PassphraseInput.js';
import '@testing-library/jest-dom/vitest';

describe('PassphraseInput', () => {
  it('input calls onPassphraseChange with NFKC-normalized value', () => {
    const onChange = vi.fn();
    render(<PassphraseInput onPassphraseChange={onChange} />);

    const input = screen.getByTestId('passphrase');
    fireEvent.change(input, { target: { value: 'test-passphrase' } });

    expect(onChange).toHaveBeenCalledWith('test-passphrase');
  });

  it('input calls onPassphraseChange with NFKC normalization (ﬁle → file)', () => {
    const onChange = vi.fn();
    render(<PassphraseInput onPassphraseChange={onChange} />);

    const input = screen.getByTestId('passphrase');
    // ﬁ is U+FB01 (LATIN SMALL LIGATURE FI) — should normalize to "fi"
    fireEvent.change(input, { target: { value: 'ﬁle' } });

    expect(onChange).toHaveBeenCalledWith('file');
  });

  it('warning displayed when showWarnings=true, absent when false', () => {
    const { rerender } = render(<PassphraseInput onPassphraseChange={vi.fn()} showWarnings={true} />);
    expect(screen.getByTestId('warning')).toBeInTheDocument();

    rerender(<PassphraseInput onPassphraseChange={vi.fn()} showWarnings={false} />);
    expect(screen.queryByTestId('warning')).toBeNull();
  });

  it('input has type="password"', () => {
    render(<PassphraseInput onPassphraseChange={vi.fn()} />);
    const input = screen.getByTestId('passphrase');
    expect(input).toHaveAttribute('type', 'password');
  });
});
