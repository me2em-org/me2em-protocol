// test/revocation-dated.spec.ts — P0.8 Phase 2: RevocationChecker.isRevokedAt?
//
// Contract under test (specs/tz-core-rc9-jcs-revocation.md §3):
// - the method is OPTIONAL — a rc.8-style checker (isRevoked only)
//   satisfies the interface unchanged and compiles on rc.9;
// - semantics: raw `jti`, unix seconds, inclusive on `at` (revoked at
//   `at` or earlier → true);
// - `Session.verifyStateless` behaviour is unchanged (rc.8 regression):
//   it keeps using `isRevoked`; dated lookups are the consumer's job
//   (pact verifyAct, Tier 3 — ТЗ pact §3.3, Р3).

import { describe, it, expect } from 'vitest';
import { Session, type RevocationChecker } from '../src/index.js';
import { createTestHandle, expectAttestationError } from './test-utils.js';

/** Dated store mock — PACTS D17 semantics, unix seconds inclusive. */
class DatedRevocationChecker implements RevocationChecker {
  private revokedAt = new Map<string, number>();

  async isRevoked(sessionId: string): Promise<boolean> {
    return this.revokedAt.has(sessionId);
  }

  async isRevokedAt(sessionId: string, at: number): Promise<boolean> {
    const revokedAt = this.revokedAt.get(sessionId);
    return revokedAt !== undefined && at >= revokedAt;
  }

  revokeAt(sessionId: string, at: number): void {
    this.revokedAt.set(sessionId, at);
  }
}

describe('RevocationChecker.isRevokedAt (P0.8 Phase 2, D17 Tier 3)', () => {
  it('additive: a rc.8-style checker (isRevoked only) satisfies the interface', () => {
    const legacy: RevocationChecker = { isRevoked: async () => false };
    // The degradation probe a retrospective consumer performs:
    expect(typeof legacy.isRevokedAt).toBe('undefined');
  });

  it('dated mock: inclusive-on-`at` semantics', async () => {
    const checker = new DatedRevocationChecker();
    checker.revokeAt('jti-1', 1000);
    await expect(checker.isRevokedAt('jti-1', 999)).resolves.toBe(false);
    await expect(checker.isRevokedAt('jti-1', 1000)).resolves.toBe(true);
    await expect(checker.isRevokedAt('jti-1', 1001)).resolves.toBe(true);
    await expect(checker.isRevokedAt('unknown-jti', 5000)).resolves.toBe(false);
    // Present-tense lookup still works alongside the dated one:
    await expect(checker.isRevoked('jti-1')).resolves.toBe(true);
    await expect(checker.isRevoked('unknown-jti')).resolves.toBe(false);
  });

  it('Session.verifyStateless regression: legacy checker keeps rc.8 behaviour', async () => {
    const { identity, handle } = await createTestHandle('revocation-legacy');
    const session = await Session.create(handle, {
      audience: 'api.example.com',
      scopes: ['read'],
      ttl: 300,
      sessionId: 'sess-fixed-1',
    });

    const allowAll: RevocationChecker = { isRevoked: async () => false };
    const verified = await Session.verifyStateless(session.token, identity, 'api.example.com', allowAll);
    expect(verified.sessionId).toBe('sess-fixed-1');

    const revokedAll: RevocationChecker = { isRevoked: async () => true };
    await expectAttestationError(
      Session.verifyStateless(session.token, identity, 'api.example.com', revokedAll),
      'REVOKED',
      'SESSION'
    );
  });

  it('a checker that also implements isRevokedAt wires through verifyStateless unchanged', async () => {
    const { identity, handle } = await createTestHandle('revocation-dated');
    const session = await Session.create(handle, {
      audience: 'api.example.com',
      scopes: ['read'],
      ttl: 300,
      sessionId: 'sess-fixed-2',
    });

    const checker = new DatedRevocationChecker();
    checker.revokeAt('sess-fixed-2', 0); // revoked since the epoch → any `at` hits

    // verifyStateless ignores isRevokedAt and uses isRevoked (present
    // tense) — unchanged rc.8 behaviour:
    await expectAttestationError(
      Session.verifyStateless(session.token, identity, 'api.example.com', checker),
      'REVOKED',
      'SESSION'
    );

    // The dated lookup itself is available for retrospective consumers:
    await expect(checker.isRevokedAt('sess-fixed-2', Math.floor(Date.now() / 1000))).resolves.toBe(true);
    await expect(checker.isRevokedAt('sess-fixed-2', -1)).resolves.toBe(false);
  });
});
