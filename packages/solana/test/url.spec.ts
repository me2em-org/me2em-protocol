// packages/solana/test/url.spec.ts
//
// Ф3: createPaymentRequestURL — the Solana Pay URI hand-off for
// external wallets (Phantom acceptance format): parameter set,
// parameter order, native-vs-SPL asset handling, validation.
import { describe, it, expect } from 'vitest';
import { base58 } from '@scure/base';
import { createPaymentReference } from '../src/reference.js';
import { createPaymentRequestURL, SOLANA_NATIVE_ASSET } from '../src/url.js';
import { GOLDEN_ADDRESSES, TV2_SEED } from './goldens.js';
import { SolanaWalletTree } from '../src/wallet-tree.js';
import type { PaymentRequest } from '@me2em/core';

const PAY_TO = GOLDEN_ADDRESSES[0]; // QVQwskmGkDfxQfRkbFJeY2YFm7go3ciiLvuANp1AsCi
const MINT = GOLDEN_ADDRESSES[1]; // any 32-byte base58 value plays the mint role here

function aRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    chain: 'solana:mainnet-beta',
    payTo: PAY_TO,
    amount: '1.5',
    asset: SOLANA_NATIVE_ASSET,
    reference: createPaymentReference(),
    expiresAt: 1798880000,
    ...overrides,
  };
}

describe('createPaymentRequestURL — Solana Pay URI shape', () => {
  it('encodes the native-SOL request: amount + reference, NO spl-token', () => {
    const request = aRequest();
    const url = createPaymentRequestURL(request);
    expect(url.startsWith(`solana:${PAY_TO}?`)).toBe(true);
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('solana:');
    expect(parsed.pathname).toBe(PAY_TO);
    expect(parsed.searchParams.get('amount')).toBe('1.5');
    expect(parsed.searchParams.get('spl-token')).toBeNull();
    expect(parsed.searchParams.get('reference')).toBe(request.reference);
    // Solana Pay spec parameter order: amount, [spl-token], reference.
    expect(url.split('?')[1]).toMatch(/^amount=.*&reference=/);
    // expiresAt is deliberately NOT part of the URI (v1.2 §0.1 — the
    // verifier enforces expiry from the SIGNED request):
    expect(url).not.toContain('expiresAt');
  });

  it('encodes SPL mints as spl-token, in spec order', () => {
    const url = createPaymentRequestURL(aRequest({ asset: MINT, amount: '100' }));
    const parsed = new URL(url);
    expect(parsed.searchParams.get('spl-token')).toBe(MINT);
    expect(parsed.searchParams.get('amount')).toBe('100');
    const query = url.split('?')[1];
    expect(query.indexOf('amount=')).toBeLessThan(query.indexOf('spl-token='));
    expect(query.indexOf('spl-token=')).toBeLessThan(query.indexOf('reference='));
  });

  it('is deterministic — the same request encodes byte-identically', () => {
    const request = aRequest({ asset: MINT });
    expect(createPaymentRequestURL(request)).toBe(createPaymentRequestURL(request));
  });

  it('accepts the whole legal amount grammar', () => {
    for (const ok of ['0', '5', '0.5', '12.75', '1000000']) {
      expect(() => createPaymentRequestURL(aRequest({ amount: ok })), `amount ${ok}`).not.toThrow();
    }
  });

  it('rejects malformed amounts fail-closed', () => {
    for (const bad of ['-1', '1e3', '1,5', ' 1', '1 ', '.5', '1.', '01', '+1', '0x10', '']) {
      expect(
        () => createPaymentRequestURL(aRequest({ amount: bad })),
        `amount ${JSON.stringify(bad)}`
      ).toThrow(TypeError);
    }
  });

  it('validates chain, payTo, asset and reference fail-closed', () => {
    expect(() => createPaymentRequestURL(aRequest({ chain: 'eip155:1' }))).toThrow(TypeError);
    expect(() => createPaymentRequestURL(aRequest({ chain: 'solana' }))).toThrow(TypeError);
    expect(() => createPaymentRequestURL(aRequest({ chain: 'Solana:mainnet-beta' }))).toThrow(TypeError);
    expect(() => createPaymentRequestURL(aRequest({ payTo: 'not-an-address' }))).toThrow(TypeError);
    expect(() => createPaymentRequestURL(aRequest({ asset: '' }))).toThrow(TypeError);
    expect(() => createPaymentRequestURL(aRequest({ asset: 'not a mint!' }))).toThrow(TypeError);
    expect(() => createPaymentRequestURL(aRequest({ asset: base58.encode(new Uint8Array(31)) }))).toThrow(
      TypeError // 31 bytes — not a mint
    );
    expect(() => createPaymentRequestURL(aRequest({ reference: 'garbage' }))).toThrow(TypeError);
    expect(() => createPaymentRequestURL(null as unknown as PaymentRequest)).toThrow(TypeError);
  });
});

describe('end-to-end wallet → URL (Ф3 acceptance flow)', () => {
  it('the derived payment address is URL-accepted as payTo', async () => {
    const tree = SolanaWalletTree.fromSeed(TV2_SEED);
    try {
      const { address, derivationPath } = await tree.deriveWallet(0);
      expect(address).toBe(GOLDEN_ADDRESSES[0]);
      const url = createPaymentRequestURL({
        chain: 'solana:mainnet-beta',
        payTo: address,
        amount: '0.000000001',
        asset: SOLANA_NATIVE_ASSET,
        reference: createPaymentReference(),
        expiresAt: 1798880000,
      });
      const parsed = new URL(url);
      expect(parsed.pathname).toBe(address);
      expect(parsed.searchParams.get('amount')).toBe('0.000000001');
      expect(derivationPath).toBe("m/44'/501'/0'/0'");
    } finally {
      tree.dispose();
    }
  });
});
