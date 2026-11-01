// Session unit tests
import { describe, it, expect } from 'vitest';
import { Identity, Handle, SubHandle, Session, type RevocationChecker } from '../src/index.js';
import { base64urlDecode } from '../src/util.js';
import { expectAttestationError, sessionFromVerified, tamperPayload } from './test-utils.js';

const testSeed = new Uint8Array(64).fill(42);

// Mock revocation checker for testing
class MockRevocationChecker implements RevocationChecker {
  private revokedSessions = new Set<string>();

  revoke(sessionId: string) {
    this.revokedSessions.add(sessionId);
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return this.revokedSessions.has(sessionId);
  }
}

describe('Session.create', () => {
  it('should create a valid signed session token', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('alice');
    const session = await Session.create(handle, {
      audience: 'my-app',
      scopes: ['read', 'write'],
      ttl: 3600,
    });

    expect(session.handleId).toBe(handle.getId());
    expect(session.handleName).toBe('alice');
    expect(session.audience).toBe('my-app');
    expect(session.scopes).toEqual(['read', 'write']);
    expect(session.expiresAt).toBeGreaterThan(0);
    expect(session.token).toContain('.');
    expect(session.sessionId).toBeDefined();

    const parts = session.token.split('.');
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it('should produce tokens in Base64URL format', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('bob');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['admin'],
      ttl: 7200,
    });

    const b64urlRegex = /^[A-Za-z0-9_-]+$/;
    const [payload, signature] = session.token.split('.');
    expect(b64urlRegex.test(payload)).toBe(true);
    expect(b64urlRegex.test(signature)).toBe(true);
  });

  it.each([
    ['NaN', NaN],
    ['zero', 0],
    ['negative', -100],
    ['fractional', 1.5],
    ['Infinity', Infinity],
  ])('rejects ttl = %s', async (_name, badTtl) => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('ttl-validate');
    await expectAttestationError(
      Session.create(handle, {
        audience: 'app', scopes: ['read'], ttl: badTtl as number,
      }),
      'MALFORMED', 'FORMAT'
    );
  });

  it('should set correct expiration based on TTL', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('carol');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read'],
      ttl: 60,
    });

    const now = Math.floor(Date.now() / 1000);
    expect(session.expiresAt).toBeGreaterThanOrEqual(now);
    expect(session.expiresAt).toBeLessThanOrEqual(now + 60 + 1);
  });
});

describe('Session.verifyStateless', () => {
  it('should verify a valid token', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('verifier-test');
    const session = await Session.create(handle, {
      audience: 'verify-app',
      scopes: ['read'],
      ttl: 3600,
    });

    const verified = await Session.verifyStateless(
      session.token,
      identity,
      'verify-app'
    );

    expect(verified.handleId).toBe(session.handleId);
    expect(verified.audience).toBe('verify-app');
    expect(verified.scopes).toEqual(['read']);
    expect(verified.isExpired()).toBe(false);
  });

  it('should reject tokens with wrong audience', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('audience-test');
    const session = await Session.create(handle, {
      audience: 'app-a',
      scopes: ['read'],
      ttl: 3600,
    });

    await expectAttestationError(
      Session.verifyStateless(session.token, identity, 'app-b'),
      'AUDIENCE_NOT_PERMITTED', 'SESSION'
    );
  });

  it('should reject expired tokens', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('expired-test');
    const farPast = Math.floor(Date.now() / 1000) - 100000;

    const payload = JSON.stringify({
      hId: handle.getId(),
      hNm: handle.getName(),
      aud: 'app',
      scp: ['read'],
      exp: farPast,
      iat: farPast,
      jti: 'mock-jti-expired',
    });

    const payloadBytes = new TextEncoder().encode(payload);
    const signature = await handle.sign(payloadBytes);
    const payloadB64 = btoa(String.fromCharCode(...payloadBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const signatureB64 = btoa(String.fromCharCode(...signature))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.${signatureB64}`;

    await expectAttestationError(
      Session.verifyStateless(token, identity, 'app'),
      'EXPIRED', 'SESSION'
    );
  });

  it('should reject future-dated tokens beyond clock skew', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('future-test');
    const farFuture = Math.floor(Date.now() / 1000) + 100000;
    
    const payload = JSON.stringify({
      hId: handle.getId(),
      hNm: handle.getName(),
      aud: 'app',
      scp: ['read'],
      exp: farFuture,
      iat: farFuture,
      jti: 'mock-jti-future',
    });
    
    const payloadBytes = new TextEncoder().encode(payload);
    const signature = await handle.sign(payloadBytes);
    const payloadB64 = btoa(String.fromCharCode(...payloadBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const signatureB64 = btoa(String.fromCharCode(...signature))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.${signatureB64}`;

    await expectAttestationError(
      Session.verifyStateless(token, identity, 'app'),
      'NOT_YET_VALID', 'SESSION'
    );
  });

  it('should reject tampered payload', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('tamper-test');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read', 'write'],
      ttl: 3600,
    });

    const tamperedToken = tamperPayload(session.token, (payload) => {
      payload.scp = ['read']; // Tamper
    });

    await expectAttestationError(
      Session.verifyStateless(tamperedToken, identity, 'app'),
      'BAD_SIGNATURE', 'SESSION'
    );
  });

  it('should reject malformed JSON payload', async () => {
    const badPayload = btoa('not valid json{{{')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const badSignature = btoa(String.fromCharCode(...new Uint8Array(64)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const malformedToken = `${badPayload}.${badSignature}`;

    await expectAttestationError(
      Session.verifyStateless(malformedToken, await Identity.fromSeed(testSeed), 'app'),
      'MALFORMED', 'FORMAT'
    );
  });

  it('should reject tokens with invalid format (no dot)', async () => {
    await expectAttestationError(
      Session.verifyStateless('no-dot-here', await Identity.fromSeed(testSeed), 'app'),
      'MALFORMED', 'FORMAT'
    );
  });

  it('should reject tokens with invalid Base64URL characters', async () => {
    const badToken = 'payload with spaces.sig!@#';
    await expectAttestationError(
      Session.verifyStateless(badToken, await Identity.fromSeed(testSeed), 'app'),
      'MALFORMED', 'FORMAT'
    );
  });

  it('should reject tokens with oversized payloads', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('size-test');
    
    const oversizedPayload = JSON.stringify({
      hId: handle.getId(),
      hNm: handle.getName(),
      aud: 'app',
      scp: ['read'],
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'mock-jti-size',
      fakeData: 'x'.repeat(5000),
    });

    const payloadBytes = new TextEncoder().encode(oversizedPayload);
    const signature = await handle.sign(payloadBytes);
    const payloadB64 = btoa(String.fromCharCode(...payloadBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const signatureB64 = btoa(String.fromCharCode(...signature))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.${signatureB64}`;

    await expectAttestationError(
      Session.verifyStateless(token, identity, 'app'),
      'MALFORMED', 'FORMAT'
    );
  });

  it('should reject tokens for unknown handle names', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('known-handle');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read'],
      ttl: 3600,
    });

    const parts = session.token.split('.');
    const payloadBytes = base64urlDecode(parts[0]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;

    payload.hNm = 'unknown-handle-xyz'; // Tamper name
    
    const modifiedPayload = JSON.stringify(payload);
    const newPayloadBytes = new TextEncoder().encode(modifiedPayload);
    const newSignature = await handle.sign(newPayloadBytes);
    const newPayloadB64 = btoa(String.fromCharCode(...newPayloadBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const newSignatureB64 = btoa(String.fromCharCode(...newSignature))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${newPayloadB64}.${newSignatureB64}`;

    await expectAttestationError(
      Session.verifyStateless(token, identity, 'app'),
      'BAD_SIGNATURE', 'SESSION'
    );
  });
});

describe('Session.isExpired', () => {
  it('should return false for non-expired session', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('expiry-test');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read'],
      ttl: 7200,
    });
    expect(session.isExpired()).toBe(false);
  });

  it('should return true for expired session', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    // PR-11 (D6): the constructor is private — reconstruction goes
    // through the @internal Session.fromVerified factory via test-utils.
    const session = sessionFromVerified(
      'mock-hId',
      'expired-now',
      'app',
      ['read'],
      past,
      'mock-token',
      undefined,
      'mock-jti'
    );
    expect(session.isExpired()).toBe(true);
  });
});

// ============================================================================
// НОВЫЕ ТЕСТЫ: SubHandle и Revocation
// ============================================================================

describe('Session with SubHandle', () => {
  it('should create a session from a SubHandle and include hPath', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('station-001');
    const subHandle = await handle.deriveSubHandle('connector-1');

    const session = await Session.create(subHandle, {
      audience: 'ev-app.com',
      scopes: ['charge:start'],
      ttl: 3600,
    });

    expect(session.path).toEqual(['station-001', 'connector-1']);
    
    // Проверка, что токен декодируется и содержит hPath (read-side — SUT-кодек)
    const payloadBytes = base64urlDecode(session.token.split('.')[0]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    expect(payload.hPath).toEqual(['station-001', 'connector-1']);
  });

  it('should successfully verify a SubHandle session via Identity', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('drone-alpha');
    const subHandle = await handle.deriveSubHandle('camera-module');

    const session = await Session.create(subHandle, {
      audience: 'client-app.com',
      scopes: ['camera:stream'],
      ttl: 3600,
    });

    const verified = await Session.verifyStateless(
      session.token,
      identity,
      'client-app.com'
    );

    expect(verified.handleName).toBe('camera-module');
    expect(verified.path).toEqual(['drone-alpha', 'camera-module']);
    expect(verified.scopes).toEqual(['camera:stream']);
  });
});

describe('Session with RevocationChecker', () => {
  it('should pass verification when session is NOT revoked', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('user-1');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read'],
      ttl: 3600,
    });

    const mockChecker = new MockRevocationChecker();
    
    const verified = await Session.verifyStateless(
      session.token,
      identity,
      'app',
      mockChecker
    );
    
    expect(verified.sessionId).toBe(session.sessionId);
  });

  it('should reject verification when session IS revoked', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('user-2');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read'],
      ttl: 3600,
    });

    const mockChecker = new MockRevocationChecker();
    mockChecker.revoke(session.sessionId); // Отзываем сессию

    await expectAttestationError(
      Session.verifyStateless(session.token, identity, 'app', mockChecker),
      'REVOKED', 'SESSION'
    );
  });

  it('should pass verification when no RevocationChecker is provided', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('user-3');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read'],
      ttl: 3600,
    });

    // Передаем undefined вместо checker
    const verified = await Session.verifyStateless(
      session.token,
      identity,
      'app',
      undefined
    );
    
    expect(verified.handleName).toBe('user-3');
  });
});

describe('SubHandle constraints in Session', () => {
  it('should reject session creation if audience is not allowed', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('station');
    const subHandle = await handle.deriveSubHandle('connector', {
      allowedAudiences: ['ev-app.com'],
    });

    await expectAttestationError(
      Session.create(subHandle, {
        audience: 'malicious-app.com',
        scopes: ['read'],
        ttl: 3600,
      }),
      'AUDIENCE_NOT_PERMITTED', 'SESSION'
    );
  });

  it('should reject session creation if scope is not allowed', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('station');
    const subHandle = await handle.deriveSubHandle('connector', {
      allowedScopes: ['charge:start'],
    });

    await expectAttestationError(
      Session.create(subHandle, {
        audience: 'ev-app.com',
        scopes: ['charge:start', 'admin:override'],
        ttl: 3600,
      }),
      'SCOPE_EXCEEDED', 'SESSION'
    );
  });

  it('should reject session creation if TTL exceeds maxSessionTtl', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('station');
    const subHandle = await handle.deriveSubHandle('connector', {
      maxSessionTtl: 3600,
    });

    await expectAttestationError(
      Session.create(subHandle, {
        audience: 'ev-app.com',
        scopes: ['read'],
        ttl: 7200, // Превышаем лимит
      }),
      'TTL_EXCEEDED', 'SESSION'
    );
  });

  it('should reject session creation if SubHandle has expired', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('station');
    const subHandle = await handle.deriveSubHandle('contractor', {
      expiresAt: Math.floor(Date.now() / 1000) - 3600, // Истек час назад
    });

    await expectAttestationError(
      Session.create(subHandle, {
        audience: 'app.com',
        scopes: ['read'],
        ttl: 3600,
      }),
      'EXPIRED', 'SESSION'
    );
  });
});

// ============================================================================
// Существующие тесты Handle.deriveSharedSecret
// ============================================================================
describe('Handle.deriveSharedSecret', () => {
  it('should produce identical shared secrets for both parties', async () => {
    const identityA = await Identity.fromSeed(testSeed);
    const handleA = await identityA.deriveHandle('shared-secret-a');
    const identityB = await Identity.fromSeed(new Uint8Array(64).fill(99));
    const handleB = await identityB.deriveHandle('shared-secret-b');

    const secretA = await handleA.deriveSharedSecret(handleB.getPublicKey());
    const secretB = await handleB.deriveSharedSecret(handleA.getPublicKey());

    expect(secretA).toEqual(secretB);
    expect(secretA.length).toBe(32);
    expect(secretB.length).toBe(32);
  });

  it('should produce different secrets for different key pairs', async () => {
    const identityA = await Identity.fromSeed(testSeed);
    const handleA = await identityA.deriveHandle('diff-secret-a');
    const identityB = await Identity.fromSeed(new Uint8Array(64).fill(99));
    const handleB = await identityB.deriveHandle('diff-secret-b');
    const identityC = await Identity.fromSeed(new Uint8Array(64).fill(55));
    const handleC = await identityC.deriveHandle('diff-secret-c');

    const secretAB = await handleA.deriveSharedSecret(handleB.getPublicKey());
    const secretAC = await handleA.deriveSharedSecret(handleC.getPublicKey());

    expect(secretAB).not.toEqual(secretAC);
  });

  it('should reject invalid public key sizes', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('invalid-pubkey');

    await expectAttestationError(
      handle.deriveSharedSecret(new Uint8Array(16)), 'MALFORMED', 'FORMAT'
    );
    await expectAttestationError(
      handle.deriveSharedSecret(new Uint8Array(64)), 'MALFORMED', 'FORMAT'
    );
  });

  it('self-secret: deriving with own public key works (sorted binding, return 0 path)', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('self-secret');

    const selfSecret = await handle.deriveSharedSecret(handle.getPublicKey());
    const selfSecret2 = await handle.deriveSharedSecret(handle.getPublicKey());

    expect(selfSecret).toBeInstanceOf(Uint8Array);
    expect(selfSecret.length).toBe(32);
    expect(selfSecret).toEqual(selfSecret2); // deterministic
  });

  it('binds peer keys: A↔B secret differs from A↔C (unknown key-share protection)', async () => {
    const identityA = await Identity.fromSeed(testSeed);
    const identityB = await Identity.fromSeed(new Uint8Array(64).fill(99));
    const identityC = await Identity.fromSeed(new Uint8Array(64).fill(55));

    const handleA = await identityA.deriveHandle('uks-test');
    const handleB = await identityB.deriveHandle('uks-peer-b');
    const handleC = await identityC.deriveHandle('uks-peer-c');

    const ab = await handleA.deriveSharedSecret(handleB.getPublicKey());
    const ac = await handleA.deriveSharedSecret(handleC.getPublicKey());
    const ba = await handleB.deriveSharedSecret(handleA.getPublicKey());

    expect(ab).not.toEqual(ac);   // different peer → different secret
    expect(ab).toEqual(ba);       // symmetric: order-independent
  });
});

