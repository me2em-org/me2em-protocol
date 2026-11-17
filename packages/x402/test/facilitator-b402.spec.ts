// packages/x402/test/facilitator-b402.spec.ts
import { describe, expect, it, vi } from 'vitest';
import type { FacilitatorClient, X402PaymentPayload, X402PaymentRequirements, X402SettleResponse, X402Supported, X402VerifyResponse } from '@me2em/core';
import { B402Facilitator } from '../src/b402.js';
import { X402Error } from '../src/errors.js';
import * as mainEntry from '../src/index.js';
import vectors from './fixtures/spec-vectors.json';

const PP = vectors.paymentPayload as unknown as X402PaymentPayload;
const SR_OK = vectors.settleResponse as unknown as X402SettleResponse;
const SR_FAIL = vectors.facilitatorSettleFailure as unknown as X402SettleResponse;
const SUPPORTED = vectors.facilitatorSupported as unknown as X402Supported;
const V_OK = vectors.verifyResponseOk as unknown as X402VerifyResponse;
const REQ = vectors.paymentRequired.accepts[0] as unknown as X402PaymentRequirements;

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const opts = { baseUrl: 'https://facil.test', auth: { headers: { authorization: 'Bearer k' } } } as const;

describe('B402Facilitator — happy paths (upstream §7 shapes)', () => {
  it('supported(): GET, auth headers attached, guard-validated result', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(200, SUPPORTED));
    const f = new B402Facilitator({ ...opts, fetch: fetchMock });
    const result = await f.supported();
    expect(result).toEqual(SUPPORTED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://facil.test/supported');
    expect(init?.method).toBe('GET');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer k');
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.has('content-type')).toBe(false);
  });

  it('verify(): POST with the upstream request body shape', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(200, V_OK));
    const f = new B402Facilitator({ ...opts, fetch: fetchMock });
    const result = await f.verify(REQ, PP);
    expect(result).toEqual(V_OK);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://facil.test/verify');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.x402Version).toBe(2);
    expect(body.paymentPayload).toEqual(PP);
    expect(body.paymentRequirements).toEqual(REQ);
  });

  it('settle(): success and failure responses both come back as data — success:false is the APPLICATION\'s throw', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(200, SR_FAIL));
    const f = new B402Facilitator({ ...opts, fetch: fetchMock });
    const result = await f.settle(REQ, PP);
    expect(result).toEqual(SR_FAIL);
    expect(result.success).toBe(false);
    void SR_OK;
  });

  it('trailing slash in baseUrl is normalized', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(200, SUPPORTED));
    const f = new B402Facilitator({ baseUrl: 'https://facil.test/', auth: { headers: {} }, fetch: fetchMock });
    await f.supported();
    expect(fetchMock.mock.calls[0][0]).toBe('https://facil.test/supported');
  });
});

describe('B402Facilitator — fail-closed error mapping (ТЗ §3.5)', () => {
  it('auth header factory is called on EVERY request', async () => {
    const factory = vi.fn(() => ({ authorization: 'Bearer rotating' }));
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(200, SUPPORTED));
    const f = new B402Facilitator({ baseUrl: 'https://facil.test', auth: { headers: factory }, fetch: fetchMock });
    await f.supported();
    await f.supported();
    expect(factory).toHaveBeenCalledTimes(2);
    const headers = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer rotating');
  });

  it('auth factory throwing → FACILITATOR_ERROR kind auth', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(200, SUPPORTED));
    const f = new B402Facilitator({
      baseUrl: 'https://facil.test',
      auth: { headers: () => Promise.reject(new Error('jwt expired')) },
      fetch: fetchMock,
    });
    try {
      await f.supported();
      expect.unreachable('expected FACILITATOR_ERROR');
    } catch (e) {
      expect((e as X402Error).code).toBe('FACILITATOR_ERROR');
      expect((e as X402Error).details).toMatchObject({ phase: 'supported', kind: 'auth' });
    }
  });

  it('auth factory returning a non-record → kind auth', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(200, SUPPORTED));
    const f = new B402Facilitator({
      baseUrl: 'https://facil.test',
      auth: { headers: () => 42 as unknown as Record<string, string> },
      fetch: fetchMock,
    });
    await expect(f.supported()).rejects.toMatchObject({ code: 'FACILITATOR_ERROR', details: { kind: 'auth' } });
  });

  it('fetch throwing → kind network', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => {
      throw new TypeError('fetch failed');
    });
    const f = new B402Facilitator({ ...opts, fetch: fetchMock });
    await expect(f.verify(REQ, PP)).rejects.toMatchObject({
      code: 'FACILITATOR_ERROR',
      details: { phase: 'verify', kind: 'network' },
    });
  });

  it('timeout rejection → kind timeout', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => {
      throw new DOMException('signal timed out', 'TimeoutError');
    });
    const f = new B402Facilitator({ ...opts, fetch: fetchMock });
    await expect(f.settle(REQ, PP)).rejects.toMatchObject({
      code: 'FACILITATOR_ERROR',
      details: { phase: 'settle', kind: 'timeout' },
    });
  });

  it.each([
    [500, 'http_5xx'],
    [503, 'http_5xx'],
    [400, 'http_4xx'],
    [404, 'http_4xx'],
    [401, 'auth'],
    [403, 'auth'],
  ] as const)('HTTP %i → kind %s', async (status, kind) => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response('no', { status }));
    const f = new B402Facilitator({ ...opts, fetch: fetchMock });
    await expect(f.supported()).rejects.toMatchObject({
      code: 'FACILITATOR_ERROR',
      details: { phase: 'supported', kind, status },
    });
  });

  it('non-JSON 200 body → kind invalid_response', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response('not json', { status: 200 }));
    const f = new B402Facilitator({ ...opts, fetch: fetchMock });
    await expect(f.supported()).rejects.toMatchObject({
      code: 'FACILITATOR_ERROR',
      details: { kind: 'invalid_response' },
    });
  });

  it('200 with a non-conforming shape → kind invalid_response (fail closed)', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(200, { hello: 'world' }));
    const f = new B402Facilitator({ ...opts, fetch: fetchMock });
    await expect(f.verify(REQ, PP)).rejects.toMatchObject({
      code: 'FACILITATOR_ERROR',
      details: { phase: 'verify', kind: 'invalid_response' },
    });
  });
});

describe('B402Facilitator — constructor fail-fast', () => {
  it('bad baseUrl → TypeError', () => {
    for (const bad of ['', 'facil.test', 'ftp://facil.test', 'https://']) {
      expect(() => new B402Facilitator({ ...opts, baseUrl: bad } as never)).toThrowError(TypeError);
    }
  });

  it('bad auth → TypeError', () => {
    expect(() => new B402Facilitator({ baseUrl: 'https://facil.test', auth: {} as never })).toThrowError(TypeError);
    expect(() =>
      new B402Facilitator({ baseUrl: 'https://facil.test', auth: { headers: null as never } })
    ).toThrowError(TypeError);
  });

  it('bad timeoutMs / fetch → TypeError', () => {
    expect(() => new B402Facilitator({ ...opts, timeoutMs: 0 })).toThrowError(TypeError);
    expect(() => new B402Facilitator({ ...opts, timeoutMs: -5 })).toThrowError(TypeError);
    expect(() => new B402Facilitator({ ...opts, timeoutMs: Number.NaN })).toThrowError(TypeError);
    expect(() => new B402Facilitator({ ...opts, fetch: 'no' as never })).toThrowError(TypeError);
  });
});

describe('entry discipline (ТЗ §3.1)', () => {
  it('B402Facilitator is NOT exported from the main entry', () => {
    expect('B402Facilitator' in mainEntry).toBe(false);
    expect(typeof mainEntry.createPaymentFetch).toBe('function');
    expect(typeof mainEntry.assertValidX402Config).toBe('function');
  });

  it('B402Facilitator satisfies FacilitatorClient', () => {
    const f: FacilitatorClient = new B402Facilitator({
      baseUrl: 'https://facil.test',
      auth: { headers: {} },
      fetch: vi.fn<FetchMock>(async () => jsonResponse(200, SUPPORTED)),
    });
    expect(typeof f.supported).toBe('function');
    expect(typeof f.verify).toBe('function');
    expect(typeof f.settle).toBe('function');
  });
});
