import { Handle, type HandleMetadata } from './handle.js';
import { Identity } from './identity.js';

const MAX_PAYLOAD_SIZE = 4096;
const CLOCK_SKEW_SECONDS = 30;
const FUTURE_WINDOW_SECONDS = 3600;

export interface SessionOptions {
  audience: string;
  scopes: string[];
  ttl: number; // in seconds
}

export interface SessionToken {
  handleId: string;
  scopes: string[];
  expiresAt: number;
  token: string;
}

export interface SessionPayload {
  hId: string;
  hNm: string;
  aud: string;
  scp: string[];
  exp: number;
}

export interface SessionData {
  handleId: string;
  handleName: string;
  audience: string;
  scopes: string[];
  expiresAt: number;
  token: string;
}

/**
 * Represents a stateless, cryptographically verifiable session token.
 * 
 * Instead of storing session state on the server, the Session object 
 * encapsulates all necessary authorization data (handle ID, scopes, expiration) 
 * into a self-contained structure that can be verified using the Handle's public key.
 * 
 * @category Core Primitives
 */
export class Session {

  public readonly handleId: string;
  public readonly handleName: string;
  public readonly audience: string;
  public readonly scopes: string[];
  public readonly expiresAt: number;
  public readonly token: string;

    /**
    * Creates a new Session instance.
    * 
    * @param handleId - The ID of the Handle that authorized this session.
    * @param handleName - The name of the Handle that authorized this session.
    * @param audience - The intended audience (recipient) of this session.
    * @param scopes - An array of permission scopes granted in this session (e.g., ['read', 'write']).
    * @param expiresAt - Unix timestamp (in seconds) when this session expires.
    * @param token - The cryptographic token string (Base64URL(Payload).Base64URL(Signature)).
    */
  constructor(
    handleId: string,
    handleName: string,
    audience: string,
    scopes: string[],
    expiresAt: number,
    token: string
  ) {
    this.handleId = handleId;
    this.handleName = handleName;
    this.audience = audience;
    this.scopes = scopes;
    this.expiresAt = expiresAt;
    this.token = token;
  }

  /**
   * Checks if the session has expired based on the current time.
   * @returns `true` if the current time is past the `expiresAt` timestamp, `false` otherwise.
   */
  isExpired(): boolean {
    return Date.now() >= this.expiresAt * 1000;
  }

  /**
   * Creates a new signed session token.
   * 
   * Encodes the session payload (handle ID, name, audience, scopes, expiration)
   * into a JSON object, signs it with the Handle's private key, and returns
   * a `Session` instance with the formatted token.
   * 
   * @param handle - The Handle that will sign this session.
   * @param options - Session configuration including audience, scopes, and TTL.
   * @returns A Promise resolving to a new Session instance.
   */
  static async create(handle: Handle, options: SessionOptions): Promise<Session> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + options.ttl;

    const payload: SessionPayload = {
      hId: handle.getId(),
      hNm: handle.getName(),
      aud: options.audience,
      scp: options.scopes,
      exp: expiresAt,
    };

    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const signature = await handle.sign(payloadBytes);

    const payloadB64 = base64urlEncode(payloadBytes);
    const signatureB64 = base64urlEncode(signature);
    const token = `${payloadB64}.${signatureB64}`;

    return new Session(
      payload.hId,
      payload.hNm,
      payload.aud,
      payload.scp,
      payload.exp,
      token
    );
  }

  /**
   * Verifies a session token statelessly without server-side storage.
   * 
   * Validates the token format, signature, audience, expiration, and size limits.
   * Rejects tokens that are malformed, expired, tampered, or targeted at the wrong audience.
   * 
   * @param token - The Base64URL-encoded session token string.
   * @param companyIdentity - The Identity of the verifying party (used to reconstruct Handle public keys).
   * @param expectedAudience - The audience that this token must be intended for.
   * @returns A Promise resolving to a verified Session instance.
   * @throws {Error} If the token is invalid, expired, tampered, or audience mismatch.
   */
  static async verifyStateless(
    token: string,
    companyIdentity: Identity,
    expectedAudience: string
  ): Promise<Session> {
    if (typeof token !== 'string') {
      throw new Error('Token must be a string');
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new Error('Invalid token format: expected two Base64URL parts separated by "."');
    }

    const [payloadB64, signatureB64] = parts;

    const b64urlRegex = /^[A-Za-z0-9_-]+$/;
    if (!b64urlRegex.test(payloadB64) || !b64urlRegex.test(signatureB64)) {
      throw new Error('Invalid token format: payload and signature must be valid Base64URL');
    }

    const payloadBytes = base64urlDecode(payloadB64);
    if (payloadBytes.length > MAX_PAYLOAD_SIZE) {
      throw new Error(`Payload exceeds maximum size of ${MAX_PAYLOAD_SIZE} bytes`);
    }

    let payload: SessionPayload;
    try {
      const jsonString = new TextDecoder().decode(payloadBytes);
      payload = JSON.parse(jsonString) as SessionPayload;
    } catch {
      throw new Error('Invalid token format: payload is not valid JSON');
    }

    if (!payload.hId || !payload.hNm || !payload.aud || !Array.isArray(payload.scp) || typeof payload.exp !== 'number') {
      throw new Error('Invalid token format: missing required fields (hId, hNm, aud, scp, exp)');
    }

    if (payload.aud !== expectedAudience) {
      throw new Error(`Audience mismatch: expected "${expectedAudience}", got "${payload.aud}"`);
    }

    const now = Math.floor(Date.now() / 1000);
    const maxExpiry = payload.exp + CLOCK_SKEW_SECONDS;
    const minExpiry = payload.exp - FUTURE_WINDOW_SECONDS;

    if (now > maxExpiry) {
      throw new Error('Token expired');
    }

    if (now < minExpiry) {
      throw new Error('Token is future-dated beyond allowed clock skew');
    }

    const handle = await companyIdentity.deriveHandle(payload.hNm);
    const publicKey = handle.getPublicKey();

    const signatureBytes = base64urlDecode(signatureB64);
    const isValid = await Handle.verify(signatureBytes, payloadBytes, publicKey);

    if (!isValid) {
      throw new Error('Invalid signature: token payload has been tampered with or was not signed by the claimed Handle');
    }

    return new Session(
      payload.hId,
      payload.hNm,
      payload.aud,
      payload.scp,
      payload.exp,
      token
    );
  }
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input: string): Uint8Array {
  let base64 = input
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
