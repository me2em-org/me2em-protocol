// identity.ts
import { ed } from './crypto/init.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Handle, type HandleMetadata } from './handle.js';
import { SubHandle, type SubHandleMetadata } from './subhandle.js';
import { DERIVATION_PATHS } from './crypto/derivation-paths.js';
import { normalizeName } from './canonical-name.js';

function parseHexSeed(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('Seed string must be 64 hex characters');
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Represents the root cryptographic identity derived from a seed phrase.
 *
 * An Identity is the foundation of the Me2em protocol. It allows for the
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
export class Identity {
  private readonly privateKey: Uint8Array;
  private readonly publicKey: Uint8Array;

  private constructor(privateKey: Uint8Array) {
    this.privateKey = privateKey;
    this.publicKey = ed.getPublicKey(privateKey);
  }

  /**
   * Initializes a new Identity from a BIP39 mnemonic seed phrase or raw seed bytes.
   *
   * @param seed - A 32-byte raw Uint8Array seed, or a hex-encoded string of 32 bytes.
   * @returns A Promise resolving to a new Identity instance.
   * @throws {Error} If the provided seed is not exactly 32 bytes.
   *
   * @example
   * ```ts
   * const seed = await get32ByteSeedFromMnemonic('abandon abandon ... art');
   * const identity = await Identity.fromSeed(seed);
   * ```
   */
  static async fromSeed(seed: Uint8Array | string): Promise<Identity> {
    const seedBytes = typeof seed === 'string'
      ? parseHexSeed(seed)
      : seed;

    if (seedBytes.length !== 32) {
      throw new Error('Invalid seed: must be 32 bytes');
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
    name = normalizeName(name);
    const info = new TextEncoder().encode(DERIVATION_PATHS.handle(name));
    const handleKey = hkdf(
      sha256,
      this.privateKey,
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
    handleName = normalizeName(handleName);
    const subNameNorm = normalizeName(subName);

    // Step 1: derive the intermediate Handle key (never exposed)
    const handleInfo = new TextEncoder().encode(DERIVATION_PATHS.handle(handleName));
    const handleKey = hkdf(
      sha256,
      this.privateKey,
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
   * Retrieves the public key of the root Identity.
   *
   * @returns A Uint8Array containing the 32-byte Ed25519 public key.
   */
  getPublicKey(): Uint8Array {
    return this.publicKey;
  }
}
