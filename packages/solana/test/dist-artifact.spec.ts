// packages/solana/test/dist-artifact.spec.ts
import { describe, it, expect } from 'vitest';
// Imports the BUILT artifact, not src. CI runs `build` before tests,
// so dist always exists in CI; locally run `pnpm --filter @me2em/solana
// build` first.
import {
  SolanaWalletTree,
  isValidSolanaAddress,
  SolanaPaymentAdapter,
  verifyWalletBindingSolana,
  pay,
} from '../dist/index.js';
import { GOLDEN_ADDRESSES, TV2_SEED } from './goldens.js';

// Import deriveForVerification as a static method (no named import needed)

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

  it('SolanaPaymentAdapter constructs from dist', () => {
    const adapter = new SolanaPaymentAdapter({ network: 'devnet' });
    expect(adapter.chain).toBe('solana:devnet');
  });

  it('verifyWalletBindingSolana works from dist', () => {
    expect(verifyWalletBindingSolana({ chain: 'solana:devnet', address: GOLDEN_ADDRESSES[0] })).toBe(true);
  });

  it('deriveForVerification works from dist', async () => {
    const addr = await SolanaWalletTree.deriveForVerification(TV2_SEED, "m/44'/501'/0'/0'");
    expect(addr).toBe(GOLDEN_ADDRESSES[0]);
  });

  it('pay is exported from dist (Ф5)', () => {
    expect(typeof pay).toBe('function');
  });

  it('SolanaPaymentAdapter.pay without seed → TypeError from dist (stateless contract)', async () => {
    const adapter = new SolanaPaymentAdapter({ network: 'devnet' });
    await expect(
      adapter.pay(
        { chain: 'solana:devnet', address: GOLDEN_ADDRESSES[0] },
        {
          chain: 'solana:devnet',
          payTo: GOLDEN_ADDRESSES[1],
          amount: '1',
          asset: 'sol',
          reference: GOLDEN_ADDRESSES[2],
          expiresAt: 9999999999,
        }
      )
    ).rejects.toThrow(TypeError);
  });
});
