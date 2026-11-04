// packages/solana/test/dist-artifact.spec.ts
import { describe, it, expect } from 'vitest';
// Imports the BUILT artifact, not src. CI runs `build` before tests,
// so dist always exists in CI; locally run `pnpm --filter @me2em/solana
// build` first.
import { SolanaWalletTree, isValidSolanaAddress } from '../dist/index.js';
import { GOLDEN_ADDRESSES, TV2_SEED } from './goldens.js';

/**
 * Smoke pin for the PUBLISHED module graph (the crypto BL-45 class of
 * failure): tsup bundles every import that is not a declared
 * dependency. If a phantom dependency ever sneaks into the solana
 * dist graph, the artifact fails to import while the src-based suite
 * stays green — this spec fails first, at import time.
 */
describe('dist artifact (published shape)', () => {
  it('loads and executes — derivation works end-to-end from dist', async () => {
    expect(isValidSolanaAddress('QVQwskmGkDfxQfRkbFJeY2YFm7go3ciiLvuANp1AsCi')).toBe(true);
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      const wallet = await tree.deriveWallet(0);
      expect(wallet.address).toBe(GOLDEN_ADDRESSES[0]);
    } finally {
      tree.dispose();
    }
  });
});
