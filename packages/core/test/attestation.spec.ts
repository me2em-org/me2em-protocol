// test/attestation.test.ts
import { describe, it, expect } from 'vitest';
import {
  Attestation,
  AttestationError,
  ATTESTATION_TYPE,
  ATTESTATION_MAX_PAYLOAD,
} from '../src/index.js';
import { base64urlEncode } from '../src/util.js';
import { ed25519 } from '@noble/curves/ed25519.js';

const testSeed = new Uint8Array(32).fill(42);

async function expectAttestationError(
  promise: Promise<unknown>, code: string, level: string
) {
  try { await promise; expect.unreachable('should have thrown'); }
  catch (e) {
    expect(e).toBeInstanceOf(AttestationError);
    expect((e as AttestationError).code).toBe(code);
    expect((e as AttestationError).level).toBe(level);
  }
}

function expectAttestationErrorSync(
  fn: () => unknown, code: string, level: string
) {
  try { fn(); expect.unreachable('should have thrown'); }
  catch (e) {
    expect(e).toBeInstanceOf(AttestationError);
    expect((e as AttestationError).code).toBe(code);
    expect((e as AttestationError).level).toBe(level);
  }
}

describe('Attestation: roundtrip issue → decode', () => {
  it('all payload fields match; subjectName normalized', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);

    const att = await Attestation.issue(
      signerKey,
      signerPub,
      'Station-001',
      { scopes: ['read'], maxSessionTtl: 3600 }
    );

    const decoded = Attestation.decode(att.token);
    expect(decoded.typ).toBe(ATTESTATION_TYPE);
    expect(decoded.subjectName).toBe('station-001');
    expect(decoded.subjectId).toBe(base64urlEncode(signerPub));
    expect(decoded.grant.scopes).toEqual(['read']);
    expect(decoded.grant.maxSessionTtl).toBe(3600);
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
    expect(typeof decoded.jti).toBe('string');
  });
});

describe('Attestation: determinism', () => {
  it('two issue calls with same inputs produce identical tokens', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);

    const opts = { jti: 'fixed', now: 1700000000 };
    const grant = { scopes: ['read', 'write'], maxSessionTtl: 7200 };

    const att1 = await Attestation.issue(
      signerKey, signerPub, 'test-handle', grant, opts
    );
    const att2 = await Attestation.issue(
      signerKey, signerPub, 'test-handle', grant, opts
    );

    expect(att1.token).toBe(att2.token);
    expect(att1.token.split('.')).toHaveLength(2);
  });
});

describe('Attestation: pattern validation in issue', () => {
  it('["connector-*"] ok', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);
    const att = await Attestation.issue(
      signerKey, signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600, subNamePatterns: ['connector-*'] }
    );
    expect(att).toBeTruthy();
  });

  it('["*"] ok', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);
    const att = await Attestation.issue(
      signerKey, signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600, subNamePatterns: ['*'] }
    );
    expect(att).toBeTruthy();
  });

  it('["a*b"] → MALFORMED/FORMAT', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);
    await expectAttestationError(
      Attestation.issue(
        signerKey, signerPub, 'test',
        { scopes: ['read'], maxSessionTtl: 3600, subNamePatterns: ['a*b'] }
      ),
      'MALFORMED', 'FORMAT'
    );
  });

  it('["*b"] → MALFORMED/FORMAT', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);
    await expectAttestationError(
      Attestation.issue(
        signerKey, signerPub, 'test',
        { scopes: ['read'], maxSessionTtl: 3600, subNamePatterns: ['*b'] }
      ),
      'MALFORMED', 'FORMAT'
    );
  });
});

describe('Attestation: matchNamePattern', () => {
  it('("connector-1", ["connector-*"]) → true', () => {
    expect(Attestation.matchNamePattern('connector-1', ['connector-*'])).toBe(true);
  });

  it('("meter-1", ["connector-*"]) → false', () => {
    expect(Attestation.matchNamePattern('meter-1', ['connector-*'])).toBe(false);
  });

  it('("anything", ["*"]) → true', () => {
    expect(Attestation.matchNamePattern('anything', ['*'])).toBe(true);
  });

  it('("connector-1", ["connector-1"]) → true (exact)', () => {
    expect(Attestation.matchNamePattern('connector-1', ['connector-1'])).toBe(true);
  });

  it('("connector-1", ["meter-*","connector-*"]) → true (any match)', () => {
    expect(Attestation.matchNamePattern('connector-1', ['meter-*', 'connector-*'])).toBe(true);
  });
});

describe('Attestation: decode rejects malformed', () => {
  it('rejects "no-dot-here"', () => {
    expectAttestationErrorSync(
      () => Attestation.decode('no-dot-here'),
      'MALFORMED', 'FORMAT'
    );
  });

  it('rejects "bad chars!.sig"', () => {
    expectAttestationErrorSync(
      () => Attestation.decode('bad chars!.sig'),
      'MALFORMED', 'FORMAT'
    );
  });

  it('rejects payload > 2048 bytes', () => {
    const bigPayload = JSON.stringify({
      typ: ATTESTATION_TYPE,
      subjectName: 'test',
      subjectId: 'dGVzdA',
      grant: { scopes: ['read'], maxSessionTtl: 3600 },
      iat: 1700000000,
      exp: 1700003600,
      jti: 'test-jti',
      fake: 'x'.repeat(3000),
    });
    const payloadB64 = btoa(bigPayload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.fakesig`;
    expectAttestationErrorSync(
      () => Attestation.decode(token),
      'MALFORMED', 'FORMAT'
    );
  });

  it('rejects non-JSON payload', () => {
    const payloadB64 = btoa('not json{{{').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.fakesig`;
    expectAttestationErrorSync(
      () => Attestation.decode(token),
      'MALFORMED', 'FORMAT'
    );
  });

  it('rejects valid JSON without jti', () => {
    const payload = JSON.stringify({
      typ: ATTESTATION_TYPE,
      subjectName: 'test',
      subjectId: 'dGVzdA',
      grant: { scopes: ['read'], maxSessionTtl: 3600 },
      iat: 1700000000,
      exp: 1700003600,
    });
    const payloadB64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.fakesig`;
    expectAttestationErrorSync(
      () => Attestation.decode(token),
      'MALFORMED', 'FORMAT'
    );
  });

  it('rejects typ !== ATTESTATION_TYPE', () => {
    const payload = JSON.stringify({
      typ: 'wrong/type',
      subjectName: 'test',
      subjectId: 'dGVzdA',
      grant: { scopes: ['read'], maxSessionTtl: 3600 },
      iat: 1700000000,
      exp: 1700003600,
      jti: 'test-jti',
    });
    const payloadB64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.fakesig`;
    expectAttestationErrorSync(
      () => Attestation.decode(token),
      'MALFORMED', 'FORMAT'
    );
  });

  it('rejects maxSessionTtl: 0', () => {
    const payload = JSON.stringify({
      typ: ATTESTATION_TYPE,
      subjectName: 'test',
      subjectId: 'dGVzdA',
      grant: { scopes: ['read'], maxSessionTtl: 0 },
      iat: 1700000000,
      exp: 1700003600,
      jti: 'test-jti',
    });
    const payloadB64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.fakesig`;
    expectAttestationErrorSync(
      () => Attestation.decode(token),
      'MALFORMED', 'FORMAT'
    );
  });

  it('rejects maxSessionTtl: -5', () => {
    const payload = JSON.stringify({
      typ: ATTESTATION_TYPE,
      subjectName: 'test',
      subjectId: 'dGVzdA',
      grant: { scopes: ['read'], maxSessionTtl: -5 },
      iat: 1700000000,
      exp: 1700003600,
      jti: 'test-jti',
    });
    const payloadB64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.fakesig`;
    expectAttestationErrorSync(
      () => Attestation.decode(token),
      'MALFORMED', 'FORMAT'
    );
  });

  it('rejects maxSessionTtl: NaN (JSON.stringify → null, type check catches)', () => {
    const payload = JSON.stringify({
      typ: ATTESTATION_TYPE,
      subjectName: 'test',
      subjectId: 'dGVzdA',
      grant: { scopes: ['read'], maxSessionTtl: NaN },
      iat: 1700000000,
      exp: 1700003600,
      jti: 'test-jti',
    });
    const payloadB64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.fakesig`;
    expectAttestationErrorSync(
      () => Attestation.decode(token),
      'MALFORMED', 'FORMAT'
    );
  });
});

describe('Attestation: verifySignature', () => {
  it('valid signature → true', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);

    const att = await Attestation.issue(
      signerKey, signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600 }
    );

    const valid = await Attestation.verifySignature(att.token, signerPub);
    expect(valid).toBe(true);
  });

  it('wrong key → false', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);

    const attackerKey = crypto.getRandomValues(new Uint8Array(32));
    const attackerPub = ed25519.getPublicKey(attackerKey);

    const att = await Attestation.issue(
      signerKey, signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600 }
    );

    const valid = await Attestation.verifySignature(att.token, attackerPub);
    expect(valid).toBe(false);
  });

  it('tampered payload → false', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);

    const att = await Attestation.issue(
      signerKey, signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600 }
    );

    const parts = att.token.split('.');
    const payloadB64 = parts[0];
    const signatureB64 = parts[1];

    let base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binary = atob(base64);
    const payloadBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      payloadBytes[i] = binary.charCodeAt(i);
    }
    const obj = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
    (obj.grant as Record<string, unknown>).scopes = ['write'];
    const modified = new TextEncoder().encode(JSON.stringify(obj));
    const modifiedB64 = btoa(String.fromCharCode(...modified))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tamperedToken = `${modifiedB64}.${signatureB64}`;

    const valid = await Attestation.verifySignature(tamperedToken, signerPub);
    expect(valid).toBe(false);
  });
});

describe('Attestation: subjectPublicKey length', () => {
  it('16 bytes → throw /32 bytes/', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const shortPub = new Uint8Array(16).fill(1);

    await expect(
      Attestation.issue(
        signerKey, shortPub, 'test',
        { scopes: ['read'], maxSessionTtl: 3600 }
      )
    ).rejects.toThrow(/32 bytes/);
  });
});

describe('Attestation: no undefined fields in serialization', () => {
  it('grant without audiences/subNamePatterns → keys absent in JSON', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);

    const att = await Attestation.issue(
      signerKey, signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600 }
    );

    const parts = att.token.split('.');
    let base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binary = atob(base64);
    const payloadBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      payloadBytes[i] = binary.charCodeAt(i);
    }
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
    const grant = parsed.grant as Record<string, unknown>;

    expect(grant.audiences).toBeUndefined();
    expect(grant.subNamePatterns).toBeUndefined();
  });

  it('grant with audiences = [] → key present and equals []', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);

    const att = await Attestation.issue(
      signerKey, signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600, audiences: [] }
    );

    const parts = att.token.split('.');
    let base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binary = atob(base64);
    const payloadBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      payloadBytes[i] = binary.charCodeAt(i);
    }
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
    const grant = parsed.grant as Record<string, unknown>;

    expect(grant.audiences).toEqual([]);
  });
});

describe('Attestation: decode does not check time', () => {
  it('past iat/exp → decode passes', () => {
    const payload = JSON.stringify({
      typ: ATTESTATION_TYPE,
      subjectName: 'test',
      subjectId: 'dGVzdA',
      grant: { scopes: ['read'], maxSessionTtl: 3600 },
      iat: 1000000000,
      exp: 1000003600,
      jti: 'test-jti',
    });
    const payloadB64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${payloadB64}.fakesig`;

    const decoded = Attestation.decode(token);
    expect(decoded.iat).toBe(1000000000);
    expect(decoded.exp).toBe(1000003600);
  });
});
