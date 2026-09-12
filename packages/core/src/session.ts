// session.ts
import { Handle } from './handle.js';
import { SubHandle } from './subhandle.js';
import { Identity } from './identity.js';
import { base64urlEncode, base64urlDecode } from './util.js';

const MAX_PAYLOAD_SIZE = 4096;
const CLOCK_SKEW_SECONDS = 30;
const FUTURE_WINDOW_SECONDS = 3600;

/**
 * Options for creating a new {@link Session}.
 *
 * @category Types
 */
export interface SessionOptions {
  /** The intended audience (recipient) of this session. */
  audience: string;
  /** Permission scopes granted in this session (e.g., `['read', 'write']`). */
  scopes: string[];
  /** Time-to-live in seconds. */
  ttl: number;
  /**
   * Optional unique session identifier, used for revocation.
   * If not provided, a random UUID is generated.
   */
  sessionId?: string;
}

/**
 * The payload structure encoded inside a session token.
 *
 * @category Types
 */
export interface SessionPayload {
  /** Handle / SubHandle ID (Base64URL of public key). */
  hId: string;
  /** Handle / SubHandle name. */
  hNm: string;
  /**
   * Derivation path for SubHandle sessions.
   * Present only when the session was created by a SubHandle.
   * Format: `[handleName, subName]`.
   */
  hPath?: string[];
  /** Intended audience. */
  aud: string;
  /** Granted scopes. */
  scp: string[];
  /** Expiration timestamp (Unix seconds). */
  exp: number;
  /** Issued-at timestamp (Unix seconds). */
  iat: number;
  /**
   * Unique session identifier, used for revocation.
   * Always present (generated automatically if not provided).
   */
  jti: string;
}

/**
 * Interface for application-side revocation checking.
 *
 * The Me2em protocol does not prescribe a storage backend for revocation.
 * Applications implement this interface using their preferred store
 * (Redis, PostgreSQL, in-memory Set, etc.) and pass it to
 * {@link Session.verifyStateless}.
 *
 * @category Extension Points
 *
 * @example
 * ```ts
 * // In-memory implementation (for simple cases)
 * class InMemoryRevocationChecker implements RevocationChecker {
 *   private revoked = new Set<string>();
 *   async isRevoked(sessionId: string): Promise<boolean> {
 *     return this.revoked.has(sessionId);
 *   }
 *   revoke(sessionId: string): void {
 *     this.revoked.add(sessionId);
 *   }
 * }
 *
 * // Redis implementation (for production)
 * class RedisRevocationChecker implements RevocationChecker {
 *   constructor(private redis: Redis) {}
 *   async isRevoked(sessionId: string): Promise<boolean> {
 *     return (await this.redis.sismember('me2em:revoked', sessionId)) === 1;
 *   }
 * }
 * ```
 */
export interface RevocationChecker {
  /**
   * Checks whether a session has been revoked.
   *
   * @param sessionId - The `jti` field from the session payload.
   * @returns A Promise resolving to `true` if revoked, `false` otherwise.
   */
  isRevoked(sessionId: string): Promise<boolean>;
}

/**
 * Represents a stateless, cryptographically verifiable session token.
 *
 * Instead of storing session state on the server, the Session object
 * encapsulates all necessary authorization data (handle ID, scopes,
 * expiration, derivation path) into a self-contained structure that can
 * be verified using the Handle's or SubHandle's public key.
 *
 * Sessions can be created from either a {@link Handle} or a {@link SubHandle}.
 * When created from a SubHandle, the token carries the derivation path
 * (`hPath`) for hierarchical auditing.
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
  /** Derivation path, present only for SubHandle sessions. */
  public readonly path?: string[];
  /** Unique session identifier, used for revocation. */
  public readonly sessionId: string;

  /**
   * Creates a new Session instance.
   *
   * @internal Typically created via {@link Session.create} or
   * {@link Session.verifyStateless}. Direct construction is discouraged.
   */
  constructor(
    handleId: string,
    handleName: string,
    audience: string,
    scopes: string[],
    expiresAt: number,
    token: string,
    path?: string[],
    sessionId?: string
  ) {
    this.handleId = handleId;
    this.handleName = handleName;
    this.audience = audience;
    this.scopes = scopes;
    this.expiresAt = expiresAt;
    this.token = token;
    this.path = path;
    this.sessionId = sessionId ?? '';
  }

  /**
   * Checks if the session has expired based on the current time.
   *
   * @returns `true` if the current time is past the `expiresAt` timestamp.
   */
  isExpired(): boolean {
    return Date.now() >= this.expiresAt * 1000;
  }

  /**
   * Creates a new signed session token.
   *
   * If the handle is a {@link SubHandle}, its constraints are validated
   * before signing (audience, scopes, TTL, expiration). The derivation
   * path is included in the payload as `hPath`.
   *
   * @param handle - The Handle or SubHandle that will sign this session.
   * @param options - Session configuration including audience, scopes, TTL, and optional sessionId.
   * @returns A Promise resolving to a new Session instance.
   *
   * @example
   * ```ts
   * const session = await Session.create(handle, {
   *   audience: 'app.example.com',
   *   scopes: ['read', 'write'],
   *   ttl: 3600,
   *   sessionId: 'unique-session-id' // optional
   * });
   * ```
   */
  static async create(
    handle: Handle | SubHandle,
    options: SessionOptions
  ): Promise<Session> {
    handle.validateSessionOptions(options);

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + options.ttl;
    const sessionId = options.sessionId ?? crypto.randomUUID();

    const payload: SessionPayload = {
      hId: handle.getId(),
      hNm: handle.getName(),
      aud: options.audience,
      scp: options.scopes,
      exp: expiresAt,
      iat: now,
      jti: sessionId,
    };

    // Include derivation path for SubHandle sessions
    const hPath = handle.getPath();
    if (hPath) {
      payload.hPath = hPath;
    }

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
      token,
      payload.hPath,
      sessionId
    );
  }

  /**
   * Verifies a session token statelessly without server-side storage.
   *
   * Validates:
   * - Token format (two Base64URL parts)
   * - Payload size limit
   * - Required fields (`hId`, `hNm`, `aud`, `scp`, `exp`, `jti`)
   * - Audience match
   * - Expiration (with clock skew tolerance)
   * - Signature (against the reconstructed Handle or SubHandle public key)
   * - Revocation status (if a {@link RevocationChecker} is provided)
   *
   * For SubHandle sessions (those with `hPath`), the Handle/SubHandle is
   * reconstructed atomically via {@link Identity.deriveSubHandle}.
   *
   * @param token - The Base64URL-encoded session token string.
   * @param companyIdentity - The Identity used to reconstruct Handle/SubHandle public keys.
   * @param expectedAudience - The audience that this token must be intended for.
   * @param revocationChecker - Optional checker for revocation list.
   * @returns A Promise resolving to a verified Session instance.
   * @throws {Error} If the token is invalid, expired, tampered, audience mismatch, or revoked.
   *
   * @example
   * ```ts
   * const session = await Session.verifyStateless(
   *   token,
   *   companyIdentity,
   *   'app.example.com',
   *   redisRevocationChecker // optional
   * );
   * ```
   */
  static async verifyStateless(
    token: string,
    companyIdentity: Identity,
    expectedAudience: string,
    revocationChecker?: RevocationChecker
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

    // Required fields validation
    if (
      !payload.hId ||
      !payload.hNm ||
      !payload.aud ||
      !Array.isArray(payload.scp) ||
      typeof payload.exp !== 'number' ||
      typeof payload.jti !== 'string'
    ) {
      throw new Error(
        'Invalid token format: missing required fields (hId, hNm, aud, scp, exp, jti)'
      );
    }

    // Audience check
    if (payload.aud !== expectedAudience) {
      throw new Error(`Audience mismatch: expected "${expectedAudience}", got "${payload.aud}"`);
    }

    // Expiration check (with clock skew tolerance)
    const now = Math.floor(Date.now() / 1000);
    const maxExpiry = payload.exp + CLOCK_SKEW_SECONDS;
    if (now > maxExpiry) {
      throw new Error('Token expired');
    }
    if (typeof payload.iat === 'number') {
      if (now < payload.iat - CLOCK_SKEW_SECONDS) {
        throw new Error('Token is future-dated');
      }
    } else if (now < payload.exp - FUTURE_WINDOW_SECONDS) {
      throw new Error('Token is future-dated');
    }

    // Revocation check (if checker provided)
    if (revocationChecker) {
      const isRevoked = await revocationChecker.isRevoked(payload.jti);
      if (isRevoked) {
        throw new Error('Session has been revoked');
      }
    }

    // Reconstruct Handle or SubHandle
    let handle: Handle;

    if (payload.hPath && payload.hPath.length === 2) {
      // SubHandle session — atomic reconstruction via Identity
      handle = await companyIdentity.deriveSubHandle(
        payload.hPath[0],
        payload.hPath[1]
      );
    } else {
      // Regular Handle session
      handle = await companyIdentity.deriveHandle(payload.hNm);
    }

    // Signature verification
    const publicKey = handle.getPublicKey();
    const signatureBytes = base64urlDecode(signatureB64);
    const isValid = await Handle.verify(signatureBytes, payloadBytes, publicKey);

    if (!isValid) {
      throw new Error(
        'Invalid signature: token payload has been tampered with or was not signed by the claimed Handle'
      );
    }

    if (handle.getId() !== payload.hId) {
      throw new Error('hId mismatch');
    }

    return new Session(
      payload.hId,
      payload.hNm,
      payload.aud,
      payload.scp,
      payload.exp,
      token,
      payload.hPath,
      payload.jti
    );
  }
}


