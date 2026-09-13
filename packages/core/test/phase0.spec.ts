// test/phase0.test.ts
import { describe, it, expect } from 'vitest';
import { Identity, Handle, SubHandle, Session } from '../src/index.js';
import { normalizeName } from '../src/canonical-name.js';

const testSeed = new Uint8Array(32).fill(42);

describe('Phase 0: normalizeName', () => {
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
});

describe('Phase 0: normalizeName in deriveHandle', () => {
  it('deriveHandle("Station-001") and deriveHandle("station-001") give SAME getPublicKey()', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const h1 = await identity.deriveHandle('Station-001');
    const h2 = await identity.deriveHandle('station-001');
    expect(h1.getPublicKey()).toEqual(h2.getPublicKey());
    expect(h1.getId()).toBe(h2.getId());
  });
});

describe('Phase 0: identity.deriveSubHandle === handle.deriveSubHandle', () => {
  it('identity.deriveSubHandle("S","X") === handle.deriveSubHandle("x") same pubkey', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('S');
    const subFromIdentity = await identity.deriveSubHandle('S', 'X');
    const subFromHandle = await handle.deriveSubHandle('x');
    expect(subFromIdentity.getPublicKey()).toEqual(subFromHandle.getPublicKey());
    expect(subFromIdentity.getId()).toBe(subFromHandle.getId());
  });
});

describe('Phase 0: SubHandle is leaf', () => {
  it('subhandle.deriveSubHandle("anything") throws', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const sub = await identity.deriveSubHandle('station', 'connector');
    await expect(sub.deriveSubHandle('anything')).rejects.toThrow(/leaf|MAX_DEPTH/i);
  });
});

describe('Phase 0: Session.create with ttl=86400 verifies immediately', () => {
  it('verifyStateless passes right away (not rejected as future-dated)', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('phase0-session');
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

describe('Phase 0: Tampering payload → Invalid signature', () => {
  it('tampered payload is rejected with signature error', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('tamper-phase0');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read', 'write'],
      ttl: 3600,
    });

    const parts = session.token.split('.');
    const payloadB64 = parts[0];
    const signatureB64 = parts[1];

    // Decode payload
    let base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binary = atob(base64);
    const payloadBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      payloadBytes[i] = binary.charCodeAt(i);
    }

    const payloadObj = JSON.parse(
      new TextDecoder().decode(payloadBytes)
    ) as Record<string, unknown>;

    payloadObj.scp = ['read']; // Tamper

    const modifiedPayload = JSON.stringify(payloadObj);
    const modifiedPayloadBytes = new TextEncoder().encode(modifiedPayload);
    const modifiedPayloadB64 = btoa(String.fromCharCode(...modifiedPayloadBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tamperedToken = `${modifiedPayloadB64}.${signatureB64}`;

    await expect(
      Session.verifyStateless(tamperedToken, identity, 'app')
    ).rejects.toThrow(/signature/i);
  });
});

describe('Phase 0 amendment: iat is required', () => {
  it('token without iat field is rejected', async () => {
    const identity = await Identity.fromSeed(testSeed);
    const handle = await identity.deriveHandle('iat-test');
    const session = await Session.create(handle, {
      audience: 'app',
      scopes: ['read'],
      ttl: 3600,
    });

    // Удаляем iat из payload и пересобираем токен.
    // Подпись станет невалидной, но проверка required fields
    // выполняется РАНЬШЕ signature-проверки, поэтому ожидаем
    // именно 'missing required fields'.
    const [payloadB64, signatureB64] = session.token.split('.');
    let base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binary = atob(base64);
    const payloadBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      payloadBytes[i] = binary.charCodeAt(i);
    }
    const obj = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
    delete obj.iat;
    const modified = new TextEncoder().encode(JSON.stringify(obj));
    const modifiedB64 = btoa(String.fromCharCode(...modified))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tokenNoIat = `${modifiedB64}.${signatureB64}`;

    await expect(
      Session.verifyStateless(tokenNoIat, identity, 'app')
    ).rejects.toThrow(/missing required fields/i);
  });
});
