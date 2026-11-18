// packages/solana/test/verify.spec.ts
//
// Ф4: SolanaPaymentVerifier — 7-step verifyPayment, containment-before-time,
// LUT fallback, blockTime fallback, chain mismatch, SPL → WRONG_ASSET,
// idempotency, v0/v1 fixtures.
import { describe, it, expect, vi } from 'vitest';
import type { PaymentRequest } from '@me2em/core';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { SolanaPaymentAdapter } from '../src/verify.js';
import { GOLDEN_ADDRESSES } from './goldens.js';

// ---------------------------------------------------------------------------
// Helpers — build minimal ParsedTransactionWithInstructions fixtures
// ---------------------------------------------------------------------------

function makeTransferTx({
  reference,
  payTo,
  lamports,
  blockTime = 1700000000,
  version = '0',
  addressTableLookups = undefined,
  loadedAddresses = undefined,
  referenceInStaticKeys = true,
}: {
  reference: string;
  payTo: string;
  lamports: number;
  blockTime?: number;
  version?: number | string;
  addressTableLookups?: unknown;
  loadedAddresses?: { writable: string[]; readonly: string[] };
  referenceInStaticKeys?: boolean;
}) {
  return {
    transaction: {
      message: {
        accountKeys: [
          {
            // When the reference lives only in a LUT, the static keys
            // must NOT contain it — otherwise containment passes before
            // the LUT path is ever reached.
            pubkey: referenceInStaticKeys ? reference : 'staticPayer123',
            signer: true,
            writable: true,
            source: 'static',
          },
          {
            pubkey: payTo,
            signer: false,
            writable: true,
            source: 'static',
          },
        ],
        ...(addressTableLookups ? { addressTableLookups } : {}),
        instructions: [
          {
            program: 'system',
            parsed: {
              type: 'transfer',
              info: {
                destination: payTo,
                lamports,
              },
            },
          },
        ],
      },
    },
    meta: {
      loadedAddresses,
      blockTime,
    },
    version,
  };
}

function makeMockFetch(
  handlers: Record<string, (body: unknown) => Promise<Record<string, unknown>>>
): typeof globalThis.fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const method = (body as Record<string, unknown>).method || '';
    const handler = handlers[method as string];
    if (!handler) {
      return {
        status: 404,
        ok: false,
        text: () => Promise.resolve('Not found'),
      } as Response;
    }
    const result = await handler(body);
    return {
      status: 200,
      ok: true,
      json: () => Promise.resolve(result),
    } as Response;
  }) as unknown as typeof globalThis.fetch;
}

function makeRequest(overrides?: Partial<PaymentRequest>): PaymentRequest {
  return {
    reference: 'refPubkey123',
    payTo: 'payTo123',
    amount: '1.0',
    asset: 'sol',
    expiresAt: 1700100000,
    chain: 'solana:devnet',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// LUT fixtures — build AddressLookupTable account data (lut.ts wire format)
// ---------------------------------------------------------------------------

/** Mirrored from verify.ts (module-private constant there). */
const LUT_PROGRAM_ID = 'AddressLookupTab1e1111111111111111111111111';
const LUT_ACCOUNT_KEY = base58.encode(new Uint8Array(32).fill(4));
// A deterministic off-static-keys reference pubkey (need not be on-curve).
const REFERENCE_BYTES = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const REFERENCE_B58 = base58.encode(REFERENCE_BYTES);

function u32le(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function u64le(v: bigint): number[] {
  const out: number[] = [];
  for (let i = 0; i < 8; i++) out.push(Number((v >> BigInt(i * 8)) & 0xffn));
  return out;
}

function makeLutAccountData(
  addresses: Uint8Array[],
  opts: { authorityTag?: number; discriminator?: number } = {}
): string {
  const bytes: number[] = [
    ...u32le(opts.discriminator ?? 1),
    ...u64le(0n),
    ...u64le(0n),
    0,
    opts.authorityTag ?? 0,
  ];
  if ((opts.authorityTag ?? 0) === 1) bytes.push(...new Array<number>(32).fill(9));
  bytes.push(...u32le(addresses.length), ...addresses.flatMap((a) => Array.from(a)));
  return base64.encode(new Uint8Array(bytes));
}

/** Count `getAccountInfo` calls a mock fetch has served so far. */
function countRpcMethod(mockFetch: unknown, method: string): number {
  const calls = (mockFetch as { mock?: { calls: [RequestInfo | URL, RequestInit?][] } })
    .mock?.calls ?? [];
  return calls.filter(
    ([, init]) => init?.body && JSON.parse(String(init.body)).method === method
  ).length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SolanaPaymentVerifier — 7 steps', () => {
  describe('step 1: NOT_FOUND', () => {
    it('returns NOT_FOUND when getTransaction returns null', async () => {
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: null }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest());
      expect(result).toEqual({ status: 'failure', reason: 'NOT_FOUND', observedAt: expect.any(Number) });
    });
  });

  describe('step 2: REFERENCE_MISMATCH', () => {
    it('returns REFERENCE_MISMATCH when reference is not in static keys or LUT', async () => {
      const tx = makeTransferTx({ reference: 'refPubkey123', payTo: 'payTo123', lamports: 1e9 });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest({ reference: 'otherRef123' }));
      expect(result).toEqual({ status: 'failure', reason: 'REFERENCE_MISMATCH', observedAt: expect.any(Number) });
    });

    it('accepts reference in LUT loadedAddresses', async () => {
      const tx = makeTransferTx({
        reference: 'lutRef123',
        payTo: 'payTo123',
        lamports: 1e9,
        loadedAddresses: { writable: ['lutRef123'], readonly: [] },
      });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () =>
          Promise.resolve({
            result: {
              signatures: [
                { signature: 'sig1', slot: 1, blockTime: 1700000000, confirmationStatus: 'confirmed', err: undefined, memo: null },
              ],
            },
          }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest({ reference: 'lutRef123', payTo: 'otherPayTo' }));
      // Passes step 2 (reference in LUT), fails step 5 (wrong recipient — payTo doesn't match)
      expect(result).toEqual({ status: 'failure', reason: 'WRONG_RECIPIENT', observedAt: expect.any(Number) });
    });
  });

  describe('step 3: EXPIRED + containment-before-time', () => {
    it('returns EXPIRED when blockTime > expiresAt', async () => {
      const tx = makeTransferTx({
        reference: 'refPubkey123',
        payTo: 'payTo123',
        lamports: 1e9,
        blockTime: 1700200000,
      });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest());
      expect(result).toEqual({ status: 'failure', reason: 'EXPIRED', observedAt: expect.any(Number) });
    });

    it('accepts payment when blockTime < expiresAt (containment-before-time)', async () => {
      const tx = makeTransferTx({
        reference: 'refPubkey123',
        payTo: 'payTo123',
        lamports: 1e9,
        blockTime: 1700000000,
      });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest());
      expect(result).toEqual({ status: 'success', observedAt: expect.any(Number) });
    });
  });

  describe('step 4: REPLAYED', () => {
    it('returns REPLAYED when >1 confirmed signature with same reference', async () => {
      const tx = makeTransferTx({ reference: 'refPubkey123', payTo: 'payTo123', lamports: 1e9 });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () =>
          Promise.resolve({
            result: {
              signatures: [
                { signature: 'sig1', slot: 1, blockTime: 1700000000, confirmationStatus: 'confirmed', err: undefined, memo: null },
                { signature: 'sig2', slot: 2, blockTime: 1700000001, confirmationStatus: 'confirmed', err: undefined, memo: null },
              ],
            },
          }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest());
      expect(result).toEqual({ status: 'failure', reason: 'REPLAYED', observedAt: expect.any(Number) });
    });
  });

  describe('step 5: WRONG_RECIPIENT + UNDERPAID', () => {
    it('returns WRONG_RECIPIENT when payTo does not match', async () => {
      const tx = makeTransferTx({ reference: 'refPubkey123', payTo: 'payTo123', lamports: 1e9 });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest({ payTo: 'otherPayTo123' }));
      expect(result).toEqual({ status: 'failure', reason: 'WRONG_RECIPIENT', observedAt: expect.any(Number) });
    });

    it('returns UNDERPAID when lamports < amount', async () => {
      const tx = makeTransferTx({ reference: 'refPubkey123', payTo: 'payTo123', lamports: 5e8 });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest({ amount: '1.0' }));
      expect(result).toEqual({ status: 'failure', reason: 'UNDERPAID', observedAt: expect.any(Number) });
    });
  });

  describe('step 6a: WRONG_ASSET', () => {
    it('returns WRONG_ASSET for SPL tokens', async () => {
      const tx = makeTransferTx({ reference: 'refPubkey123', payTo: 'payTo123', lamports: 1e9 });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest({ amount: '1.0', asset: 'usdc' }));
      expect(result.reason).toBe('WRONG_ASSET');
    });

    it('accepts SOL (asset: sol) — status success', async () => {
      const tx = makeTransferTx({ reference: 'refPubkey123', payTo: 'payTo123', lamports: 1e9 });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest({ amount: '1.0', asset: 'sol' }));
      expect(result.status).toBe('success');
    });

    it('SPL without system.transfer → WRONG_ASSET (not UNDERPAID)', async () => {
      // Transaction with system.transfer (passes step 5 WRONG_RECIPIENT and step 6 UNDERPAID)
      // but asset is 'usdc' → must fail at step 6a WRONG_ASSET, not step 6 UNDERPAID
      const tx = {
        transaction: {
          message: {
            accountKeys: [
              { pubkey: 'refPubkey123', signer: true, writable: true, source: 'static' as const },
              { pubkey: 'payTo123', signer: false, writable: true, source: 'static' as const },
            ],
            instructions: [
              {
                program: 'system',
                parsed: {
                  type: 'transfer',
                  info: {
                    destination: 'payTo123',
                    lamports: 1e9,
                  },
                },
              },
            ],
          },
        },
        meta: { blockTime: 1700000000 },
      } as const;
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest({ asset: 'usdc' }));
      expect(result.reason).toBe('WRONG_ASSET');
    });
  });

  describe('idempotency — same payment verified twice', () => {
    it('returns success both times', async () => {
      const tx = makeTransferTx({ reference: 'refPubkey123', payTo: 'payTo123', lamports: 1e9 });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const r1 = await adapter.verifyPayment('sig123', makeRequest({ amount: '1.0', asset: 'sol' }));
      const r2 = await adapter.verifyPayment('sig123', makeRequest({ amount: '1.0', asset: 'sol' }));
      expect(r1.status).toBe('success');
      expect(r2.status).toBe('success');
    });
  });

  describe('chain mismatch', () => {
    it('throws when request chain differs from adapter chain', async () => {
      const tx = makeTransferTx({ reference: 'refPubkey123', payTo: 'payTo123', lamports: 1e9 });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      await expect(
        adapter.verifyPayment('sig123', makeRequest({ chain: 'mainnet-beta' }))
      ).rejects.toThrow('does not match');
    });
  });

  describe('v0 vs v1 transactions', () => {
    it('handles v0 transactions (version "0")', async () => {
      const tx = makeTransferTx({ reference: 'refPubkey123', payTo: 'payTo123', lamports: 1e9, version: '0' });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () =>
          Promise.resolve({
            result: {
              signatures: [
                { signature: 'sig1', slot: 1, blockTime: 1700000000, confirmationStatus: 'confirmed', err: undefined, memo: null },
              ],
            },
          }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest({ amount: '1.0', asset: 'sol' }));
      expect(result).toEqual({ status: 'success', observedAt: expect.any(Number) });
    });

    it('handles v1 transactions (version 1)', async () => {
      const tx = makeTransferTx({ reference: 'refPubkey123', payTo: 'payTo123', lamports: 1e9, version: 1 });
      const mockFetch = makeMockFetch({
        getTransaction: () => Promise.resolve({ result: tx }),
        getSignaturesForAddress: () =>
          Promise.resolve({
            result: {
              signatures: [
                { signature: 'sig1', slot: 1, blockTime: 1700000000, confirmationStatus: 'confirmed', err: undefined, memo: null },
              ],
            },
          }),
      });
      const adapter = new SolanaPaymentAdapter({
        network: 'devnet',
        endpoint: 'http://localhost:8899',
        fetch: mockFetch,
      });
      const result = await adapter.verifyPayment('sig123', makeRequest({ amount: '1.0', asset: 'sol' }));
      expect(result).toEqual({ status: 'success', observedAt: expect.any(Number) });
    });
  });
});

describe('SolanaPaymentAdapter — wallet-surface delegation', () => {
  const adapter = new SolanaPaymentAdapter({ network: 'devnet' });

  it('network getter exposes the bound network', () => {
    expect(adapter.network).toBe('devnet');
    expect(adapter.chain).toBe('solana:devnet');
  });

  it('nextIndex delegates to the wallet adapter', () => {
    expect(adapter.nextIndex(["m/44'/501'/3'/0'", "m/44'/501'/7'/0'"])).toBe(8);
    expect(adapter.nextIndex([])).toBe(0);
  });

  it('verifyWalletBinding delegates to the on-curve override (Ф4)', async () => {
    // A guaranteed off-curve address, found deterministically: ~half of
    // arbitrary 32-byte strings are not valid ed25519 points.
    const offCurveAddress = (() => {
      for (let i = 1; i < 100; i++) {
        const bytes = new Uint8Array(32);
        bytes[0] = i;
        if (!ed25519.utils.isValidPublicKey(bytes)) return base58.encode(bytes);
      }
      throw new Error('no off-curve fixture found');
    })();
    const ok = await adapter.verifyWalletBinding(
      { chain: 'solana:devnet', address: GOLDEN_ADDRESSES[0] },
      { id: 'x', kind: 'identity', name: 'n' },
      {}
    );
    expect(ok).toBe(true);
    const offCurve = await adapter.verifyWalletBinding(
      { chain: 'solana:devnet', address: offCurveAddress },
      { id: 'x', kind: 'identity', name: 'n' },
      {}
    );
    expect(offCurve).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LUT containment — RPC-resolved loadedAddresses and the manual fallback
// (the legacy path: addressTableLookups present, loadedAddresses absent)
// ---------------------------------------------------------------------------

describe('verifyPayment — LUT containment (loadedAddresses + manual fallback)', () => {
  it('accepts a reference present only in meta.loadedAddresses (not in static keys)', async () => {
    const tx = makeTransferTx({
      reference: REFERENCE_B58,
      payTo: 'payTo123',
      lamports: 1e9,
      loadedAddresses: { writable: [REFERENCE_B58], readonly: [] },
      referenceInStaticKeys: false,
    });
    const mockFetch = makeMockFetch({
      getTransaction: () => Promise.resolve({ result: tx }),
      getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
    });
    const adapter = new SolanaPaymentAdapter({ network: 'devnet', endpoint: 'http://localhost:8899', fetch: mockFetch });
    const result = await adapter.verifyPayment('sig123', makeRequest({ reference: REFERENCE_B58 }));
    expect(result).toEqual({ status: 'success', observedAt: expect.any(Number) });
    expect(countRpcMethod(mockFetch, 'getAccountInfo')).toBe(0);
  });

  it('returns REFERENCE_MISMATCH when loadedAddresses exist but lack the reference', async () => {
    const tx = makeTransferTx({
      reference: REFERENCE_B58,
      payTo: 'payTo123',
      lamports: 1e9,
      loadedAddresses: { writable: ['unrelatedLutAddr'], readonly: ['anotherOne'] },
      referenceInStaticKeys: false,
    });
    const mockFetch = makeMockFetch({
      getTransaction: () => Promise.resolve({ result: tx }),
      getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
    });
    const adapter = new SolanaPaymentAdapter({ network: 'devnet', endpoint: 'http://localhost:8899', fetch: mockFetch });
    const result = await adapter.verifyPayment('sig123', makeRequest({ reference: REFERENCE_B58 }));
    expect(result).toEqual({ status: 'failure', reason: 'REFERENCE_MISMATCH', observedAt: expect.any(Number) });
    expect(countRpcMethod(mockFetch, 'getAccountInfo')).toBe(0);
  });

  it('skips the manual fallback when the RPC already resolved loadedAddresses', async () => {
    // addressTableLookups present AND loadedAddresses present: the manual
    // bincode path must not run (no getAccountInfo), result is mismatch.
    const tx = makeTransferTx({
      reference: REFERENCE_B58,
      payTo: 'payTo123',
      lamports: 1e9,
      addressTableLookups: [{ accountKey: LUT_ACCOUNT_KEY, writableIndexes: [0], readonlyIndexes: [] }],
      loadedAddresses: { writable: ['resolvedElsewhere'], readonly: [] },
      referenceInStaticKeys: false,
    });
    const mockFetch = makeMockFetch({
      getTransaction: () => Promise.resolve({ result: tx }),
      getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
    });
    const adapter = new SolanaPaymentAdapter({ network: 'devnet', endpoint: 'http://localhost:8899', fetch: mockFetch });
    const result = await adapter.verifyPayment('sig123', makeRequest({ reference: REFERENCE_B58 }));
    expect(result.reason).toBe('REFERENCE_MISMATCH');
    expect(countRpcMethod(mockFetch, 'getAccountInfo')).toBe(0);
  });

  it('manual fallback: resolves the reference from an on-chain LUT account → success', async () => {
    const tx = makeTransferTx({
      reference: REFERENCE_B58,
      payTo: 'payTo123',
      lamports: 1e9,
      addressTableLookups: [{ accountKey: LUT_ACCOUNT_KEY, writableIndexes: [0], readonlyIndexes: [] }],
      referenceInStaticKeys: false,
    });
    const mockFetch = makeMockFetch({
      getTransaction: () => Promise.resolve({ result: tx }),
      getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      getAccountInfo: () =>
        Promise.resolve({
          result: { data: [makeLutAccountData([REFERENCE_BYTES]), 'base64'], owner: LUT_PROGRAM_ID },
        }),
    });
    const adapter = new SolanaPaymentAdapter({ network: 'devnet', endpoint: 'http://localhost:8899', fetch: mockFetch });
    const result = await adapter.verifyPayment('sig123', makeRequest({ reference: REFERENCE_B58 }));
    expect(result).toEqual({ status: 'success', observedAt: expect.any(Number) });
    expect(countRpcMethod(mockFetch, 'getAccountInfo')).toBe(1);
  });

  it('manual fallback: reference not among resolved LUT addresses → REFERENCE_MISMATCH', async () => {
    const tx = makeTransferTx({
      reference: REFERENCE_B58,
      payTo: 'payTo123',
      lamports: 1e9,
      addressTableLookups: [{ accountKey: LUT_ACCOUNT_KEY, writableIndexes: [0], readonlyIndexes: [] }],
      referenceInStaticKeys: false,
    });
    const other = REFERENCE_BYTES.map((b, i) => (i === 0 ? b ^ 0xff : b));
    const mockFetch = makeMockFetch({
      getTransaction: () => Promise.resolve({ result: tx }),
      getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      getAccountInfo: () =>
        Promise.resolve({
          result: { data: [makeLutAccountData([other]), 'base64'], owner: LUT_PROGRAM_ID },
        }),
    });
    const adapter = new SolanaPaymentAdapter({ network: 'devnet', endpoint: 'http://localhost:8899', fetch: mockFetch });
    const result = await adapter.verifyPayment('sig123', makeRequest({ reference: REFERENCE_B58 }));
    expect(result).toEqual({ status: 'failure', reason: 'REFERENCE_MISMATCH', observedAt: expect.any(Number) });
  });

  it('manual fallback: LUT account missing (getAccountInfo null) → fail-closed mismatch', async () => {
    const tx = makeTransferTx({
      reference: REFERENCE_B58,
      payTo: 'payTo123',
      lamports: 1e9,
      addressTableLookups: [{ accountKey: LUT_ACCOUNT_KEY, writableIndexes: [0], readonlyIndexes: [] }],
      referenceInStaticKeys: false,
    });
    const mockFetch = makeMockFetch({
      getTransaction: () => Promise.resolve({ result: tx }),
      getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      getAccountInfo: () => Promise.resolve({ result: null }),
    });
    const adapter = new SolanaPaymentAdapter({ network: 'devnet', endpoint: 'http://localhost:8899', fetch: mockFetch });
    const result = await adapter.verifyPayment('sig123', makeRequest({ reference: REFERENCE_B58 }));
    expect(result.reason).toBe('REFERENCE_MISMATCH');
    expect(countRpcMethod(mockFetch, 'getAccountInfo')).toBe(1);
  });

  it('manual fallback: account owner is not the LUT program → fail-closed mismatch', async () => {
    const tx = makeTransferTx({
      reference: REFERENCE_B58,
      payTo: 'payTo123',
      lamports: 1e9,
      addressTableLookups: [{ accountKey: LUT_ACCOUNT_KEY, writableIndexes: [0], readonlyIndexes: [] }],
      referenceInStaticKeys: false,
    });
    const mockFetch = makeMockFetch({
      getTransaction: () => Promise.resolve({ result: tx }),
      getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      getAccountInfo: () =>
        Promise.resolve({
          result: {
            data: [makeLutAccountData([REFERENCE_BYTES]), 'base64'],
            owner: 'SystemProgram1111111111111111111111111111111',
          },
        }),
    });
    const adapter = new SolanaPaymentAdapter({ network: 'devnet', endpoint: 'http://localhost:8899', fetch: mockFetch });
    const result = await adapter.verifyPayment('sig123', makeRequest({ reference: REFERENCE_B58 }));
    expect(result.reason).toBe('REFERENCE_MISMATCH');
  });

  it('manual fallback: corrupted LUT data → fail-closed mismatch', async () => {
    const tx = makeTransferTx({
      reference: REFERENCE_B58,
      payTo: 'payTo123',
      lamports: 1e9,
      addressTableLookups: [{ accountKey: LUT_ACCOUNT_KEY, writableIndexes: [0], readonlyIndexes: [] }],
      referenceInStaticKeys: false,
    });
    const mockFetch = makeMockFetch({
      getTransaction: () => Promise.resolve({ result: tx }),
      getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      getAccountInfo: () =>
        Promise.resolve({
          result: {
            data: [makeLutAccountData([REFERENCE_BYTES], { discriminator: 2 }), 'base64'],
            owner: LUT_PROGRAM_ID,
          },
        }),
    });
    const adapter = new SolanaPaymentAdapter({ network: 'devnet', endpoint: 'http://localhost:8899', fetch: mockFetch });
    const result = await adapter.verifyPayment('sig123', makeRequest({ reference: REFERENCE_B58 }));
    expect(result.reason).toBe('REFERENCE_MISMATCH');
  });

  it('caches resolved LUTs: a second verification does not re-fetch the account', async () => {
    const tx = makeTransferTx({
      reference: REFERENCE_B58,
      payTo: 'payTo123',
      lamports: 1e9,
      addressTableLookups: [{ accountKey: LUT_ACCOUNT_KEY, writableIndexes: [0], readonlyIndexes: [] }],
      referenceInStaticKeys: false,
    });
    const mockFetch = makeMockFetch({
      getTransaction: () => Promise.resolve({ result: tx }),
      getSignaturesForAddress: () => Promise.resolve({ result: { signatures: [] } }),
      getAccountInfo: () =>
        Promise.resolve({
          result: { data: [makeLutAccountData([REFERENCE_BYTES]), 'base64'], owner: LUT_PROGRAM_ID },
        }),
    });
    const adapter = new SolanaPaymentAdapter({ network: 'devnet', endpoint: 'http://localhost:8899', fetch: mockFetch });
    const r1 = await adapter.verifyPayment('sig123', makeRequest({ reference: REFERENCE_B58 }));
    const r2 = await adapter.verifyPayment('sig123', makeRequest({ reference: REFERENCE_B58 }));
    expect(r1.status).toBe('success');
    expect(r2.status).toBe('success');
    expect(countRpcMethod(mockFetch, 'getAccountInfo')).toBe(1);
  });
});
