// packages/react/test/react/renderWithProvider.tsx
import { renderHook, type RenderHookResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Me2emProvider } from '../../src/react/Me2emProvider.js';

export const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

export async function testSeed(): Promise<Uint8Array> {
  const { get32ByteSeedFromMnemonic } = await import('@me2em/core');
  return get32ByteSeedFromMnemonic(TEST_MNEMONIC);
}

export function withProvider(node?: ReactNode): (props: { children: ReactNode }) => ReactNode {
  return ({ children }) => <Me2emProvider>{node ?? children}</Me2emProvider>;
}

export function renderHookCapturingError(
  callback: () => unknown
): { captured: { message: string } | null; rerender: () => void } {
  let captured: { message: string } | null = null;
  const spy = (globalThis as any).console?.error;
  if (spy) {
    spy.mockImplementation((...args: unknown[]) => {
      const msg = args[0];
      if (typeof msg === 'string' && msg.includes('Error:')) {
        captured = { message: msg };
      }
    });
  }
  const result: RenderHookResult<unknown, unknown> = renderHook(callback);
  return { captured, rerender: () => result.rerender(callback) };
}

export { renderHookCapturingError as renderHookWithBoundary };
