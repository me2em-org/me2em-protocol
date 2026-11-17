// packages/x402/test/codec.spec.ts
import { describe, expect, it } from 'vitest';
import type { X402PaymentPayload, X402PaymentRequired, X402SettleResponse } from '@me2em/core';
import {
  DEFAULT_MAX_HEADER_BYTES,
  decodePaymentPayload,
  decodePaymentRequired,
  decodeSettleResponse,
  encodePaymentPayload,
  encodePaymentRequired,
  encodeSettleResponse,
} from '../src/codec.js';
import { X402Error } from '../src/errors.js';
import vectors from './fixtures/spec-vectors.json';

const PR = vectors.paymentRequired as unknown as X402PaymentRequired;
const PP = vectors.paymentPayload as unknown as X402PaymentPayload;
const SR = vectors.settleResponse as unknown as X402SettleResponse;

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function expectCode(fn: () => unknown, code: X402Error['code']): void {
  try {
    fn();
    expect.unreachable(`expected ${code}`);
  } catch (e) {
    expect(e).toBeInstanceOf(X402Error);
    expect((e as X402Error).code).toBe(code);
  }
}

describe('round trip (upstream vectors)', () => {
  it('PAYMENT-REQUIRED round trips and is deterministic', () => {
    const wire = encodePaymentRequired(PR);
    expect(decodePaymentRequired(wire)).toEqual(PR);
    expect(encodePaymentRequired(decodePaymentRequired(wire))).toBe(wire);
  });

  it('PAYMENT-SIGNATURE round trips and is deterministic', () => {
    const wire = encodePaymentPayload(PP);
    expect(decodePaymentPayload(wire)).toEqual(PP);
    expect(encodePaymentPayload(decodePaymentPayload(wire))).toBe(wire);
  });

  it('PAYMENT-RESPONSE round trips and is deterministic', () => {
    const wire = encodeSettleResponse(SR);
    expect(decodeSettleResponse(wire)).toEqual(SR);
    expect(encodeSettleResponse(decodeSettleResponse(wire))).toBe(wire);
  });

  it('decoder accepts base64 without padding', () => {
    const wire = encodePaymentRequired(PR);
    expect(decodePaymentRequired(wire.replace(/=+$/, ''))).toEqual(PR);
    expect(decodePaymentRequired(wire)).toEqual(PR);
  });
});

describe('decode failures (fail-closed, ТЗ §3.2)', () => {
  it('invalid base64 → PAYMENT_REQUIRED_MALFORMED', () => {
    expectCode(() => decodePaymentRequired('!!!'), 'PAYMENT_REQUIRED_MALFORMED');
  });

  it('empty header value → MALFORMED', () => {
    expectCode(() => decodePaymentRequired('   '), 'PAYMENT_REQUIRED_MALFORMED');
  });

  it('valid base64, non-JSON → MALFORMED', () => {
    expectCode(() => decodePaymentRequired(b64('plain text')), 'PAYMENT_REQUIRED_MALFORMED');
  });

  it('valid base64, non-UTF-8 bytes → MALFORMED', () => {
    expectCode(() => decodePaymentRequired(Buffer.from([0xff]).toString('base64')), 'PAYMENT_REQUIRED_MALFORMED');
  });

  it('JSON but wrong shape → MALFORMED', () => {
    expectCode(() => decodePaymentRequired(b64({ foo: 1 })), 'PAYMENT_REQUIRED_MALFORMED');
    expectCode(() => decodePaymentRequired(b64([1, 2, 3])), 'PAYMENT_REQUIRED_MALFORMED');
    expectCode(() => decodePaymentPayload(b64({ accepted: 'no' })), 'PAYMENT_PAYLOAD_MALFORMED');
    expectCode(() => decodeSettleResponse(b64({ success: 'yes' })), 'PAYMENT_RESPONSE_MALFORMED');
  });

  it('non-CAIP-2 network → MALFORMED', () => {
    const bad = { ...PR, accepts: [{ ...PR.accepts[0], network: 'solana' }] };
    expectCode(() => decodePaymentRequired(b64(bad)), 'PAYMENT_REQUIRED_MALFORMED');
  });

  it('v1-era maxAmountRequired shape (no amount) → MALFORMED', () => {
    const bad = { ...PR, accepts: [{ ...PR.accepts[0], amount: undefined, maxAmountRequired: '10000' }] };
    expectCode(() => decodePaymentRequired(b64(bad)), 'PAYMENT_REQUIRED_MALFORMED');
  });

  it('x402Version 1 → VERSION_UNSUPPORTED (a version failure, not structural)', () => {
    const v1 = { ...PP, x402Version: 1 };
    expectCode(() => decodePaymentPayload(b64(v1)), 'VERSION_UNSUPPORTED');
    const v1Required = { ...PR, x402Version: 1 };
    expectCode(() => decodePaymentRequired(b64(v1Required)), 'VERSION_UNSUPPORTED');
  });

  it('non-numeric x402Version → MALFORMED (structural, not a version)', () => {
    const bad = { ...PR, x402Version: '2' };
    expectCode(() => decodePaymentRequired(b64(bad)), 'PAYMENT_REQUIRED_MALFORMED');
  });
});

describe('header size limits (ТЗ §3.2)', () => {
  it('encode overflow → TypeError (programmer error)', () => {
    const big = {
      ...PR,
      accepts: [{ ...PR.accepts[0], extra: { name: 'USDC', version: '2', blob: 'x'.repeat(20000) } }],
    } as unknown as X402PaymentRequired;
    expect(() => encodePaymentRequired(big)).toThrowError(TypeError);
    expect(() => encodePaymentRequired(big)).toThrowError(/8192/);
  });

  it('decode overflow → MALFORMED (hostile input); custom limit passes it', () => {
    const big = {
      ...PR,
      accepts: [{ ...PR.accepts[0], extra: { name: 'USDC', version: '2', blob: 'x'.repeat(20000) } }],
    } as unknown as X402PaymentRequired;
    const wire = encodePaymentRequired(big, { maxHeaderBytes: 100000 });
    expect(wire.length).toBeGreaterThan(DEFAULT_MAX_HEADER_BYTES);
    expectCode(() => decodePaymentRequired(wire), 'PAYMENT_REQUIRED_MALFORMED');
    expect(decodePaymentRequired(wire, { maxHeaderBytes: 100000 })).toEqual(big);
  });

  it('encode of a structurally invalid value → TypeError', () => {
    expect(() => encodePaymentRequired({} as unknown as X402PaymentRequired)).toThrowError(TypeError);
    expect(() => encodePaymentPayload({} as unknown as X402PaymentPayload)).toThrowError(TypeError);
    expect(() => encodeSettleResponse({} as unknown as X402SettleResponse)).toThrowError(TypeError);
  });

  it('maxHeaderBytes must be a positive integer', () => {
    expect(() => encodePaymentRequired(PR, { maxHeaderBytes: 0 })).toThrowError(TypeError);
    expect(() => decodePaymentRequired('e30', { maxHeaderBytes: 1.5 })).toThrowError(TypeError);
    expect(() => encodePaymentRequired(PR, { maxHeaderBytes: Number.POSITIVE_INFINITY })).toThrowError(TypeError);
  });
});
