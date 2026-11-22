// packages/pact/src/codec.ts
//
// Wire codec of the Pact Journal (ТЗ §2 codec.ts): encode/decode of
// journal events over JCS (RFC 8785, core rc.9) + strict parse.
//
// Strictness (PACTS D33 / Р6): the payload shape per event type is
// normative (PACTS §7.3) — an unknown field or a missing required one
// rejects with MALFORMED. Limits (D35) reject with PAYLOAD_TOO_LARGE.
// Inline material is check-verified against its commitment
// (SHA-256(UTF-8(cx)) == ch, SHA-256(UTF-8(doc)) == dh — D34).
//
// Duplicate JSON keys are out of scope by design (same decision as
// core rc.9 / P0.8 §2.2.3): the bytes are parsed once into a JS object
// where duplicate string keys cannot exist.

import { canonicalize, crypto, type JsonValue } from '@me2em/core';
import { PactError, type PactErrorContext } from './errors.js';
import { EVENT_TYPES, type Anchor, type Event, type EventType } from './types.js';

/** Envelope key set — exact (unknown or missing envelope field ⇒ MALFORMED). */
const ENVELOPE_KEYS = ['typ', 'pid', 'sq', 'ph', 'ty', 'pl', 'iat', 'sig'] as const;

/** JCS bytes of the event payload; over this limit the event rejects (D35). */
export const PAYLOAD_MAX_BYTES = 4096;
/** Inline `cx`/`doc` UTF-8 byte limit (D35). */
export const INLINE_MAX_BYTES = 2048;
/** Maximum signatures per event (D35). */
export const MAX_SIGNATURES = 16;
/** Maximum founders on GENESIS (D35). */
export const MAX_FOUNDERS = 16;

/** String field character limits (D35): dn ≤ 64, rs ≤ 256, no ≤ 32. */
const STR_LIMITS = { dn: 64, rs: 256, no: 32 } as const;

// ---------------------------------------------------------------------------
// base64url (RFC 4648 §5, unpadded, canonical)
// ---------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = new Map<string, number>([...B64].map((c, i) => [c, i]));

/** Unpadded base64url of bytes. */
export function b64urlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63];
  }
  return out;
}

/**
 * Strict base64url decode: alphabet-checked, length-checked, canonical
 * (re-encode must match), byte length pinned when `expectedBytes` given.
 * `context` — the layer reporting the failure (codec by default; the
 * derivation module reports `derive`).
 */
export function b64urlDecode(
  value: string,
  field: string,
  expectedBytes?: number,
  context: PactErrorContext = 'codec'
): Uint8Array {
  if (value.length % 4 === 1) {
    throw new PactError('MALFORMED', context, `${field}: invalid base64url length`);
  }
  const outLen =
    value.length % 4 === 0
      ? Math.floor(value.length / 4) * 3
      : Math.floor(value.length / 4) * 3 + (value.length % 4 - 1);
  const out = new Uint8Array(outLen);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < value.length; i++) {
    const idx = B64_INDEX.get(value[i]);
    if (idx === undefined) {
      throw new PactError('MALFORMED', context, `${field}: invalid base64url character`);
    }
    acc = ((acc << 6) | idx) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  if (b64urlEncode(out) !== value) {
    throw new PactError('MALFORMED', context, `${field}: non-canonical base64url`);
  }
  if (expectedBytes !== undefined && out.length !== expectedBytes) {
    throw new PactError('MALFORMED', context, `${field}: expected ${expectedBytes} bytes, got ${out.length}`);
  }
  return out;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const present = Object.keys(value);
  if (
    present.length !== keys.length ||
    !keys.every((k) => present.includes(k))
  ) {
    throw new PactError('MALFORMED', 'codec', `${field}: unknown or missing field (expected ${keys.join(', ')})`);
  }
}

// ---------------------------------------------------------------------------
// Payload validation (PACTS §7.3 — normative shape per event type)
// ---------------------------------------------------------------------------

interface FieldSpec {
  readonly name: string;
  readonly required: boolean;
  readonly kind: 'b64' | 'str' | 'int' | 'anchor' | 'constitution' | 'founders' | 'voucher' | 'reverseKind';
  readonly bytes?: number;
  readonly maxChars?: number;
  readonly maxBytes?: number;
  readonly min?: number;
}

const PAYLOAD_SPECS: Record<EventType, readonly FieldSpec[]> = {
  GENESIS: [
    { name: 'ch', required: true, kind: 'b64', bytes: 32 },
    { name: 'cx', required: false, kind: 'str', maxBytes: INLINE_MAX_BYTES },
    { name: 'cn', required: true, kind: 'constitution' },
    { name: 'ft', required: true, kind: 'founders' },
  ],
  INVITE: [
    { name: 'dn', required: false, kind: 'str', maxChars: STR_LIMITS.dn },
    { name: 'w', required: false, kind: 'int', min: 1 },
    { name: 'an', required: true, kind: 'anchor' },
  ],
  REVOKE_INVITE: [
    { name: 'ref', required: true, kind: 'b64', bytes: 32 },
    { name: 'rs', required: false, kind: 'str', maxChars: STR_LIMITS.rs },
  ],
  ENROLL: [
    { name: 'ref', required: true, kind: 'b64', bytes: 32 },
    { name: 'dn', required: false, kind: 'str', maxChars: STR_LIMITS.dn },
    { name: 'w', required: false, kind: 'int', min: 1 },
    { name: 'vc', required: false, kind: 'voucher' },
  ],
  EXIT: [{ name: 'rs', required: false, kind: 'str', maxChars: STR_LIMITS.rs }],
  EVICT: [
    { name: 'tp', required: true, kind: 'b64', bytes: 32 },
    { name: 'rs', required: false, kind: 'str', maxChars: STR_LIMITS.rs },
  ],
  ROTATE_KEY: [
    { name: 'np', required: true, kind: 'b64', bytes: 32 },
    { name: 'ca', required: false, kind: 'int', min: 0 },
  ],
  ACT: [
    { name: 'dh', required: false, kind: 'b64', bytes: 32 },
    { name: 'doc', required: false, kind: 'str', maxBytes: INLINE_MAX_BYTES },
    { name: 'no', required: false, kind: 'str', maxChars: STR_LIMITS.no },
  ],
  REVERSE_ACT: [
    { name: 'ref', required: true, kind: 'b64', bytes: 32 },
    { name: 'k', required: true, kind: 'reverseKind' },
    { name: 'rs', required: false, kind: 'str', maxChars: STR_LIMITS.rs },
  ],
  AMEND: [
    { name: 'cn', required: true, kind: 'constitution' },
    { name: 'no', required: false, kind: 'str', maxChars: STR_LIMITS.no },
  ],
  DISSOLVE: [{ name: 'rs', required: false, kind: 'str', maxChars: STR_LIMITS.rs }],
};

const ANCHORS: readonly Anchor[] = ['identity', 'handle', 'subhandle'];
const THRESHOLD_MODES = ['all', 'any', 'k-of-active', 'founder'] as const;

function validateConstitution(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new PactError('MALFORMED', 'codec', `${field}: must be an object`);
  }
  exactKeys(value, ['th', 'im', 'w'], field);
  const th = value['th'];
  if (!isPlainObject(th)) {
    throw new PactError('MALFORMED', 'codec', `${field}.th: must be an object`);
  }
  for (const ty of Object.keys(th)) {
    if (!EVENT_TYPES.includes(ty as EventType)) {
      throw new PactError('MALFORMED', 'codec', `${field}.th: unknown event type "${ty}"`);
    }
    const t = th[ty];
    if (!isPlainObject(t)) {
      throw new PactError('MALFORMED', 'codec', `${field}.th.${ty}: must be an object`);
    }
    const tKeys = Object.keys(t);
    if (tKeys.length !== 1 && !(tKeys.length === 2 && tKeys.includes('k'))) {
      throw new PactError('MALFORMED', 'codec', `${field}.th.${ty}: unknown field`);
    }
    const m = t['m'];
    if (typeof m !== 'string' || !THRESHOLD_MODES.includes(m as never)) {
      throw new PactError('MALFORMED', 'codec', `${field}.th.${ty}: unknown threshold mode`);
    }
    const k = t['k'];
    if (m === 'k-of-active') {
      if (!Number.isSafeInteger(k) || (k as number) < 1) {
        throw new PactError('MALFORMED', 'codec', `${field}.th.${ty}: k-of-active requires integer k ≥ 1`);
      }
    } else if (k !== undefined) {
      throw new PactError('MALFORMED', 'codec', `${field}.th.${ty}: k is only meaningful for k-of-active`);
    }
  }
  const im = value['im'];
  if (im !== 'pinned' && im !== 'bearer') {
    throw new PactError('MALFORMED', 'codec', `${field}.im: must be 'pinned' or 'bearer'`);
  }
  if (typeof value['w'] !== 'boolean') {
    throw new PactError('MALFORMED', 'codec', `${field}.w: must be a boolean`);
  }
}

function validateVoucher(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new PactError('MALFORMED', 'codec', `${field}: must be an object`);
  }
  exactKeys(value, ['rh', 'rp'], field);
  b64urlDecode(value['rh'] as string, `${field}.rh`, 32);
  b64urlDecode(value['rp'] as string, `${field}.rp`, 32);
}

function validateFounder(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new PactError('MALFORMED', 'codec', `${field}: must be an object`);
  }
  const required = ['p', 'pp', 'an'];
  const present = Object.keys(value);
  const extra = present.filter((k) => k !== 'w' && k !== 'vc');
  if (
    extra.length !== required.length ||
    !required.every((k) => present.includes(k))
  ) {
    throw new PactError('MALFORMED', 'codec', `${field}: unknown or missing field (expected p, pp, an, w?, vc?)`);
  }
  b64urlDecode(value['p'] as string, `${field}.p`, 32);
  b64urlDecode(value['pp'] as string, `${field}.pp`, 32);
  const an = value['an'];
  if (typeof an !== 'string' || !ANCHORS.includes(an as Anchor)) {
    throw new PactError('MALFORMED', 'codec', `${field}.an: unknown anchor type`);
  }
  const w = value['w'];
  if (w !== undefined && (!Number.isSafeInteger(w) || (w as number) < 1)) {
    throw new PactError('MALFORMED', 'codec', `${field}.w: must be an integer ≥ 1`);
  }
  if (value['vc'] !== undefined) {
    validateVoucher(value['vc'], `${field}.vc`);
  }
}

function validateField(spec: FieldSpec, value: unknown, field: string): void {
  switch (spec.kind) {
    case 'b64': {
      if (typeof value !== 'string') {
        throw new PactError('MALFORMED', 'codec', `${field}: must be a base64url string`);
      }
      b64urlDecode(value, field, spec.bytes);
      return;
    }
    case 'str': {
      if (typeof value !== 'string') {
        throw new PactError('MALFORMED', 'codec', `${field}: must be a string`);
      }
      if (spec.maxChars !== undefined && [...value].length > spec.maxChars) {
        throw new PactError('PAYLOAD_TOO_LARGE', 'codec', `${field}: exceeds ${spec.maxChars} characters`);
      }
      if (spec.maxBytes !== undefined && utf8(value).length > spec.maxBytes) {
        throw new PactError('PAYLOAD_TOO_LARGE', 'codec', `${field}: exceeds ${spec.maxBytes} bytes`);
      }
      return;
    }
    case 'int': {
      if (!Number.isSafeInteger(value) || (spec.min !== undefined && (value as number) < spec.min)) {
        throw new PactError('MALFORMED', 'codec', `${field}: must be an integer${spec.min !== undefined ? ` ≥ ${spec.min}` : ''}`);
      }
      return;
    }
    case 'anchor': {
      if (typeof value !== 'string' || !ANCHORS.includes(value as Anchor)) {
        throw new PactError('MALFORMED', 'codec', `${field}: unknown anchor type`);
      }
      return;
    }
    case 'reverseKind': {
      if (value !== 'supersede' && value !== 'reversal') {
        throw new PactError('MALFORMED', 'codec', `${field}: must be 'supersede' or 'reversal'`);
      }
      return;
    }
    case 'constitution': {
      validateConstitution(value, field);
      return;
    }
    case 'founders': {
      if (!Array.isArray(value)) {
        throw new PactError('MALFORMED', 'codec', `${field}: must be an array`);
      }
      if (value.length < 1 || value.length > MAX_FOUNDERS) {
        throw new PactError('PAYLOAD_TOO_LARGE', 'codec', `${field}: must contain 1..${MAX_FOUNDERS} founders`);
      }
      let prev = '';
      for (let i = 0; i < value.length; i++) {
        validateFounder(value[i], `${field}[${i}]`);
        const p = (value[i] as Record<string, unknown>)['p'] as string;
        // Roster/founder order is normative (PACTS §7.3): strictly
        // ascending by pactPub, no duplicates.
        if (i > 0 && !(prev < p)) {
          throw new PactError('MALFORMED', 'codec', `${field}: founders must be sorted by p (strictly ascending)`);
        }
        prev = p;
      }
      return;
    }
    case 'voucher': {
      validateVoucher(value, field);
      return;
    }
  }
}

/**
 * Strict payload validation for `ty` (PACTS §7.3 + D35 limits + D34
 * check-verification). Used by `decodeEvent` and by every assembler —
 * both sides fail closed.
 */
export function assertValidPayload(ty: EventType, pl: Record<string, unknown>): void {
  const spec = PAYLOAD_SPECS[ty];
  for (const key of Object.keys(pl)) {
    if (!spec.some((f) => f.name === key)) {
      throw new PactError('MALFORMED', 'codec', `pl: unknown payload field "${key}" for ${ty}`);
    }
  }
  for (const f of spec) {
    const value = pl[f.name];
    if (value === undefined) {
      if (f.required) {
        throw new PactError('MALFORMED', 'codec', `pl: missing required field "${f.name}" for ${ty}`);
      }
      continue;
    }
    validateField(f, value, `pl.${f.name}`);
  }

  // D34 check-verification of inline material against its commitment.
  if (ty === 'GENESIS' && pl['cx'] !== undefined) {
    if (b64urlEncode(crypto.sha256(utf8(pl['cx'] as string))) !== pl['ch']) {
      throw new PactError('MALFORMED', 'codec', 'pl.cx: SHA-256(UTF-8(cx)) != ch');
    }
  }
  if (ty === 'ACT' && pl['doc'] !== undefined) {
    if (pl['dh'] === undefined) {
      throw new PactError('MALFORMED', 'codec', 'pl.doc: inline doc requires dh');
    }
    if (b64urlEncode(crypto.sha256(utf8(pl['doc'] as string))) !== pl['dh']) {
      throw new PactError('MALFORMED', 'codec', 'pl.doc: SHA-256(UTF-8(doc)) != dh');
    }
  }

  // D35: canonical payload ≤ 4096 B.
  if (canonicalize(pl as unknown as JsonValue).length > PAYLOAD_MAX_BYTES) {
    throw new PactError('PAYLOAD_TOO_LARGE', 'codec', `pl exceeds ${PAYLOAD_MAX_BYTES} bytes`);
  }
}

// ---------------------------------------------------------------------------
// Envelope codec
// ---------------------------------------------------------------------------

/**
 * Canonical wire bytes of the event: JCS(event) — UTF-8. No schema
 * validation here (assemblers build valid events; the strict gate is
 * `decodeEvent` / `assertValidPayload`).
 */
export function encodeEvent(event: Event): Uint8Array {
  try {
    return canonicalize(event as unknown as JsonValue);
  } catch {
    throw new PactError('MALFORMED', 'codec', 'event is not JSON-representable');
  }
}

/**
 * Strict parse of canonical event bytes: UTF-8 → JSON → exact envelope
 * shape → per-type payload validation. Any deviation rejects
 * (`MALFORMED` / `PAYLOAD_TOO_LARGE`); nothing is skipped or coerced.
 */
export function decodeEvent(bytes: Uint8Array): Event {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PactError('MALFORMED', 'codec', 'event bytes are not valid UTF-8');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PactError('MALFORMED', 'codec', 'event is not valid JSON');
  }
  if (!isPlainObject(raw)) {
    throw new PactError('MALFORMED', 'codec', 'event must be a JSON object');
  }
  exactKeys(raw, ENVELOPE_KEYS, 'event');

  const typ = raw['typ'];
  if (typ !== 'me2em/pact-event/v1') {
    throw new PactError('MALFORMED', 'codec', `typ: unknown envelope version ${JSON.stringify(typ)}`);
  }
  if (typeof raw['pid'] !== 'string') {
    throw new PactError('MALFORMED', 'codec', 'pid: must be a base64url string');
  }
  b64urlDecode(raw['pid'], 'pid', 16);
  const sq = raw['sq'];
  if (!Number.isSafeInteger(sq) || (sq as number) < 0) {
    throw new PactError('MALFORMED', 'codec', 'sq: must be an integer ≥ 0');
  }
  if (typeof raw['ph'] !== 'string') {
    throw new PactError('MALFORMED', 'codec', 'ph: must be a base64url string');
  }
  b64urlDecode(raw['ph'], 'ph', 32);
  const ty = raw['ty'];
  if (typeof ty !== 'string' || !EVENT_TYPES.includes(ty as EventType)) {
    throw new PactError('MALFORMED', 'codec', `ty: unknown event type ${JSON.stringify(ty)}`);
  }
  const pl = raw['pl'];
  if (!isPlainObject(pl)) {
    throw new PactError('MALFORMED', 'codec', 'pl: must be an object');
  }
  const iat = raw['iat'];
  if (!Number.isSafeInteger(iat) || (iat as number) < 0) {
    throw new PactError('MALFORMED', 'codec', 'iat: must be an integer ≥ 0');
  }
  const sig = raw['sig'];
  if (!Array.isArray(sig)) {
    throw new PactError('MALFORMED', 'codec', 'sig: must be an array');
  }
  if (sig.length > MAX_SIGNATURES) {
    throw new PactError('PAYLOAD_TOO_LARGE', 'codec', `sig exceeds ${MAX_SIGNATURES} signatures`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < sig.length; i++) {
    const s = sig[i];
    if (!isPlainObject(s)) {
      throw new PactError('MALFORMED', 'codec', `sig[${i}]: must be an object`);
    }
    exactKeys(s, ['p', 's'], `sig[${i}]`);
    b64urlDecode(s['p'] as string, `sig[${i}].p`, 32);
    b64urlDecode(s['s'] as string, `sig[${i}].s`, 64);
    const p = s['p'] as string;
    if (seen.has(p)) {
      throw new PactError('MALFORMED', 'codec', `sig[${i}].p: duplicate signer`);
    }
    seen.add(p);
  }

  assertValidPayload(ty as EventType, pl);
  return {
    typ: 'me2em/pact-event/v1',
    pid: raw['pid'] as string,
    sq: sq as number,
    ph: raw['ph'] as string,
    ty: ty as EventType,
    pl,
    iat: iat as number,
    sig: sig as Event['sig'],
  };
}

// ---------------------------------------------------------------------------
// TBS / evHash (PACTS §7.2, D32)
// ---------------------------------------------------------------------------

/**
 * To-be-signed bytes: JCS(event without the `sig` field). `typ`/`pid`
 * inside TBS give domain separation and anti-replay (D32).
 */
export function tbsBytes(event: Event): Uint8Array {
  return canonicalize({
    typ: event.typ,
    pid: event.pid,
    sq: event.sq,
    ph: event.ph,
    ty: event.ty,
    pl: event.pl as unknown as JsonValue,
    iat: event.iat,
  } as unknown as JsonValue);
}

/**
 * Event id (PACTS §2): b64url(SHA-256(TBS)). Journal chaining, roster
 * membership ids, ACT references and the JournalHead are all evHashes.
 */
export function evHash(event: Event): string {
  return b64urlEncode(crypto.sha256(tbsBytes(event)));
}

/** The empty-chain head: b64url of 32 zero bytes (PACTS §2). */
export const ZERO32: string = b64urlEncode(new Uint8Array(32));
