// packages/solana/test/dist-artifact.spec.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// Imports the BUILT artifact, not src. CI runs `build` before tests,
// so dist always exists in CI; locally run `pnpm --filter @me2em/solana
// build` first.
import {
  SolanaWalletTree,
  SolanaX402Signer,
  isValidSolanaAddress,
  SolanaPaymentAdapter,
  verifyWalletBindingSolana,
  pay,
} from '../dist/index.js';
import { base58 } from '@scure/base';
import { fromHex, fromBase64 } from '@me2em/crypto';
import {
  GOLDEN_ADDRESSES,
  TV2_SEED,
  X402_GOLDEN_BLOCKHASH_HEX,
  X402_GOLDEN_AMOUNT,
  X402_GOLDEN_TX_BASE64,
} from './goldens.js';

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

  it('SolanaX402Signer is exported from dist and reproduces the golden transaction (M2)', async () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      const signer = new SolanaX402Signer({
        tree,
        getRecentBlockhash: async () => base58.encode(fromHex(X402_GOLDEN_BLOCKHASH_HEX)),
      });
      const payload = (await signer.signPayment(
        {
          scheme: 'exact',
          network: 'solana:devnet',
          amount: X402_GOLDEN_AMOUNT,
          asset: 'sol',
          payTo: GOLDEN_ADDRESSES[1],
          maxTimeoutSeconds: 60,
        },
        { url: 'https://api.example.com/premium/feed' }
      )) as Record<string, string>;
      expect(payload.transaction).toBe(X402_GOLDEN_TX_BASE64);
      expect(fromBase64(payload.transaction)[0]).toBe(1);
    } finally {
      tree.dispose();
    }
  });

  it('SolanaX402Signer without the blockhash injection → TypeError from dist (§4.4)', () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      // @ts-expect-error — exercising the runtime contract
      expect(() => new SolanaX402Signer({ tree })).toThrow(/getRecentBlockhash is required/);
    } finally {
      tree.dispose();
    }
  });

  it('@me2em/x402 stays a TYPE-ONLY dependency — zero x402 runtime code in dist (§0.3)', () => {
    const dist = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
    // Distinctive x402 runtime literals, checked QUOTED — as they exist
    // in the x402 bundle only as actual string constants / error codes.
    // Unquoted prose mentions (JSDoc references like `SIGNER_REJECTED`)
    // stay in the solana comments legitimately and must not trip this.
    for (const marker of ["'PAYMENT-REQUIRED'", "'PAYMENT-SIGNATURE'", "'PAYMENT-RESPONSE'", "'NO_VIABLE_OPTION'", "'PAYMENT_REQUIRED_MALFORMED'", "'ME2EM_EXTRA_INVALID'"]) {
      expect(dist.includes(marker), `dist must not contain x402 runtime literal: ${marker}`).toBe(false);
    }
    // The signer itself ships, obviously.
    expect(dist.includes('solana-legacy-transfer')).toBe(true);
  });
});
