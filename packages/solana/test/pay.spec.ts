// packages/solana/test/pay.spec.ts
//
// Ф5: `pay` — unit suite via fetch injection (В-6). No network: the
// RPC layer is a method-routing mock; signing uses REAL kit/WebCrypto
// crypto (node ≥24). The wire payload captured from `sendTransaction`
// is decoded with kit's transaction decoder to pin the assembly
// contract: system transfer + reference as read-only non-signer +
// optional memo. The non-CI devnet integration closes on Ф4
// (`pay` → `verifyPayment` = success; repeat → `REPLAYED`).
import { describe, it, expect, vi } from 'vitest';
import { base58, base64 } from '@scure/base';
import { getTransactionDecoder, getCompiledTransactionMessageDecoder, type Address } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { MEMO_PROGRAM_ADDRESS } from '@solana-program/memo';
import type { PaymentRequest, WalletDescriptor } from '@me2em/core';
import { pay, solToLamports } from '../src/pay.js';
import { RpcClient } from '../src/rpc.js';
import { SolanaPaymentAdapter } from '../src/verify.js';
import { SolanaWalletTree } from '../src/wallet-tree.js';
import { createPaymentReference } from '../src/reference.js';
import { SOLANA_NATIVE_ASSET } from '../src/url.js';
import { GOLDEN_ADDRESSES, TV2_SEED } from './goldens.js';

const CHAIN = 'solana:devnet';
const FROM_ADDRESS = GOLDEN_ADDRESSES[0];
const PAY_TO = GOLDEN_ADDRESSES[1];
const DERIVATION_PATH = "m/44'/501'/0'/0'";
const BLOCKHASH = base58.encode(new Uint8Array(32).fill(7));
const SIGNATURE = base58.encode(new Uint8Array(64).fill(5));
const EXPIRES_AT = Math.floor(Date.now() / 1000) + 600;

const FROM: WalletDescriptor = {
  chain: CHAIN,
  address: FROM_ADDRESS,
  derivationPath: DERIVATION_PATH,
  label: 'buyer',
};
const SEED = TV2_SEED;

function makeRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    chain: CHAIN,
    payTo: PAY_TO,
    amount: '1.5',
    asset: 'sol',
    reference: createPaymentReference(),
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

interface RecordedCall {
  method: string;
  params: unknown[];
}

interface ResponderResult {
  result?: unknown;
  error?: unknown;
}

/**
 * Decodes a captured base64 wire payload into the compiled message
 * (kit 8.6: transaction = { messageBytes, signatures }; the message
 * decoder exposes staticAccounts / accountIndices / header counts).
 */
function decodeWire(wire: string) {
  const tx = getTransactionDecoder().decode(base64.decode(wire));
  return getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
}

/** Method-routing mock transport — fetch injection, no module mocks (В-6). */
function makeRpcFetch(
  respond: (method: string, params: unknown[]) => ResponderResult
): { fetch: typeof globalThis.fetch; calls: RecordedCall[]; payloads: string[] } {
  const calls: RecordedCall[] = [];
  const payloads: string[] = [];
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    calls.push({ method: body.method, params: body.params });
    const r = respond(body.method, body.params);
    const res = {
      status: 200,
      ok: true,
      json: () =>
        Promise.resolve(
          r.error !== undefined
            ? { jsonrpc: '2.0', error: r.error, id: body.id }
            : { jsonrpc: '2.0', result: r.result, id: body.id }
        ),
      headers: new Headers(),
      clone: () => res,
      body: null,
      bodyUsed: false,
      redirected: false,
      type: 'basic' as ResponseType,
      url: '',
      text: () => Promise.resolve(''),
    } as Response;
    return res;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, payloads };
}

/** Happy-path responder: fresh blockhash, fixed signature; captures sendTransaction payloads. */
function makeHappyRpc() {
  const payloads: string[] = [];
  const { fetch, calls } = makeRpcFetch((method, params) => {
    if (method === 'getLatestBlockhash') {
      return { result: { value: { blockhash: BLOCKHASH, lastValidBlockHeight: 12345 } } };
    }
    if (method === 'sendTransaction') {
      payloads.push(String(params[0]));
      return { result: SIGNATURE };
    }
    return { result: null };
  });
  return { fetch, calls, payloads };
}

function makeCtx(fetch: typeof globalThis.fetch) {
  return {
    rpc: new RpcClient({ endpoint: 'http://localhost:8899', fetch }),
    chain: CHAIN,
  };
}

// ---------------------------------------------------------------------------
// Success path + assembly
// ---------------------------------------------------------------------------

describe('pay — success path (unit, fetch injection)', () => {
  it('fetches a fresh blockhash, submits, returns the non-empty signature', async () => {
    const { fetch, calls } = makeHappyRpc();
    const txRef = await pay(FROM, makeRequest(), { seed: SEED }, makeCtx(fetch));
    expect(txRef).toBe(SIGNATURE);
    expect(txRef.length).toBeGreaterThan(0);
    expect(calls.map((c) => c.method)).toEqual(['getLatestBlockhash', 'sendTransaction']);
  });

  it('assembles: system transfer (discriminator 2) with reference as readonly non-signer; no memo by default', async () => {
    const { fetch, payloads } = makeHappyRpc();
    const request = makeRequest();
    await pay(FROM, request, { seed: SEED }, makeCtx(fetch));
    expect(payloads).toHaveLength(1);

    const msg = decodeWire(payloads[0]);
    const keys = msg.staticAccounts;

    // Exactly one instruction — the transfer.
    expect(msg.instructions).toHaveLength(1);
    const sysIdx = keys.indexOf(SYSTEM_PROGRAM_ADDRESS as Address);
    const transfer = msg.instructions[0];
    expect(transfer.programAddressIndex).toBe(sysIdx);
    expect(transfer.data[0]).toBe(2); // TRANSFER_SOL_DISCRIMINATOR
    expect(keys[transfer.accountIndices[0]]).toBe(FROM_ADDRESS); // source = the descriptor wallet
    expect(keys[transfer.accountIndices[1]]).toBe(PAY_TO); // destination = request.payTo
    expect(keys[transfer.accountIndices[2]]).toBe(request.reference); // reference rides the transfer

    // Roles (v0 header): source signs (fee payer), destination writable,
    // reference + the system program itself are read-only non-signers.
    expect(msg.header).toEqual({
      numSignerAccounts: 1,
      numReadonlySignerAccounts: 0,
      numReadonlyNonSignerAccounts: 2,
    });
  });

  it('memo: opts.memo appends a memo-program instruction with the text', async () => {
    const { fetch, payloads } = makeHappyRpc();
    await pay(FROM, makeRequest(), { seed: SEED, memo: 'invoice 42' }, makeCtx(fetch));

    const msg = decodeWire(payloads[0]);
    const keys = msg.staticAccounts;
    expect(msg.instructions).toHaveLength(2);
    const memoIx = msg.instructions[1];
    expect(keys[memoIx.programAddressIndex]).toBe(MEMO_PROGRAM_ADDRESS);
    expect(new TextDecoder().decode(memoIx.data)).toBe('invoice 42');
    // The memo carries no accounts — reference stays on the transfer.
    // (Empty account lists are omitted in the compiled v0 message.)
    expect(memoIx.accountIndices ?? []).toHaveLength(0);
  });

  it('seed per call: two independent pays succeed (fresh tree, fresh wipe)', async () => {
    const first = makeHappyRpc();
    const second = makeHappyRpc();
    const request = makeRequest();
    const txRef1 = await pay(FROM, request, { seed: SEED }, makeCtx(first.fetch));
    const txRef2 = await pay(FROM, request, { seed: SEED }, makeCtx(second.fetch));
    expect(txRef1).toBe(SIGNATURE);
    expect(txRef2).toBe(SIGNATURE);
  });
});

// ---------------------------------------------------------------------------
// Validation — bare TypeError, package-wide programmer-error contract
// ---------------------------------------------------------------------------

describe('pay — validation (TypeError contract)', () => {
  it('request.chain mismatch → TypeError', async () => {
    const { fetch } = makeHappyRpc();
    await expect(
      pay(FROM, makeRequest({ chain: 'solana:mainnet-beta' }), { seed: SEED }, makeCtx(fetch))
    ).rejects.toThrow(TypeError);
  });

  it('from.chain mismatch → TypeError', async () => {
    const { fetch } = makeHappyRpc();
    await expect(
      pay({ ...FROM, chain: 'solana:mainnet-beta' }, makeRequest(), { seed: SEED }, makeCtx(fetch))
    ).rejects.toThrow(TypeError);
  });

  it('non-native asset → TypeError (SOL-only, В-3/A)', async () => {
    expect(SOLANA_NATIVE_ASSET).toBe('sol');
    const { fetch } = makeHappyRpc();
    await expect(
      pay(FROM, makeRequest({ asset: 'usdc-mint' }), { seed: SEED }, makeCtx(fetch))
    ).rejects.toThrow(TypeError);
  });

  it('seed not Uint8Array / wrong length → TypeError', async () => {
    const { fetch } = makeHappyRpc();
    await expect(
      pay(FROM, makeRequest(), { seed: 'nope' as unknown as Uint8Array }, makeCtx(fetch))
    ).rejects.toThrow(TypeError);
    await expect(
      pay(FROM, makeRequest(), { seed: new Uint8Array(63) }, makeCtx(fetch))
    ).rejects.toThrow(TypeError);
  });

  it('missing derivationPath → TypeError (no default index exists)', async () => {
    const { fetch } = makeHappyRpc();
    const noPath: WalletDescriptor = { chain: CHAIN, address: FROM_ADDRESS };
    await expect(pay(noPath, makeRequest(), { seed: SEED }, makeCtx(fetch))).rejects.toThrow(TypeError);
  });

  it('foreign derivationPath → TypeError', async () => {
    const { fetch } = makeHappyRpc();
    await expect(
      pay(
        { ...FROM, derivationPath: "m/44'/60'/0'/0/0" },
        makeRequest(),
        { seed: SEED },
        makeCtx(fetch)
      )
    ).rejects.toThrow(TypeError);
  });

  it('derived address ≠ from.address → TypeError (descriptor/seed disagree)', async () => {
    const { fetch } = makeHappyRpc();
    await expect(
      pay(
        { ...FROM, address: GOLDEN_ADDRESSES[1] }, // path 0, address of wallet 1
        makeRequest(),
        { seed: SEED },
        makeCtx(fetch)
      )
    ).rejects.toThrow(TypeError);
  });

  it('invalid payTo / reference → TypeError (structural base58-32)', async () => {
    const { fetch } = makeHappyRpc();
    await expect(
      pay(FROM, makeRequest({ payTo: 'abc' }), { seed: SEED }, makeCtx(fetch))
    ).rejects.toThrow(TypeError);
    await expect(
      pay(FROM, makeRequest({ reference: '0OIl' }), { seed: SEED }, makeCtx(fetch))
    ).rejects.toThrow(TypeError);
  });

  it('zero / malformed amount → TypeError', async () => {
    const { fetch } = makeHappyRpc();
    for (const amount of ['0', '1.2.3', '1.0000000001']) {
      await expect(
        pay(FROM, makeRequest({ amount }), { seed: SEED }, makeCtx(fetch))
      ).rejects.toThrow(TypeError);
    }
  });
});

describe('solToLamports — exact decimal math (BL-55)', () => {
  it('converts whole and fractional SOL', () => {
    expect(solToLamports('1.5')).toBe(1_500_000_000n);
    expect(solToLamports('1')).toBe(1_000_000_000n);
    expect(solToLamports('0.000000001')).toBe(1n);
    expect(solToLamports('0.5')).toBe(500_000_000n);
    expect(solToLamports('12.000000001')).toBe(12_000_000_001n);
  });

  it('rejects malformed and zero amounts with TypeError', () => {
    for (const bad of ['0', '-1', '1.2.3', '1.0000000001', '1e3', '', ' 1', '1 ', '.5', '1.', 'abc']) {
      expect(() => solToLamports(bad)).toThrow(TypeError);
    }
  });
});

// ---------------------------------------------------------------------------
// Transport failures — bare Error (the RpcClient contract)
// ---------------------------------------------------------------------------

describe('pay — transport failures', () => {
  it('sendTransaction JSON-RPC error → Error, no txRef', async () => {
    const { fetch } = makeRpcFetch((method) =>
      method === 'sendTransaction'
        ? { error: { code: -32002, message: 'Transaction simulation failed' } }
        : { result: { value: { blockhash: BLOCKHASH, lastValidBlockHeight: 12345 } } }
    );
    await expect(pay(FROM, makeRequest(), { seed: SEED }, makeCtx(fetch))).rejects.toThrow(Error);
    await expect(pay(FROM, makeRequest(), { seed: SEED }, makeCtx(fetch))).rejects.toThrow(
      /simulation failed/
    );
  });

  it('sendTransaction empty signature → Error (txRef is non-empty by contract)', async () => {
    const { fetch } = makeRpcFetch((method) =>
      method === 'sendTransaction'
        ? { result: '' }
        : { result: { value: { blockhash: BLOCKHASH, lastValidBlockHeight: 12345 } } }
    );
    await expect(pay(FROM, makeRequest(), { seed: SEED }, makeCtx(fetch))).rejects.toThrow(
      /empty signature/
    );
  });
});

// ---------------------------------------------------------------------------
// Adapter surface
// ---------------------------------------------------------------------------

describe('SolanaPaymentAdapter.pay (Ф5)', () => {
  it('without opts.seed → TypeError (stateless contract)', async () => {
    const adapter = new SolanaPaymentAdapter({ network: 'devnet' });
    await expect(adapter.pay(FROM, makeRequest())).rejects.toThrow(TypeError);
    await expect(adapter.pay(FROM, makeRequest())).rejects.toThrow(/requires opts\.seed/);
  });

  it('delegates to pay with the verifier transport (seed per call)', async () => {
    const { fetch, calls } = makeHappyRpc();
    const adapter = new SolanaPaymentAdapter({ network: 'devnet', fetch });
    const txRef = await adapter.pay(FROM, makeRequest(), { seed: SEED });
    expect(txRef).toBe(SIGNATURE);
    expect(calls.map((c) => c.method)).toEqual(['getLatestBlockhash', 'sendTransaction']);
  });

  it('memo passes through the adapter', async () => {
    const { fetch, payloads } = makeHappyRpc();
    const adapter = new SolanaPaymentAdapter({ network: 'devnet', fetch });
    await adapter.pay(FROM, makeRequest(), { seed: SEED, memo: 'via adapter' });
    expect(decodeWire(payloads[0]).instructions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Integration — non-CI devnet, closes on Ф4
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.ME2EM_DEVNET_PAY_SEED)(
  'pay — integration (devnet, non-CI)',
  () => {
    // Precondition: ME2EM_DEVNET_PAY_SEED — base64 of a 64-byte seed
    // whose wallet m/44'/501'/0'/0' holds devnet SOL (≥ fee + amount).
    function fundedSeed(): Uint8Array {
      return base64.decode(process.env.ME2EM_DEVNET_PAY_SEED as string);
    }

    it('pay → verifyPayment = success; repeat with the same reference → REPLAYED', async () => {
      const seed = fundedSeed();
      const adapter = new SolanaPaymentAdapter({ network: 'devnet' });
      const tree = SolanaWalletTree.fromSeed(seed);
      let from: WalletDescriptor;
      try {
        const w = await tree.deriveWallet(0);
        from = { chain: CHAIN, address: w.address, derivationPath: w.derivationPath };
      } finally {
        tree.dispose();
      }
      const request: PaymentRequest = {
        chain: CHAIN,
        payTo: PAY_TO,
        amount: '0.001',
        asset: 'sol',
        reference: createPaymentReference(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      };
      const txRef = await adapter.pay(from, request, { seed });
      const result = await adapter.verifyPayment(txRef, request);
      expect(result.status).toBe('success');

      const txRef2 = await adapter.pay(from, request, { seed });
      const replay = await adapter.verifyPayment(txRef2, request);
      expect(replay.status).toBe('failure');
      expect(replay.reason).toBe('REPLAYED');
    }, 120_000);
  }
);
