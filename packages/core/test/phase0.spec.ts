// test/phase0.spec.ts — Phase 0 smoke tests.
// Duplication note: subhandle-leaf and atomic-vs-two-step parity tests
// live in derivation.spec.ts (single source); vectors.spec.ts pins the
// same paths byte-exactly. This file keeps only phase-0-unique behavior.
import { describe, it, expect } from 'vitest';
import { Identity, Session } from '../src/index.js';
import { normalizeName } from '../src/canonical-name.js';
import {
  TEST_SEED,
  createTestHandle,
  tamperPayload,
} from './test-utils.js';

describe('normalizeName', () => {
  it('should lowercase and trim: "Station-001" → "station-001"', () => {
    expect(normalizeName('Station-001')).toBe('station-001');
    expect(normalizeName('station-001')).toBe('station-001');
  });

  it('NFKC folds compatibility forms (ligature and fullwidth to ascii)', () => {
    expect(normalizeName('\uFB01le')).toBe('file');                 // ﬁ → fi
    expect(normalizeName('\uFF33TATION-001')).toBe('station-001');  // Ｓ → s
  });

  it('rejects non-ASCII letters even after NFKC (é in any form)', () => {
    expect(() => normalizeName('caf\u00e9')).toThrow(/Invalid name/);   // NFC
    expect(() => normalizeName('cafe\u0301')).toThrow(/Invalid name/);  // NFD
  });

  it('should reject "/" in name: "a/b"', () => {
    expect(() => normalizeName('a/b')).toThrow();
  });

  it('should reject 64-char name (too long: max 64 total, pattern allows 1+62=63)', () => {
    expect(() => normalizeName('a'.repeat(64))).toThrow();
  });

  it('should reject empty string', () => {
    expect(() => normalizeName('')).toThrow();
  });

  it('rejects non-string input with TypeError (defensive branch)', () => {
    expect(() => normalizeName(42 as unknown as string)).toThrow(TypeError);
  });
});

describe('deriveHandle canonicalizes names', () => {
  it('deriveHandle("Station-001") and deriveHandle("station-001") give SAME getPublicKey()', async () => {
    const identity = await Identity.fromSeed(TEST_SEED);
    const h1 = await identity.deriveHandle('Station-001');
    const h2 = await identity.deriveHandle('station-001');
    expect(h1.getPublicKey()).toEqual(h2.getPublicKey());
    expect(h1.getId()).toBe(h2.getId());
  });
});

describe('long-lived sessions verify immediately', () => {
  it('verifyStateless passes right away (not rejected as future-dated)', async () => {
    const { identity, handle } = await createTestHandle('phase0-session');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read'],
      ttl: 86400,
    });
    const verified = await Session.verifyStateless(
      session.token,
      identity,
      'app'
    );
    expect(verified.handleId).toBe(session.handleId);
    expect(verified.isExpired()).toBe(false);
  });
});

describe('tampered payload rejected', () => {
  it('tampered payload is rejected with signature error', async () => {
    const { identity, handle } = await createTestHandle('tamper-phase0');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read', 'write'],
      ttl: 3600,
    });

    const tamperedToken = tamperPayload(session.token, (payload) => {
      payload.scp = ['read']; // Tamper
    });

    await expect(
      Session.verifyStateless(tamperedToken, identity, 'app')
    ).rejects.toThrow(/signature/i);
  });
});

describe('iat is required', () => {
  it('token without iat field is rejected', async () => {
    const { identity, handle } = await createTestHandle('iat-test');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read'],
      ttl: 3600,
    });

    // Удаляем iat из payload и пересобираем токен.
    // Подпись станет невалидной, но проверка required fields
    // выполняется РАНЬШЕ signature-проверки, поэтому ожидаем
    // именно 'missing required fields'.
    const tokenNoIat = tamperPayload(session.token, (payload) => {
      delete payload.iat;
    });

    await expect(
      Session.verifyStateless(tokenNoIat, identity, 'app')
    ).rejects.toThrow(/missing required fields/i);
  });
});
