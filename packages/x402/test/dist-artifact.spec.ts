// packages/x402/test/dist-artifact.spec.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// Imports the BUILT artifact, not src. CI builds before tests; locally
// run `pnpm --filter @me2em/x402 build` first.
import * as b402Entry from '../dist/b402.js';
import * as mainEntry from '../dist/index.js';
import { B402Facilitator } from '../dist/b402.js';
import {
  assertValidX402Config,
  createPaymentFetch,
  decodePaymentRequired,
  encodePaymentRequired,
  X402Error,
} from '../dist/index.js';
import type { X402PaymentRequired } from '@me2em/core';
import vectors from './fixtures/spec-vectors.json';

const PR = vectors.paymentRequired as unknown as X402PaymentRequired;

/**
 * Smoke pin for the PUBLISHED module graph (the crypto BL-45 class of
 * failure): tsup bundles every import that is not a declared external.
 * `@me2em/core` must stay external — the core guards define the wire
 * contract; inlining them would fork the protocol.
 */
describe('dist artifact (published shape)', () => {
  it('main entry: pure transport — no B402Facilitator', () => {
    expect('B402Facilitator' in mainEntry).toBe(false);
    expect(typeof mainEntry.createPaymentFetch).toBe('function');
    expect(typeof mainEntry.readSettlement).toBe('function');
    expect(typeof mainEntry.paymentRequiredResponse).toBe('function');
    expect(typeof mainEntry.readPaymentHeader).toBe('function');
    expect(typeof mainEntry.settlementHeader).toBe('function');
    expect(typeof mainEntry.assertValidX402Config).toBe('function');
    expect(typeof mainEntry.withMe2emExtra).toBe('function');
    expect(typeof mainEntry.readMe2emExtra).toBe('function');
    expect(typeof mainEntry.X402Error).toBe('function');
    expect(typeof mainEntry.X402ConfigError).toBe('function');
  });

  it('b402 entry exports a working B402Facilitator', () => {
    expect('B402Facilitator' in b402Entry).toBe(true);
    const facilitator = new B402Facilitator({
      baseUrl: 'https://facil.test',
      auth: { headers: { authorization: 'k' } },
    });
    expect(typeof facilitator.supported).toBe('function');
    expect(typeof facilitator.verify).toBe('function');
    expect(typeof facilitator.settle).toBe('function');
  });

  it('codec round-trips the upstream vector from dist', () => {
    const wire = encodePaymentRequired(PR);
    expect(decodePaymentRequired(wire)).toEqual(PR);
    expect(new X402Error('RESOURCE_MISMATCH', 'test')).toBeInstanceOf(Error);
    expect(typeof createPaymentFetch({ signer: { capabilities: [], signPayment: async () => ({}) } })).toBe('function');
    expect(() => assertValidX402Config({ facilitator: undefined as never, mode: 'stateless' })).toThrowError(/facilitator/);
  });

  it('@me2em/core stays external — guards are not inlined', () => {
    const indexSource = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
    expect(indexSource).toMatch(/from\s*["']@me2em\/core["']/);
    expect(indexSource).not.toMatch(/function isX402PaymentRequired/);
    expect(indexSource).not.toMatch(/function isX402SettleResponse/);
    const b402Source = readFileSync(new URL('../dist/b402.js', import.meta.url), 'utf8');
    expect(b402Source).toMatch(/from\s*["']@me2em\/core["']/);
    expect(b402Source).not.toMatch(/function isX402SettleResponse/);
  });
});
