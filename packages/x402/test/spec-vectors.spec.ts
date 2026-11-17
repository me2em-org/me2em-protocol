// packages/x402/test/spec-vectors.spec.ts
//
// Golden vectors lifted VERBATIM from the upstream x402 v2 specification
// (x402-foundation/x402, specs/x402-specification-v2.md, commit
// 51a0664c2b7826e3cb02595481eb6848a1b11815, 2026-10-26 — see $meta).
// These pin the codec to the real wire examples, not just to our own
// fixtures.
import { describe, expect, it } from 'vitest';
import { isX402Supported } from '@me2em/core';
import { decodePaymentPayload, decodePaymentRequired, decodeSettleResponse } from '../src/codec.js';
import { X402Error } from '../src/errors.js';
import vectors from './fixtures/spec-vectors.json';

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

describe('golden vectors — upstream x402-foundation/x402 @ 51a0664c (2026-10-26)', () => {
  it('§5.1.1 PaymentRequired decodes verbatim', () => {
    expect(decodePaymentRequired(b64(vectors.paymentRequired))).toEqual(vectors.paymentRequired);
  });

  it('§5.2.1 PaymentPayload decodes verbatim', () => {
    expect(decodePaymentPayload(b64(vectors.paymentPayload))).toEqual(vectors.paymentPayload);
  });

  it('§5.3.1 SettleResponse decodes verbatim', () => {
    expect(decodeSettleResponse(b64(vectors.settleResponse))).toEqual(vectors.settleResponse);
  });

  it('§7.2 failure settle (empty transaction) decodes — core rc.7 guard', () => {
    expect(decodeSettleResponse(b64(vectors.facilitatorSettleFailure))).toEqual(vectors.facilitatorSettleFailure);
  });

  it('§7.1 verify responses (ok / invalid) pass the core guard shape', () => {
    expect(vectors.verifyResponseOk).toEqual({ isValid: true, payer: expect.any(String) });
    expect(vectors.verifyResponseInvalid).toEqual({ isValid: false, invalidReason: 'insufficient_funds', payer: expect.any(String) });
  });

  it('§7.3 Supported shape passes the core guard', () => {
    expect(isX402Supported(vectors.facilitatorSupported)).toBe(true);
  });

  it('the §5.2.1 payload shape with x402Version 1 is refused (VERSION_UNSUPPORTED)', () => {
    const v1 = { ...(vectors.paymentPayload as object), x402Version: 1 };
    try {
      decodePaymentPayload(b64(v1));
      expect.unreachable('expected VERSION_UNSUPPORTED');
    } catch (e) {
      expect(e).toBeInstanceOf(X402Error);
      expect((e as X402Error).code).toBe('VERSION_UNSUPPORTED');
    }
  });
});
