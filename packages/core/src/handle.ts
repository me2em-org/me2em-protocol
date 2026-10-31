// handle.ts
import { ed } from './crypto/init.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { normalizeName } from './canonical-name.js';
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
   * @param context - A unique identifier for the service (e.g., `'google'`, `'github'`).
   * @param length - Length of the derived raw bytes (default: 16 bytes ≈ 22 chars base64url).
   * @returns A URL-safe base64 string suitable for use as a strong password.
   *
   * @example
   * ```ts
   * const githubPassword = handle.derivePassword('github', 20);
   * ```
   */
  derivePassword(context: string, length: number = 16): string {
    this.#assertNotDisposed();
    const salt = new TextEncoder().encode(`me2em/secret/${context.toLowerCase().trim()}`);
    const info = new TextEncoder().encode('me2em/secret/v1');
    const secretBytes = hkdf(sha256, this.#privateKey, salt, info, length);
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
   * @param context - Channel identifier for domain separation (e.g., `'drone-001'`).
   *   Both parties **MUST** use the same context.
   * @returns A 32-byte Uint8Array suitable for AES-256-GCM encryption.
   *
   * @example
   * ```ts
   * // AES-GCM helpers are application-side; the protocol provides
   * // only the key:
   * const channelKey = droneHandle.deriveChannelKey('telemetry-v1');
   * ```
   */
  deriveChannelKey(context: string): Uint8Array {
    this.#assertNotDisposed();
    const salt = new TextEncoder().encode(`me2em/channel/${context.toLowerCase().trim()}`);
    const info = new TextEncoder().encode('me2em/channel/v1');
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
