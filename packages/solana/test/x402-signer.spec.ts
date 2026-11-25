// packages/solana/test/x402-signer.spec.ts
//
// M2 acceptance suite (ТЗ @me2em/x402 v1.2 §4.5): SolanaX402Signer
// implements the x402 `PaymentSigner` (type-only peer), the legacy
// transfer serialization is pinned by golden vectors, signatures are
// verified offline with `verifyRaw`, the derived private key is wiped
// on every path, and the signer composes with `createPaymentFetch`
// against a mock server (402 → PAYMENT-SIGNATURE → 200).
//
// No network: the blockhash source is a method-routing injection and
// the HTTP layer is a mock `fetch` — same philosophy as pay.spec.ts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { base58 } from '@scure/base';
import { DisposedError, type X402PaymentRequired } from '@me2em/core';
import { fromBase64, fromHex, toHex, verifyRaw } from '@me2em/crypto';
import {
  createPaymentFetch,
  decodePaymentPayload,
  encodePaymentRequired,
  encodeSettleResponse,
  readSettlement,
  X402Error,
} from '@me2em/x402';
import {
  SolanaWalletTree,
  SolanaX402Signer,
  SOLANA_NATIVE_ASSET,
  type SolanaDerivedWallet,
} from '../src/index.js';
import {
  GOLDEN_ADDRESSES,
  TV2_SEED,
  X402_GOLDEN_AMOUNT,
  X402_GOLDEN_BLOCKHASH_HEX,
  X402_GOLDEN_MESSAGE_HEX,
  X402_GOLDEN_TX_BASE64,
} from './goldens.js';
import type { X402PaymentRequirements } from '@me2em/core';

/** The golden blockhash as the application's RPC would return it. */
const GOLDEN_BLOCKHASH = base58.encode(fromHex(X402_GOLDEN_BLOCKHASH_HEX));

const openedTrees: SolanaWalletTree[] = [];

function makeTree(): SolanaWalletTree {
  const tree = SolanaWalletTree.fromSeed(TV2_SEED);
  openedTrees.push(tree);
  return tree;
}

function requirements(overrides: Partial<X402PaymentRequirements> = {}): X402PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'solana:devnet',
    amount: X402_GOLDEN_AMOUNT,
    asset: SOLANA_NATIVE_ASSET,
    payTo: GOLDEN_ADDRESSES[1],
    maxTimeoutSeconds: 60,
    ...overrides,
  };
}

const resource = { url: 'https://api.example.com/premium/feed', description: 'premium feed' };

afterEach(() => {
  for (const tree of openedTrees.splice(0)) tree.dispose();
  vi.unstubAllGlobals();
});

describe('SolanaX402Signer — constructor (fail-fast)', () => {
  it('throws TypeError without getRecentBlockhash — the injection is mandatory (§4.4)', () => {
    expect(
      () =>
        // @ts-expect-error — exercising the runtime contract
        new SolanaX402Signer({ tree: makeTree() })
    ).toThrow(TypeError);
    expect(
      () =>
        new SolanaX402Signer({
          tree: makeTree(),
          // @ts-expect-error — exercising the runtime contract
          getRecentBlockhash: 'https://api.devnet.solana.com',
        })
    ).toThrow(/getRecentBlockhash is required/);
  });

  it('throws TypeError for a non-tree', () => {
    expect(
      () =>
        new SolanaX402Signer({
          // @ts-expect-error — exercising the runtime contract
          tree: { deriveWallet: async () => ({}) },
          getRecentBlockhash: async () => GOLDEN_BLOCKHASH,
        })
    ).toThrow(TypeError);
  });

  it('throws TypeError for an out-of-range index; default index is 0', () => {
    expect(() => new SolanaX402Signer({ tree: makeTree(), index: -1, getRecentBlockhash: async () => GOLDEN_BLOCKHASH })).toThrow(TypeError);
    expect(() => new SolanaX402Signer({ tree: makeTree(), index: 0x80000000, getRecentBlockhash: async () => GOLDEN_BLOCKHASH })).toThrow(TypeError);
    expect(() => new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH })).not.toThrow();
  });
});

describe('SolanaX402Signer — capabilities (§4.1)', () => {
  it('declares exactly the three explicit CAIP-2 pairs, scheme exact, no wildcard', () => {
    const signer = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    expect([...signer.capabilities]).toEqual([
      { scheme: 'exact', network: 'solana:mainnet-beta' },
      { scheme: 'exact', network: 'solana:devnet' },
      { scheme: 'exact', network: 'solana:testnet' },
    ]);
    for (const cap of signer.capabilities) {
      expect(cap.network).toMatch(/^solana:(mainnet-beta|devnet|testnet)$/);
      expect(cap.network.includes('*')).toBe(false);
    }
  });
});

describe('SolanaX402Signer — signPayment happy path + golden vectors (§4.5)', () => {
  it('signs the golden devnet payment — full transaction pinned byte-for-byte', async () => {
    const signer = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    const payload = (await signer.signPayment(requirements(), resource)) as Record<string, string>;

    expect(payload.kind).toBe('solana-legacy-transfer');
    expect(payload.network).toBe('solana:devnet');
    expect(payload.blockhash).toBe(GOLDEN_BLOCKHASH);
    expect(payload.from).toBe(GOLDEN_ADDRESSES[0]);
    expect(payload.to).toBe(GOLDEN_ADDRESSES[1]);
    expect(payload.lamports).toBe('1000');
    // The strongest pin: the signed wire bytes, golden from an
    // independent hand-built construction.
    expect(payload.transaction).toBe(X402_GOLDEN_TX_BASE64);
  });

  it('message layout matches the documented legacy format (structural spot checks)', async () => {
    const signer = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    const payload = (await signer.signPayment(requirements(), resource)) as Record<string, string>;
    const tx = fromBase64(payload.transaction);
    expect(tx.length).toBe(216); // 1 + 64 + 151
    const message = tx.subarray(65);
    expect(toHex(message)).toBe(X402_GOLDEN_MESSAGE_HEX);
    // Transaction wire: compact-u16(1) || signature || message.
    expect(tx[0]).toBe(1);
    // Message header: 1 required signature, 0 readonly signed, 1 readonly unsigned.
    expect([...message.subarray(0, 5)]).toEqual([0x01, 0x01, 0x00, 0x01, 0x03]);
    // Account 3 = the system program — 32 zero bytes.
    expect(message.subarray(37 + 32, 37 + 64).every((b) => b === 0)).toBe(true);
    // Instruction: programIdIndex 2, accounts [0, 1], data 12 bytes.
    expect([...message.subarray(133, 139)]).toEqual([0x01, 0x02, 0x02, 0x00, 0x01, 0x0c]);
    // Instruction data: u32 LE discriminant 2 (Transfer) + u64 LE 1000.
    expect([...message.subarray(139, 143)]).toEqual([0x02, 0x00, 0x00, 0x00]);
    expect([...message.subarray(143, 151)]).toEqual([0xe8, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  });

  it('signature verifies offline with verifyRaw against the declared `from`', async () => {
    const signer = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    const payload = (await signer.signPayment(requirements(), resource)) as Record<string, string>;
    const tx = fromBase64(payload.transaction);
    const message = tx.subarray(65);
    const signature = tx.subarray(1, 65);
    expect(verifyRaw(base58.decode(payload.from), message, signature)).toBe(true);
    // A tampered signature or a foreign key both fail — the payload is
    // self-verifiable without any network access.
    const tampered = signature.slice();
    tampered[0] ^= 0x01;
    expect(verifyRaw(base58.decode(payload.from), message, tampered)).toBe(false);
    expect(verifyRaw(base58.decode(GOLDEN_ADDRESSES[2]), message, signature)).toBe(false);
  });

  it('is deterministic: same inputs → byte-identical transaction', async () => {
    const a = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    const b = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    const pa = (await a.signPayment(requirements(), resource)) as Record<string, string>;
    const pb = (await b.signPayment(requirements(), resource)) as Record<string, string>;
    expect(pa.transaction).toBe(pb.transaction);
  });

  it('uses the injected index: index 1 signs from GOLDEN_ADDRESSES[1]', async () => {
    const signer = new SolanaX402Signer({
      tree: makeTree(),
      index: 1,
      getRecentBlockhash: async () => GOLDEN_BLOCKHASH,
    });
    const payload = (await signer.signPayment(requirements({ payTo: GOLDEN_ADDRESSES[2] }), resource)) as Record<string, string>;
    expect(payload.from).toBe(GOLDEN_ADDRESSES[1]);
    expect(payload.to).toBe(GOLDEN_ADDRESSES[2]);
  });

  it('accepts the u64 boundary amount and renders it canonically', async () => {
    const signer = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    const payload = (await signer.signPayment(requirements({ amount: '18446744073709551615' }), resource)) as Record<string, string>;
    expect(payload.lamports).toBe('18446744073709551615');
    const tx = fromBase64(payload.transaction);
    expect([...tx.subarray(65 + 143, 65 + 151)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  });

  it('mainnet and testnet requirements are signed on their own CAIP-2 echo', async () => {
    const signer = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    for (const network of ['solana:mainnet-beta', 'solana:testnet']) {
      const payload = (await signer.signPayment(requirements({ network }), resource)) as Record<string, string>;
      expect(payload.network).toBe(network);
    }
  });
});

describe('SolanaX402Signer — key hygiene (§4.5)', () => {
  it('wipes the derived private key after signing (spy on deriveWallet)', async () => {
    const tree = makeTree();
    const original = tree.deriveWallet.bind(tree);
    let captured: SolanaDerivedWallet | undefined;
    // Instance-level override: the signer must go through
    // tree.deriveWallet — and the buffer it received must be dead
    // after the call returns.
    (tree as unknown as { deriveWallet: typeof original }).deriveWallet = async (index: number) => {
      const wallet = await original(index);
      captured ??= wallet;
      return wallet;
    };
    const signer = new SolanaX402Signer({ tree, getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    await signer.signPayment(requirements(), resource);
    expect(captured).toBeDefined();
    const before = new Uint8Array(captured!.privateKey); // snapshot AFTER wipe — zeros
    expect(captured!.privateKey.every((b) => b === 0)).toBe(true);
    expect(before.length).toBe(32);
    // Sanity that the snapshot pipeline actually captured live
    // material: re-derive a fresh wallet and confirm it differs from
    // the wiped buffer.
    const fresh = await original(0);
    expect(Array.from(fresh.privateKey).some((b) => b !== 0)).toBe(true);
  });

  it('wipes on the throwing path too (self-pay rejection inside try)', async () => {
    const tree = makeTree();
    const original = tree.deriveWallet.bind(tree);
    let captured: SolanaDerivedWallet | undefined;
    (tree as unknown as { deriveWallet: typeof original }).deriveWallet = async (index: number) => {
      const wallet = await original(index);
      captured ??= wallet;
      return wallet;
    };
    const signer = new SolanaX402Signer({ tree, getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    await expect(signer.signPayment(requirements({ payTo: GOLDEN_ADDRESSES[0] }), resource)).rejects.toThrow(TypeError);
    expect(captured!.privateKey.every((b) => b === 0)).toBe(true);
  });

  it('rejects after tree disposal with DisposedError', async () => {
    const tree = makeTree();
    const signer = new SolanaX402Signer({ tree, getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    tree.dispose();
    await expect(signer.signPayment(requirements(), resource)).rejects.toThrow(DisposedError);
  });
});

describe('SolanaX402Signer — fail-closed validation', () => {
  const signer = () => new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });

  it('rejects networks outside the declared capabilities — no wildcard, no localnet', async () => {
    const s = signer();
    await expect(s.signPayment(requirements({ network: 'solana:*' }), resource)).rejects.toThrow(/not covered by the declared capabilities/);
    await expect(s.signPayment(requirements({ network: 'solana:localnet' }), resource)).rejects.toThrow(/not covered/);
    await expect(s.signPayment(requirements({ network: 'eip155:1' }), resource)).rejects.toThrow(/not covered/);
    await expect(s.signPayment(requirements({ network: '' }), resource)).rejects.toThrow(/not covered/);
  });

  it('rejects a non-exact scheme', async () => {
    await expect(signer().signPayment(requirements({ scheme: 'eip3009' }), resource)).rejects.toThrow(/'exact' only/);
  });

  it('rejects SPL mints and wrong-case assets — native SOL only in M2 (§8.3)', async () => {
    await expect(signer().signPayment(requirements({ asset: GOLDEN_ADDRESSES[2] }), resource)).rejects.toThrow(/native SOL/);
    await expect(signer().signPayment(requirements({ asset: 'SOL' }), resource)).rejects.toThrow(/native SOL/);
  });

  it('rejects malformed, zero and oversized amounts', async () => {
    const s = signer();
    for (const bad of ['-1', '1.5', '1e3', 'abc', ' 1', '', '1_000', '18446744073709551616']) {
      await expect(s.signPayment(requirements({ amount: bad }), resource)).rejects.toThrow(TypeError);
    }
    await expect(s.signPayment(requirements({ amount: '0' }), resource)).rejects.toThrow(/zero transfer is not a payment/);
  });

  it('rejects an invalid or self-referencing payTo', async () => {
    const s = signer();
    await expect(s.signPayment(requirements({ payTo: 'not-an-address' }), resource)).rejects.toThrow(/base58-32/);
    await expect(s.signPayment(requirements({ payTo: 'abc' }), resource)).rejects.toThrow(/base58-32/);
    await expect(s.signPayment(requirements({ payTo: GOLDEN_ADDRESSES[0] }), resource)).rejects.toThrow(/self-transfer is not a payment/);
  });

  it('rejects a malformed blockhash — the injection is validated, never trusted', async () => {
    const notBase58 = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => 'definitely!!not~base58' });
    await expect(notBase58.signPayment(requirements(), resource)).rejects.toThrow(/not valid base58/);
    const shortB58 = base58.encode(new Uint8Array(31));
    const short = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => shortB58 });
    await expect(short.signPayment(requirements(), resource)).rejects.toThrow(/decodes to 31 bytes, expected 32/);
    const nonString = new SolanaX402Signer({
      tree: makeTree(),
      // @ts-expect-error — exercising the runtime contract
      getRecentBlockhash: async () => 42,
    });
    await expect(nonString.signPayment(requirements(), resource)).rejects.toThrow(/must return a base58 string/);
  });

  it('propagates the application RPC failure from the injection', async () => {
    const failing = new SolanaX402Signer({
      tree: makeTree(),
      getRecentBlockhash: async () => {
        throw new Error('rpc down');
      },
    });
    await expect(failing.signPayment(requirements(), resource)).rejects.toThrow('rpc down');
  });

  it('rejects garbage requirements', async () => {
    const s = signer();
    await expect(s.signPayment(undefined as unknown as X402PaymentRequirements, resource)).rejects.toThrow(TypeError);
    await expect(s.signPayment(null as unknown as X402PaymentRequirements, resource)).rejects.toThrow(TypeError);
  });
});

describe('SolanaX402Signer + createPaymentFetch — e2e against a mock server (§4.5)', () => {
  function paymentRequired(accepts: X402PaymentRequirements[]): X402PaymentRequired {
    return { x402Version: 2, resource, accepts };
  }

  function mockServer(paymentRequiredHeader: string, settleHeader: string): ReturnType<typeof vi.fn> {
    return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get('PAYMENT-SIGNATURE') === null) {
        return new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': paymentRequiredHeader } });
      }
      return new Response('ok', { status: 200, headers: { 'PAYMENT-RESPONSE': settleHeader } });
    });
  }

  it('pays the 402 exactly once and the mock facilitator accepts the payload convention', async () => {
    const captured: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const signature = headers.get('PAYMENT-SIGNATURE');
      if (signature === null) {
        return new Response(null, {
          status: 402,
          headers: { 'PAYMENT-REQUIRED': encodePaymentRequired(paymentRequired([requirements()])) },
        });
      }
      captured.push(signature);
      return new Response('ok', {
        status: 200,
        headers: {
          'PAYMENT-RESPONSE': encodeSettleResponse({
            success: true,
            transaction: 'settle-tx-ref-1',
            network: 'solana:devnet',
            payer: GOLDEN_ADDRESSES[0],
          }),
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const signer = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    const payFetch = createPaymentFetch({ signer });
    const response = await payFetch(resource.url);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 402 → exactly one paid attempt
    expect(captured).toHaveLength(1);

    // Server side (mock facilitator): decode the header and validate
    // the experimental convention end-to-end.
    const payload = decodePaymentPayload(captured[0]);
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toEqual(requirements());
    expect(payload.resource).toEqual(resource);
    const scheme = payload.payload as Record<string, string>;
    expect(scheme.kind).toBe('solana-legacy-transfer');
    expect(scheme.network).toBe('solana:devnet');
    expect(scheme.to).toBe(GOLDEN_ADDRESSES[1]);
    expect(scheme.lamports).toBe('1000');
    expect(scheme.blockhash).toBe(GOLDEN_BLOCKHASH);
    const tx = fromBase64(scheme.transaction);
    expect(tx[0]).toBe(1);
    expect(verifyRaw(base58.decode(scheme.from), tx.subarray(65), tx.subarray(1, 65))).toBe(true);

    const settlement = readSettlement(response);
    expect(settlement).toEqual({
      success: true,
      transaction: 'settle-tx-ref-1',
      network: 'solana:devnet',
      payer: GOLDEN_ADDRESSES[0],
    });
  });

  it('surfaces NO_VIABLE_OPTION when the 402 offers nothing Solana', async () => {
    vi.stubGlobal(
      'fetch',
      mockServer(
        encodePaymentRequired(
          paymentRequired([
            { scheme: 'exact', network: 'eip155:1', amount: '1000', asset: '0xabc', payTo: '0xdef', maxTimeoutSeconds: 60 },
          ])
        ),
        ''
      )
    );
    const signer = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    const payFetch = createPaymentFetch({ signer });
    await expect(payFetch(resource.url)).rejects.toMatchObject({ code: 'NO_VIABLE_OPTION' });
  });

  it('wraps a signer refusal as SIGNER_REJECTED with the cause attached (SPL asset)', async () => {
    const splMint = GOLDEN_ADDRESSES[2];
    vi.stubGlobal(
      'fetch',
      mockServer(encodePaymentRequired(paymentRequired([requirements({ asset: splMint })])), '')
    );
    const signer = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    const payFetch = createPaymentFetch({ signer });
    const error = await payFetch(resource.url).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(X402Error);
    expect((error as X402Error).code).toBe('SIGNER_REJECTED');
    expect((error as X402Error).details?.cause).toBeInstanceOf(TypeError);
  });

  it('never retries after the paid attempt even on a failed settlement', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get('PAYMENT-SIGNATURE') === null) {
        return new Response(null, {
          status: 402,
          headers: { 'PAYMENT-REQUIRED': encodePaymentRequired(paymentRequired([requirements()])) },
        });
      }
      return new Response(null, {
        status: 402,
        headers: {
          'PAYMENT-RESPONSE': encodeSettleResponse({
            success: false,
            errorReason: 'insufficient_funds',
            transaction: '',
            network: 'solana:devnet',
          }),
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const signer = new SolanaX402Signer({ tree: makeTree(), getRecentBlockhash: async () => GOLDEN_BLOCKHASH });
    const response = await createPaymentFetch({ signer })(resource.url);
    expect(fetchMock).toHaveBeenCalledTimes(2); // the failure comes back as-is — no second paid attempt
    const settlement = readSettlement(response);
    expect(settlement?.success).toBe(false);
    expect(settlement?.errorReason).toBe('insufficient_funds');
  });
});
