// packages/x402/test/server.spec.ts
import { describe, expect, it } from 'vitest';
import type { X402PaymentPayload, X402PaymentRequired, X402SettleResponse } from '@me2em/core';
import type { FacilitatorClient } from '../src/facilitator.js';
import { decodePaymentRequired, decodeSettleResponse } from '../src/codec.js';
import { X402ConfigError, X402Error } from '../src/errors.js';
import {
  assertValidX402Config,
  paymentRequiredResponse,
  readPaymentHeader,
  settlementHeader,
  type X402Config,
} from '../src/server.js';
import vectors from './fixtures/spec-vectors.json';

const PR = vectors.paymentRequired as unknown as X402PaymentRequired;
const PP = vectors.paymentPayload as unknown as X402PaymentPayload;
const SR = vectors.settleResponse as unknown as X402SettleResponse;

function paymentHeader(): Record<string, string> {
  return { 'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(PP), 'utf8').toString('base64') };
}

const facilitator = {
  supported: async () => vectors.facilitatorSupported,
  verify: async () => vectors.verifyResponseOk,
  settle: async () => SR,
} as unknown as FacilitatorClient;

describe('paymentRequiredResponse (ТЗ §3.4)', () => {
  it('builds a 402 with the base64 PAYMENT-REQUIRED header and a JSON body', async () => {
    const res = paymentRequiredResponse(PR);
    expect(res.status).toBe(402);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(decodePaymentRequired(res.headers.get('PAYMENT-REQUIRED') as string)).toEqual(PR);
    expect(await res.json()).toEqual(PR);
  });

  it('merges custom init headers and keeps the transport header', () => {
    const res = paymentRequiredResponse(PR, { headers: { 'x-custom': 'yes', 'content-type': 'text/plain' } });
    expect(res.headers.get('x-custom')).toBe('yes');
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(res.headers.get('PAYMENT-REQUIRED')).not.toBeNull();
  });

  it('structurally invalid pr → TypeError', () => {
    expect(() => paymentRequiredResponse({} as unknown as X402PaymentRequired)).toThrowError(TypeError);
  });
});

describe('readPaymentHeader (ТЗ §3.4)', () => {
  it('no header → null', () => {
    expect(readPaymentHeader(new Headers())).toBeNull();
  });

  it('parses PAYMENT-SIGNATURE', () => {
    expect(readPaymentHeader(new Headers(paymentHeader()))).toEqual(PP);
  });

  it('resource mismatch → RESOURCE_MISMATCH', () => {
    const headers = new Headers(paymentHeader());
    try {
      readPaymentHeader(headers, 'https://other.test/resource');
      expect.unreachable('expected RESOURCE_MISMATCH');
    } catch (e) {
      expect(e).toBeInstanceOf(X402Error);
      expect((e as X402Error).code).toBe('RESOURCE_MISMATCH');
      expect((e as X402Error).details).toMatchObject({ expected: 'https://other.test/resource' });
    }
  });

  it('payload without a resource + expectedResourceUrl → RESOURCE_MISMATCH', () => {
    const bare = { ...PP, resource: undefined } as unknown as X402PaymentPayload;
    const headers = new Headers({
      'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(bare), 'utf8').toString('base64'),
    });
    expect(() => readPaymentHeader(headers, 'https://shop.test/data')).toThrowError(X402Error);
  });

  it('matching resource URL passes', () => {
    expect(readPaymentHeader(new Headers(paymentHeader()), 'https://api.example.com/premium-data')).toEqual(PP);
  });
});

describe('settlementHeader (ТЗ §3.4)', () => {
  it('returns the PAYMENT-RESPONSE record and the value decodes', () => {
    const header = settlementHeader(SR);
    expect(header).toEqual({ 'PAYMENT-RESPONSE': expect.any(String) });
    expect(decodeSettleResponse(header['PAYMENT-RESPONSE'])).toEqual(SR);
  });

  it('structurally invalid settle → TypeError', () => {
    expect(() => settlementHeader({} as unknown as X402SettleResponse)).toThrowError(TypeError);
  });
});

describe('assertValidX402Config (ТЗ §3.10)', () => {
  const base: X402Config = { facilitator, mode: 'stateless' };

  it('accepts a valid stateless config', () => {
    expect(() => assertValidX402Config(base)).not.toThrowError();
  });

  it('accepts pact-aware + regulatoryProfile none, and a fully declared auto config', () => {
    expect(() => assertValidX402Config({ facilitator, mode: 'pact-aware', regulatoryProfile: 'none' })).not.toThrowError();
    expect(() =>
      assertValidX402Config({
        facilitator,
        mode: 'auto',
        buyerAttestationPolicy: 'required',
        regulatoryProfile: 'kyc',
      })
    ).not.toThrowError();
  });

  it('facilitator without callable verify/settle/supported → X402ConfigError', () => {
    expect(() => assertValidX402Config({ ...base, facilitator: {} as unknown as FacilitatorClient })).toThrowError(
      X402ConfigError
    );
    expect(() =>
      assertValidX402Config({ ...base, facilitator: undefined as unknown as FacilitatorClient })
    ).toThrowError(X402ConfigError);
  });

  it('unknown enums fail closed', () => {
    expect(() => assertValidX402Config({ ...base, mode: 'yolo' as X402Config['mode'] })).toThrowError(X402ConfigError);
    expect(() =>
      assertValidX402Config({ ...base, buyerAttestationPolicy: 'strict' as X402Config['buyerAttestationPolicy'] })
    ).toThrowError(X402ConfigError);
    expect(() =>
      assertValidX402Config({ ...base, regulatoryProfile: 'gdpr' as X402Config['regulatoryProfile'] })
    ).toThrowError(X402ConfigError);
  });

  it('stateless + a real regulatory profile → X402ConfigError', () => {
    try {
      assertValidX402Config({ ...base, regulatoryProfile: 'kyc' });
      expect.unreachable('expected X402ConfigError');
    } catch (e) {
      expect(e).toBeInstanceOf(X402ConfigError);
      expect((e as X402ConfigError).code).toBe('CONFIG_INVALID');
      expect(e).toBeInstanceOf(TypeError);
      expect((e as X402ConfigError).details).toMatchObject({ field: 'mode' });
    }
  });
});
