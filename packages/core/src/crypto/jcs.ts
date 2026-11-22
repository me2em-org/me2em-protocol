// packages/core/src/crypto/jcs.ts
//
// JSON Canonicalization Scheme (RFC 8785) for @me2em/core (P0.8, decision
// B1): the single canonical serialization for new consumers of the
// protocol — `@me2em/pact` signs and hashes ONLY over the bytes this
// module produces (specs/tz-pact.md §4.1).
//
// Normative behaviour (specs/tz-core-rc9-jcs-revocation.md §2.2):
//
// 1. Object property names are sorted recursively as arrays of UTF-16
//    code units (RFC 8785 §3.2.3) — NOT by code point. JS relational
//    comparison (`<` / `>`) is exactly code-unit order, so the
//    comparator is the spec algorithm itself.
// 2. Numbers are serialized by ECMAScript `Number::toString`
//    (RFC 8785 §3.2.2.3). Per the ТЗ §2.2.2 the JS implementation MAY
//    rely on the engine: since ES6 the V8/JSC output is normatively
//    identical to the RFC (Appendix B vectors pin it — incl. values
//    beyond the safe-integer range, e.g. `1e+30`, `295147905179352830000`).
// 3. I-JSON (RFC 7493) constraints apply at the JSON-text parsing
//    boundary (RFC 8785 §3.3). This module consumes already-parsed
//    values, so it does not police the integer range; it fails closed
//    on what a double cannot represent: NaN / ±Infinity. `-0`
//    serializes as `0` (ECMAScript behaviour).
// 4. Strings: control characters < 0x20 as `\uhhhh` (lowercase hex)
//    except the predefined `\b \t \n \f \r`; `"` and `\` escaped; every
//    other code point emitted as-is (UTF-8 at the byte level). Lone
//    surrogates MUST terminate with an error (RFC 8785 §3.2.2.2 Note —
//    broken signatures otherwise).
// 5. Fail-closed (§2.2.6): BigInt, undefined, functions, symbols,
//    sparse arrays, `undefined` property values, non-plain objects
//    (Date/Map/class instances) and circular references throw
//    {@link CanonicalizationError} — the serializer never guesses.
// 6. This module does NOT touch attestation/session serialization
//    (`JSON.stringify(payload)` with spec-pinned literal field order,
//    attestation.ts / session.ts): those tokens are byte-frozen for
//    v1.0 compatibility (ТЗ §2.3).
//
// The `duplicates in external JSON` I-JSON caveat is out of scope by
// design: the input is an already-parsed value, where JS objects cannot
// hold duplicate string keys.

import { AttestationError } from '../errors.js';

/**
 * The JSON value domain accepted by {@link canonicalize} — the I-JSON
 * (RFC 7493) surface: `null`, booleans, numbers (IEEE 754 doubles),
 * strings, arrays and plain objects with string keys.
 *
 * @since 1.0.0-rc.9
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * The failure type of the JCS module (ТЗ §2.2.6): a
 * {@link AttestationError} with code `MALFORMED` at level `FORMAT`,
 * carrying `context: 'JCS'` for machine-level narrowing.
 *
 * Thrown for every input outside the JSON/I-JSON domain (see the module
 * header for the full fail-closed list) — canonicalization never
 * produces a best-effort result.
 *
 * @example
 * ```ts
 * import { canonicalize, CanonicalizationError } from '@me2em/core';
 *
 * try {
 *   canonicalize({ bad: 1n } as never);
 * } catch (e) {
 *   if (e instanceof CanonicalizationError) {
 *     // code 'MALFORMED', level 'FORMAT', context 'JCS'
 *   }
 * }
 * ```
 *
 * @category Errors
 */
export class CanonicalizationError extends AttestationError {
  /** Failure domain — always `'JCS'` (narrow without parsing messages). */
  public readonly context = 'JCS' as const;

  /** @param msg - Human-readable description of the offending input. */
  constructor(msg: string) {
    super('MALFORMED', 'FORMAT', msg);
    this.name = 'CanonicalizationError';
  }
}

/**
 * Lexicographic property-name comparator over UTF-16 code units —
 * RFC 8785 §3.2.3. JS relational string comparison IS code-unit
 * comparison (unsigned, locale-independent), so this is the literal
 * spec algorithm.
 */
const compareUtf16 = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Validates that `value` contains no lone surrogates (RFC 8785
 * §3.2.2.2 Note: they break signatures) and returns its canonical
 * JSON form. `JSON.stringify` on a well-formed string performs exactly
 * the §3.2.2.2 escaping (control chars as lowercase `\uhhhh` except
 * `\b \t \n \f \r`, `\"` and `\\`, everything else literal).
 */
function escapeString(value: string): string {
  const n = value.length;
  for (let i = 0; i < n; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = i + 1 < n ? value.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        throw new CanonicalizationError(
          `lone high surrogate U+${unit.toString(16).padStart(4, '0')} in string`
        );
      }
      i++; // skip the low half of a valid surrogate pair
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new CanonicalizationError(
        `lone low surrogate U+${unit.toString(16).padStart(4, '0')} in string`
      );
    }
  }
  return JSON.stringify(value);
}

/**
 * Recursive serializer. `ancestors` holds the objects/arrays on the
 * current path for cycle detection — the same object referenced twice
 * WITHOUT a cycle (a DAG) stays legal.
 */
function serialize(value: JsonValue, ancestors: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      // NaN / ±Infinity are not permitted in JSON (RFC 8785 §3.2.2.3
      // Note). Every finite double serializes per ES6 — including
      // integers beyond the safe range (Appendix B vectors).
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`non-finite number is not JSON-representable: ${String(value)}`);
      }
      return String(value);

    case 'string':
      return escapeString(value);

    case 'object': {
      if (ancestors.has(value)) {
        throw new CanonicalizationError('circular reference detected');
      }
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          let out = '[';
          for (let i = 0; i < value.length; i++) {
            if (i > 0) out += ',';
            // Sparse holes read as undefined and fail closed below —
            // JSON.stringify-style silent skipping would be a
            // determinism hazard.
            out += serialize(value[i] as JsonValue, ancestors);
          }
          return out + ']';
        }

        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
          throw new CanonicalizationError(
            `non-plain object is not JSON-representable: ${value.constructor?.name ?? 'unknown prototype'}`
          );
        }
        const keys = Object.keys(value);
        for (const key of keys) {
          if ((value as { [key: string]: JsonValue })[key] === undefined) {
            throw new CanonicalizationError(`property "${key}" is undefined — not JSON-representable`);
          }
        }
        keys.sort(compareUtf16);
        let out = '{';
        for (let i = 0; i < keys.length; i++) {
          if (i > 0) out += ',';
          out += escapeString(keys[i]) + ':' + serialize((value as { [key: string]: JsonValue })[keys[i]], ancestors);
        }
        return out + '}';
      } finally {
        ancestors.delete(value);
      }
    }

    default:
      // bigint, symbol, function, undefined — nothing the JSON domain
      // can represent (ТЗ §2.2.6).
      throw new CanonicalizationError(`value of type ${typeof value} is not JSON-representable`);
  }
}

/**
 * Canonical bytes of `value` per RFC 8785 (JCS): UTF-16-sorted object
 * keys, ECMAScript number/string serialization, UTF-8 output.
 *
 * This is the primary contract (decision B1): pact signatures and
 * hashes are computed ONLY over the bytes returned here.
 *
 * Fail-closed — throws {@link CanonicalizationError} for any input
 * outside the JSON domain (BigInt, undefined, functions, symbols,
 * non-finite numbers, lone surrogates, sparse arrays, `undefined`
 * property values, non-plain objects, circular references).
 *
 * @param value - An already-parsed JSON value (I-JSON domain).
 * @returns The canonical UTF-8 bytes.
 * @since 1.0.0-rc.9
 *
 * @example
 * ```ts
 * import { canonicalize } from '@me2em/core';
 *
 * const bytes = canonicalize({ b: 2, a: [1, 'x'] }); // {"a":[1,"x"],"b":2}
 * ```
 */
export function canonicalize(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalizeToString(value));
}

/**
 * Same canonicalization as {@link canonicalize}, returned as a string —
 * for debugging and logs. `canonicalize(value)` is byte-identical to
 * `new TextEncoder().encode(canonicalizeToString(value))`.
 *
 * @param value - An already-parsed JSON value (I-JSON domain).
 * @returns The canonical JSON text (no whitespace, sorted keys).
 * @since 1.0.0-rc.9
 */
export function canonicalizeToString(value: JsonValue): string {
  return serialize(value, new Set<object>());
}
