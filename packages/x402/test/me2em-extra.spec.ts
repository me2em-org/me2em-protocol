// packages/x402/test/me2em-extra.spec.ts
import { describe, expect, it } from 'vitest';
import type { X402PaymentRequired, X402PaymentRequirements } from '@me2em/core';
import { encodePaymentRequired } from '../src/codec.js';
import { X402Error } from '../src/errors.js';
import { X402_ME2EM_EXTRA_KEY, X402_RESERVED_EXTRA_KEYS, readMe2emExtra, withMe2emExtra } from '../src/me2em-extra.js';
import vectors from './fixtures/spec-vectors.json';

const base: X402PaymentRequirements = {
  scheme: 'exact',
  network: 'eip155:84532',
  amount: '10000',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
  maxTimeoutSeconds: 60,
  extra: { name: 'USDC', version: '2' },
};

function expectInvalid(fn: () => unknown, message: RegExp): void {
  try {
    fn();
    expect.unreachable('expected ME2EM_EXTRA_INVALID');
  } catch (e) {
    expect(e).toBeInstanceOf(X402Error);
    expect((e as X402Error).code).toBe('ME2EM_EXTRA_INVALID');
    expect((e as X402Error).message).toMatch(message);
  }
}

describe('withMe2emExtra — write (ТЗ §3.6)', () => {
  it('sets the nested me2em key and preserves the x402-reserved extra keys', () => {
    const merged = withMe2emExtra(base, { sellerId: 'seller-1', memo: 'note' });
    expect(merged.extra).toMatchObject({ name: 'USDC', version: '2' });
    expect((merged.extra as Record<string, unknown>)[X402_ME2EM_EXTRA_KEY]).toEqual({
      sellerId: 'seller-1',
      memo: 'note',
    });
    for (const key of X402_RESERVED_EXTRA_KEYS) {
      expect(key in (merged.extra as Record<string, unknown>) || key === 'assetTransferMethod' || key === 'paymentFlow').toBe(true);
    }
  });

  it('merges with an existing extra.me2em — new values win, old fields survive', () => {
    const started = {
      ...base,
      extra: { ...base.extra, me2em: { sellerId: 'old-seller', buyerId: 'buyer-1', reference: 'ref-1' } },
    } as X402PaymentRequirements;
    const merged = withMe2emExtra(started, { sellerId: 'new-seller' });
    expect(readMe2emExtra(merged)).toEqual({ sellerId: 'new-seller', buyerId: 'buyer-1', reference: 'ref-1' });
  });

  it('application-defined extra keys survive the merge', () => {
    const started = { ...base, extra: { ...base.extra, myKey: { deep: true } } } as X402PaymentRequirements;
    const merged = withMe2emExtra(started, { sellerId: 'seller-1' });
    expect((merged.extra as Record<string, unknown>).myKey).toEqual({ deep: true });
  });

  it('invalid values → ME2EM_EXTRA_INVALID', () => {
    expectInvalid(() => withMe2emExtra(base, { sellerId: '' }), /sellerId/);
    expectInvalid(() => withMe2emExtra(base, { sellerId: 42 as unknown as string }), /sellerId/);
    expectInvalid(() => withMe2emExtra(base, { sellerId: 's', memo: 1 as unknown as string }), /memo/);
    expectInvalid(() => withMe2emExtra(base, { sellerId: 's', me2emError: 'NOT_A_CODE' as never }), /me2emError/);
    expectInvalid(
      () => withMe2emExtra({ ...base, extra: [1, 2] } as unknown as X402PaymentRequirements, { sellerId: 's' }),
      /extra must be a plain object/
    );
    expectInvalid(
      () =>
        withMe2emExtra({ ...base, extra: { me2em: 'nope' } } as unknown as X402PaymentRequirements, { sellerId: 's' }),
      /existing requirements.extra.me2em/
    );
  });
});

describe('readMe2emExtra — read (fail-tolerant, ТЗ §3.6)', () => {
  it('no extra → null', () => {
    expect(readMe2emExtra({ ...base, extra: undefined })).toBeNull();
  });

  it('foreign top-level extra (sellerId outside me2em) is ignored → null', () => {
    expect(readMe2emExtra({ ...base, extra: { sellerId: 'intruder' } })).toBeNull();
  });

  it('non-object / sellerId-less me2em → null', () => {
    expect(readMe2emExtra({ ...base, extra: { me2em: 'nope' } } as X402PaymentRequirements)).toBeNull();
    expect(readMe2emExtra({ ...base, extra: { me2em: { memo: 'no sellerId' } } } as X402PaymentRequirements)).toBeNull();
    expect(readMe2emExtra({ ...base, extra: { me2em: { sellerId: '' } } } as X402PaymentRequirements)).toBeNull();
  });

  it('valid nested me2em reads through with its index-key fields', () => {
    const extra = { sellerId: 'seller-1', agreementProof: 'aGVsbG8=', customFlag: true } as const;
    const req = { ...base, extra: { name: 'USDC', me2em: extra } } as unknown as X402PaymentRequirements;
    expect(readMe2emExtra(req)).toEqual(extra);
  });

  it('the upstream vector (no me2em) reads as null', () => {
    const PR = vectors.paymentRequired as unknown as X402PaymentRequired;
    expect(readMe2emExtra(PR.accepts[0])).toBeNull();
  });
});

describe('compactness (ТЗ §3.6 — 8 KiB header budget)', () => {
  it('the ТЗ §3.8 example shape with extra.me2em fits the default limit', () => {
    const pr = {
      ...vectors.paymentRequired,
      accepts: [withMe2emExtra(vectors.paymentRequired.accepts[0], {
        sellerId: 'c2VsbGVyLXB1YmtleQ==',
        memo: 'base58-reference',
        reference: 'base58-reference',
        agreementProof: 'UEFjdFByb29m',
      })],
    } as unknown as X402PaymentRequired;
    const wire = encodePaymentRequired(pr);
    expect(wire.length).toBeLessThanOrEqual(8192);
  });
});
