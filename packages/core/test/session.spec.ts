import { describe, it, expect } from 'vitest';
import { Identity, Handle, Session } from '../src/index.js';

const testSeed = new Uint8Array(32).fill(42);

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

    await expect(
      Session.verifyStateless(session.token, identity, 'app-b')
    ).rejects.toThrow(/Audience mismatch/);
  });

  it('should reject expired tokens', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('expired-test');

    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read'],
      ttl: -100,
    });

    await expect(
      Session.verifyStateless(session.token, identity, 'app')
    ).rejects.toThrow(/expired/i);
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
    });

    const payloadBytes = new TextEncoder().encode(payload);
    const signature = await handle.sign(payloadBytes);

    const payloadB64 = btoa(String.fromCharCode(...payloadBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const signatureB64 = btoa(String.fromCharCode(...signature))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.${signatureB64}`;

    await expect(
      Session.verifyStateless(token, identity, 'app')
    ).rejects.toThrow(/future/i);
  });

  it('should reject tampered payload', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('tamper-test');

    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read', 'write'],
      ttl: 3600,
    });

    const parts = session.token.split('.');
    const payloadB64 = parts[0];
    const signatureB64 = parts[1];

    const payloadBytes = base64urlDecode(payloadB64);
    const payloadObj = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
    payloadObj.scp = ['read'];
    const modifiedPayload = JSON.stringify(payloadObj);
    const modifiedPayloadBytes = new TextEncoder().encode(modifiedPayload);

    const modifiedPayloadB64 = btoa(String.fromCharCode(...modifiedPayloadBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tamperedToken = `${modifiedPayloadB64}.${signatureB64}`;

    await expect(
      Session.verifyStateless(tamperedToken, identity, 'app')
    ).rejects.toThrow(/signature/i);
  });

  it('should reject malformed JSON payload', async () => {
    const badPayload = btoa('not valid json{{{')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const badSignature = btoa(new Uint8Array(64))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const malformedToken = `${badPayload}.${badSignature}`;

    await expect(
      Session.verifyStateless(malformedToken, await Identity.fromSeed(testSeed), 'app')
    ).rejects.toThrow(/JSON|format/i);
  });

  it('should reject tokens with invalid format (no dot)', async () => {
    await expect(
      Session.verifyStateless('no-dot-here', await Identity.fromSeed(testSeed), 'app')
    ).rejects.toThrow(/format/i);
  });

  it('should reject tokens with invalid Base64URL characters', async () => {
    const badToken = 'payload with spaces.sig!@#';
    await expect(
      Session.verifyStateless(badToken, await Identity.fromSeed(testSeed), 'app')
    ).rejects.toThrow(/Base64URL|format/i);
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
      fakeData: 'x'.repeat(5000),
    });

    const payloadBytes = new TextEncoder().encode(oversizedPayload);
    const signature = await handle.sign(payloadBytes);

    const payloadB64 = btoa(String.fromCharCode(...payloadBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const signatureB64 = btoa(String.fromCharCode(...signature))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.${signatureB64}`;

    await expect(
      Session.verifyStateless(token, identity, 'app')
    ).rejects.toThrow(/size|exceed/i);
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
    payload.hNm = 'unknown-handle-xyz';
    const modifiedPayload = JSON.stringify(payload);

    const newPayloadBytes = new TextEncoder().encode(modifiedPayload);
    const newSignature = await handle.sign(newPayloadBytes);

    const newPayloadB64 = btoa(String.fromCharCode(...newPayloadBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const newSignatureB64 = btoa(String.fromCharCode(...newSignature))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${newPayloadB64}.${newSignatureB64}`;

    await expect(
      Session.verifyStateless(token, identity, 'app')
    ).rejects.toThrow(/signature/i);
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

  it('should return true for expired session', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('expired-now');

    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read'],
      ttl: -100,
    });

    expect(session.isExpired()).toBe(true);
  });
});

describe('Handle.deriveSharedSecret', () => {
  it('should produce identical shared secrets for both parties', async () => {
    const identityA = await Identity.fromSeed(testSeed);
    const handleA = await identityA.deriveHandle('shared-secret-a');

    const identityB = await Identity.fromSeed(new Uint8Array(32).fill(99));
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

    const identityB = await Identity.fromSeed(new Uint8Array(32).fill(99));
    const handleB = await identityB.deriveHandle('diff-secret-b');

    const identityC = await Identity.fromSeed(new Uint8Array(32).fill(55));
    const handleC = await identityC.deriveHandle('diff-secret-c');

    const secretAB = await handleA.deriveSharedSecret(handleB.getPublicKey());
    const secretAC = await handleA.deriveSharedSecret(handleC.getPublicKey());

    expect(secretAB).not.toEqual(secretAC);
  });

  it('should reject invalid public key sizes', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('invalid-pubkey');

    await expect(handle.deriveSharedSecret(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
    await expect(handle.deriveSharedSecret(new Uint8Array(64))).rejects.toThrow(/32 bytes/);
  });
});

function base64urlDecode(input: string): Uint8Array {
  let base64 = input
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
