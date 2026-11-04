// attestation.ts
//
// Attestation module: cryptographically signed, self-contained
// authorization attestations for the Me2eM protocol.

import { normalizeName } from './canonical-name.js';
import { base64urlEncode, base64urlDecode, randomUUID, safeJsonParse } from './util.js';
import { ed } from './crypto/init.js';
import type { Signer } from './types.js';
import { AttestationError, type AttestationErrorCode } from './errors.js';
import { getWalletAdapter, isValidChain } from './payment.js';

export { AttestationError, type AttestationErrorCode, type AttestationLevel } from './errors.js';

export const ATTESTATION_TYPE = 'me2em/attestation/v1';
export const ATTESTATION_MAX_PAYLOAD = 2048;

/** Maximum accepted length of an attestation `jti` (hardening, PR-7). */
const MAX_JTI_LENGTH = 256;

export interface AttestationGrant {
  /**
   * Audiences the subject may create sessions for.
   * `undefined` = unrestricted; `[]` = deny all (fail-closed).
   */
  audiences?: string[];
  /**
   * Exact scope strings the subject may request. Wildcards are NOT
   * supported here — only `subNamePatterns` supports wildcards.
   */
  scopes: string[];
  /**
   * Maximum session TTL (seconds) the subject may create. Must be a
   * finite positive number.
   */
  maxSessionTtl: number;
  /**
   * Permitted child (SubHandle) names. Only meaningful on
   * Identity→Handle attestations. Each pattern is either an exact name
   * or ends with a single trailing `*` (prefix match); a lone `*`
   * matches everything. Patterns like `a*b` are rejected at issue time.
   */
  subNamePatterns?: string[];
}

export interface AttestationPayload {
  typ: typeof ATTESTATION_TYPE;
  subjectName: string;
  subjectId: string;
  grant: AttestationGrant;
  iat: number;
  exp: number;
  jti: string;
  /**
   * v1 optional extensions (specs/v1.0.md §5.1) — the canonical tail of
   * the serialization order: `…, jti, subjectWallet, subjectWalletChain,
   * subjectWalletPath`. Absent fields are omitted entirely (never
   * `null`, never `""`); tokens without them are byte-identical to the
   * pre-extension format. Pairing (address ⇔ chain, path ⇒ address) is
   * enforced at issue time; decode tolerates any string values.
   */
  subjectWallet?: string;
  subjectWalletChain?: string;
  subjectWalletPath?: string;
}

function throwFormat(code: AttestationErrorCode, msg: string): never {
  throw new AttestationError(code, 'FORMAT', msg);
}

type ParseResult = {
  payloadBytes: Uint8Array;
  signatureBytes: Uint8Array;
  payload: AttestationPayload;
};

function parseToken(token: string): ParseResult {
  if (typeof token !== 'string') {
    throwFormat('MALFORMED', 'Token must be a string');
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    throwFormat('MALFORMED', 'Token must have exactly two parts separated by "."');
  }

  const [payloadB64, signatureB64] = parts;

  const b64urlRegex = /^[A-Za-z0-9_-]+$/;
  if (!b64urlRegex.test(payloadB64) || !b64urlRegex.test(signatureB64)) {
    throwFormat('MALFORMED', 'Payload and signature must be valid Base64URL');
  }

  let payloadBytes: Uint8Array;
  try {
    payloadBytes = base64urlDecode(payloadB64);
  } catch {
    throwFormat('MALFORMED', 'Payload and signature must be valid Base64URL');
  }
  if (payloadBytes.length > ATTESTATION_MAX_PAYLOAD) {
    throwFormat('MALFORMED', `Payload exceeds maximum size of ${ATTESTATION_MAX_PAYLOAD} bytes`);
  }

  let payload: AttestationPayload;
  try {
    const jsonString = new TextDecoder().decode(payloadBytes);
    payload = safeJsonParse(jsonString) as AttestationPayload;
  } catch (e) {
    throwFormat(
      'MALFORMED',
      e instanceof SyntaxError && e.message.includes('__proto__')
        ? `Payload is not valid JSON — ${e.message}`
        : 'Payload is not valid JSON'
    );
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64urlDecode(signatureB64);
  } catch {
    throwFormat('MALFORMED', 'Payload and signature must be valid Base64URL');
  }

  return { payloadBytes, signatureBytes, payload };
}

/**
 * Validates the v1 optional wallet extensions (§5.1) passed in
 * `Attestation.issue` opts. No-op when all three are absent. Order is
 * normative:
 *
 * 1. Pairing (§5.1 rule 2) — `subjectWallet` and `subjectWalletChain`
 *    together or not at all (a chain without an address is invalid);
 *    `subjectWalletPath` only with an address. These checks PRECEDE any
 *    adapter lookup.
 * 2. Structural (rule 4) — every present field is a non-empty string
 *    without any whitespace character (the full `\s` class: space, tab,
 *    newline, vertical tab, form feed, carriage return, NBSP and other
 *    Unicode space separators).
 * 3. CAIP-2 grammar (rule 4) — `subjectWalletChain` via
 *    `isValidChain` (namespace `[-a-z0-9]{3,8}`, reference
 *    `[-a-zA-Z0-9]{1,64}`).
 * 4. Adapter-aware, fail-closed (rule 5) — when an adapter is
 *    registered for the exact chain value, the address MUST pass
 *    `adapter.isValidAddress()`; otherwise issuance applies rules 1–3
 *    only (identity-only context). On-curve is deliberately not checked
 *    here — it belongs to wallet-binding verification.
 */
function validateWalletOpts(
  opts?: { subjectWallet?: string; subjectWalletChain?: string; subjectWalletPath?: string }
): { subjectWallet?: string; subjectWalletChain?: string; subjectWalletPath?: string } {
  const { subjectWallet, subjectWalletChain, subjectWalletPath } = opts ?? {};

  // 1. Pairing — before any adapter lookup: the wallet fields are issued
  // in pairs (both or none), and a derivation path requires an address.
  // The nested guards keep every failure message distinct and let the
  // compiler narrow `subjectWallet` / `subjectWalletChain` to `string`
  // for steps 2–4 (no casts).
  if (subjectWallet === undefined) {
    if (subjectWalletChain !== undefined) {
      throwFormat(
        'MALFORMED',
        'subjectWalletChain without subjectWallet — the wallet fields are issued in pairs (both or none)'
      );
    }
    if (subjectWalletPath !== undefined) {
      throwFormat(
        'MALFORMED',
        'subjectWalletPath without subjectWallet — a derivation path requires an address'
      );
    }
    return {};
  }
  if (subjectWalletChain === undefined) {
    throwFormat(
      'MALFORMED',
      'subjectWallet without subjectWalletChain — the wallet fields are issued in pairs (both or none)'
    );
  }

  // 2. Structural: string type, non-empty, no whitespace (full \s class).
  // The wallet and chain are both present here (pairing above); the typeof
  // checks stay as a fail-closed runtime defense for untyped JS callers.
  const present: Array<[string, string]> = [
    ['subjectWallet', subjectWallet],
    ['subjectWalletChain', subjectWalletChain],
  ];
  if (subjectWalletPath !== undefined) present.push(['subjectWalletPath', subjectWalletPath]);
  for (const [field, value] of present) {
    if (typeof value !== 'string') {
      throwFormat('MALFORMED', `${field} must be a string`);
    }
    if (value.length === 0) {
      throwFormat('MALFORMED', `${field} must not be empty`);
    }
    if (/\s/.test(value)) {
      throwFormat(
        'MALFORMED',
        `${field} must not contain whitespace (space, tab, newline, NBSP or any other \\s character)`
      );
    }
  }

  // 3. CAIP-2 grammar for the chain (grammar lives in core — v1.2 §0.3).
  if (!isValidChain(subjectWalletChain)) {
    throwFormat(
      'MALFORMED',
      `subjectWalletChain is not a valid CAIP-2 chain id: ${JSON.stringify(subjectWalletChain)}`
    );
  }

  // 4. Adapter-aware validation, fail-closed (§5.1 rule 5). Exact-CAIP-2
  // registry lookup; without a registered adapter only rules 1–3 apply.
  const adapter = getWalletAdapter(subjectWalletChain);
  if (adapter !== null && !adapter.isValidAddress(subjectWallet)) {
    throwFormat(
      'MALFORMED',
      `subjectWallet failed adapter address validation for ${adapter.chain}`
    );
  }

  return { subjectWallet, subjectWalletChain, subjectWalletPath };
}

/**
 * A parent-signed statement binding a derived child key to a name and a
 * grant. Chains of attestations (`Identity → Handle → SubHandle`) allow
 * any third party to verify sessions offline using only the root public
 * key, with grant constraints enforced at verification time.
 *
 * Tokens have the form `base64url(payload).base64url(signature)` and are
 * deterministic: the same inputs (including `jti` and `now`) always
 * produce byte-identical tokens.
 *
   * @example
   * ```ts
   * import { ed25519 } from '@noble/curves/ed25519.js';
   *
   * // Issuer (a Signer — Identity/Handle qualify) and subject public key:
   * const identity = await Identity.fromSeed(seed);
   * const childPub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());
   *
   * const A = await Attestation.issue(identity, childPub, 'station-001', {
   *   audiences: ['ev-app.com'],
   *   scopes: ['charge:start', 'charge:stop'],
   *   maxSessionTtl: 7200,
   *   subNamePatterns: ['connector-*'],
   * });
   *
   * const ok = await Attestation.verifySignature(A.token, identity.getPublicKey()); // true
   * const payload = Attestation.decode(A.token); // structure only — no sig, no time
   * ```
 *
 * @category Core Primitives
 */
export class Attestation {
  private readonly _payload: AttestationPayload;
  private readonly _token: string;

  private constructor(payload: AttestationPayload, token: string) {
    this._payload = payload;
    this._token = token;
  }

  get payload(): AttestationPayload {
    return this._payload;
  }

  get token(): string {
    return this._token;
  }

  get jti(): string {
    return this._payload.jti;
  }

  /**
   * Parses a token and validates its structure WITHOUT checking the
   * signature or any timestamps. Use {@link verifySignature} for the
   * signature; expiration is checked by `Session.verifyAttested`.
   *
   * @throws {AttestationError} `MALFORMED`/`FORMAT` on any structural
   *   problem: wrong shape, invalid Base64URL, size over
   *   {@link ATTESTATION_MAX_PAYLOAD}, non-JSON payload, wrong `typ`,
   *   missing/ill-typed fields, or a non-positive/NaN `maxSessionTtl`.
   */
  static decode(token: string): AttestationPayload {
    const { payload } = parseToken(token);

    if (payload.typ !== ATTESTATION_TYPE) {
      throwFormat('MALFORMED', `Invalid typ: expected "${ATTESTATION_TYPE}"`);
    }

    if (typeof payload.subjectName !== 'string') {
      throwFormat('MALFORMED', 'Missing required field: subjectName');
    }
    if (typeof payload.subjectId !== 'string') {
      throwFormat('MALFORMED', 'Missing required field: subjectId');
    }

    if (
      typeof payload.grant !== 'object' ||
      payload.grant === null ||
      Array.isArray(payload.grant)
    ) {
      throwFormat('MALFORMED', 'Invalid field: grant');
    }

    if (!Array.isArray(payload.grant.scopes) || !payload.grant.scopes.every((s: unknown) => typeof s === 'string')) {
      throwFormat('MALFORMED', 'Invalid field: grant.scopes');
    }

    if (typeof payload.grant.maxSessionTtl !== 'number' || !Number.isFinite(payload.grant.maxSessionTtl) || payload.grant.maxSessionTtl <= 0) {
      throwFormat('MALFORMED', 'Invalid field: grant.maxSessionTtl');
    }

    if (payload.grant.audiences !== undefined) {
      if (!Array.isArray(payload.grant.audiences) || !payload.grant.audiences.every((a: unknown) => typeof a === 'string')) {
        throwFormat('MALFORMED', 'Invalid field: grant.audiences');
      }
    }

    if (payload.grant.subNamePatterns !== undefined) {
      if (!Array.isArray(payload.grant.subNamePatterns) || !payload.grant.subNamePatterns.every((p: unknown) => typeof p === 'string')) {
        throwFormat('MALFORMED', 'Invalid field: grant.subNamePatterns');
      }
    }

    if (typeof payload.iat !== 'number') {
      throwFormat('MALFORMED', 'Missing required field: iat');
    }
    if (typeof payload.exp !== 'number') {
      throwFormat('MALFORMED', 'Missing required field: exp');
    }
    // Non-finite numbers survive JSON.parse only as `Infinity` (e.g. 1e999);
    // unchecked, `now > exp + skew` would be false forever — fail-open expiry.
    if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) {
      throwFormat('MALFORMED', 'iat/exp must be finite numbers');
    }
    if (payload.exp <= payload.iat) {
      throwFormat('MALFORMED', 'exp must be greater than iat');
    }
    if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
      throwFormat('MALFORMED', 'Missing required field: jti');
    }
    if (payload.jti.length > MAX_JTI_LENGTH) {
      throwFormat('MALFORMED', `jti exceeds the maximum length of ${MAX_JTI_LENGTH} characters`);
    }

    // v1 optional extensions (§5.1) — decode tolerance: when present,
    // the fields must be strings; pairing, grammar and on-curve checks
    // are deliberately NOT repeated at decode. A verifier that does not
    // implement the extension MUST NOT reject tokens carrying it — the
    // fields are payload bytes covered by the signature (§4).
    if (payload.subjectWallet !== undefined && typeof payload.subjectWallet !== 'string') {
      throwFormat('MALFORMED', 'Invalid field: subjectWallet');
    }
    if (payload.subjectWalletChain !== undefined && typeof payload.subjectWalletChain !== 'string') {
      throwFormat('MALFORMED', 'Invalid field: subjectWalletChain');
    }
    if (payload.subjectWalletPath !== undefined && typeof payload.subjectWalletPath !== 'string') {
      throwFormat('MALFORMED', 'Invalid field: subjectWalletPath');
    }

    return payload;
  }

  /**
    * Verifies the token signature against a public key.
    *
    * A signature whose length differs from the 64-byte Ed25519 size is
    * rejected with `false` before any crypto runs (PR-7 pre-check) —
    * the method therefore never throws for short/long signatures.
    *
    * @returns `false` for a bad signature or a wrong key. Returns
    *   `false` for any invalid signature, including malformed lengths.
    *   It still throws `AttestationError` `MALFORMED`/`FORMAT` for
    *   structurally invalid tokens (see {@link decode}).
    */
   static async verifySignature(token: string, signerPublicKey: Uint8Array): Promise<boolean> {
     const { signatureBytes, payloadBytes } = parseToken(token);
     // Ed25519 signatures are exactly 64 bytes — reject other lengths
     // before the curve math (the underlying library throws RangeError).
     if (signatureBytes.length !== 64) {
       return false;
     }
     try {
       return ed.verify(signatureBytes, payloadBytes, signerPublicKey);
     } catch {
       return false;
     }
   }

  /**
   * Wildcard name matching used for `subNamePatterns`.
   * A pattern matches if it equals `name`, or ends with `*` and `name`
   * starts with the pattern's prefix. A lone `*` matches everything.
   *
   * @example
   * ```ts
   * Attestation.matchNamePattern('connector-1', ['connector-*']); // true
   * Attestation.matchNamePattern('meter-1',    ['connector-*']); // false
   * Attestation.matchNamePattern('anything',   ['*']);           // true
   * ```
   */
  static matchNamePattern(name: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (pattern === '*') return true;
      if (pattern.endsWith('*')) {
        if (name.startsWith(pattern.slice(0, -1))) return true;
      } else {
        if (pattern === name) return true;
      }
    }
    return false;
  }

  /**
   * Creates and signs a new attestation.
   *
   * The subject name is canonicalized (NFKC → lowercase → trim) before
   * signing; the subject public key must be exactly 32 bytes. Serialization is
   * deterministic: fields are emitted in a fixed order and
   * `undefined` grant fields are omitted from the JSON entirely
   * (distinguishable from `[]`).
   *
   * The `signer` is a {@link Signer} — typically the issuing
   * {@link Identity} (root attestations) or {@link Handle} (SubHandle
   * attestations). Raw private keys never cross a trust boundary as
   * function arguments (D2): the key material stays encapsulated in the
   * signer object.
   *
   * @param signer - Object producing the Ed25519 signature via
   *   `sign(data)`. `Identity` and `Handle` implement `Signer`; custom
   *   implementations (remote/HSM-backed signing) are accepted
   *   structurally.
   * @param subjectPublicKey - 32-byte Ed25519 public key being attested.
   * @param subjectName - Child name; canonicalized before signing.
   * @param grant - Constraints enforced by verifiers (Mode 2).
   * @param opts - Lifetime control: `ttlSeconds` (default one year),
   *   `expiresAt` (overrides `ttlSeconds`), `jti` (default random UUID),
   *   `now` (fixed clock for deterministic tests). Optional wallet
   *   extensions (specs/v1.0.md §5.1): `subjectWallet`,
   *   `subjectWalletChain` (exact CAIP-2) and `subjectWalletPath` —
   *   emitted in that canonical order after `jti`; absent fields are
   *   omitted (byte-identity for tokens without them). Pairing and
   *   structural rules are enforced at issue time; when an adapter is
   *   registered for the chain, the address must pass
   *   `adapter.isValidAddress()` (fail-closed).
   * @returns The attestation with `payload`, `token` and `jti` accessors.
   * @throws {AttestationError} `MALFORMED`/`FORMAT` if the grant is
   *   structurally invalid (bad scopes/TTL/audiences or a wildcard
   *   not at the end of a `subNamePatterns` entry).
   * @throws {TypeError} If `signer` has no callable `sign` method — e.g.
   *   when a raw private key is passed (the pre-v1.0 form is no longer
   *   accepted).
   * @throws {Error} If `subjectPublicKey` is not 32 bytes.
   *
   * @example
   * ```ts
   * const att = await Attestation.issue(rootIdentity, childPub, 'Station-1',
   *   { scopes: ['read'], maxSessionTtl: 3600 }, { ttlSeconds: 600 });
   * ```
   */
  static async issue(
    signer: Signer,
    subjectPublicKey: Uint8Array,
    subjectName: string,
    grant: AttestationGrant,
    opts?: {
      ttlSeconds?: number; expiresAt?: number; jti?: string; now?: number;
      subjectWallet?: string; subjectWalletChain?: string; subjectWalletPath?: string;
    }
  ): Promise<Attestation> {
    if (typeof (signer as Signer | undefined)?.sign !== 'function') {
      throw new TypeError(
        'Attestation.issue requires a Signer — an object with a sign(data) ' +
        'method (Identity or Handle). Raw private keys are no longer accepted.'
      );
    }

    const name = normalizeName(subjectName);

    if (subjectPublicKey.length !== 32) {
      throwFormat('MALFORMED', 'subject public key must be 32 bytes');
    }

    if (opts?.jti !== undefined &&
        (typeof opts.jti !== 'string' || opts.jti.length === 0 || opts.jti.length > MAX_JTI_LENGTH)) {
      throwFormat(
        'MALFORMED',
        `opts.jti must be a non-empty string of at most ${MAX_JTI_LENGTH} characters`
      );
    }

    // Validate grant
    if (!Array.isArray(grant.scopes) || !grant.scopes.every((s: unknown) => typeof s === 'string')) {
      throwFormat('MALFORMED', 'grant.scopes must be an array of strings');
    }
    if (typeof grant.maxSessionTtl !== 'number' || !Number.isFinite(grant.maxSessionTtl) || grant.maxSessionTtl <= 0) {
      throwFormat('MALFORMED', 'grant.maxSessionTtl must be a finite positive number');
    }
    if (grant.audiences !== undefined) {
      if (!Array.isArray(grant.audiences) || !grant.audiences.every((a: unknown) => typeof a === 'string')) {
        throwFormat('MALFORMED', 'grant.audiences must be an array of strings');
      }
    }
    if (grant.subNamePatterns !== undefined) {
      if (!Array.isArray(grant.subNamePatterns) || !grant.subNamePatterns.every((p: unknown) => typeof p === 'string')) {
        throwFormat('MALFORMED', 'grant.subNamePatterns must be an array of strings');
      }
      for (const pattern of grant.subNamePatterns) {
        const starIndex = pattern.indexOf('*');
        if (starIndex !== -1 && starIndex !== pattern.length - 1) {
          throwFormat('MALFORMED', `Invalid pattern: ${JSON.stringify(pattern)} — '*' only allowed at end`);
        }
      }
    }

    // Validate the v1 optional wallet extensions (§5.1): pairing first
    // (precedes any adapter lookup), then structural checks, CAIP-2
    // grammar and the fail-closed adapter check. Runs only when at
    // least one wallet field is present.
    const walletFields = validateWalletOpts(opts);

    const now = opts?.now ?? Math.floor(Date.now() / 1000);
    const exp = opts?.expiresAt ?? (now + (opts?.ttlSeconds ?? 31536000));
    const jti = opts?.jti ?? randomUUID();

    const grantJson: Record<string, unknown> = {};
    if (grant.audiences !== undefined) grantJson.audiences = [...grant.audiences];
    grantJson.scopes = [...grant.scopes];
    grantJson.maxSessionTtl = grant.maxSessionTtl;
    if (grant.subNamePatterns !== undefined)
      grantJson.subNamePatterns = [...grant.subNamePatterns];

    const payload: AttestationPayload = {
      typ: ATTESTATION_TYPE,
      subjectName: name,
      subjectId: base64urlEncode(subjectPublicKey),
      grant: grantJson as unknown as AttestationGrant,
      iat: now,
      exp,
      jti,
    };

    // Canonical tail order (§5.1 rule 1): wallet fields follow jti in
    // exactly this order; absent fields are omitted entirely — tokens
    // without them stay byte-identical to the pre-extension format.
    if (walletFields.subjectWallet !== undefined) {
      payload.subjectWallet = walletFields.subjectWallet;
      payload.subjectWalletChain = walletFields.subjectWalletChain;
      if (walletFields.subjectWalletPath !== undefined) {
        payload.subjectWalletPath = walletFields.subjectWalletPath;
      }
    }

    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const signature = await signer.sign(payloadBytes);
    const payloadB64 = base64urlEncode(payloadBytes);
    const signatureB64 = base64urlEncode(signature);
    const token = `${payloadB64}.${signatureB64}`;

    return new Attestation(payload, token);
  }
}
