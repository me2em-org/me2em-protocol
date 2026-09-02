export interface SessionOptions {
  audience: string;
  scopes: string[];
  ttl?: number; // в секундах
}

export interface SessionToken {
  handleId: string;
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

    /**
   * Creates a new Session instance.
   * 
   * @param handleId - The ID of the Handle that authorized this session.
   * @param scopes - An array of permission scopes granted in this session (e.g., ['read', 'write']).
   * @param expiresAt - Unix timestamp (in milliseconds) when this session expires.
   * @param token - The cryptographic token string (e.g., JWT or custom signature format).
   */
  constructor(
    public readonly handleId: string,
    public readonly scopes: string[],
    public readonly expiresAt: number,
    public readonly token: string
  ) {}

  /**
   * Checks if the session has expired based on the current time.
   * @returns `true` if the current time is past the `expiresAt` timestamp, `false` otherwise.
   */
  isExpired(): boolean {
    return Date.now() >= this.expiresAt * 1000;
  }
}