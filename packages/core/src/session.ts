// session.ts
import { Handle } from './handle.js';
import { SubHandle } from './subhandle.js';
import { Identity } from './identity.js';
import { base64urlEncode, base64urlDecode } from './util.js';
import {
  Attestation,
  AttestationError,
  type AttestationPayload,
} from './attestation.js';

const MAX_PAYLOAD_SIZE = 4096;
const CLOCK_SKEW_SECONDS = 30;

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

  private static parseSessionToken(token: string): {
    payload: SessionPayload;
    payloadBytes: Uint8Array;
    signatureBytes: Uint8Array;
  } {
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
      typeof payload.iat !== 'number' ||
      typeof payload.jti !== 'string'
    ) {
      throw new Error(
        'Invalid token format: missing required fields (hId, hNm, aud, scp, exp, iat, jti)'
      );
    }

    const signatureBytes = base64urlDecode(signatureB64);

    return { payload, payloadBytes, signatureBytes };
  }

  /**
   * Verifies a session token statelessly without server-side storage.
   *
   * Validates:
   * - Token format (two Base64URL parts)
   * - Payload size limit
   * - Required fields (`hId`, `hNm`, `aud`, `scp`, `exp`, `iat`, `jti`)
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
    const { payload, payloadBytes, signatureBytes } = Session.parseSessionToken(token);

    // Audience check
    if (payload.aud !== expectedAudience) {
      throw new Error(`Audience mismatch: expected "${expectedAudience}", got "${payload.aud}"`);
    }

    // Time checks
    const now = Math.floor(Date.now() / 1000);
    if (now > payload.exp + CLOCK_SKEW_SECONDS) {
      throw new Error('Token expired');
    }
    if (now < payload.iat - CLOCK_SKEW_SECONDS) {
      throw new Error('Token is future-dated');
    }

    // Reconstruct Handle or SubHandle
    let handle: Handle;
    if (payload.hPath && payload.hPath.length === 2) {
      handle = await companyIdentity.deriveSubHandle(
        payload.hPath[0],
        payload.hPath[1]
      );
    } else {
      handle = await companyIdentity.deriveHandle(payload.hNm);
    }

    // Signature verification (wrapped to catch exceptions from the crypto lib)
    const publicKey = handle.getPublicKey();
    let isValid = false;
    try {
      isValid = await Handle.verify(signatureBytes, payloadBytes, publicKey);
    } catch {
      isValid = false;
    }
    if (!isValid) {
      throw new Error(
        'Invalid signature: token payload has been tampered with or was not signed by the claimed Handle'
      );
    }

    if (handle.getId() !== payload.hId) {
      throw new Error('hId mismatch');
    }

    // Revocation check — last, after signature is verified
    if (revocationChecker) {
      const isRevoked = await revocationChecker.isRevoked(payload.jti);
      if (isRevoked) {
        throw new Error('Session has been revoked');
      }
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

  /**
   * Verifies a session token along with its attestation chain.
   *
   * Validates the session token, the attestation chain (one or two attestations),
   * scope/ttl inheritance, name permitting, subject binding, and session expiry
   * against attestation expiry.
   *
   * @param token - The session token string.
   * @param rootPublicKey - The root Identity public key.
   * @param attestationChain - Array of attestation token strings.
   * @param expectedAudience - The expected audience for the session.
   * @param revocationChecker - Optional revocation checker.
   * @returns A verified Session instance.
   * @throws {AttestationError} On any validation failure.
   */
  static async verifyAttested(
    token: string,
    rootPublicKey: Uint8Array,
    attestationChain: string[],
    expectedAudience: string,
    revocationChecker?: RevocationChecker
  ): Promise<Session> {
    const { payload, payloadBytes, signatureBytes } = Session.parseSessionToken(token);

    // Step 2: Audience
    if (payload.aud !== expectedAudience) {
      throw new AttestationError(
        'AUDIENCE_NOT_PERMITTED',
        'SESSION',
        `Expected audience "${expectedAudience}", got "${payload.aud}"`
      );
    }

    // Step 3: Session time
    const now = Math.floor(Date.now() / 1000);
    if (now > payload.exp + CLOCK_SKEW_SECONDS) {
      throw new AttestationError('EXPIRED', 'SESSION', 'Session has expired');
    }
    if (now < payload.iat - CLOCK_SKEW_SECONDS) {
      throw new AttestationError('NOT_YET_VALID', 'SESSION', 'Session is not yet valid');
    }

    // Step 4: Chain structure
    const isSubSession = payload.hPath !== undefined;
    if (isSubSession) {
      if (!payload.hPath || payload.hPath.length !== 2) {
        throw new AttestationError('PATH_MISMATCH', 'SESSION', 'SubHandle session requires hPath of length 2');
      }
      if (attestationChain.length !== 2) {
        throw new AttestationError('CHAIN_INCOMPLETE', 'FORMAT', 'SubHandle session requires exactly 2 attestations');
      }
    } else {
      if (attestationChain.length !== 1) {
        throw new AttestationError('CHAIN_INCOMPLETE', 'FORMAT', 'Handle session requires exactly 1 attestation');
      }
    }

    // Step 5: Decode A
    const A = Attestation.decode(attestationChain[0]);

    // Step 6: Verify A signature against root
    const sigOkA = await Attestation.verifySignature(attestationChain[0], rootPublicKey);
    if (!sigOkA) {
      throw new AttestationError('BAD_SIGNATURE', 'ROOT', 'Root attestation signature is invalid');
    }

    // Step 7: A time
    if (now > A.exp + CLOCK_SKEW_SECONDS) {
      throw new AttestationError('EXPIRED', 'ROOT', 'Root attestation has expired');
    }
    if (now < A.iat - CLOCK_SKEW_SECONDS) {
      throw new AttestationError('NOT_YET_VALID', 'ROOT', 'Root attestation is not yet valid');
    }

    // Step 8: A revocation
    if (revocationChecker) {
      const isRevoked = await revocationChecker.isRevoked(A.jti);
      if (isRevoked) {
        throw new AttestationError('REVOKED', 'ROOT', 'Root attestation has been revoked');
      }
    }

    let G: AttestationPayload['grant'];

    if (isSubSession) {
      // Step 9: SubHandle chain
      const B = Attestation.decode(attestationChain[1]);

      const signerPubABytes = (() => {
        try { return base64urlDecode(A.subjectId); } catch { return null; }
      })();
      if (!signerPubABytes) {
        throw new AttestationError('MALFORMED', 'FORMAT', 'Cannot decode root attestation subjectId');
      }

      const sigOkB = await Attestation.verifySignature(attestationChain[1], signerPubABytes);
      if (!sigOkB) {
        throw new AttestationError('BAD_SIGNATURE', 'HANDLE_ATTESTATION', 'Handle attestation signature is invalid');
      }

      if (now > B.exp + CLOCK_SKEW_SECONDS) {
        throw new AttestationError('EXPIRED', 'HANDLE_ATTESTATION', 'Handle attestation has expired');
      }
      if (now < B.iat - CLOCK_SKEW_SECONDS) {
        throw new AttestationError('NOT_YET_VALID', 'HANDLE_ATTESTATION', 'Handle attestation is not yet valid');
      }

      if (revocationChecker) {
        const isRevoked = await revocationChecker.isRevoked(B.jti);
        if (isRevoked) {
          throw new AttestationError('REVOKED', 'HANDLE_ATTESTATION', 'Handle attestation has been revoked');
        }
      }

      if (B.subjectName !== payload.hPath![1]) {
        throw new AttestationError('PATH_MISMATCH', 'HANDLE_ATTESTATION',
          `Handle attestation subject "${B.subjectName}" does not match session subName "${payload.hPath![1]}"`);
      }
      if (A.subjectName !== payload.hPath![0]) {
        throw new AttestationError('PATH_MISMATCH', 'ROOT',
          `Root attestation subject "${A.subjectName}" does not match session handleName "${payload.hPath![0]}"`);
      }

      if (A.grant.subNamePatterns !== undefined) {
        if (!Attestation.matchNamePattern(B.subjectName, A.grant.subNamePatterns)) {
          throw new AttestationError('NAME_NOT_PERMITTED', 'ROOT',
            `SubHandle name "${B.subjectName}" not permitted by root patterns`);
        }
      }

      if (payload.hId !== B.subjectId) {
        throw new AttestationError('SUBJECT_MISMATCH', 'SUB_ATTESTATION',
          'Session handleId does not match handle attestation subjectId');
      }

      // Nested grant check
      const forbidden = B.grant.scopes.filter(s => !A.grant.scopes.includes(s));
      if (forbidden.length > 0) {
        throw new AttestationError('SCOPE_EXCEEDED', 'ROOT',
          `Handle attination scopes not subset of root: ${forbidden.join(', ')}`);
      }
      if (B.grant.maxSessionTtl > A.grant.maxSessionTtl) {
        throw new AttestationError('TTL_EXCEEDED', 'ROOT',
          'Handle attestation maxSessionTtl exceeds root attestation');
      }

      G = B.grant;
    } else {
      // Handle session
      const subjectIdBytes = (() => {
        try { return base64urlDecode(A.subjectId); } catch { return null; }
      })();
      if (!subjectIdBytes) {
        throw new AttestationError('MALFORMED', 'FORMAT', 'Cannot decode root attestation subjectId');
      }
      if (payload.hId !== A.subjectId) {
        throw new AttestationError('SUBJECT_MISMATCH', 'ROOT',
          'Session handleId does not match root attestation subjectId');
      }
      G = A.grant;
    }

    // Step 10: Session vs grant G
    const sessionForbidden = payload.scp.filter(s => !G.scopes.includes(s));
    if (sessionForbidden.length > 0) {
      throw new AttestationError('SCOPE_EXCEEDED', 'SESSION',
        `Session scopes not permitted by grant: ${sessionForbidden.join(', ')}`);
    }
    if (G.audiences !== undefined && !G.audiences.includes(payload.aud)) {
      throw new AttestationError('AUDIENCE_NOT_PERMITTED', 'SESSION',
        `Session audience "${payload.aud}" not in grant audiences`);
    }
    if ((payload.exp - payload.iat) > G.maxSessionTtl) {
      throw new AttestationError('TTL_EXCEEDED', 'SESSION',
        `Session duration ${payload.exp - payload.iat}s exceeds grant maxSessionTtl ${G.maxSessionTtl}s`);
    }

    // Step 11: Session does not outlive attestation
    const earliestAttestationExp = isSubSession
      ? Math.min(A.exp, Attestation.decode(attestationChain[1]).exp)
      : A.exp;
    if (payload.exp > earliestAttestationExp + CLOCK_SKEW_SECONDS) {
      throw new AttestationError('SESSION_OUTLIVES_ATTESTATION', 'SESSION',
        'Session expires after the earliest attestation');
    }

    // Step 12: Session signature
    const sessionPub = (() => {
      try { return base64urlDecode(payload.hId); } catch { return null; }
    })();
    if (!sessionPub) {
      throw new AttestationError('BAD_SIGNATURE', 'SESSION', 'Cannot decode session hId');
    }
    const sigOk = await Attestation.verifySignature(token, sessionPub);
    if (!sigOk) {
      throw new AttestationError('BAD_SIGNATURE', 'SESSION', 'Session signature is invalid');
    }

    // Step 13: Session revocation
    if (revocationChecker) {
      const isRevoked = await revocationChecker.isRevoked(payload.jti);
      if (isRevoked) {
        throw new AttestationError('REVOKED', 'SESSION', 'Session has been revoked');
      }
    }

    // Step 14
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
