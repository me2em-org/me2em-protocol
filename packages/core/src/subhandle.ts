// subhandle.ts
//
// SubHandle is a leaf node in the Me2eM derivation tree.
// With MAX_DEPTH = 2, a SubHandle CANNOT derive children.
// It inherits from Handle for polymorphism in Session handling.

import { Handle, type HandleMetadata } from './handle.js';
import { normalizeName } from './canonical-name.js';
import type { Signer } from './types.js';
import { AttestationError } from './errors.js';
import { base64urlEncode, INSPECT_SYMBOL } from './util.js';

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
    * `undefined` = unrestricted; `[]` = deny all.
    */
   allowedAudiences?: string[];

   /**
    * Restricts the set of scopes this SubHandle may request in sessions.
    * `undefined` = unrestricted; `[]` = deny all.
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
 * Extracts only display-safe fields for the base Handle metadata.
 * Constraint fields stay in SubHandle's own storage and must never
 * leak through Handle.getMetadata().
 */
function extractDisplayFields(
  meta?: SubHandleMetadata
): HandleMetadata | undefined {
  if (!meta) return undefined;
  const display: HandleMetadata = {};
  if (meta.displayName !== undefined) display.displayName = meta.displayName;
  if (meta.avatar !== undefined) display.avatar = meta.avatar;
  // copy any other custom fields, but never the constraint ones
  const CONSTRAINT_KEYS = new Set([
    'allowedAudiences', 'allowedScopes', 'maxSessionTtl', 'expiresAt',
  ]);
  for (const [k, v] of Object.entries(meta)) {
    if (!CONSTRAINT_KEYS.has(k)) {
      (display as Record<string, unknown>)[k] = v;
    }
  }
  return display;
}

/**
 * Deep copy of SubHandle metadata for the {@link SubHandle.getSubMetadata}
 * getter (PR-7): JSON-safe values (plain objects and arrays, including
 * nested ones) are duplicated so no caller mutation can reach the
 * enforced constraints. Non-plain values (Date, Map, class instances)
 * are shared by reference at depth > 8 and documented as such.
 */
function deepCloneJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => deepCloneJsonValue(v, depth + 1));
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value; // non-plain: share
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = deepCloneJsonValue(v, depth + 1);
  }
  return out;
}

/**
 * Deep-ish copy of SubHandle metadata: constraint arrays (the
 * security-relevant part) are duplicated so the caller cannot mutate
 * the enforced constraints after construction. Custom fields are
 * shallow-copied (nested objects are not cloned).
 */
function copySubMetadata(meta?: SubHandleMetadata): SubHandleMetadata {
  const out: SubHandleMetadata = { ...(meta ?? {}) };
  if (out.allowedAudiences !== undefined) out.allowedAudiences = [...out.allowedAudiences];
  if (out.allowedScopes !== undefined) out.allowedScopes = [...out.allowedScopes];
  return out;
}

/**
 * Represents a context-isolated child Handle in the Me2eM hierarchy.
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
export class SubHandle extends Handle implements Signer {
  #path: string[];
  #subMetadata: SubHandleMetadata;

  /**
   * Creates a new SubHandle instance.
   *
   * @internal Typically created via {@link Handle.deriveSubHandle} or
   * {@link Identity.deriveSubHandle}. Direct construction is discouraged.
   *
   * @param privateKey - The 32-byte Ed25519 private key for this SubHandle.
   *   Copied on input by the Handle constructor.
   * @param name - The SubHandle name.
   * @param path - The derivation path, must have exactly 2 elements: `[handleName, subName]`.
   *   Copied on input — later mutation of the caller's array has no effect.
   * @param subMetadata - Optional constraints and metadata.
   *   Copied on input (constraint arrays are duplicated).
   * @throws {Error} If the path does not have exactly 2 elements.
   */
  constructor(
    privateKey: Uint8Array,
    name: string,
    path: string[],
    subMetadata?: SubHandleMetadata
  ) {
    super(privateKey, name, extractDisplayFields(subMetadata));

    if (path.length !== 2) {
      throw new AttestationError(
        'MALFORMED',
        'FORMAT',
        `SubHandle path must have exactly 2 elements: [handleName, subName]. Got ${path.length}.`
      );
    }

    const normalizedName = normalizeName(name);
    if (path[1] !== normalizedName) {
      throw new AttestationError(
        'MALFORMED',
        'FORMAT',
        `path[1] must equal normalized name: path[1]=${JSON.stringify(path[1])}, name=${JSON.stringify(normalizedName)}`
      );
    }

    // Defensive copies: the caller keeps no live reference into this leaf.
    this.#path = [...path];
    this.#subMetadata = copySubMetadata(subMetadata);
  }

  /**
   * Returns the full derivation path of this SubHandle.
   *
   * @returns A copy of the path array, e.g. `["station-001", "connector-1"]`.
   */
  getPath(): string[] {
    return [...this.#path];
  }

  /**
   * Returns the derivation path as a slash-separated string.
   *
   * @returns The path string, e.g. `"station-001/connector-1"`.
   */
  getPathString(): string {
    return this.#path.join('/');
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
   * Overrides the inherited `Handle.deriveSubHandle` to throw
   * `AttestationError` `MAX_DEPTH_EXCEEDED`/`FORMAT`.
   */
  override async deriveSubHandle(): Promise<never> {
    throw new AttestationError(
      'MAX_DEPTH_EXCEEDED',
      'FORMAT',
      'Cannot derive child: maximum depth (2) reached or this SubHandle is marked as leaf'
    );
  }

  /**
   * Returns the SubHandle-specific metadata (constraints).
   *
   * The returned object is a **deep copy** (PR-7): JSON-safe nested
   * structures (plain objects, arrays) are fully duplicated, so mutating
   * the result — at any depth — cannot alter the constraints this
   * SubHandle enforces. Non-plain values (Date, Map, class instances)
   * are shared by reference; functions abort the deep copy and fall
   * back to the shallow constraint-array-duplicating copy.
   *
   * @returns A deep copy of the SubHandleMetadata object.
   */
  getSubMetadata(): SubHandleMetadata {
    for (const value of Object.values(this.#subMetadata)) {
      // A function anywhere in the metadata cannot be deep-cloned by the
      // generic copier — fall back to the shallow, array-duplicating copy.
      if (typeof value === 'function') return copySubMetadata(this.#subMetadata);
    }
    return deepCloneJsonValue(this.#subMetadata) as SubHandleMetadata;
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
    // Audience check: undefined = unrestricted, [] = deny all
    if (this.#subMetadata.allowedAudiences !== undefined) {
      if (!this.#subMetadata.allowedAudiences.includes(options.audience)) {
        throw new AttestationError(
          'AUDIENCE_NOT_PERMITTED',
          'SESSION',
          `Audience "${options.audience}" not allowed for this SubHandle. ` +
          `Allowed: ${this.#subMetadata.allowedAudiences.length === 0
            ? '(none — empty list denies all)'
            : this.#subMetadata.allowedAudiences.join(', ')}`
        );
      }
    }

    // Scopes check: undefined = unrestricted, [] = deny all
    if (this.#subMetadata.allowedScopes !== undefined) {
      const forbidden = options.scopes.filter(
        s => !this.#subMetadata.allowedScopes!.includes(s)
      );
      // An empty allow-list denies every requested scope.
      if (forbidden.length > 0) {
        throw new AttestationError(
          'SCOPE_EXCEEDED',
          'SESSION',
          `Scopes not allowed for this SubHandle: ${forbidden.join(', ')}`
        );
      }
    }

    // TTL check
    if (
      this.#subMetadata.maxSessionTtl !== undefined &&
      options.ttl > this.#subMetadata.maxSessionTtl
    ) {
      throw new AttestationError(
        'TTL_EXCEEDED',
        'SESSION',
        `TTL ${options.ttl}s exceeds max allowed ` +
        `${this.#subMetadata.maxSessionTtl}s for this SubHandle`
      );
    }

    // SubHandle expiration check
    if (this.#subMetadata.expiresAt !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      if (now >= this.#subMetadata.expiresAt) {
        throw new AttestationError('EXPIRED', 'SESSION', 'SubHandle has expired');
      }
    }
  }

  /**
   * Redacted serialization contract: `JSON.stringify(sub)` exposes only the
   * object kind, the public identifier, the name and the derivation path —
   * never key material or constraint metadata.
   */
  override toJSON(): { kind: string; id: string; name: string; path: string[] } {
    return {
      kind: 'SubHandle',
      id: base64urlEncode(this.getPublicKey()),
      name: this.getName(),
      path: [...this.#path],
    };
  }

  override [INSPECT_SYMBOL](): string {
    return `SubHandle(id=${base64urlEncode(this.getPublicKey()).slice(0, 8)}…, path=${this.#path.join('/')})`;
  }
}
