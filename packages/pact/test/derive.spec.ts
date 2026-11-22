// test/derive.spec.ts — M1.2: deterministic Pact Keys (ТЗ §3.2, D3/D38).
//
// Golden vectors cross-check against node:crypto hkdfSync — an
// INDEPENDENT HKDF implementation, so the info-string construction is
// pinned, not self-referential. Negative vectors: swapped ch/pid/anchor
// produce different keys (fail-closed D4), invalid arguments reject.

import { describe, it, expect } from 'vitest';
import { hkdfSync } from 'node:crypto';
import { crypto } from '@me2em/core';
import { b64urlEncode, ZERO32 } from '../src/codec.js';
import { derivePactKey, PACT_KEY_INFO_PREFIX } from '../src/derive.js';
import { PactError } from '../src/errors.js';

const utf8 = (s: string) => new TextEncoder().encode(s);
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

const ANCHOR = bytes(32, 0x42);
const PID = b64urlEncode(bytes(16, 0x07));
const CH = b64urlEncode(bytes(32, 0x09));

function nodeHkdf(gen: number, pid = PID, ch = CH, anchor: Uint8Array = ANCHOR): Uint8Array {
  return new Uint8Array(
    hkdfSync('sha256', anchor, new Uint8Array(0), utf8(`${PACT_KEY_INFO_PREFIX}/${pid}/${ch}/g${gen}`), 32)
  );
}

describe('pact key derivation — M1.2', () => {
  it('golden: matches node:crypto HKDF-SHA256 for gen 0..2', () => {
    for (const gen of [0, 1, 2]) {
      expect(derivePactKey(ANCHOR, PID, CH, gen)).toEqual(nodeHkdf(gen));
    }
  });

  it('deterministic: same inputs → same 32-byte key', () => {
    const a = derivePactKey(ANCHOR, PID, CH, 0);
    const b = derivePactKey(ANCHOR, PID, CH, 0);
    expect(a).toEqual(b);
    expect(a.length).toBe(32);
  });

  it('generations 0..2 are distinct keys', () => {
    const g0 = derivePactKey(ANCHOR, PID, CH, 0);
    const g1 = derivePactKey(ANCHOR, PID, CH, 1);
    const g2 = derivePactKey(ANCHOR, PID, CH, 2);
    expect(g0).not.toEqual(g1);
    expect(g1).not.toEqual(g2);
    expect(g0).not.toEqual(g2);
  });

  it('fail-closed (D4): a swapped ch produces a different key', () => {
    const chB = b64urlEncode(bytes(32, 0x0a));
    expect(derivePactKey(ANCHOR, PID, chB, 0)).toEqual(nodeHkdf(0, PID, chB));
    expect(derivePactKey(ANCHOR, PID, chB, 0)).not.toEqual(derivePactKey(ANCHOR, PID, CH, 0));
  });

  it('a swapped pid or anchor produces a different key', () => {
    const pidB = b64urlEncode(bytes(16, 0x08));
    expect(derivePactKey(ANCHOR, pidB, CH, 0)).not.toEqual(derivePactKey(ANCHOR, PID, CH, 0));
    expect(derivePactKey(bytes(32, 0x43), PID, CH, 0)).not.toEqual(derivePactKey(ANCHOR, PID, CH, 0));
  });

  it('pactPub is a plain Ed25519 public key of the pact key (Р1)', () => {
    const key0 = derivePactKey(ANCHOR, PID, CH, 0);
    const pub0 = crypto.getPublicKey(key0);
    expect(pub0.length).toBe(32);
    const pub1 = crypto.getPublicKey(derivePactKey(ANCHOR, PID, CH, 1));
    expect(pub0).not.toEqual(pub1);
  });

  it('rejects invalid arguments with MALFORMED @ derive', () => {
    expect(() => derivePactKey(new Uint8Array(0), PID, CH, 0)).toThrow(PactError);
    expect(() => derivePactKey(bytes(32, 1), b64urlEncode(bytes(15)), CH, 0)).toThrow(PactError);
    expect(() => derivePactKey(bytes(32, 1), 'not!b64!!', CH, 0)).toThrow(PactError);
    expect(() => derivePactKey(bytes(32, 1), PID, b64urlEncode(bytes(31)), 0)).toThrow(PactError);
    expect(() => derivePactKey(bytes(32, 1), PID, ZERO32.slice(0, -1) + 'B', 0)).toThrow(PactError);
    expect(() => derivePactKey(ANCHOR, 42 as never, CH, 0)).toThrow(PactError); // pid non-string
    expect(() => derivePactKey(ANCHOR, PID, 42 as never, 0)).toThrow(PactError); // ch non-string
    for (const gen of [-1, 1.5, NaN]) {
      expect(() => derivePactKey(ANCHOR, PID, CH, gen)).toThrow(PactError);
    }
    try {
      derivePactKey(ANCHOR, PID, CH, -1);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PactError);
      expect((e as PactError).context).toBe('derive');
    }
  });
});
