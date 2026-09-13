// attestation.ts
//
// Attestation module: cryptographically signed, self-contained
// authorization attestations for the Me2em protocol.

import { normalizeName } from './canonical-name.js';
import { base64urlEncode, base64urlDecode } from './util.js';
import { ed } from './crypto/init.js';

export const ATTESTATION_TYPE = 'me2em/attestation/v1';
export const ATTESTATION_MAX_PAYLOAD = 2048;

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
}

export type AttestationErrorCode =
  | 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'NOT_YET_VALID'
  | 'REVOKED' | 'PATH_MISMATCH' | 'NAME_NOT_PERMITTED'
  | 'SCOPE_EXCEEDED' | 'AUDIENCE_NOT_PERMITTED' | 'TTL_EXCEEDED'
  | 'CHAIN_INCOMPLETE' | 'SUBJECT_MISMATCH' | 'SESSION_OUTLIVES_ATTESTATION';

export type AttestationLevel =
  | 'ROOT' | 'HANDLE_ATTESTATION' | 'SUB_ATTESTATION' | 'SESSION' | 'FORMAT';

export class AttestationError extends Error {
  constructor(
    public readonly code: AttestationErrorCode,
    public readonly level: AttestationLevel,
    msg: string
  ) { super(`[${level}/${code}] ${msg}`); }
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

  const payloadBytes = base64urlDecode(payloadB64);
  if (payloadBytes.length > ATTESTATION_MAX_PAYLOAD) {
    throwFormat('MALFORMED', `Payload exceeds maximum size of ${ATTESTATION_MAX_PAYLOAD} bytes`);
  }

  let payload: AttestationPayload;
  try {
    const jsonString = new TextDecoder().decode(payloadBytes);
    payload = JSON.parse(jsonString) as AttestationPayload;
  } catch {
    throwFormat('MALFORMED', 'Payload is not valid JSON');
  }

  const signatureBytes = base64urlDecode(signatureB64);

  return { payloadBytes, signatureBytes, payload };
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
   * // Parent (signer) and child (subject) keys — use a CSPRNG in practice:
   * const signerPriv = ed25519.utils.randomPrivateKey();
   * const signerPub = ed25519.getPublicKey(signerPriv);
   * const childPub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());
   *
   * const A = await Attestation.issue(signerPriv, childPub, 'station-001', {
   *   audiences: ['ev-app.com'],
   *   scopes: ['charge:start', 'charge:stop'],
   *   maxSessionTtl: 7200,
   *   subNamePatterns: ['connector-*'],
   * });
   *
   * const ok = await Attestation.verifySignature(A.token, signerPub); // true
   * const payload = Attestation.decode(A.token); // structure only — no sig, no time
   * 
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
    if (typeof payload.jti !== 'string') {
      throwFormat('MALFORMED', 'Missing required field: jti');
    }

    return payload;
  }

  /**
    * Verifies the token signature against a public key.
    *
    * @returns `false` for a bad signature or a wrong key. Returns
    *   `false` for any invalid signature, including malformed lengths.
    *   It still throws `AttestationError` `MALFORMED`/`FORMAT` for
    *   structurally invalid tokens (see {@link decode}).
    */
   static async verifySignature(token: string, signerPublicKey: Uint8Array): Promise<boolean> {
     const { signatureBytes, payloadBytes } = parseToken(token);
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
   * @param signerPrivateKey - 32-byte Ed25519 private key of the parent.
   * @param subjectPublicKey - 32-byte Ed25519 public key being attested.
   * @param subjectName - Child name; canonicalized before signing.
   * @param grant - Constraints enforced by verifiers (Mode 2).
   * @param opts - Lifetime control: `ttlSeconds` (default one year),
   *   `expiresAt` (overrides `ttlSeconds`), `jti` (default random UUID),
   *   `now` (fixed clock for deterministic tests).
   * @returns The attestation with `payload`, `token` and `jti` accessors.
   * @throws {AttestationError} `MALFORMED`/`FORMAT` if the grant is
   *   structurally invalid (bad scopes/TTL/audiences or a wildcard
   *   not at the end of a `subNamePatterns` entry).
   * @throws {Error} If `subjectPublicKey` is not 32 bytes.
   *
   * @example
   * ```ts
   * const att = await Attestation.issue(rootPriv, childPub, 'Station-1',
   *   { scopes: ['read'], maxSessionTtl: 3600 }, { ttlSeconds: 600 });
   * ```
   */
  static async issue(
    signerPrivateKey: Uint8Array,
    subjectPublicKey: Uint8Array,
    subjectName: string,
    grant: AttestationGrant,
    opts?: { ttlSeconds?: number; expiresAt?: number; jti?: string; now?: number }
  ): Promise<Attestation> {
    const name = normalizeName(subjectName);

    if (subjectPublicKey.length !== 32) {
      throw new Error('subject public key must be 32 bytes');
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

    const now = opts?.now ?? Math.floor(Date.now() / 1000);
    const exp = opts?.expiresAt ?? (now + (opts?.ttlSeconds ?? 31536000));
    const jti = opts?.jti ?? crypto.randomUUID();

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

    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const signature = await ed.sign(payloadBytes, signerPrivateKey);
    const payloadB64 = base64urlEncode(payloadBytes);
    const signatureB64 = base64urlEncode(signature);
    const token = `${payloadB64}.${signatureB64}`;

    return new Attestation(payload, token);
  }
}
