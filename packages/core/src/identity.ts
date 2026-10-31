// identity.ts
import { ed } from './crypto/init.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Handle, type HandleMetadata } from './handle.js';
import { SubHandle, type SubHandleMetadata } from './subhandle.js';
import { DERIVATION_PATHS } from './crypto/derivation-paths.js';
import { normalizeName } from './canonical-name.js';
import { Attestation, type AttestationGrant } from './attestation.js';
import { DisposedError } from './disposed-error.js';
import type { Signer } from './types.js';
import { base64urlEncode, INSPECT_SYMBOL } from './util.js';

function parseHexSeed(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{128}$/.test(hex)) {
    throw new Error('Seed string must be 128 hex characters');
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Represents the root cryptographic identity derived from a seed phrase.
 *
 * An Identity is the foundation of the Me2eM protocol. It allows for the
 * hierarchical derivation of isolated {@link Handle}s and {@link SubHandle}s
 * for different contexts (e.g., email, social, specific devices) from a
 * single master seed, ensuring zero cross-contamination of cryptographic material.
 *
 * The Identity provides two derivation entry points:
 * - {@link Identity.deriveHandle} — derives a top-level Handle.
 * - {@link Identity.deriveSubHandle} — atomically derives a SubHandle by its
 *   full path (Handle name + SubHandle name). Used primarily for stateless
 *   session verification on the server side.
 *
 * @category Core Primitives
 */
export class Identity implements Signer {
  #privateKey: Uint8Array;
  #publicKey: Uint8Array;
  #disposed = false;

  private constructor(privateKey: Uint8Array) {
    // Defensive copy: the caller keeps no reference to the stored bytes.
    this.#privateKey = new Uint8Array(privateKey);
    this.#publicKey = ed.getPublicKey(this.#privateKey);
  }

  /**
   * Initializes a new Identity from a BIP39 mnemonic seed phrase or raw seed bytes.
   *
   * The seed is the full 64-byte BIP39 seed (PBKDF2-HMAC-SHA512 output,
   * as produced by {@link get64ByteSeedFromMnemonic}). It is used as the
   * HKDF-SHA256 input key material; HKDF info strings are unchanged.
   *
   * @param seed - A 64-byte raw Uint8Array seed, or a hex-encoded string of 64 bytes.
   * @returns A Promise resolving to a new Identity instance.
   * @throws {Error} If the provided seed is not exactly 64 bytes.
   *
   * @example
   * ```ts
   * const seed = await get64ByteSeedFromMnemonic('abandon abandon ... art');
   * const identity = await Identity.fromSeed(seed);
   * ```
   */
  static async fromSeed(seed: Uint8Array | string): Promise<Identity> {
    const seedBytes = typeof seed === 'string'
      ? parseHexSeed(seed)
      : seed;

    if (seedBytes.length !== 64) {
      throw new Error('Invalid seed: must be 64 bytes');
    }

    const key = hkdf(
      sha256,
      seedBytes,
      new Uint8Array(0),
      new TextEncoder().encode(DERIVATION_PATHS.identity),
      32
    );
    return new Identity(key);
  }

  /**
   * Derives a new, cryptographically isolated {@link Handle} for a specific context.
   *
   * Each Handle is derived deterministically. The same name will always produce
   * the same Handle from the same Identity, but different names produce
   * completely unrelated keys.
   *
   * @param name - The context identifier (e.g., `'alice@example.com'`, `'station-001'`).
   * @param metadata - Optional metadata to associate with this Handle.
   * @returns A Promise resolving to the derived Handle.
   *
   * @example
   * ```ts
   * const handle = await identity.deriveHandle('station-001', {
   *   displayName: 'Berlin Station #001'
   * });
   * ```
   */
  async deriveHandle(name: string, metadata?: HandleMetadata): Promise<Handle> {
    this.#assertNotDisposed();
    name = normalizeName(name);
    const info = new TextEncoder().encode(DERIVATION_PATHS.handle(name));
    const handleKey = hkdf(
      sha256,
      this.#privateKey,
      new Uint8Array(0),
      info,
      32
    );
    return new Handle(handleKey, name, metadata);
  }

  /**
   * Atomically derives a {@link SubHandle} from this Identity by its full path.
   *
   * This method performs the equivalent of:
   * ```ts
   * const handle = await identity.deriveHandle(handleName);
   * const sub = await handle.deriveSubHandle(subName);
   * ```
   * but in a single call, without exposing the intermediate Handle.
   *
   * It is the **recommended entry point for stateless session verification**,
   * because the server only needs the Identity and the path from the token.
   *
   * The resulting SubHandle is cryptographically identical to the one produced
   * by `Handle.deriveSubHandle(subName)` on the same Identity.
   *
   * @param handleName - The parent Handle name.
   * @param subName - The SubHandle name.
   * @param metadata - Optional SubHandle metadata with constraints.
   * @returns A Promise resolving to the derived SubHandle with path `[handleName, subName]`.
   *
   * @example
   * ```ts
   * // Server-side stateless verification
   * const sub = await identity.deriveSubHandle('station-001', 'connector-1');
   * const publicKey = sub.getPublicKey();
   * ```
   */
  async deriveSubHandle(
    handleName: string,
    subName: string,
    metadata?: SubHandleMetadata
  ): Promise<SubHandle> {
    this.#assertNotDisposed();
    handleName = normalizeName(handleName);
    const subNameNorm = normalizeName(subName);

    // Step 1: derive the intermediate Handle key (never exposed)
    const handleInfo = new TextEncoder().encode(DERIVATION_PATHS.handle(handleName));
    const handleKey = hkdf(
      sha256,
      this.#privateKey,
      new Uint8Array(0),
      handleInfo,
      32
    );

    // Step 2: derive the SubHandle key from the Handle key
    const subInfo = new TextEncoder().encode(
      DERIVATION_PATHS.subhandle(handleName, subNameNorm)
    );
    const subKey = hkdf(
      sha256,
      handleKey,
      new Uint8Array(0),
      subInfo,
      32
    );

    const path = [handleName, subNameNorm];
    return new SubHandle(subKey, subNameNorm, path, metadata);
  }

  /**
   * Signs arbitrary data with the root private key (implements
   * {@link Signer}).
   *
   * This is what makes an `Identity` acceptable as the `signer` argument
   * of {@link Attestation.issue} — the raw private key never leaves the
   * Identity.
   *
   * @param data - The data to be signed, as a Uint8Array.
   * @returns A Promise resolving to the 64-byte Ed25519 signature.
   * @throws {DisposedError} If the Identity has been disposed.
   */
  async sign(data: Uint8Array): Promise<Uint8Array> {
    this.#assertNotDisposed();
    return ed.sign(data, this.#privateKey);
  }

  /**
   * Issues an attestation binding a derived Handle key to its name
   * and grant. The subject public key is always derived internally —
   * it is impossible to attest a foreign key, and the resulting
   * `subjectId` always matches the handle reconstructed via
   * {@link Identity.deriveSubHandle}.
   *
   * @param grant - Constraints verifiers will enforce for this handle
   *   and (via `subNamePatterns`) for the SubHandles it may attest.
   * @returns An attestation signed by the Identity root key (the
   *   Identity passes itself to `Attestation.issue` as the {@link Signer}).
   *   Store it with the Handle — it is a public artifact, not a secret.
   * @throws {Error} If the name is not canonicalizable.
   * @throws {AttestationError} If the grant is invalid.
   *
   * @example
   * ```ts
   * const A = await identity.attestHandle('station-001', {
   *   audiences: ['ev-app.com'],
   *   scopes: ['charge:start', 'charge:stop', 'charge:status'],
   *   maxSessionTtl: 7200,
   *   subNamePatterns: ['connector-*', 'meter-*'],
   * });
   * ```
   */
  async attestHandle(
    name: string,
    grant: AttestationGrant,
    opts?: { ttlSeconds?: number; expiresAt?: number; jti?: string; now?: number }
  ): Promise<Attestation> {
    this.#assertNotDisposed();
    const normalized = normalizeName(name);
    const handle = await this.deriveHandle(normalized);
    return Attestation.issue(
      this,
      handle.getPublicKey(),
      normalized,
      grant,
      opts ?? {}
    );
  }

  /**
   * Retrieves the public key of the root Identity.
   *
   * The returned array is a defensive copy — mutating it does not affect
   * the Identity.
   *
   * @returns A Uint8Array containing the 32-byte Ed25519 public key.
   */
  getPublicKey(): Uint8Array {
    return new Uint8Array(this.#publicKey);
  }

  /**
   * Permanently destroys this Identity's key material.
   *
   * The private key bytes are zeroized; afterwards every capability method
   * ({@link sign}, {@link deriveHandle}, {@link deriveSubHandle},
   * {@link attestHandle}) throws a {@link DisposedError}. Informational getters
   * ({@link getPublicKey}) keep working — public keys are not secrets.
   *
   * Calling `dispose()` more than once is a no-op (idempotent).
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#privateKey.fill(0);
    this.#privateKey = new Uint8Array(0);
    this.#disposed = true;
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new DisposedError('Identity');
  }

  /**
   * Redacted serialization contract: `JSON.stringify(identity)` exposes
   * only the object kind and the public identifier — never key material
   * or seed-derived state.
   */
  toJSON(): { kind: string; id: string } {
    return { kind: 'Identity', id: base64urlEncode(this.#publicKey) };
  }

  [INSPECT_SYMBOL](): string {
    return `Identity(id=${base64urlEncode(this.#publicKey).slice(0, 8)}…)`;
  }
}
