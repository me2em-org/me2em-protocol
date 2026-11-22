// test/codec.spec.ts — M1.1: strict codec (ТЗ §3.1/§3.5; PACTS §7.3/§7.4).
//
// Positive: encode/decode roundtrip over all 11 event types, JCS byte
// exactness, evHash cross-checked against node:crypto (independent of
// the implementation), ZERO32.
// Negative: every strict-parse deviation — unknown/missing fields,
// wrong encodings, D35 limits, D34 check-verification — rejects with
// the normative code (MALFORMED / PAYLOAD_TOO_LARGE).

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { crypto } from '@me2em/core';
import {
  b64urlDecode,
  b64urlEncode,
  decodeEvent,
  encodeEvent,
  evHash,
  MAX_SIGNATURES,
  tbsBytes,
  ZERO32,
} from '../src/codec.js';
import { PactError } from '../src/errors.js';
import type { Constitution, Event, EventType, Founder } from '../src/types.js';

const utf8 = (s: string) => new TextEncoder().encode(s);
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);
const sha256b64 = (s: string) => b64urlEncode(crypto.sha256(utf8(s)));

const PID = b64urlEncode(bytes(16, 0x11));
const H32 = b64urlEncode(bytes(32, 0x22));
const SIG64 = b64urlEncode(bytes(64, 0x33));
const PUB_A = b64urlEncode(bytes(32, 0xa1));
const PUB_B = b64urlEncode(bytes(32, 0xb2));
const IAT = 1700000000;

const CN: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'pinned', w: false };
const FT: Founder[] = [
  { p: PUB_A, pp: H32, an: 'identity' },
  { p: PUB_B, pp: H32, an: 'identity' },
];

function mkEvent(ty: EventType, pl: Record<string, unknown>, sq = 0, sig = 1): Event {
  return {
    typ: 'me2em/pact-event/v1',
    pid: PID,
    sq,
    ph: sq === 0 ? ZERO32 : H32,
    ty,
    pl,
    iat: IAT,
    sig: Array.from({ length: sig }, (_, i) => ({ p: b64urlEncode(bytes(32, 0xa0 + i)), s: SIG64 })),
  };
}

const SAMPLE_PAYLOADS: Record<EventType, Record<string, unknown>> = {
  GENESIS: { ch: sha256b64('pact context'), cx: 'pact context', cn: CN, ft: FT },
  INVITE: { dn: 'borrower', w: 2, an: 'handle' },
  REVOKE_INVITE: { ref: H32, rs: 'unused' },
  ENROLL: { ref: H32, dn: 'borrower', w: 2 },
  EXIT: { rs: 'leaving' },
  EVICT: { tp: PUB_B, rs: 'breach' },
  ROTATE_KEY: { np: PUB_B, ca: 1700000100 },
  ACT: { doc: 'the parties agree to charge at night', dh: sha256b64('the parties agree to charge at night'), no: 'tariff' },
  REVERSE_ACT: { ref: H32, k: 'supersede', rs: 'wrong amount' },
  AMEND: { cn: CN, no: 'weights' },
  DISSOLVE: { rs: 'done' },
};

const ALL_TYPES = Object.keys(SAMPLE_PAYLOADS) as EventType[];

function expectPactError(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(PactError);
    expect((e as PactError).code).toBe(code);
  }
}

describe('pact codec — M1.1', () => {
  describe('positive', () => {
    it('encode → decode roundtrip over all 11 event types', () => {
      for (const ty of ALL_TYPES) {
        const event = mkEvent(ty, SAMPLE_PAYLOADS[ty]);
        const decoded = decodeEvent(encodeEvent(event));
        expect(decoded).toEqual(event);
        expect(decoded.typ).toBe('me2em/pact-event/v1');
      }
    });

    it('encodeEvent produces canonical JCS bytes (sorted keys, no whitespace)', () => {
      const text = new TextDecoder().decode(encodeEvent(mkEvent('EXIT', {})));
      // JCS key order: iat < ph < pid < pl < sig < sq < ty < typ
      expect(text.startsWith('{"iat":')).toBe(true);
      expect(text.includes(' ')).toBe(false);
      // Byte-exact stability: re-canonicalizing the decoded event matches.
      const decoded = decodeEvent(encodeEvent(mkEvent('EXIT', {})));
      expect(encodeEvent(decoded)).toEqual(encodeEvent(mkEvent('EXIT', {})));
    });

    it('evHash cross-checked against node:crypto and excludes sig, includes typ/pid', () => {
      const event = mkEvent('ACT', SAMPLE_PAYLOADS['ACT']);
      const expected = b64urlEncode(
        new Uint8Array(createHash('sha256').update(tbsBytes(event)).digest())
      );
      expect(evHash(event)).toBe(expected);

      const otherSig = { ...event, sig: [{ p: PUB_B, s: SIG64 }] };
      expect(evHash(otherSig)).toBe(evHash(event)); // TBS has no sig

      const otherPid = { ...event, pid: b64urlEncode(bytes(16, 0x12)) };
      expect(evHash(otherPid)).not.toBe(evHash(event)); // typ/pid in TBS
    });

    it('tbsBytes is the canonical bytes of the event without the sig field', () => {
      const event = mkEvent('DISSOLVE', { rs: 'done' });
      const tbs = new TextDecoder().decode(tbsBytes(event));
      expect(tbs.startsWith('{"iat":')).toBe(true);
      expect(tbs.includes('"sig"')).toBe(false);
      expect(tbs).toContain('"typ":"me2em/pact-event/v1"');
    });

    it('ZERO32 is b64url of 32 zero bytes', () => {
      expect(ZERO32).toBe('A'.repeat(43));
      expect(b64urlDecode(ZERO32, 'zero', 32)).toEqual(new Uint8Array(32));
    });

    it('base64url strict decode roundtrip; limits are exported', () => {
      const raw = bytes(97, 0x5a);
      expect(b64urlDecode(b64urlEncode(raw), 'x')).toEqual(raw);
      expect(MAX_SIGNATURES).toBe(16);
    });
  });

  describe('strict envelope parse', () => {
    const event = mkEvent('EXIT', {});

    const decodeOf = (mutate: (e: Event) => unknown): unknown => {
      try {
        return decodeEvent(encodeEvent(mutate(event) as Event));
      } catch (e) {
        return e;
      }
    };

    it('rejects invalid UTF-8 and invalid JSON', () => {
      expectPactError(() => decodeEvent(new Uint8Array([0xff, 0xfe])), 'MALFORMED');
      expectPactError(() => decodeEvent(utf8('{not json')), 'MALFORMED');
      expectPactError(() => decodeEvent(utf8('42')), 'MALFORMED');
    });

    it('rejects unknown and missing envelope fields', () => {
      const extra = { ...event, extra: 1 } as unknown as Event;
      expect(decodeOf(() => extra)).toBeInstanceOf(PactError);
      const missing = { ...event } as Record<string, unknown>;
      delete missing['iat'];
      expect(decodeOf(() => missing as unknown as Event)).toBeInstanceOf(PactError);
    });

    it('rejects wrong typ (version fail-closed, P4)', () => {
      expectPactError(
        () => decodeEvent(encodeEvent({ ...event, typ: 'me2em/pact-event/v2' })),
        'MALFORMED'
      );
    });

    it('rejects wrong pid/ph encodings and lengths', () => {
      expectPactError(
        () => decodeEvent(encodeEvent({ ...event, pid: b64urlEncode(bytes(15, 1)) })),
        'MALFORMED'
      );
      expectPactError(() => decodeEvent(encodeEvent({ ...event, ph: 'not!valid*' })), 'MALFORMED');
      expectPactError(() => decodeEvent(encodeEvent({ ...event, ph: 'AAAAA' })), 'MALFORMED'); // length % 4 == 1
    });

    it('rejects non-canonical base64url', () => {
      const canonical = b64urlEncode(bytes(4, 0)); // 'AAAAAA'
      const nonCanonical = canonical.slice(0, -1) + 'B'; // hidden bits differ
      expectPactError(
        () => decodeEvent(encodeEvent({ ...event, ph: nonCanonical })),
        'MALFORMED'
      );
    });

    it('rejects bad sq/iat/ty', () => {
      expectPactError(() => decodeEvent(encodeEvent({ ...event, sq: -1 })), 'MALFORMED');
      expectPactError(() => decodeEvent(encodeEvent({ ...event, sq: 1.5 })), 'MALFORMED');
      expectPactError(() => decodeEvent(encodeEvent({ ...event, iat: -5 })), 'MALFORMED');
      expectPactError(() => decodeEvent(encodeEvent({ ...event, ty: 'SIDE_DEAL' })), 'MALFORMED');
    });

    it('rejects wrong field types before decoding (pid/ph/pl/iat/sig)', () => {
      expectPactError(() => decodeEvent(encodeEvent({ ...event, pid: 42 })), 'MALFORMED');
      expectPactError(() => decodeEvent(encodeEvent({ ...event, ph: 7 })), 'MALFORMED');
      expectPactError(() => decodeEvent(encodeEvent({ ...event, pl: [] })), 'MALFORMED');
      expectPactError(() => decodeEvent(encodeEvent({ ...event, iat: 1.5 })), 'MALFORMED');
      expectPactError(() => decodeEvent(encodeEvent({ ...event, sig: 'n/a' })), 'MALFORMED');
      const entry = { ...event, sig: ['x'] } as unknown as Event;
      expectPactError(() => decodeEvent(encodeEvent(entry)), 'MALFORMED');
    });

    it('rejects sig > 16 and duplicate signers', () => {
      expectPactError(() => decodeEvent(encodeEvent(mkEvent('EXIT', {}, 0, 17))), 'PAYLOAD_TOO_LARGE');
      const dup = mkEvent('EXIT', {}, 0, 2);
      dup.sig = [dup.sig[0], { ...dup.sig[0] }];
      expectPactError(() => decodeEvent(encodeEvent(dup)), 'MALFORMED');
    });

    it('rejects malformed signature entries', () => {
      const bad = { ...event, sig: [{ p: PUB_A, s: SIG64, extra: 1 }] } as unknown as Event;
      expectPactError(() => decodeEvent(encodeEvent(bad)), 'MALFORMED');
      const short = { ...event, sig: [{ p: PUB_A, s: b64urlEncode(bytes(63)) }] } as unknown as Event;
      expectPactError(() => decodeEvent(encodeEvent(short)), 'MALFORMED');
    });
  });

  describe('strict payload parse (PACTS §7.3)', () => {
    const decodePl = (ty: EventType, pl: Record<string, unknown>): void => {
      decodeEvent(encodeEvent(mkEvent(ty, pl)));
    };
    const expectOk = (ty: EventType, pl: Record<string, unknown>): void =>
      expect(() => decodePl(ty, pl)).not.toThrow();

    it('rejects unknown payload fields and missing required ones', () => {
      expectPactError(() => decodePl('EXIT', { rs: 'ok', extra: 1 }), 'MALFORMED');
      expectPactError(() => decodePl('GENESIS', { ch: H32, ft: FT }), 'MALFORMED'); // no cn
      expectPactError(() => decodePl('REVERSE_ACT', { k: 'supersede' }), 'MALFORMED'); // no ref
    });

    it('GENESIS: cx ↔ ch check-verification (D34)', () => {
      expectOk('GENESIS', { ch: sha256b64('ctx'), cx: 'ctx', cn: CN, ft: FT });
      expectPactError(() => decodePl('GENESIS', { ch: sha256b64('other'), cx: 'ctx', cn: CN, ft: FT }), 'MALFORMED');
      // Pure commitment without inline cx is legal:
      expectOk('GENESIS', { ch: sha256b64('out-of-band'), cn: CN, ft: FT });
    });

    it('ACT: inline doc requires matching dh (D34)', () => {
      const doc = 'agreement';
      expectOk('ACT', { doc, dh: sha256b64(doc) });
      expectOk('ACT', { dh: sha256b64(doc) }); // pure commit
      expectPactError(() => decodePl('ACT', { doc }), 'MALFORMED');
      expectPactError(() => decodePl('ACT', { doc, dh: sha256b64('mismatch') }), 'MALFORMED');
    });

    it('D35 limits: inline cx/doc ≤ 2048 B, dn/rs/no, ft ≤ 16, payload ≤ 4096 B', () => {
      expectPactError(() => decodePl('GENESIS', { ch: sha256b64('x'), cx: 'a'.repeat(2049), cn: CN, ft: FT }), 'PAYLOAD_TOO_LARGE');
      expectPactError(() => decodePl('ACT', { doc: 'a'.repeat(2049), dh: sha256b64('a'.repeat(2049)) }), 'PAYLOAD_TOO_LARGE');
      expectPactError(() => decodePl('INVITE', { dn: 'a'.repeat(65), an: 'handle' }), 'PAYLOAD_TOO_LARGE');
      expectOk('INVITE', { dn: 'a'.repeat(64), an: 'handle' });
      expectPactError(() => decodePl('EXIT', { rs: 'a'.repeat(257) }), 'PAYLOAD_TOO_LARGE');
      expectPactError(() => decodePl('AMEND', { cn: CN, no: 'a'.repeat(33) }), 'PAYLOAD_TOO_LARGE');
    });

    it('D35: payload over 4096 B rejects (GENESIS: cx 2048 + 16 founders with vc)', () => {
      const vc = { rh: H32, rp: H32 };
      const ft: Founder[] = Array.from({ length: 16 }, (_, i) => ({
        p: b64urlEncode(bytes(32, i + 1)),
        pp: H32,
        an: 'identity' as const,
        w: 1,
        vc,
      }));
      // founders sorted by p: bytes(32, i+1) ascending ✓
      const pl = { ch: sha256b64('a'.repeat(2048)), cx: 'a'.repeat(2048), cn: CN, ft };
      expectPactError(() => decodePl('GENESIS', pl), 'PAYLOAD_TOO_LARGE');
    });

    it('founders: sorted by p (strictly), 1..16, valid entries', () => {
      const unsorted = { ch: H32, cn: CN, ft: [FT[1], FT[0]] };
      expectPactError(() => decodePl('GENESIS', unsorted), 'MALFORMED');
      const dup = { ch: H32, cn: CN, ft: [FT[0], FT[0]] };
      expectPactError(() => decodePl('GENESIS', dup), 'MALFORMED');
      const vc = { rh: H32, rp: H32 };
      const many: Founder[] = Array.from({ length: 17 }, (_, i) => ({
        p: b64urlEncode(bytes(32, i + 1)),
        pp: H32,
        an: 'identity' as const,
        vc,
      }));
      expectPactError(() => decodePl('GENESIS', { ch: H32, cn: CN, ft: many }), 'PAYLOAD_TOO_LARGE');
      expectPactError(() => decodePl('GENESIS', { ch: H32, cn: CN, ft: [] }), 'PAYLOAD_TOO_LARGE');
      const badAnchor = { ch: H32, cn: CN, ft: [{ p: PUB_A, pp: H32, an: 'wallet' }] };
      expectPactError(() => decodePl('GENESIS', badAnchor), 'MALFORMED');
      const badW = { ch: H32, cn: CN, ft: [{ p: PUB_A, pp: H32, an: 'identity', w: 0 }] };
      expectPactError(() => decodePl('GENESIS', badW), 'MALFORMED');
      const badVc = { ch: H32, cn: CN, ft: [{ p: PUB_A, pp: H32, an: 'identity', vc: { rh: 'x', rp: H32 } }] };
      expectPactError(() => decodePl('GENESIS', badVc), 'MALFORMED');
    });

    it('constitution: th keys, threshold modes, k rules, im, w', () => {
      const mk = (cn: unknown) => ({ ch: H32, cn, ft: FT });
      expectPactError(() => decodePl('GENESIS', mk({ th: { SIDE_DEAL: { m: 'any' } }, im: 'pinned', w: false })), 'MALFORMED');
      expectPactError(() => decodePl('GENESIS', mk({ th: { EVICT: { m: 'majority' } }, im: 'pinned', w: false })), 'MALFORMED');
      expectPactError(() => decodePl('GENESIS', mk({ th: { EVICT: { m: 'k-of-active' } }, im: 'pinned', w: false })), 'MALFORMED'); // no k
      expectPactError(() => decodePl('GENESIS', mk({ th: { EVICT: { m: 'all', k: 2 } }, im: 'pinned', w: false })), 'MALFORMED'); // stray k
      expectPactError(() => decodePl('GENESIS', mk({ th: { EVICT: { m: 'k-of-active', k: 0 } }, im: 'pinned', w: false })), 'MALFORMED');
      expectPactError(() => decodePl('GENESIS', mk({ th: {}, im: 'random', w: false })), 'MALFORMED');
      expectPactError(() => decodePl('GENESIS', mk({ th: {}, im: 'pinned', w: 'yes' })), 'MALFORMED');
      const ok = { th: { EVICT: { m: 'k-of-active', k: 2 }, ACT: { m: 'any' } }, im: 'bearer', w: true };
      expectOk('GENESIS', mk(ok));
    });

    it('INVITE/ROTATE_KEY/REVERSE_ACT field rules', () => {
      expectPactError(() => decodePl('INVITE', { w: 0, an: 'handle' }), 'MALFORMED');
      expectPactError(() => decodePl('INVITE', { an: 'identity', w: 1.5 }), 'MALFORMED');
      expectPactError(() => decodePl('ROTATE_KEY', { np: PUB_B, ca: 1.5 }), 'MALFORMED');
      expectPactError(() => decodePl('ROTATE_KEY', { np: b64urlEncode(bytes(31)) }), 'MALFORMED');
      expectPactError(() => decodePl('REVERSE_ACT', { ref: H32, k: 'cancel' }), 'MALFORMED');
      expectOk('REVERSE_ACT', { ref: H32, k: 'reversal' });
    });
  });
});
