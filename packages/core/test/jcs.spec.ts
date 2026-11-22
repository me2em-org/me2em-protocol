// test/jcs.spec.ts — RFC 8785 conformance suite (P0.8 Phase 1).
//
// Vector sources (byte-exact, transcribed from the RFC text):
// - §3.2.2 input sample + §3.2.3 canonical output + §3.2.4 canonical
//   UTF-8 bytes (the only vector that pins the byte level);
// - §3.2.3 property-sorting sample (UTF-16 code-unit order);
// - Appendix B "Number Serialization Samples" (hex bits → ES6 output),
//   incl. NaN/Infinity → error and the 2^53 / 2^68 beyond-safe-range
//   values that pin the I-JSON parse-boundary decision (ТЗ §2.2.3).
// Edge cases beyond the RFC: UTF-16-vs-code-point sorting divergence,
// lone surrogates, cycles, non-plain objects, sparse arrays.

import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  canonicalizeToString,
  CanonicalizationError,
  AttestationError,
  type JsonValue,
} from '../src/index.js';

/** Rebuilds the IEEE 754 double from an RFC Appendix B hex bit pattern. */
function doubleFromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt('0x' + hex), false);
  return view.getFloat64(0, false);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// RFC 8785 §3.2.4 — canonical UTF-8 bytes of the §3.2.2 sample.
const RFC_MAIN_HEX =
  '7b226c69746572616c73223a5b6e756c6c2c7472' +
  '75652c66616c73655d2c226e756d62657273223a' +
  '5b3333333333333333332e333333333333332c31' +
  '652b33302c342e352c302e3030322c31652d3237' +
  '5d2c22737472696e67223a22e282ac245c753030' +
  '30665c6e4127425c225c5c5c5c5c222f227d';

// RFC 8785 §3.2.2 — the sample as JSON *input text* (verbatim escapes).
const RFC_INPUT_TEXT =
  '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
  '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
  '"literals":[null,true,false]}';

// RFC 8785 Appendix B — IEEE 754 bits → expected ECMAScript serialization.
const NUMBER_VECTORS: ReadonlyArray<readonly [string, string]> = [
  ['0000000000000001', '5e-324'],
  ['8000000000000001', '-5e-324'],
  ['7fefffffffffffff', '1.7976931348623157e+308'],
  ['ffefffffffffffff', '-1.7976931348623157e+308'],
  ['4340000000000000', '9007199254740992'], // max pos int (2^53)
  ['c340000000000000', '-9007199254740992'],
  ['4430000000000000', '295147905179352830000'], // ~2**68
  ['44b52d02c7e14af5', '9.999999999999997e+22'],
  ['44b52d02c7e14af6', '1e+23'],
  ['44b52d02c7e14af7', '1.0000000000000001e+23'],
  ['444b1ae4d6e2ef4e', '999999999999999700000'],
  ['444b1ae4d6e2ef4f', '999999999999999900000'],
  ['444b1ae4d6e2ef50', '1e+21'],
  ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
  ['3eb0c6f7a0b5ed8d', '0.000001'],
  ['41b3de4355555553', '333333333.3333332'],
  ['41b3de4355555554', '333333333.33333325'],
  ['41b3de4355555555', '333333333.3333333'],
  ['41b3de4355555556', '333333333.3333334'],
  ['41b3de4355555557', '333333333.33333343'],
  ['becbf647612f3696', '-0.0000033333333333333333'],
  ['43143ff3c1cb0959', '1424953923781206.2'], // round to even (Note 2)
];

// RFC 8785 §3.2.3 — property-sorting sample as JSON input text.
const RFC_SORT_TEXT =
  '{"\\u20ac":"Euro Sign","\\r":"Carriage Return",' +
  '"\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One",' +
  '"\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control",' +
  '"\\u00f6":"Latin Small Letter O With Diaeresis"}';

// Keys in UTF-16 code-unit order: 0D < 31 < 80 < F6 < 20AC < D83D < FB33.
// U+000D is a predefined escape ("\r"); U+0080 is OUTSIDE the ASCII
// control range and is emitted as-is; everything ≥ U+0080 is literal.
const RFC_SORT_EXPECTED =
  '{"\\r":"Carriage Return","1":"One","\u0080":"Control",' +
  '"ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign",' +
  '"😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}';

describe('JCS canonicalization (RFC 8785, P0.8 Phase 1)', () => {
  describe('RFC normative vectors', () => {
    it('§3.2.2 sample — canonical text matches the §3.2.4 bytes decoded', () => {
      const parsed = JSON.parse(RFC_INPUT_TEXT) as JsonValue;
      expect(canonicalizeToString(parsed)).toBe(new TextDecoder().decode(hexToBytes(RFC_MAIN_HEX)));
    });

    it('§3.2.4 — canonical bytes are byte-exact', () => {
      const parsed = JSON.parse(RFC_INPUT_TEXT) as JsonValue;
      expect(canonicalize(parsed)).toEqual(hexToBytes(RFC_MAIN_HEX));
    });

    it('§3.2.2.1 — literals serialize as-is', () => {
      expect(canonicalizeToString([null, true, false])).toBe('[null,true,false]');
      expect(canonicalizeToString(null)).toBe('null');
    });

    it('Appendix B — number serialization table (bits → output)', () => {
      for (const [bits, expected] of NUMBER_VECTORS) {
        expect(canonicalizeToString(doubleFromBits(bits))).toBe(expected);
      }
    });

    it('Appendix B — NaN / ±Infinity terminate with an error', () => {
      expect(() => canonicalizeToString(doubleFromBits('7fffffffffffffff'))).toThrow(CanonicalizationError);
      expect(() => canonicalizeToString(doubleFromBits('7ff0000000000000'))).toThrow(CanonicalizationError);
      expect(() => canonicalizeToString(Number.NEGATIVE_INFINITY)).toThrow(CanonicalizationError);
    });

    it('§3.2.3 — properties sort by UTF-16 code units', () => {
      const parsed = JSON.parse(RFC_SORT_TEXT) as JsonValue;
      expect(canonicalizeToString(parsed)).toBe(RFC_SORT_EXPECTED);
    });

    it('§3.2.3 — sorting recurses into arrays and nested objects, array order preserved', () => {
      expect(canonicalizeToString([3, 1, 2])).toBe('[3,1,2]');
      expect(canonicalizeToString({ b: { d: 1, c: [2, 1] }, a: 3 })).toBe(
        '{"a":3,"b":{"c":[2,1],"d":1}}'
      );
      expect(canonicalizeToString({})).toBe('{}');
      expect(canonicalizeToString([])).toBe('[]');
    });
  });

  describe('edge cases (ТЗ §4.2–§4.3)', () => {
    it('numbers beyond the safe-integer range serialize as doubles (I-JSON parses, not serializes)', () => {
      expect(canonicalizeToString(1e30)).toBe('1e+30');
      expect(canonicalizeToString(doubleFromBits('4340000000000000'))).toBe('9007199254740992');
      expect(canonicalizeToString(9007199254740991)).toBe('9007199254740991'); // 2^53−1
    });

    it('-0 serializes as 0', () => {
      expect(canonicalizeToString(-0)).toBe('0');
    });

    it('UTF-16 code-unit order differs from code-point order — the divergence is pinned', () => {
      // U+10000 (surrogate pair, first unit 0xD800) must precede
      // U+FFFD (0xFFFD): code-unit sort. Code-point sorting would
      // flip the order — this test fails under that regression.
      const canonical = canonicalizeToString(JSON.parse('{"\\ufffd":1,"\\ud800\\udc00":2}') as JsonValue);
      expect(canonical).toBe('{"\uD800\uDC00":2,"\uFFFD":1}');
    });

    it('predefined and lowercase-hex control escapes', () => {
      expect(canonicalizeToString('\b\t\n\f\r')).toBe('"\\b\\t\\n\\f\\r"');
      expect(canonicalizeToString('\u000f')).toBe('"\\u000f"'); // lowercase hex
      expect(canonicalizeToString('€😀')).toBe('"€😀"'); // no \u escapes for non-controls
    });

    it('lone surrogates terminate with an error — in values and in property names', () => {
      expect(() => canonicalizeToString('\udead')).toThrow(CanonicalizationError);
      expect(() => canonicalizeToString('\ud800')).toThrow(CanonicalizationError);
      expect(() => canonicalizeToString({ '\ud800': 1 })).toThrow(CanonicalizationError);
      expect(() => canonicalizeToString(['ok', '\udc00'])).toThrow(CanonicalizationError);
    });
  });

  describe('fail-closed inputs (ТЗ §2.2.6)', () => {
    it('BigInt — top level and nested', () => {
      expect(() => canonicalizeToString(1n as never)).toThrow(CanonicalizationError);
      expect(() => canonicalizeToString({ a: 1n } as unknown as JsonValue)).toThrow(CanonicalizationError);
    });

    it('undefined, functions, symbols', () => {
      expect(() => canonicalizeToString(undefined as never)).toThrow(CanonicalizationError);
      expect(() => canonicalizeToString((() => 1) as unknown as JsonValue)).toThrow(CanonicalizationError);
      expect(() => canonicalizeToString(Symbol('x') as unknown as JsonValue)).toThrow(CanonicalizationError);
    });

    it('undefined property values and sparse arrays fail closed (no JSON.stringify-style skipping)', () => {
      expect(() => canonicalizeToString({ a: undefined } as unknown as JsonValue)).toThrow(CanonicalizationError);
      const sparse: unknown[] = new Array(3);
      sparse[0] = 1;
      sparse[2] = 2;
      expect(() => canonicalizeToString(sparse as unknown as JsonValue)).toThrow(CanonicalizationError);
    });

    it('non-plain objects (Date, Map, class instances)', () => {
      expect(() => canonicalizeToString(new Date() as unknown as JsonValue)).toThrow(CanonicalizationError);
      expect(() => canonicalizeToString(new Map() as unknown as JsonValue)).toThrow(CanonicalizationError);
      class Wrapper {
        public v = 1;
      }
      expect(() => canonicalizeToString(new Wrapper() as unknown as JsonValue)).toThrow(CanonicalizationError);
      // Exotic prototype chain — neither Object.prototype nor null; the
      // constructor name is unavailable, so the message falls back:
      const exotic = Object.setPrototypeOf({ v: 1 }, Object.create(null));
      expect(() => canonicalizeToString(exotic as unknown as JsonValue)).toThrow(/unknown prototype/);
    });

    it('a null-prototype object is still plain JSON data and canonicalizes', () => {
      const nullProto = Object.create(null) as { b?: JsonValue; a?: JsonValue };
      nullProto.b = 2;
      nullProto.a = [1, 'x'];
      expect(canonicalizeToString(nullProto)).toBe('{"a":[1,"x"],"b":2}');
    });

    it('circular references — object and array; DAG references stay legal', () => {
      const o: { a: number; self?: unknown } = { a: 1 };
      o.self = o;
      expect(() => canonicalizeToString(o as unknown as JsonValue)).toThrow(CanonicalizationError);

      const a: unknown[] = [1];
      a.push(a);
      expect(() => canonicalizeToString(a as unknown as JsonValue)).toThrow(CanonicalizationError);

      const shared = { x: 1 };
      expect(canonicalizeToString({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
    });

    it('CanonicalizationError carries the core error contract (MALFORMED / FORMAT / JCS)', () => {
      try {
        canonicalizeToString(1n as never);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AttestationError);
        expect(e).toBeInstanceOf(CanonicalizationError);
        const err = e as CanonicalizationError;
        expect(err.code).toBe('MALFORMED');
        expect(err.level).toBe('FORMAT');
        expect(err.context).toBe('JCS');
        expect(err.message).toContain('MALFORMED');
      }
    });
  });

  describe('idempotence (ТЗ §4.4)', () => {
    const samples: ReadonlyArray<string> = [RFC_INPUT_TEXT, RFC_SORT_TEXT, '{"k":[1,{"z":2,"a":true},"€",null]}'];

    it('canonicalize → parse → canonicalize is byte-stable', () => {
      for (const text of samples) {
        const once = canonicalizeToString(JSON.parse(text) as JsonValue);
        const twice = canonicalizeToString(JSON.parse(once) as JsonValue);
        expect(twice).toBe(once);
        expect(canonicalize(JSON.parse(once) as JsonValue)).toEqual(new TextEncoder().encode(once));
      }
    });
  });
});
