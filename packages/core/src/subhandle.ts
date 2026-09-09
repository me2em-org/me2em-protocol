// subhandle.ts
//
// SubHandle is a leaf node in the Me2em derivation tree.
// With MAX_DEPTH = 2, a SubHandle CANNOT derive children.
// It inherits from Handle for polymorphism in Session handling.

import { Handle, type HandleMetadata } from './handle.js';

/**
 * Metadata for a {@link SubHandle}, extending {@link HandleMetadata} with
 * constraints that govern session creation.
 *
 * All constraint fields are optional. When present, they are enforced by
 * {@link SubHandle.validateSessionOptions} at session creation time.
 *
 * @category Types
 */
export interface SubHandleMetadata extends HandleMetadata {
  /**
   * Restricts the set of audiences this SubHandle may create sessions for.
   * If empty or undefined, any audience is allowed.
   */
  allowedAudiences?: string[];

  /**
   * Restricts the set of scopes this SubHandle may request in sessions.
   * If empty or undefined, any scope is allowed.
   */
  allowedScopes?: string[];

  /**
   * Maximum allowed TTL (in seconds) for sessions created by this SubHandle.
   * Attempts to create a session with a larger TTL will be rejected.
   */
  maxSessionTtl?: number;

  /**
   * Unix timestamp (in seconds) at which this SubHandle itself expires.
   * After this time, any attempt to create a session will fail.
   * Useful for temporary access grants (e.g., contractor access for 2 weeks).
   */
  expiresAt?: number;
}

/**
 * Represents a context-isolated child Handle in the Me2em hierarchy.
 *
 * A SubHandle is always derived from a parent {@link Handle} and represents
 * a leaf node in the derivation tree (MAX_DEPTH = 2). It inherits all
 * cryptographic capabilities of Handle (signing, key derivation, etc.) but
 * adds:
 *
 * - A **derivation path** (`[handleName, subName]`) carried in session tokens.
 * - **Constraint enforcement** on audience, scopes, and TTL at session creation.
 * - An optional **expiration timestamp** for temporary access grants.
 *
 * SubHandle is used for polymorphism in {@link Session}: both Handle and
 * SubHandle can create and verify sessions, but SubHandle sessions carry
 * the additional `hPath` field for hierarchical auditing.
 *
 * @category Core Primitives
 */
export class SubHandle extends Handle {
  private readonly _path: string[];
  private readonly _subMetadata: SubHandleMetadata;

  /**
   * Creates a new SubHandle instance.
   *
   * @internal Typically created via {@link Handle.deriveSubHandle} or
   * {@link Identity.deriveSubHandle}. Direct construction is discouraged.
   *
   * @param privateKey - The 32-byte Ed25519 private key for this SubHandle.
   * @param name - The SubHandle name.
   * @param path - The derivation path, must have exactly 2 elements: `[handleName, subName]`.
   * @param subMetadata - Optional constraints and metadata.
   * @throws {Error} If the path does not have exactly 2 elements.
   */
  constructor(
    privateKey: Uint8Array,
    name: string,
    path: string[],
    subMetadata?: SubHandleMetadata
  ) {
    super(privateKey, name, subMetadata);

    if (path.length !== 2) {
      throw new Error(
        `SubHandle path must have exactly 2 elements: [handleName, subName]. Got ${path.length}.`
      );
    }

    this._path = path;
    this._subMetadata = subMetadata ?? {};
  }

  /**
   * Returns the full derivation path of this SubHandle.
   *
   * @returns A copy of the path array, e.g. `["station-001", "connector-1"]`.
   */
  getPath(): string[] {
    return [...this._path];
  }

  /**
   * Returns the derivation path as a slash-separated string.
   *
   * @returns The path string, e.g. `"station-001/connector-1"`.
   */
  getPathString(): string {
    return this._path.join('/');
  }

  /**
   * Returns the depth of this SubHandle in the derivation hierarchy.
   *
   * With MAX_DEPTH = 2, this is always `2` (Identity = 0, Handle = 1, SubHandle = 2).
   *
   * @returns The depth, always `2`.
   */
  getDepth(): number {
    return 2;
  }

  /**
   * Returns whether this SubHandle is a leaf node.
   *
   * With MAX_DEPTH = 2, a SubHandle is **always** a leaf and cannot derive children.
   *
   * @returns Always `true`.
   */
  isLeaf(): boolean {
    return true;
  }

  /**
   * SubHandle is a leaf node (depth = 2) and cannot derive children.
   * Overrides the inherited `Handle.deriveSubHandle` to throw an error.
   */
  override async deriveSubHandle(_name: string, _metadata?: SubHandleMetadata): Promise<SubHandle> {
    throw new Error(
      `Cannot derive child: maximum depth (${2}) reached ` +
      `or this SubHandle is marked as leaf`
    );
  }

  /**
   * Returns the SubHandle-specific metadata (constraints).
   *
   * @returns The SubHandleMetadata object.
   */
  getSubMetadata(): SubHandleMetadata {
    return {
      ...this._subMetadata,
      allowedAudiences: this._subMetadata.allowedAudiences
        ? [...this._subMetadata.allowedAudiences]
        : undefined,
      allowedScopes: this._subMetadata.allowedScopes
        ? [...this._subMetadata.allowedScopes]
        : undefined,
    };
  }

  /**
   * Validates session options against this SubHandle's constraints.
   *
   * Called internally by {@link Session.create} before signing. Throws if
   * any constraint is violated:
   * - `audience` not in `allowedAudiences`
   * - any `scope` not in `allowedScopes`
   * - `ttl` exceeds `maxSessionTtl`
   * - current time is past `expiresAt`
   *
   * @param options - The session options to validate.
   * @throws {Error} If any constraint is violated.
   */
  validateSessionOptions(options: {
    audience: string;
    scopes: string[];
    ttl: number;
  }): void {
    // Audience check
    if (this._subMetadata.allowedAudiences?.length) {
      if (!this._subMetadata.allowedAudiences.includes(options.audience)) {
        throw new Error(
          `Audience "${options.audience}" not allowed for this SubHandle. ` +
          `Allowed: ${this._subMetadata.allowedAudiences.join(', ')}`
        );
      }
    }

    // Scopes check
    if (this._subMetadata.allowedScopes?.length) {
      const forbidden = options.scopes.filter(
        s => !this._subMetadata.allowedScopes!.includes(s)
      );
      if (forbidden.length > 0) {
        throw new Error(
          `Scopes not allowed for this SubHandle: ${forbidden.join(', ')}`
        );
      }
    }

    // TTL check
    if (
      this._subMetadata.maxSessionTtl !== undefined &&
      options.ttl > this._subMetadata.maxSessionTtl
    ) {
      throw new Error(
        `TTL ${options.ttl}s exceeds max allowed ` +
        `${this._subMetadata.maxSessionTtl}s for this SubHandle`
      );
    }

    // SubHandle expiration check
    if (this._subMetadata.expiresAt !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      if (now >= this._subMetadata.expiresAt) {
        throw new Error('SubHandle has expired');
      }
    }
  }
}
