// packages/x402/test/client.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { X402PaymentRequired, X402SettleResponse } from '@me2em/core';
import { createPaymentFetch, readSettlement, type PaymentSigner } from '../src/client.js';
import { decodePaymentPayload } from '../src/codec.js';
import { X402Error } from '../src/errors.js';
import vectors from './fixtures/spec-vectors.json';

const PR = vectors.paymentRequired as unknown as X402PaymentRequired;
const SR = vectors.settleResponse as unknown as X402SettleResponse;
const FAIL = vectors.facilitatorSettleFailure as unknown as X402SettleResponse;

const PR_HEADER = Buffer.from(JSON.stringify(PR), 'utf8').toString('base64');

function response402(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 402, headers });
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function makeSigner(overrides: Partial<PaymentSigner> = {}): PaymentSigner {
  return {
    capabilities: [{ scheme: 'exact', network: 'eip155:84532' }],
    signPayment: vi.fn(async () => ({ signature: '0xdeadbeef' })),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createPaymentFetch — passthrough (ТЗ §3.3 rules 2–3)', () => {
  it('200 passes through unsigned', async () => {
    const signer = makeSigner();
    const fetchMock = vi.fn<FetchMock>(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const pay = createPaymentFetch({ signer });
    const res = await pay('https://shop.test/data');
    expect(res.status).toBe(200);
    expect(res.bodyUsed).toBe(false);
    expect(signer.signPayment).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('non-402 error (500) passes through — not our business', async () => {
    const signer = makeSigner();
    const fetchMock = vi.fn<FetchMock>(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await createPaymentFetch({ signer })('https://shop.test/data');
    expect(res.status).toBe(500);
    expect(signer.signPayment).not.toHaveBeenCalled();
  });
});

describe('createPaymentFetch — 402 handling (fail-closed)', () => {
  it('402 without PAYMENT-REQUIRED → PAYMENT_REQUIRED_MALFORMED', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>(async () => response402()));
    await expect(createPaymentFetch({ signer: makeSigner() })('https://shop.test/data')).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED_MALFORMED',
    });
  });

  it('402 with a broken header → PAYMENT_REQUIRED_MALFORMED', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>(async () => response402({ 'PAYMENT-REQUIRED': '!!!' })));
    await expect(createPaymentFetch({ signer: makeSigner() })('https://shop.test/data')).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED_MALFORMED',
    });
  });

  it('402 with x402Version 1 → VERSION_UNSUPPORTED', async () => {
    const v1 = Buffer.from(JSON.stringify({ ...PR, x402Version: 1 }), 'utf8').toString('base64');
    vi.stubGlobal('fetch', vi.fn<FetchMock>(async () => response402({ 'PAYMENT-REQUIRED': v1 })));
    await expect(createPaymentFetch({ signer: makeSigner() })('https://shop.test/data')).rejects.toMatchObject({
      code: 'VERSION_UNSUPPORTED',
    });
  });
});

describe('createPaymentFetch — signing flow', () => {
  it('happy path: signs the covered option and replays exactly once', async () => {
    const signer = makeSigner();
    const inits: (RequestInit | undefined)[] = [];
    const fetchMock = vi.fn<FetchMock>(async (_input, init) => {
      inits.push(init);
      if (inits.length === 1) return response402({ 'PAYMENT-REQUIRED': PR_HEADER });
      return new Response('settled', {
        status: 200,
        headers: { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify(SR), 'utf8').toString('base64') },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await createPaymentFetch({ signer })('https://shop.test/data');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signer.signPayment).toHaveBeenCalledWith(PR.accepts[0], PR.resource);

    const sigHeader = new Headers(inits[1]?.headers).get('PAYMENT-SIGNATURE');
    expect(sigHeader).not.toBeNull();
    const payload = decodePaymentPayload(sigHeader as string);
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toEqual(PR.accepts[0]);
    expect(payload.resource).toEqual(PR.resource);
    expect(payload.payload).toEqual({ signature: '0xdeadbeef' });

    expect(readSettlement(res)).toEqual(SR);
  });

  it('default selection picks the FIRST option covered by capabilities', async () => {
    const twoOptions = {
      ...PR,
      accepts: [{ ...PR.accepts[0], scheme: 'upto' }, PR.accepts[0]],
    } as unknown as X402PaymentRequired;
    const header = Buffer.from(JSON.stringify(twoOptions), 'utf8').toString('base64');
    let calls = 0;
    let captured: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (_input, init) => {
        calls += 1;
        if (calls === 1) return response402({ 'PAYMENT-REQUIRED': header });
        captured = init;
        return new Response('ok', { status: 200 });
      })
    );
    await createPaymentFetch({ signer: makeSigner() })('https://shop.test/data');
    const payload = decodePaymentPayload(new Headers(captured?.headers).get('PAYMENT-SIGNATURE') as string);
    expect(payload.accepted.scheme).toBe('exact');
  });

  it('custom selectRequirements wins over the default', async () => {
    const select = vi.fn((accepts: typeof PR.accepts) => accepts[accepts.length - 1]);
    let calls = 0;
    let captured: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (_input, init) => {
        calls += 1;
        if (calls === 1) return response402({ 'PAYMENT-REQUIRED': PR_HEADER });
        captured = init;
        return new Response('ok', { status: 200 });
      })
    );
    await createPaymentFetch({ signer: makeSigner(), selectRequirements: select })('https://shop.test/data');
    expect(select).toHaveBeenCalledWith(PR.accepts);
    const payload = decodePaymentPayload(new Headers(captured?.headers).get('PAYMENT-SIGNATURE') as string);
    expect(payload.accepted).toEqual(PR.accepts[0]);
  });

  it('picker returning nothing → NO_VIABLE_OPTION, signPayment never called', async () => {
    const signer = makeSigner();
    vi.stubGlobal('fetch', vi.fn<FetchMock>(async () => response402({ 'PAYMENT-REQUIRED': PR_HEADER })));
    await expect(
      createPaymentFetch({
        signer,
        selectRequirements: () => undefined as unknown as (typeof PR.accepts)[number],
      })('https://shop.test/data')
    ).rejects.toMatchObject({ code: 'NO_VIABLE_OPTION' });
    expect(signer.signPayment).not.toHaveBeenCalled();
  });

  it('no capability coverage → NO_VIABLE_OPTION', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>(async () => response402({ 'PAYMENT-REQUIRED': PR_HEADER })));
    const signer = makeSigner({ capabilities: [{ scheme: 'exact', network: 'solana:devnet' }] });
    await expect(createPaymentFetch({ signer })('https://shop.test/data')).rejects.toMatchObject({
      code: 'NO_VIABLE_OPTION',
    });
  });

  it('signPayment rejection → SIGNER_REJECTED with the original error in details.cause', async () => {
    const boom = new Error('user cancelled');
    const signer = makeSigner({ signPayment: vi.fn(async () => Promise.reject(boom)) });
    vi.stubGlobal('fetch', vi.fn<FetchMock>(async () => response402({ 'PAYMENT-REQUIRED': PR_HEADER })));
    try {
      await createPaymentFetch({ signer })('https://shop.test/data');
      expect.unreachable('expected SIGNER_REJECTED');
    } catch (e) {
      expect(e).toBeInstanceOf(X402Error);
      expect((e as X402Error).code).toBe('SIGNER_REJECTED');
      expect((e as X402Error).details?.cause).toBe(boom);
    }
  });

  it('never retries after PAYMENT-SIGNATURE (402 again → returned as-is)', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async () => {
        calls += 1;
        return response402({ 'PAYMENT-REQUIRED': PR_HEADER });
      })
    );
    const res = await createPaymentFetch({ signer: makeSigner() })('https://shop.test/data');
    expect(calls).toBe(2);
    expect(res.status).toBe(402);
  });
});

describe('createPaymentFetch — option validation', () => {
  it('invalid signer → TypeError', () => {
    expect(() => createPaymentFetch({ signer: {} as unknown as PaymentSigner })).toThrowError(TypeError);
  });
  it('maxAttempts < 2 / non-integer → TypeError', () => {
    expect(() => createPaymentFetch({ signer: makeSigner(), maxAttempts: 1 })).toThrowError(TypeError);
    expect(() => createPaymentFetch({ signer: makeSigner(), maxAttempts: 1.5 })).toThrowError(TypeError);
    expect(() => createPaymentFetch({ signer: makeSigner(), maxAttempts: 2 })).not.toThrowError();
  });
});

describe('readSettlement (ТЗ §3.3)', () => {
  it('no header → null', () => {
    expect(readSettlement(new Response('ok'))).toBeNull();
  });

  it('valid header → parsed settle response', () => {
    const res = new Response('ok', {
      headers: { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify(SR), 'utf8').toString('base64') },
    });
    expect(readSettlement(res)).toEqual(SR);
  });

  it('broken header → PAYMENT_RESPONSE_MALFORMED (never silently null)', () => {
    const res = new Response('ok', { headers: { 'PAYMENT-RESPONSE': '!!!' } });
    try {
      readSettlement(res);
      expect.unreachable('expected PAYMENT_RESPONSE_MALFORMED');
    } catch (e) {
      expect((e as X402Error).code).toBe('PAYMENT_RESPONSE_MALFORMED');
    }
  });

  it('failure settle with empty transaction parses (upstream §7.2)', () => {
    const res = new Response('ok', {
      headers: { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify(FAIL), 'utf8').toString('base64') },
    });
    expect(readSettlement(res)).toEqual(FAIL);
  });
});
