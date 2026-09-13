// test/attested-session.spec.ts
import { describe, it, expect } from 'vitest';
import { Identity, Attestation, AttestationError, Session, type RevocationChecker } from '../src/index.js';
import { base64urlEncode, base64urlDecode } from '../src/util.js';

const testSeed = new Uint8Array(32).fill(42);
const identity = await Identity.fromSeed(testSeed);

async function expectCode(
  promise: Promise<unknown>, code: string, level: string
) {
  try { await promise; expect.unreachable('should have thrown'); }
  catch (e) {
    expect(e).toBeInstanceOf(AttestationError);
    expect((e as AttestationError).code).toBe(code);
    expect((e as AttestationError).level).toBe(level);
  }
}

class MockRevocationChecker implements RevocationChecker {
  private revoked = new Set<string>();
  revoke(jti: string) { this.revoked.add(jti); }
  async isRevoked(jti: string) { return this.revoked.has(jti); }
}

const grantA = {
  audiences: ['app.com'],
  scopes: ['charge:start', 'charge:stop', 'charge:status'],
  maxSessionTtl: 7200,
  subNamePatterns: ['connector-*', 'meter-*'],
};
const grantB = {
  audiences: ['app.com'],
  scopes: ['charge:start', 'charge:stop'],
  maxSessionTtl: 7200,
};
const rootPub = identity.getPublicKey();

async function makeHandleSession() {
  const handle = await identity.deriveHandle('station-001');
  const A = await identity.attestHandle('station-001', grantA);
  const session = await Session.create(handle, {
    audience: 'app.com', scopes: ['charge:start'], ttl: 3600,
  });
  return { handle, A, session };
}

async function makeSubSession(subName = 'connector-ccs') {
  const handle = await identity.deriveHandle('station-001');
  const A = await identity.attestHandle('station-001', grantA);
  const sub = await handle.deriveSubHandle(subName);
  const B = await handle.attestSubHandle(subName, grantB);
  const session = await Session.create(sub, {
    audience: 'app.com', scopes: ['charge:start'], ttl: 3600,
  });
  return { handle, sub, A, B, session };
}

describe('verifyAttested: positive cases', () => {
  it('1. Handle-сессия: верификация с цепочкой из одной аттестации', async () => {
    const { A, session } = await makeHandleSession();
    const verified = await Session.verifyAttested(
      session.token, rootPub, [A.token], 'app.com'
    );
    expect(verified.handleName).toBe('station-001');
    expect(verified.scopes).toEqual(['charge:start']);
    expect(verified.path).toBeUndefined();
  });

  it('2. SubHandle-сессия: верификация с цепочкой из двух аттестаций', async () => {
    const { A, B, session } = await makeSubSession();
    const verified = await Session.verifyAttested(
      session.token, rootPub, [A.token, B.token], 'app.com'
    );
    expect(verified.handleName).toBe('connector-ccs');
    expect(verified.path).toEqual(['station-001', 'connector-ccs']);
  });
});

describe('verifyAttested: negative cases', () => {
  it('3. TTL сессии превышает grantB.maxSessionTtl', async () => {
    const { A, B, sub } = await makeSubSession();
    const session = await Session.create(sub, {
      audience: 'app.com', scopes: ['charge:start'], ttl: 8000,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'app.com'),
      'TTL_EXCEEDED', 'SESSION'
    );
  });

  it('4. Scope сессии вне гранта G', async () => {
    const { A, B, sub } = await makeSubSession();
    const session = await Session.create(sub, {
      audience: 'app.com', scopes: ['charge:start', 'billing:admin'], ttl: 3600,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'app.com'),
      'SCOPE_EXCEEDED', 'SESSION'
    );
  });

  it('5. Вложенность: grantB содержит scope вне grantA', async () => {
    const handle = await identity.deriveHandle('station-001');
    const A = await identity.attestHandle('station-001', grantA);
    const grantBExtra = {
      audiences: ['app.com'],
      scopes: ['charge:start', 'meter:read'],
      maxSessionTtl: 7200,
    };
    const sub = await handle.deriveSubHandle('connector-ccs');
    const B = await handle.attestSubHandle('connector-ccs', grantBExtra);
    const session = await Session.create(sub, {
      audience: 'app.com', scopes: ['charge:start'], ttl: 3600,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'app.com'),
      'SCOPE_EXCEEDED', 'ROOT'
    );
  });

  it('6. Вложенность TTL: grantB.maxSessionTtl > grantA.maxSessionTtl', async () => {
    const handle = await identity.deriveHandle('station-001');
    const A = await identity.attestHandle('station-001', grantA);
    const grantBHigh = {
      audiences: ['app.com'],
      scopes: ['charge:start'],
      maxSessionTtl: 8000,
    };
    const sub = await handle.deriveSubHandle('connector-ccs');
    const B = await handle.attestSubHandle('connector-ccs', grantBHigh);
    const session = await Session.create(sub, {
      audience: 'app.com', scopes: ['charge:start'], ttl: 3600,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'app.com'),
      'TTL_EXCEEDED', 'ROOT'
    );
  });

  it('7. Имя субхэндла вне wildcard паттернов', async () => {
    const handle = await identity.deriveHandle('station-001');
    const grantAPatterns = {
      audiences: ['app.com'],
      scopes: ['charge:start'],
      maxSessionTtl: 7200,
      subNamePatterns: ['connector-*', 'meter-*'],
    };
    const A = await identity.attestHandle('station-001', grantAPatterns);
    const sub = await handle.deriveSubHandle('battery-01');
    const grantBPatterns = {
      audiences: ['app.com'],
      scopes: ['charge:start'],
      maxSessionTtl: 7200,
    };
    const B = await handle.attestSubHandle('battery-01', grantBPatterns);
    const session = await Session.create(sub, {
      audience: 'app.com', scopes: ['charge:start'], ttl: 3600,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'app.com'),
      'NAME_NOT_PERMITTED', 'ROOT'
    );
  });

  it('8. A подписана чужим ключом', async () => {
    const handle = await identity.deriveHandle('station-001');
    const handlePub = handle.getPublicKey();
    const otherSeed = new Uint8Array(32).fill(99);
    const A = await Attestation.issue(
      otherSeed,
      handlePub,
      'station-001',
      grantA
    );
    const session = await Session.create(handle, {
      audience: 'app.com', scopes: ['charge:start'], ttl: 3600,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token], 'app.com'),
      'BAD_SIGNATURE', 'ROOT'
    );
  });

  it('9. B подписана чужим ключом', async () => {
    const handle = await identity.deriveHandle('station-001');
    const A = await identity.attestHandle('station-001', grantA);
    const sub = await handle.deriveSubHandle('connector-ccs');
    const subPub = sub.getPublicKey();
    const otherSeed = new Uint8Array(32).fill(77);
    const B = await Attestation.issue(
      otherSeed,
      subPub,
      'connector-ccs',
      grantB
    );
    const session = await Session.create(sub, {
      audience: 'app.com', scopes: ['charge:start'], ttl: 3600,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'app.com'),
      'BAD_SIGNATURE', 'HANDLE_ATTESTATION'
    );
  });

  it('10. Истёкшая A', async () => {
    const now = Math.floor(Date.now() / 1000);
    const handle = await identity.deriveHandle('station-001');
    const expiredA = await identity.attestHandle('station-001', grantA, {
      now: now - 7200, ttlSeconds: 3600,
    });
    const session = await Session.create(handle, {
      audience: 'app.com', scopes: ['charge:start'], ttl: 3600,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [expiredA.token], 'app.com'),
      'EXPIRED', 'ROOT'
    );
  });

  it('11. A из будущего', async () => {
    const now = Math.floor(Date.now() / 1000);
    const futureNow = now + 100000;
    const handle = await identity.deriveHandle('station-001');
    const futureA = await identity.attestHandle('station-001', grantA, {
      now: futureNow, ttlSeconds: 3600,
    });
    const session = await Session.create(handle, {
      audience: 'app.com', scopes: ['charge:start'], ttl: 3600,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [futureA.token], 'app.com'),
      'NOT_YET_VALID', 'ROOT'
    );
  });

  it('12. SESSION_OUTLIVES_ATTESTATION', async () => {
    const now = Math.floor(Date.now() / 1000);
    const handle = await identity.deriveHandle('station-001');
    const grantALarge = {
      audiences: ['app.com'],
      scopes: ['charge:start', 'charge:stop', 'charge:status'],
      maxSessionTtl: 250000,
      subNamePatterns: ['connector-*', 'meter-*'],
    };
    const grantBLarge = {
      audiences: ['app.com'],
      scopes: ['charge:start', 'charge:stop'],
      maxSessionTtl: 250000,
    };
    const A = await identity.attestHandle('station-001', grantALarge, {
      now, ttlSeconds: 100000,
    });
    const sub = await handle.deriveSubHandle('connector-ccs');
    const B = await handle.attestSubHandle('connector-ccs', grantBLarge, {
      now, ttlSeconds: 100000,
    });
    const session = await Session.create(sub, {
      audience: 'app.com', scopes: ['charge:start'], ttl: 200000,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'app.com'),
      'SESSION_OUTLIVES_ATTESTATION', 'SESSION'
    );
  });

  it('13. Ревокация: A, B, session', async () => {
    const { A, B, session } = await makeSubSession();

    const mockA = new MockRevocationChecker();
    mockA.revoke(A.jti);
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'app.com', mockA),
      'REVOKED', 'ROOT'
    );

    const mockB = new MockRevocationChecker();
    mockB.revoke(B.jti);
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'app.com', mockB),
      'REVOKED', 'HANDLE_ATTESTATION'
    );

    const mockS = new MockRevocationChecker();
    mockS.revoke(session.sessionId);
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'app.com', mockS),
      'REVOKED', 'SESSION'
    );
  });

  it('14. SUBJECT_MISMATCH: B от другого субхэндла', async () => {
    const handle = await identity.deriveHandle('station-001');
    const A = await identity.attestHandle('station-001', grantA);

    const sub1 = await handle.deriveSubHandle('connector-1');
    const sub2 = await handle.deriveSubHandle('connector-ccs');
    const B = await handle.attestSubHandle('connector-ccs', grantB);

    const payloadBytes = new TextEncoder().encode(JSON.stringify({
      hId: sub1.getId(),
      hNm: 'connector-1',
      hPath: ['station-001', 'connector-ccs'],
      aud: 'app.com',
      scp: ['charge:start'],
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      jti: 'subject-mismatch-test',
    }));
    const signature = await sub1.sign(payloadBytes);
    const payloadB64 = base64urlEncode(payloadBytes);
    const signatureB64 = base64urlEncode(signature);
    const token = `${payloadB64}.${signatureB64}`;

    await expectCode(
      Session.verifyAttested(token, rootPub, [A.token, B.token], 'app.com'),
      'SUBJECT_MISMATCH', 'SUB_ATTESTATION'
    );
  });

  it('15. CHAIN_INCOMPLETE: subhandle с chain длины 1, handle с chain длины 2', async () => {
    const { A, sub, session: subSession } = await makeSubSession();
    await expectCode(
      Session.verifyAttested(subSession.token, rootPub, [A.token], 'app.com'),
      'CHAIN_INCOMPLETE', 'FORMAT'
    );

    const { A: hA, session: hSession } = await makeHandleSession();
    const subForExtra = await (await identity.deriveHandle('station-001')).deriveSubHandle('extra');
    const extraB = await (await identity.deriveHandle('station-001')).attestSubHandle('extra', grantB);
    await expectCode(
      Session.verifyAttested(hSession.token, rootPub, [hA.token, extraB.token], 'app.com'),
      'CHAIN_INCOMPLETE', 'FORMAT'
    );
  });

  it('16. PATH_MISMATCH: hPath длины 1', async () => {
    const handle = await identity.deriveHandle('station-001');
    const A = await identity.attestHandle('station-001', grantA);
    const sub = await handle.deriveSubHandle('connector-ccs');

    const payloadBytes = new TextEncoder().encode(JSON.stringify({
      hId: sub.getId(),
      hNm: 'connector-ccs',
      hPath: ['station-001'],
      aud: 'app.com',
      scp: ['charge:start'],
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      jti: 'path-mismatch-test',
    }));
    const signature = await sub.sign(payloadBytes);
    const payloadB64 = base64urlEncode(payloadBytes);
    const signatureB64 = base64urlEncode(signature);
    const token = `${payloadB64}.${signatureB64}`;

    await expectCode(
      Session.verifyAttested(token, rootPub, [A.token], 'app.com'),
      'PATH_MISMATCH', 'SESSION'
    );
  });

  it('17. audiences в гранте: сессия на другую аудиторию', async () => {
    const handle = await identity.deriveHandle('station-001');
    const grantANoAud = {
      scopes: ['charge:start', 'charge:stop', 'charge:status'],
      maxSessionTtl: 7200,
      subNamePatterns: ['connector-*', 'meter-*'],
    };
    const grantBAud = {
      audiences: ['app.com'],
      scopes: ['charge:start', 'charge:stop'],
      maxSessionTtl: 7200,
    };
    const A = await identity.attestHandle('station-001', grantANoAud);
    const sub = await handle.deriveSubHandle('connector-ccs');
    const B = await handle.attestSubHandle('connector-ccs', grantBAud);
    const session = await Session.create(sub, {
      audience: 'other.com', scopes: ['charge:start'], ttl: 3600,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'other.com'),
      'AUDIENCE_NOT_PERMITTED', 'SESSION'
    );
  });

  it('18. audiences: [] в гранте — любая аудитория отклоняется', async () => {
    const handle = await identity.deriveHandle('station-001');
    const grantAEmpty = {
      audiences: ['app.com'],
      scopes: ['charge:start', 'charge:stop', 'charge:status'],
      maxSessionTtl: 7200,
      subNamePatterns: ['connector-*', 'meter-*'],
    };
    const grantBEmpty = {
      audiences: [],
      scopes: ['charge:start', 'charge:stop'],
      maxSessionTtl: 7200,
    };
    const A = await identity.attestHandle('station-001', grantAEmpty);
    const sub = await handle.deriveSubHandle('connector-ccs');
    const B = await handle.attestSubHandle('connector-ccs', grantBEmpty);
    const session = await Session.create(sub, {
      audience: 'any.com', scopes: ['charge:start'], ttl: 3600,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token, B.token], 'any.com'),
      'AUDIENCE_NOT_PERMITTED', 'SESSION'
    );
  });

  it('19. Handle-сессия с чужим hId', async () => {
    const otherIdentity = await Identity.fromSeed(new Uint8Array(32).fill(55));
    const otherHandle = await otherIdentity.deriveHandle('other-station');
    const A = await identity.attestHandle('station-001', grantA);
    const session = await Session.create(otherHandle, {
      audience: 'app.com', scopes: ['charge:start'], ttl: 3600,
    });
    await expectCode(
      Session.verifyAttested(session.token, rootPub, [A.token], 'app.com'),
      'SUBJECT_MISMATCH', 'ROOT'
    );
  });

  it('20. REGRESSION: verifyStateless без цепочки работает', async () => {
    const { session: hSession } = await makeHandleSession();
    const { session: sSession } = await makeSubSession();

    const verifiedH = await Session.verifyStateless(
      hSession.token, identity, 'app.com'
    );
    expect(verifiedH.handleName).toBe('station-001');

    const verifiedS = await Session.verifyStateless(
      sSession.token, identity, 'app.com'
    );
    expect(verifiedS.handleName).toBe('connector-ccs');
  });
});

describe('verifyAttested: signature robustness', () => {
  it('short signature in session token → BAD_SIGNATURE/SESSION, not raw error', async () => {
    const { A, B, session } = await makeSubSession();
    const parts = session.token.split('.');
    const shortSig = base64urlEncode(crypto.getRandomValues(new Uint8Array(10)));
    const shortSigToken = `${parts[0]}.${shortSig}`;
    await expectCode(
      Session.verifyAttested(shortSigToken, rootPub, [A.token, B.token], 'app.com'),
      'BAD_SIGNATURE', 'SESSION'
    );
  });

  it('short signature in root attestation → BAD_SIGNATURE/ROOT', async () => {
    const { A, session } = await makeHandleSession();
    const parts = A.token.split('.');
    const shortSig = base64urlEncode(crypto.getRandomValues(new Uint8Array(10)));
    await expectCode(
      Session.verifyAttested(session.token, rootPub,
        [`${parts[0]}.${shortSig}`], 'app.com'),
      'BAD_SIGNATURE', 'ROOT'
    );
  });

  it('large session payload (~2500 bytes) verifies OK (4096 limit, not 2048)', async () => {
    const handle = await identity.deriveHandle('station-001');
    const A = await identity.attestHandle('station-001', grantA);
    const session = await Session.create(handle, {
      audience: 'app.com',
      scopes: ['charge:start'],
      ttl: 3600,
      sessionId: 'x'.repeat(2000),
    });
    const raw = base64urlDecode(session.token.split('.')[0]);
    expect(raw.length).toBeGreaterThan(2048);
    expect(raw.length).toBeLessThanOrEqual(4096);
    const verified = await Session.verifyAttested(
      session.token, rootPub, [A.token], 'app.com'
    );
    expect(verified.handleName).toBe('station-001');
  });
});
