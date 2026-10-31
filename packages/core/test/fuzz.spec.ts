// test/fuzz.spec.ts
//
// 5.15 — Deterministic fuzz for the token parsers (PR-7). Random garbage
// and targeted mutations of valid tokens are pushed through the public
// entry points that wrap parseToken / parseSessionToken. Invariants:
//   1. Every rejection is an AttestationError — no TypeError, RangeError
//      or SyntaxError ever escapes (the "all errors → AttestationError"
//      guarantee).
//   2. Attestation.decode / Attestation.verifySignature parsing failures
//      are exactly MALFORMED at level FORMAT.
//   3. Object.prototype stays clean.
// The PRNG is seeded, so a failure reproduces with the same seed.
import { describe, expect, it } from 'vitest';
import {
  Attestation,
  AttestationError,
  Identity,
  Session,
} from '../src/index.js';

const SEED = 0xc0ffee;
const testSeed = new Uint8Array(64).fill(42);
const identity = await Identity.fromSeed(testSeed);
const rootPub = identity.getPublicKey();

const grantA = {
  audiences: ['app.com'],
  scopes: ['charge:start', 'charge:stop'],
  maxSessionTtl: 7200,
  subNamePatterns: ['connector-*'],
};
const grantB = {
  audiences: ['app.com'],
  scopes: ['charge:start'],
  maxSessionTtl: 7200,
};

/** Valid fixtures, built once (top-level await, same pattern as other specs). */
const { A, B, session } = await (async () => {
  const handle = await identity.deriveHandle('fuzz-station');
  const A = await identity.attestHandle('fuzz-station', grantA);
  const B = await handle.attestSubHandle('fuzz-connector', grantB);
  const sub = await handle.deriveSubHandle('fuzz-connector');
  const session = await Session.create(sub, {
    audience: 'app.com', scopes: ['charge:start'], ttl: 3600,
  });
  return { A, B, session };
})();

/** mulberry32 — tiny deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(SEED);
const pick = (chars: string, n: number): string =>
  Array.from({ length: n }, () => chars[Math.floor(rnd() * chars.length)]).join('');
const int = (max: number): number => Math.floor(rnd() * max);

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CHAOS = B64URL + '.{}[]",:0123456789 \t\n\\/é🎯\u0000';

function garbageToken(): string {
  const shape = int(4);
  const a = pick(B64URL, int(90));
  const b = pick(B64URL, int(90));
  if (shape === 0) return `${a}.${b}`;
  if (shape === 1) return a;
  if (shape === 2) return `${a}.${b}.${pick(B64URL, int(10))}`;
  return pick(CHAOS, int(120)); // includes '.' inside the random soup
}

function mutate(token: string): string {
  let out = token;
  const ops = 1 + int(3);
  for (let i = 0; i < ops; i++) {
    const at = int(out.length + 1);
    const kind = int(5);
    if (kind === 0) out = out.slice(0, at) + out.slice(at + int(8) + 1); // delete
    else if (kind === 1) out = out.slice(0, at) + pick(CHAOS, 1 + int(4)) + out.slice(at); // insert
    else if (kind === 2 && at < out.length) {
      out = out.slice(0, at) + pick(CHAOS, 1) + out.slice(at + 1); // replace
    } else if (kind === 3) out = out.slice(0, Math.max(0, out.length - int(20))); // truncate
    else out = out === out.toUpperCase() ? out.toLowerCase() : out.toUpperCase(); // case flip
  }
  return out;
}

/** Every rejection must be an AttestationError — any code/level. */
async function expectOnlyAttestationError(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(
      e instanceof AttestationError,
      `non-AttestationError escaped: ${String(e)}`,
    ).toBe(true);
  }
}

/** Parsing failures of Attestation.verifySignature: exactly MALFORMED/FORMAT. */
async function expectMalformedFormat(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(
      e instanceof AttestationError && e.code === 'MALFORMED' && e.level === 'FORMAT',
      `wrong error for garbage: ${String(e)}`,
    ).toBe(true);
  }
}

describe('5.15 — fuzz: random garbage', () => {
  it('400 garbage tokens through Attestation.decode + verifySignature', async () => {
    for (let i = 0; i < 400; i++) {
      const token = garbageToken();
      try {
        Attestation.decode(token);
      } catch (e) {
        expect(
          e instanceof AttestationError && e.code === 'MALFORMED' && e.level === 'FORMAT',
          `decode failed with ${String(e)} for ${JSON.stringify(token)}`,
        ).toBe(true);
      }
      await expectMalformedFormat(Attestation.verifySignature(token, rootPub));
    }
  });

  it('200 garbage tokens through Session.verifyStateless', async () => {
    for (let i = 0; i < 200; i++) {
      await expectOnlyAttestationError(
        Session.verifyStateless(garbageToken(), identity, 'app.com'),
      );
    }
  });

  it('150 garbage chains through Session.verifyAttested', async () => {
    for (let i = 0; i < 150; i++) {
      const chainLen = int(4);
      const chain = Array.from({ length: chainLen }, () =>
        rnd() < 0.5 ? garbageToken() : A.token,
      );
      await expectOnlyAttestationError(
        Session.verifyAttested(garbageToken(), rootPub, chain, 'app.com'),
      );
    }
  });
});

describe('5.15 — fuzz: mutations of valid tokens', () => {
  it('200 mutations of a valid attestation token (decode + verifySignature)', async () => {
    for (let i = 0; i < 200; i++) {
      const token = mutate(A.token);
      try {
        Attestation.decode(token); // may legitimately succeed
      } catch (e) {
        expect(
          e instanceof AttestationError && e.code === 'MALFORMED' && e.level === 'FORMAT',
          `decode failed with ${String(e)}`,
        ).toBe(true);
      }
      try {
        const verdict = await Attestation.verifySignature(token, rootPub);
        expect(typeof verdict).toBe('boolean');
      } catch (e) {
        expect(
          e instanceof AttestationError && e.code === 'MALFORMED' && e.level === 'FORMAT',
          `verifySignature failed with ${String(e)}`,
        ).toBe(true);
      }
    }
  });

  it('200 mutations of a valid session token (verifyStateless)', async () => {
    for (let i = 0; i < 200; i++) {
      await expectOnlyAttestationError(
        Session.verifyStateless(mutate(session.token), identity, 'app.com'),
      );
    }
  });

  it('100 mutations of an attestation chain (verifyAttested)', async () => {
    for (let i = 0; i < 100; i++) {
      const chain = [mutate(A.token), rnd() < 0.5 ? B.token : mutate(B.token)];
      await expectOnlyAttestationError(
        Session.verifyAttested(rnd() < 0.5 ? session.token : mutate(session.token), rootPub, chain, 'app.com'),
      );
    }
  });
});

describe('5.15 — fuzz hygiene', () => {
  it('Object.prototype is clean after the fuzz run', () => {
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((globalThis as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('seeded PRNG is reproducible', () => {
    const a = mulberry32(SEED);
    const b = mulberry32(SEED);
    expect(Array.from({ length: 16 }, a)).toEqual(Array.from({ length: 16 }, b));
  });
});
