// test/attestation-issuance.spec.ts
import { describe, it, expect } from 'vitest';
import { Identity, Attestation, AttestationError } from '../src/index.js';
import { base64urlEncode, base64urlDecode } from '../src/util.js';

const testSeed = new Uint8Array(32).fill(42);
const identity = await Identity.fromSeed(testSeed);

describe('Attestation issuance: attestHandle', () => {
  it('binds derived handle key to name and grant', async () => {
    const handle = await identity.deriveHandle('station-001');
    const att = await identity.attestHandle('Station-001', {
      audiences: ['app.com'],
      scopes: ['charge:start'],
      maxSessionTtl: 3600,
    });

    expect(att.payload.subjectName).toBe('station-001');
    expect(att.payload.subjectId).toBe(base64urlEncode(handle.getPublicKey()));

    const validIdentity = await Attestation.verifySignature(att.token, identity.getPublicKey());
    expect(validIdentity).toBe(true);

    const validHandle = await Attestation.verifySignature(att.token, handle.getPublicKey());
    expect(validHandle).toBe(false);
  });
});

describe('Attestation issuance: attestSubHandle', () => {
  it('binds derived subhandle key to name and grant', async () => {
    const handle = await identity.deriveHandle('station-001');
    const att = await handle.attestSubHandle('Connector-CCS', {
      scopes: ['charge:start', 'charge:stop'],
      maxSessionTtl: 7200,
    });

    expect(att.payload.subjectName).toBe('connector-ccs');

    const valid = await Attestation.verifySignature(att.token, handle.getPublicKey());
    expect(valid).toBe(true);
  });
});

describe('Attestation issuance: binding to derivation', () => {
  it('subjectId matches identity.deriveSubHandle path', async () => {
    const handle = await identity.deriveHandle('station-001');
    const att = await handle.attestSubHandle('connector-ccs', {
      scopes: ['charge:start'],
      maxSessionTtl: 7200,
    });

    const expectedSub = await identity.deriveSubHandle('station-001', 'connector-ccs');
    expect(att.payload.subjectId).toBe(base64urlEncode(expectedSub.getPublicKey()));
  });
});

describe('Attestation issuance: opts pass-through', () => {
  it('jti, now, ttlSeconds are passed to payload', async () => {
    const grant = { scopes: ['read'], maxSessionTtl: 3600 };
    const att = await identity.attestHandle('x', grant, {
      jti: 'fixed',
      now: 1700000000,
      ttlSeconds: 600,
    });

    expect(att.payload.iat).toBe(1700000000);
    expect(att.payload.exp).toBe(1700000600);
    expect(att.payload.jti).toBe('fixed');
  });
});

describe('Attestation issuance: grant pass-through', () => {
  it('audiences and subNamePatterns preserved', async () => {
    const grant = {
      audiences: ['a.com'],
      scopes: ['read'],
      maxSessionTtl: 3600,
      subNamePatterns: ['c-*'],
    };
    const att = await identity.attestHandle('x', grant);
    const decoded = Attestation.decode(att.token);

    expect(decoded.grant.audiences).toEqual(['a.com']);
    expect(decoded.grant.subNamePatterns).toEqual(['c-*']);
  });
});

describe('Attestation issuance: chain A→B', () => {
  it('attestation chain verifies correctly', async () => {
    const grantA = { scopes: ['read'], maxSessionTtl: 3600 };
    const grantB = { scopes: ['charge:start'], maxSessionTtl: 7200 };

    const A = await identity.attestHandle('station-001', grantA);
    const handle = await identity.deriveHandle('station-001');
    const B = await handle.attestSubHandle('connector-1', grantB);

    const validA = await Attestation.verifySignature(A.token, identity.getPublicKey());
    expect(validA).toBe(true);

    const subHandlePub = base64urlDecode(A.payload.subjectId);
    const validB = await Attestation.verifySignature(B.token, subHandlePub);
    expect(validB).toBe(true);
  });
});

describe('Attestation issuance: errors propagate', () => {
  it('attestHandle with invalid name throws', async () => {
    await expect(
      identity.attestHandle('a/b', { scopes: ['read'], maxSessionTtl: 3600 })
    ).rejects.toThrow();
  });

  it('attestHandle with maxSessionTtl: 0 throws AttestationError', async () => {
    const err = await identity.attestHandle('ok', { scopes: ['s'], maxSessionTtl: 0 }).catch(e => e);
    expect(err).toBeInstanceOf(AttestationError);
    expect((err as AttestationError).code).toBe('MALFORMED');
  });
});
