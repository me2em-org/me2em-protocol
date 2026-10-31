// handle.ts
import { ed } from './crypto/init.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { normalizeName, normalizeContext } from './canonical-name.js';
import type { SubHandleMetadata, SubHandle } from './subhandle.js';
import { DERIVATION_PATHS } from './crypto/derivation-paths.js';
import { Attestation, type AttestationGrant } from './attestation.js';
import { DisposedError } from './disposed-error.js';
import { AttestationError } from './errors.js';
import type { Signer } from './types.js';
import { base64urlEncode, INSPECT_SYMBOL } from './util.js';

/**
 * Metadata associated with a {@link Handle}.
 *
 * All fields are optional and application-defined. The protocol does not
 * interpret metadata; it is carried for convenience and may be serialized
 * into tokens or stored by the application.
 *
 * @category Types
 */
export interface HandleMetadata {
  /** Human-readable display name. */
  displayName?: string;
  /** URL or data-URI of an avatar image. */
  avatar?: string;
  /** Arbitrary additional fields. */
  [key: string]: unknown;
}

/**
 * Options for {@link Handle.derivePassword}.
 *
 * All fields are optional; the defaults reproduce the frozen v1.0
 * derivation exactly (specs/v1.0.md §3).
 *
 * @category Types
 */
export interface DerivePasswordOptions {
  /**
   * Positive integer revision of the secret (default `1`).
   *
   * Revision `1` — the initial secret — is byte-identical to the
   * pre-revision derivation. Revision `N ≥ 2` derives a secret that is
   * cryptographically independent of revision 1 for the same context:
   * the sanctioned rotation path when a credential leaks, without
   * changing the context string.
   *
   * Canonical by construction: NFKC normalization applies to the string
   * `context` only. Integers have no Unicode representation, so no
   * normalization is needed or performed on `revision`.
   */
  revision?: number;
  /**
   * Length of the derived raw bytes in `[1, 8160]` (default `16` —
   * ≈ 22 base64url chars). Upper bound is the RFC 5869 HKDF-SHA256
   * limit (`255 × 32`); note the output is prefix-stable, so the first
   * `n` bytes of a longer derivation equal the `n`-byte derivation.
   */
  byteLength?: number;
}

/**
 * Options for {@link Handle.deriveChannelKey}.
 *
 * All fields are optional; the defaults reproduce the frozen v1.0
 * derivation exactly (specs/v1.0.md §3).
 *
 * @category Types
 */
export interface DeriveChannelKeyOptions {
  /**
   * Positive integer revision of the channel key (default `1`).
   *
   * Revision `N ≥ 2` derives a key that is independent of revision 1 for
   * the same context — rotate a compromised channel by bumping the
   * revision on **both** peers in lockstep.
   *
   * Canonical by construction: NFKC normalization applies to the string
   * `context` only. Integers have no Unicode representation, so no
   * normalization is needed or performed on `revision`.
   */
  revision?: number;
}

/** Default {@link Handle.derivePassword} output length (bytes). */
const DEFAULT_PASSWORD_BYTES = 16;

/** Upper HKDF-SHA256 output bound per RFC 5869: 255 × 32 bytes. */
const MAX_HKDF_BYTES = 255 * 32;

/**
 * Revision-domain guard shared by {@link Handle.derivePassword} and
 * {@link Handle.deriveChannelKey}. An omitted revision is the default
 * (`1`); anything that is not a positive integer is rejected as
 * `MALFORMED`/`FORMAT` (same pattern as `Session.create` ttl).
 */
function assertRevision(revision: number | undefined): void {
  if (
    revision !== undefined &&
    (typeof revision !== 'number' ||
      !Number.isInteger(revision) ||
      revision < 1)
  ) {
    throw new AttestationError(
      'MALFORMED',
      'FORMAT',
      `revision must be a positive integer, got: ${String(revision)}`
    );
  }
}

/**
 * Output-length guard for {@link Handle.derivePassword}: an integer in
 * `[1, 8160]`. Pre-checking here keeps the failure an
 * {@link AttestationError} instead of the raw `Error` @noble/hashes
 * would throw beyond the RFC 5869 bound.
 */
function assertByteLength(byteLength: number): void {
  if (
    typeof byteLength !== 'number' ||
    !Number.isInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > MAX_HKDF_BYTES
  ) {
    throw new AttestationError(
      'MALFORMED',
      'FORMAT',
      `byteLength must be an integer in [1, ${MAX_HKDF_BYTES}] (RFC 5869: 255 × SHA-256 output), got: ${String(byteLength)}`
    );
  }
}

/**
 * Represents a context-specific cryptographic handle derived from an {@link Identity}.
 *
 * A Handle encapsulates a private key tied to a specific name (context).
 * It provides methods for signing data, verifying signatures, and deriving
 * secondary secrets (passwords, channel keys, shared secrets) without ever
 * exposing the underlying private key.
 *
 * A Handle can also derive {@link SubHandle}s for hierarchical access control
 * (e.g., an IoT device deriving keys for its components). The private key
 * **never leaves the Handle** — derivation is performed internally using HKDF.
 *
 * Handles own their lifecycle: {@link Handle.dispose} zeroizes the private
 * key, after which every capability method throws a {@link DisposedError}.
 * Serialization (`JSON.stringify`, console inspection) is redacted and never
 * emits key material.
 *
 * @category Core Primitives
 */
export class Handle implements Signer {
  #privateKey: Uint8Array;
  #publicKey: Uint8Array;
  #name: string;
  #metadata: HandleMetadata | undefined;
  #disposed = false;

  /**
   * Creates a new Handle instance.
   *
   * @internal Typically created via {@link Identity.deriveHandle} or
   * {@link Handle.deriveSubHandle}. Direct construction is discouraged.
   *
   * @param privateKey - The 32-byte Ed25519 private key for this handle.
   *   Copied on input — later mutation of the caller's buffer has no effect.
   * @param name - The context name this handle represents.
   * @param metadata - Optional metadata associated with this handle.
   *   Shallow-copied on input (nested values are not cloned).
   */
  constructor(privateKey: Uint8Array, name: string, metadata?: HandleMetadata) {
    this.#privateKey = new Uint8Array(privateKey);
    this.#publicKey = ed.getPublicKey(this.#privateKey);
    this.#name = name;
    this.#metadata = metadata ? { ...metadata } : undefined;
  }

  /**
   * Returns a URL-safe Base64-encoded identifier for this Handle,
   * derived from its public key.
   *
   * @returns A unique, URL-safe string identifier.
   */
  getId(): string {
    return base64urlEncode(this.#publicKey);
  }

  /**
   * Cryptographically signs arbitrary data using the Handle's private key
   * (implements {@link Signer} — a `Handle` is acceptable as the `signer`
   * argument of {@link Attestation.issue}).
   *
   * @param data - The data to be signed, as a Uint8Array.
   * @returns A Promise resolving to the Ed25519 signature as a Uint8Array.
   * @throws {DisposedError} If the Handle has been disposed.
   */
  async sign(data: Uint8Array): Promise<Uint8Array> {
    this.#assertNotDisposed();
    return ed.sign(data, this.#privateKey);
  }

  /**
   * Verifies an Ed25519 signature against the provided data and public key.
   *
   * A signature whose length differs from the 64-byte Ed25519 size is
   * rejected with `false` before any crypto runs (PR-7 pre-check) — the
   * method therefore never throws for short/long signatures.
   *
   * @param signature - The signature to verify (Uint8Array).
   * @param data - The original data that was signed (Uint8Array).
   * @param publicKey - The public key to verify against (Uint8Array).
   * @returns A Promise resolving to `true` if the signature is valid, `false` otherwise.
   */
  static async verify(
    signature: Uint8Array,
    data: Uint8Array,
    publicKey: Uint8Array
  ): Promise<boolean> {
    if (signature.length !== 64) {
      return false;
    }
    return ed.verify(signature, data, publicKey);
  }

  /** @returns The context name associated with this Handle. */
  getName(): string {
    return this.#name;
  }

  /**
   * @returns A shallow copy of the metadata object associated with this
   *   Handle — mutating the returned object does not affect the Handle.
   */
  getMetadata(): HandleMetadata | undefined {
    return this.#metadata ? { ...this.#metadata } : undefined;
  }

  /**
   * @returns A copy of the 32-byte Ed25519 public key — mutating the
   *   returned array does not affect the Handle.
   */
  getPublicKey(): Uint8Array {
    return new Uint8Array(this.#publicKey);
  }

  /** @returns The derivation path, or undefined for Handle (only SubHandle has a path). */
  getPath(): string[] | undefined {
    return undefined;
  }

  /**
   * Validates session options against this Handle's constraints.
   * Handle has no constraints.
   */
  validateSessionOptions(_options: {
    audience: string; scopes: string[]; ttl: number;
  }): void { /* Handle has no constraints */ }

  /**
   * Derives a {@link SubHandle} from this Handle.
   *
   * This is the **autonomous entry point** for IoT devices and other contexts
   * where the Identity is not available locally. The Handle uses its own
   * private key internally (it never leaves the class) to derive a child key
   * via HKDF-SHA256.
   *
   * The resulting SubHandle is cryptographically identical to the one produced
   * by `Identity.deriveSubHandle(this.name, subName)`.
   *
   * @param name - The SubHandle name (will be normalized).
   * @param metadata - Optional SubHandle metadata with constraints.
   * @returns A Promise resolving to the derived SubHandle with path `[this.name, name]`.
   *
   * @example
   * ```ts
   * // On an IoT device (no Identity available)
   * const connector = await stationHandle.deriveSubHandle('connector-1', {
   *   allowedScopes: ['charge:start'],
   *   maxSessionTtl: 3600
   * });
   * ```
   */
  async deriveSubHandle(name: string, metadata?: SubHandleMetadata): Promise<SubHandle> {
    this.#assertNotDisposed();
    const normalizedName = normalizeName(name);
    const info = new TextEncoder().encode(
      DERIVATION_PATHS.subhandle(this.#name, normalizedName)
    );
    // The private key is used internally and never leaves this class.
    const subKey = hkdf(
      sha256,
      this.#privateKey,
      new Uint8Array(0),
      info,
      32
    );
    const path = [this.#name, normalizedName];
    const { SubHandle: SubHandleClass } = await import('./subhandle.js');
    return new SubHandleClass(subKey, normalizedName, path, metadata);
  }

  /**
   * Issues an attestation for a derived SubHandle, binding its
   * derived key to the name and grant. Autonomous: requires only
   * this Handle's own key, no Identity and no network.
   *
   * The child key is derived internally, so the attestation's
   * `subjectId` always equals the key produced by
   * `identity.deriveSubHandle(this.name, subName)`.
   *
   * Note: this method does not check this Handle's own grant — it may
   * not have one (Mode 1). Nesting is enforced by verifiers in
   * `Session.verifyAttested` (a child grant exceeding the parent's is
   * rejected with `SCOPE_EXCEEDED`/`TTL_EXCEEDED` at level ROOT).
   *
   * @example
   * ```ts
   * const B = await station.attestSubHandle('connector-ccs', {
   *   audiences: ['ev-app.com'],
   *   scopes: ['charge:start', 'charge:stop'],
   *   maxSessionTtl: 7200,
   * }, { ttlSeconds: 1800 });
   * // Ship [A.token, B.token] together with the session token.
   * ```
   */
  async attestSubHandle(
    subName: string,
    grant: AttestationGrant,
    opts?: { ttlSeconds?: number; expiresAt?: number; jti?: string; now?: number }
  ): Promise<Attestation> {
    this.#assertNotDisposed();
    const normalized = normalizeName(subName);
    const sub = await this.deriveSubHandle(normalized);
    return Attestation.issue(
      this,
      sub.getPublicKey(),
      normalized,
      grant,
      opts ?? {}
    );
  }

  /**
   * Deterministically derives a secret (e.g., a password or API key) for a
   * specific service context.
   *
   * The private key **never leaves this class**, ensuring maximum security.
   *
   * The `context` is canonicalized NFKC → lowercase → trim before use
   * (`'  GitHub '`, `'github'` and `'ＧitHub'` yield the same secret).
   * NFKC applies to the string `context` only — `options.revision` is
   * an integer and is canonical by construction (no normalization).
   *
   * **Revision model (since 0.8.0, D3):** `options.revision` (positive
   * integer, default `1`) selects an independent secret for the same
   * context — revision 1 is the initial secret, revision 2, 3, … are for
   * rotation (e.g. after a breach). Revision 1 is byte-identical to the
   * pre-revision v1.0 derivation.
   *
   * @param context - A unique identifier for the service (e.g., `'google'`, `'github'`).
   * @param options - Derivation options.
   * @returns A URL-safe base64 string suitable for use as a strong password.
   * @throws AttestationError `MALFORMED`/`FORMAT` if `revision` is not a
   *   positive integer, `byteLength` is not an integer in `[1, 8160]`, or
   *   the context is empty after canonicalization.
   *
   * @example
   * ```ts
   * const githubPassword = handle.derivePassword('github', { byteLength: 20 });
   * // after rotating the GitHub credential:
   * const rotated = handle.derivePassword('github', { revision: 2 });
   * ```
   */
  derivePassword(context: string, options: DerivePasswordOptions = {}): string {
    this.#assertNotDisposed();
    assertRevision(options.revision);
    const byteLength = options.byteLength ?? DEFAULT_PASSWORD_BYTES;
    assertByteLength(byteLength);
    const canonical = normalizeContext(context);
    const salt = new TextEncoder().encode(`me2em/secret/${canonical}`);
    const info = new TextEncoder().encode(DERIVATION_PATHS.password(options.revision ?? 1));
    const secretBytes = hkdf(sha256, this.#privateKey, salt, info, byteLength);
    // Audited @scure/base codec (A3) — no hand-rolled btoa alphabet math.
    return base64urlEncode(secretBytes);
  }

  /**
   * Derives a symmetric 256-bit channel key for secure communication between
   * the Identity (controller) and this Handle (device/context).
   *
   * Both parties can independently compute this key because:
   * - The Handle possesses its own private key directly.
   * - The Identity can derive the same private key via `identity.deriveHandle(name)`.
   *
   * This enables zero-knowledge encrypted channels without key exchange protocols.
   *
   * The `context` is canonicalized NFKC → lowercase → trim before use.
   * NFKC applies to the string `context` only — `options.revision` is
   * an integer and is canonical by construction (no normalization).
   *
   * **Revision model (since 0.8.0, D3):** `options.revision` (positive
   * integer, default `1`) selects an independent 32-byte key for the same
   * context — the sanctioned rotation path for a compromised channel
   * without changing the context string. Revision 1 is byte-identical to
   * the pre-revision v1.0 derivation.
   *
   * @param context - Channel identifier for domain separation (e.g., `'drone-001'`).
   *   Both parties **MUST** use the same context **and** the same revision.
   * @param options - Derivation options.
   * @returns A 32-byte Uint8Array suitable for AES-256-GCM encryption.
   * @throws AttestationError `MALFORMED`/`FORMAT` if `revision` is not a
   *   positive integer or the context is empty after canonicalization.
   *
   * @example
   * ```ts
   * // AES-GCM helpers are application-side; the protocol provides
   * // only the key:
   * const channelKey = droneHandle.deriveChannelKey('telemetry-v1');
   * // after rotating the channel (both sides migrate in lockstep):
   * const rotatedKey = droneHandle.deriveChannelKey('telemetry-v1', { revision: 2 });
   * ```
   */
  deriveChannelKey(context: string, options: DeriveChannelKeyOptions = {}): Uint8Array {
    this.#assertNotDisposed();
    assertRevision(options.revision);
    const canonical = normalizeContext(context);
    const salt = new TextEncoder().encode(`me2em/channel/${canonical}`);
    const info = new TextEncoder().encode(DERIVATION_PATHS.channel(options.revision ?? 1));
    return hkdf(sha256, this.#privateKey, salt, info, 32);
  }

  /**
   * Derives a shared secret using ECDH (X25519) for P2P key exchange.
   *
   * Converts the Ed25519 keypair to X25519 for Diffie-Hellman key agreement,
   * then applies HKDF-SHA256 to produce a clean 32-byte channel key.
   *
   * @param otherPublicKey - The Ed25519 public key of the other party (32 bytes).
   * @returns A Promise resolving to a 32-byte shared secret suitable for AES-256-GCM.
   *
   * @example
   * ```ts
   * const aliceShared = await aliceHandle.deriveSharedSecret(bobHandle.getPublicKey());
   * const bobShared = await bobHandle.deriveSharedSecret(aliceHandle.getPublicKey());
   * // aliceShared === bobShared
   * ```
   */
  async deriveSharedSecret(otherPublicKey: Uint8Array): Promise<Uint8Array> {
    this.#assertNotDisposed();
    const myPrivBytes = this.#privateKey;
    const otherPubBytes = otherPublicKey;

    /* v8 ignore start -- defensive: the constructor already validates the
       key length implicitly (ed25519.getPublicKey throws RangeError). */
    if (myPrivBytes.length !== 32) {
      throw new AttestationError('MALFORMED', 'FORMAT', 'Handle private key must be 32 bytes');
    }
    /* v8 ignore stop */
    if (otherPubBytes.length !== 32) {
      throw new AttestationError('MALFORMED', 'FORMAT', 'Public key must be 32 bytes');
    }

    const x25519Priv = ed25519.utils.toMontgomerySecret(myPrivBytes);
    const x25519Pub = ed25519.utils.toMontgomery(otherPubBytes);
    const rawSharedSecret = x25519.getSharedSecret(x25519Priv, x25519Pub);

    // Canonical, order-independent binding of both peers' public keys.
    const myPub = this.getPublicKey();
    const peers = [myPub, otherPubBytes].sort((a, b) => {
      for (let i = 0; i < 32; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
      }
      return 0;
    });
    const bound = new Uint8Array(64);
    bound.set(peers[0], 0);
    bound.set(peers[1], 32);

    const info = new TextEncoder().encode(
      DERIVATION_PATHS.p2pChannelV2
    );
    return hkdf(sha256, rawSharedSecret, bound, info, 32);
  }

  /**
   * Permanently destroys this Handle's key material.
   *
   * The private key bytes are zeroized; afterwards every capability method
   * ({@link sign}, {@link deriveSubHandle}, {@link attestSubHandle},
   * {@link derivePassword}, {@link deriveChannelKey},
   * {@link deriveSharedSecret}) throws a {@link DisposedError}.
   * Informational getters ({@link getName}, {@link getId},
   * {@link getPublicKey}, {@link getMetadata}) keep working — they never
   * touch key material.
   *
   * SubHandles inherit `dispose()`. Calling it more than once is a no-op
   * (idempotent).
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#privateKey.fill(0);
    this.#disposed = true;
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new DisposedError('Handle');
  }

  /**
   * Redacted serialization contract: `JSON.stringify(handle)` exposes only
   * the object kind, the public identifier and the context name — never
   * key material or metadata.
   */
  toJSON(): { kind: string; id: string; name: string } {
    return {
      kind: 'Handle',
      id: base64urlEncode(this.#publicKey),
      name: this.#name,
    };
  }

  [INSPECT_SYMBOL](): string {
    return `Handle(id=${base64urlEncode(this.#publicKey).slice(0, 8)}…, name=${JSON.stringify(this.#name)})`;
  }
}
