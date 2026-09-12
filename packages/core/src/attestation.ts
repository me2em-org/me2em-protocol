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
  audiences?: string[];
  scopes: string[];
  maxSessionTtl: number;
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

export class Attestation {
  private readonly _payload: AttestationPayload;
  private readonly _token: string;

  constructor(payload: AttestationPayload, token: string) {
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

  static async verifySignature(token: string, signerPublicKey: Uint8Array): Promise<boolean> {
    const { signatureBytes, payloadBytes } = parseToken(token);
    return ed.verify(signatureBytes, payloadBytes, signerPublicKey);
  }

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
