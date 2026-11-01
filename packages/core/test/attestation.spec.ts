// Attestation unit tests
import { describe, it, expect } from 'vitest';
import {
  Attestation,
  ATTESTATION_TYPE,
  ATTESTATION_MAX_PAYLOAD,
} from '../src/index.js';
import { base64urlDecode, base64urlEncode } from '../src/util.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  expectAttestationError,
  expectAttestationErrorSync,
  signerFromKey,
  tamperPayload,
  tamperPayloadJson,
} from './test-utils.js';

describe('Attestation: roundtrip issue → decode', () => {
  it('all payload fields match; subjectName normalized', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);

    const att = await Attestation.issue(
      signerFromKey(signerKey),
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
      signerFromKey(signerKey), signerPub, 'test-handle', grant, opts
    );
    const att2 = await Attestation.issue(
      signerFromKey(signerKey), signerPub, 'test-handle', grant, opts
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
      signerFromKey(signerKey), signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600, subNamePatterns: ['connector-*'] }
    );
    expect(att).toBeTruthy();
  });

  it('["*"] ok', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);
    const att = await Attestation.issue(
      signerFromKey(signerKey), signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600, subNamePatterns: ['*'] }
    );
    expect(att).toBeTruthy();
  });

  it('["a*b"] → MALFORMED/FORMAT', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);
    await expectAttestationError(
      Attestation.issue(
        signerFromKey(signerKey), signerPub, 'test',
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
        signerFromKey(signerKey), signerPub, 'test',
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
      signerFromKey(signerKey), signerPub, 'test',
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
      signerFromKey(signerKey), signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600 }
    );

    const valid = await Attestation.verifySignature(att.token, attackerPub);
    expect(valid).toBe(false);
  });

  it('malformed signature length → false, not throw', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);
    const att = await Attestation.issue(
      signerFromKey(signerKey), signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600 }
    );
    const parts = att.token.split('.');
    const shortSig = base64urlEncode(crypto.getRandomValues(new Uint8Array(10)));
    const valid = await Attestation.verifySignature(
      `${parts[0]}.${shortSig}`, signerPub
    );
    expect(valid).toBe(false);
  });

  it('structurally invalid token still throws MALFORMED (not swallowed to false)', async () => {
    const signerPub = ed25519.getPublicKey(new Uint8Array(32));
    await expectAttestationError(
      Attestation.verifySignature('no-dot-here', signerPub),
      'MALFORMED', 'FORMAT'
    );
  });

  it('tampered payload → false', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);

    const att = await Attestation.issue(
      signerFromKey(signerKey), signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600 }
    );

    const tamperedToken = tamperPayload(att.token, (obj) => {
      (obj.grant as Record<string, unknown>).scopes = ['write'];
    });

    const valid = await Attestation.verifySignature(tamperedToken, signerPub);
    expect(valid).toBe(false);
  });
});

describe('Attestation: subjectPublicKey length', () => {
  it('16 bytes → throw /32 bytes/', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const shortPub = new Uint8Array(16).fill(1);

    await expectAttestationError(
      Attestation.issue(
        signerFromKey(signerKey), shortPub, 'test',
        { scopes: ['read'], maxSessionTtl: 3600 }
      ),
      'MALFORMED', 'FORMAT'
    );
  });
});

describe('Attestation.issue: grant validation contract', () => {
  it('grant.scopes not an array → MALFORMED/FORMAT', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    await expectAttestationError(
      Attestation.issue(
        signerFromKey(signerKey), signerKey, 'test',
        { scopes: 'read' as unknown as string[], maxSessionTtl: 3600 }
      ),
      'MALFORMED', 'FORMAT'
    );
  });

  it('grant.maxSessionTtl = 0 → MALFORMED/FORMAT', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    await expectAttestationError(
      Attestation.issue(
        signerFromKey(signerKey), signerKey, 'test',
        { scopes: ['read'], maxSessionTtl: 0 }
      ),
      'MALFORMED', 'FORMAT'
    );
  });

  it('grant.audiences not an array → MALFORMED/FORMAT', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    await expectAttestationError(
      Attestation.issue(
        signerFromKey(signerKey), signerKey, 'test',
        {
          scopes: ['read'], maxSessionTtl: 3600,
          audiences: 'app' as unknown as string[],
        }
      ),
      'MALFORMED', 'FORMAT'
    );
  });

  it('grant.subNamePatterns not an array → MALFORMED/FORMAT', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    await expectAttestationError(
      Attestation.issue(
        signerFromKey(signerKey), signerKey, 'test',
        {
          scopes: ['read'], maxSessionTtl: 3600,
          subNamePatterns: 'connector-*' as unknown as string[],
        }
      ),
      'MALFORMED', 'FORMAT'
    );
  });
});

describe('Attestation: no undefined fields in serialization', () => {
  it('grant without audiences/subNamePatterns → keys absent in JSON', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);

    const att = await Attestation.issue(
      signerFromKey(signerKey), signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600 }
    );

    const parts = att.token.split('.');
    const payloadBytes = base64urlDecode(parts[0]);
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
    const grant = parsed.grant as Record<string, unknown>;

    expect(grant.audiences).toBeUndefined();
    expect(grant.subNamePatterns).toBeUndefined();
  });

  it('grant with audiences = [] → key present and equals []', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);

    const att = await Attestation.issue(
      signerFromKey(signerKey), signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600, audiences: [] }
    );

    const parts = att.token.split('.');
    const payloadBytes = base64urlDecode(parts[0]);
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

describe('Attestation: decode rejects non-finite iat/exp and exp <= iat', () => {
  const basePayload = {
    typ: ATTESTATION_TYPE,
    subjectName: 'test',
    subjectId: 'dGVzdA',
    grant: { scopes: ['read'], maxSessionTtl: 3600 },
    iat: 1000000000,
    exp: 1000003600,
    jti: 'test-jti',
  };

  // Synthetic fixtures — free encoder (btoa) is the independent
  // test-oracle (write-side fixture building; read-side uses the SUT codec).
  function decodeRawPayload(raw: string): void {
    const payloadB64 = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    Attestation.decode(`${payloadB64}.fakesig`);
  }

  it('finite iat < exp → still decodes (no regression)', () => {
    const payloadB64 = btoa(JSON.stringify(basePayload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const decoded = Attestation.decode(`${payloadB64}.fakesig`);
    expect(decoded.iat).toBe(1000000000);
    expect(decoded.exp).toBe(1000003600);
  });

  it('exp < iat → MALFORMED/FORMAT', () => {
    expectAttestationErrorSync(
      () => decodeRawPayload(JSON.stringify({ ...basePayload, exp: 999999000 })),
      'MALFORMED', 'FORMAT'
    );
  });

  it('exp === iat → MALFORMED/FORMAT', () => {
    expectAttestationErrorSync(
      () => decodeRawPayload(JSON.stringify({ ...basePayload, exp: 1000000000 })),
      'MALFORMED', 'FORMAT'
    );
  });

  it('exp: 1e999 (parses as Infinity) → MALFORMED/FORMAT', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);
    const att = await Attestation.issue(
      signerFromKey(signerKey), signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600 },
      { jti: 'inf-exp', now: 1700000000, ttlSeconds: 3600 }
    );
    // JSON.stringify cannot emit Infinity — patch the raw payload JSON
    // with the 1e999 literal via the shared helper (same style as
    // session.spec); unchecked, `now > exp + skew` would be false
    // forever (fail-open expiry)
    const tampered = tamperPayloadJson(att.token, (json) => json.replace(/"exp":\d+/, '"exp":1e999'));
    expectAttestationErrorSync(() => Attestation.decode(tampered), 'MALFORMED', 'FORMAT');
  });

  it('iat: 1e999 (parses as Infinity) → MALFORMED/FORMAT', async () => {
    const signerKey = crypto.getRandomValues(new Uint8Array(32));
    const signerPub = ed25519.getPublicKey(signerKey);
    const att = await Attestation.issue(
      signerFromKey(signerKey), signerPub, 'test',
      { scopes: ['read'], maxSessionTtl: 3600 },
      { jti: 'inf-iat', now: 1700000000, ttlSeconds: 3600 }
    );
    const tampered = tamperPayloadJson(att.token, (json) => json.replace(/"iat":\d+/, '"iat":1e999'));
    expectAttestationErrorSync(() => Attestation.decode(tampered), 'MALFORMED', 'FORMAT');
  });
});
