// test/hardening.spec.ts
//
// PR-7 hardening slice:
//  - 5.18   runtime portability: tokens issue without crypto.randomUUID
//  - A3     no btoa/atob anywhere in src/ (@scure/base only)
//  - 1.8.x  signature-length pre-checks (Attestation.verifySignature, Handle.verify)
//  - 1.8.x  jti validation (decode, issue opts, session payload)
//  - 1.8.x  __proto__ pollution protection in both token parsers
//  - 1.8.5+ getSubMetadata returns a true deep copy
//  - strict field-type validation of session payloads (fuzz finding)
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import {
  Attestation,
  ATTESTATION_TYPE,
  AttestationError,
  Handle,
  Identity,
  Session,
} from '../src/index.js';
import { base64urlDecode, base64urlEncode } from '../src/util.js';
import { expectAttestationError, expectAttestationErrorSync, tamperPayload } from './test-utils.js';

const testSeed = new Uint8Array(64).fill(42);
const identity = await Identity.fromSeed(testSeed);
const grant = {
  audiences: ['app.com'],
  scopes: ['charge:start'],
  maxSessionTtl: 3600,
};
const subjectPub = (await identity.deriveHandle('subject-pub')).getPublicKey();

describe('5.18 — randomUUID fallback (runtime portability)', () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('issues attestations and sessions without crypto.randomUUID', async () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    });
    try {
      const A = await Attestation.issue(identity, subjectPub, 'fallback-a', grant, {
        now: 1_000_000, ttlSeconds: 3600,
      });
      expect(V4.test(A.jti)).toBe(true);

      const handle = await identity.deriveHandle('fallback-s');
      const s = await Session.create(handle, { audience: 'app.com', scopes: ['charge:start'], ttl: 60 });
      expect(V4.test(s.sessionId)).toBe(true);

      const A2 = await Attestation.issue(identity, subjectPub, 'fallback-a', grant, {
        now: 1_000_000, ttlSeconds: 3600,
      });
      expect(A2.jti).not.toBe(A.jti); // both produced by the fallback, still unique
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('A3 — base64url exclusively via @scure/base', () => {
  it('no btoa/atob calls remain in src/', () => {
    const srcDir = new URL('../src/', import.meta.url);
    const files = readdirSync(srcDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
      if (/\b(atob|btoa)\s*\(/.test(text)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('codec roundtrip across the padding boundary lengths', () => {
    for (let len = 0; len <= 70; len++) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + len) & 0xff);
      const decoded = base64urlDecode(base64urlEncode(bytes));
      expect(Buffer.from(decoded).equals(Buffer.from(bytes)), `length ${len}`).toBe(true);
    }
    expect(base64urlEncode(new Uint8Array(0))).toBe('');
  });
});

describe('1.8.x — signature-length pre-check', () => {
  it('Attestation.verifySignature returns false for 63/67-byte signatures (no throw)', async () => {
    const A = await identity.attestHandle('precheck', grant);
    const [payloadB64, sigB64] = A.token.split('.');
    const pub = identity.getPublicKey();

    expect(sigB64.length).toBe(86); // 64 bytes unpadded
    expect(await Attestation.verifySignature(`${payloadB64}.${sigB64.slice(0, -2)}`, pub)).toBe(false);
    // +4 chars keeps the base64 decodable (90 chars → 67 bytes) so the
    // pre-check (not the parser) rejects the length.
    expect(await Attestation.verifySignature(`${payloadB64}.${sigB64}AAAA`, pub)).toBe(false);
    expect(await Attestation.verifySignature(A.token, pub)).toBe(true);
  });

  it('Handle.verify returns false for a short signature (no throw)', async () => {
    const handle = await identity.deriveHandle('precheck-handle');
    const data = new TextEncoder().encode('x');
    const sig = await handle.sign(data);
    expect(await Handle.verify(sig.slice(0, 63), data, handle.getPublicKey())).toBe(false);
    expect(await Handle.verify(new Uint8Array(0), data, handle.getPublicKey())).toBe(false);
    expect(await Handle.verify(sig, data, handle.getPublicKey())).toBe(true);
  });
});

describe('1.8.x — jti validation', () => {
  it('decode: empty and oversized jti → MALFORMED/FORMAT', async () => {
    const A = await identity.attestHandle('jti-decode', grant);

    const emptyJti = tamperPayload(A.token, (p) => { p.jti = ''; });
    expectAttestationErrorSync(() => Attestation.decode(emptyJti), 'MALFORMED', 'FORMAT');

    const longJti = tamperPayload(A.token, (p) => { p.jti = 'x'.repeat(257); });
    expectAttestationErrorSync(() => Attestation.decode(longJti), 'MALFORMED', 'FORMAT');

    const ok = tamperPayload(A.token, (p) => { p.jti = 'x'.repeat(256); });
    expect(Attestation.decode(ok).jti).toHaveLength(256); // boundary accepted
  });

  it('issue: invalid opts.jti → MALFORMED/FORMAT', async () => {
    await expectAttestationError(
      Attestation.issue(identity, subjectPub, 'jti-issue', grant, { jti: '' }),
      'MALFORMED', 'FORMAT',
    );
    await expectAttestationError(
      Attestation.issue(identity, subjectPub, 'jti-issue', grant, { jti: 'x'.repeat(257) }),
      'MALFORMED', 'FORMAT',
    );
    await expectAttestationError(
      Attestation.issue(identity, subjectPub, 'jti-issue', grant, { jti: 42 as unknown as string }),
      'MALFORMED', 'FORMAT',
    );
  });

  it('session payload: missing/empty jti → MALFORMED/FORMAT', async () => {
    const handle = await identity.deriveHandle('jti-session');
    const s = await Session.create(handle, { audience: 'app.com', scopes: ['charge:start'], ttl: 60 });

    const noJti = tamperPayload(s.token, (p) => { delete p.jti; });
    await expectAttestationError(
      Session.verifyStateless(noJti, identity, 'app.com'), 'MALFORMED', 'FORMAT',
    );

    const emptyJti = tamperPayload(s.token, (p) => { p.jti = ''; });
    await expectAttestationError(
      Session.verifyStateless(emptyJti, identity, 'app.com'), 'MALFORMED', 'FORMAT',
    );
  });
});

describe('1.8.x — __proto__ pollution protection', () => {
  function tokenWithProtoPayload(): string {
    const legit = JSON.stringify({
      typ: ATTESTATION_TYPE, subjectName: 'x', subjectId: 'y',
      grant: { scopes: ['a'], maxSessionTtl: 1 }, iat: 1, exp: 2, jti: 'j',
    });
    // Inject an own "__proto__" key into the raw JSON text (JSON.stringify
    // cannot emit it directly): splice the hostile key before the object
    // body instead of a replace(), which would touch only the first match.
    const hostile = `{"__proto__":{"polluted":true},${legit.slice(1)}`;
    return `${base64urlEncode(new TextEncoder().encode(hostile))}.${base64urlEncode(new Uint8Array(64))}`;
  }

  it('attestation parser rejects __proto__ payloads with MALFORMED/FORMAT', async () => {
    expectAttestationErrorSync(() => Attestation.decode(tokenWithProtoPayload()), 'MALFORMED', 'FORMAT');
    await expectAttestationError(
      Attestation.verifySignature(tokenWithProtoPayload(), identity.getPublicKey()),
      'MALFORMED', 'FORMAT',
    );
  });

  it('session parser rejects __proto__ payloads with MALFORMED/FORMAT', async () => {
    await expectAttestationError(
      Session.verifyStateless(tokenWithProtoPayload(), identity, 'app.com'),
      'MALFORMED', 'FORMAT',
    );
  });

  it('Object.prototype stays clean after hostile payloads', () => {
    try { Attestation.decode(tokenWithProtoPayload()); } catch { /* expected */ }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((globalThis as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('1.8.x — strict session payload field types (fuzz finding)', () => {
  it('non-string hNm / numeric hPath entries → MALFORMED/FORMAT, never TypeError', async () => {
    const handle = await identity.deriveHandle('strict-fields');
    const sub = await handle.deriveSubHandle('strict-sub');
    const s = await Session.create(sub, { audience: 'app.com', scopes: ['charge:start'], ttl: 60 });

    const numericName = tamperPayload(s.token, (p) => { p.hNm = 123 as unknown as string; });
    await expectAttestationError(
      Session.verifyStateless(numericName, identity, 'app.com'), 'MALFORMED', 'FORMAT',
    );

    const numericPath = tamperPayload(s.token, (p) => { p.hPath = [1, 2] as unknown as string[]; });
    await expectAttestationError(
      Session.verifyStateless(numericPath, identity, 'app.com'), 'MALFORMED', 'FORMAT',
    );

    const shortPath = tamperPayload(s.token, (p) => { p.hPath = ['only-one'] as unknown as string[]; });
    await expectAttestationError(
      Session.verifyStateless(shortPath, identity, 'app.com'), 'MALFORMED', 'FORMAT',
    );

    const badScopes = tamperPayload(s.token, (p) => { p.scp = ['ok', 7] as unknown as string[]; });
    await expectAttestationError(
      Session.verifyStateless(badScopes, identity, 'app.com'), 'MALFORMED', 'FORMAT',
    );
  });

  it('wrong token argument types → MALFORMED/FORMAT (not TypeError)', async () => {
    await expectAttestationError(
      Session.verifyStateless(undefined as unknown as string, identity, 'app.com'),
      'MALFORMED', 'FORMAT',
    );
    expectAttestationErrorSync(
      () => Attestation.decode(123 as unknown as string), 'MALFORMED', 'FORMAT',
    );
    expectAttestationErrorSync(() => Attestation.decode('A.B'), 'MALFORMED', 'FORMAT'); // bad base64 length
  });

  it('stateless SUBJECT_MISMATCH/SESSION is reachable via a re-signed payload', async () => {
    const real = await identity.deriveHandle('sm-real');
    const decoy = await identity.deriveHandle('sm-decoy');
    // Payload claims the decoy's hId but hNm resolves to `real`, and the
    // token is signed by `real` — signature valid, hId mismatch fires.
    const payload = {
      hId: decoy.getId(), hNm: real.getName(), aud: 'app.com',
      scp: ['charge:start'], exp: Math.floor(Date.now() / 1000) + 60,
      iat: Math.floor(Date.now() / 1000), jti: 'sm-test',
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const token = `${base64urlEncode(bytes)}.${base64urlEncode(await real.sign(bytes))}`;
    await expectAttestationError(
      Session.verifyStateless(token, identity, 'app.com'), 'SUBJECT_MISMATCH', 'SESSION',
    );
  });
});

describe('1.8.x — getSubMetadata deep copy', () => {
  it('deep mutations of the returned object cannot reach enforced constraints', async () => {
    const sub = await identity.deriveSubHandle('deep-copy', 'connector-1', {
      allowedScopes: ['a'],
      allowedAudiences: ['app.com'],
      nested: { arr: [1, { deep: true }] },
    });

    const m1 = sub.getSubMetadata();
    (m1.allowedScopes as string[]).push('evil');
    m1.nested.arr[0] = 999;
    (m1.nested.arr[1] as { deep: unknown }).deep = 'tampered';

    const m2 = sub.getSubMetadata();
    expect(m2.allowedScopes).toEqual(['a']);
    expect(m2.allowedAudiences).toEqual(['app.com']);
    expect(m2.nested.arr[0]).toBe(1);
    expect(m2.nested.arr[1]).toEqual({ deep: true });
  });

  it('non-plain values (Date) are shared by reference and documented as such', async () => {
    const when = new Date(0);
    const sub = await identity.deriveSubHandle('deep-copy-date', 'connector-2', { when });
    const m = sub.getSubMetadata();
    expect(m.when).toBe(when); // non-plain: shared, not cloned
  });

  it('function-valued metadata falls back to the constraint-copying copy', async () => {
    const fn = () => 1;
    const sub = await identity.deriveSubHandle('deep-copy-fn', 'connector-3', {
      allowedScopes: ['a'], fn,
    });
    const m = sub.getSubMetadata();
    expect(m.fn).toBe(fn); // shared — functions cannot be deep-cloned
    (m.allowedScopes as string[]).push('evil'); // constraint arrays still duplicated
    expect(sub.getSubMetadata().allowedScopes).toEqual(['a']);
  });

  it('depth cap: structures deeper than 8 levels are shared', async () => {
    const leaf = { marker: true };
    let deep: Record<string, unknown> = leaf;
    for (let i = 0; i < 12; i++) deep = { a: deep };
    const sub = await identity.deriveSubHandle('deep-copy-cap', 'connector-4', {
      nested: deep as unknown as Record<string, unknown>,
    });
    const m1 = sub.getSubMetadata();
    // Walk down to the shared subtree (depth > 8) and mutate it.
    let cursor = m1.nested as Record<string, unknown>;
    for (let i = 0; i < 9; i++) cursor = cursor.a as Record<string, unknown>;
    (cursor as { marker?: boolean }).marker = false;
    const m2 = sub.getSubMetadata();
    let cursor2 = m2.nested as Record<string, unknown>;
    for (let i = 0; i < 9; i++) cursor2 = cursor2.a as Record<string, unknown>;
    expect(cursor2.marker).toBe(false); // beyond the cap: shared reference
    // Shallow parts remain isolated.
    expect(m1.nested).not.toBe(m2.nested);
  });
});

describe('error-model plumbing', () => {
  it('AttestationError carries name and [level/code] message prefix', async () => {
    try {
      await Attestation.issue(identity, new Uint8Array(16), 'bad-key', grant);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AttestationError);
      expect((e as AttestationError).name).toBe('AttestationError');
      expect((e as AttestationError).message).toMatch(/^\[FORMAT\/MALFORMED\]/);
    }
  });

  it('DisposedError is an AttestationError with code DISPOSED', async () => {
    const handle = await identity.deriveHandle('err-plumbing');
    handle.dispose();
    try {
      await handle.sign(new Uint8Array(1));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AttestationError);
      expect((e as AttestationError).code).toBe('DISPOSED');
      expect((e as AttestationError).level).toBe('FORMAT');
    }
  });
});
