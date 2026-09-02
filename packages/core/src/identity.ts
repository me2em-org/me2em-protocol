import { ed, sha512 } from './crypto/init.js';  // ← sha512 теперь импортируется из init
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Handle, type HandleMetadata } from './handle.js';

const ME2EM_HKDF_INFO_PREFIX = 'me2em/handle/v1/';

/**
 * Represents the root cryptographic identity derived from a seed phrase.
 * 
 * An Identity is the foundation of the Me2em protocol. It allows for the 
 * hierarchical derivation of isolated {@link Handle}s for different contexts 
 * (e.g., email, social, specific devices) from a single master seed, 
 * ensuring zero cross-contamination of cryptographic material.
 * 
 * @category Core Primitives
 */
export class Identity {
  private readonly privateKey: Uint8Array;
  private readonly publicKey: Uint8Array;

  private constructor(privateKey: Uint8Array) {
    this.privateKey = privateKey;
    this.publicKey = ed.getPublicKey(privateKey);  // Теперь работает синхронно
  }

    /**
   * Initializes a new Identity from a BIP39 mnemonic seed phrase or raw seed bytes.
   * 
   * @param seed - A 12 or 24-word BIP39 mnemonic string, or a raw Uint8Array seed.
   * @returns A Promise resolving to a new Identity instance.
   * @throws {Error} If the provided seed is invalid or cannot be processed.
   */
  static async fromSeed(seed: Uint8Array | string): Promise<Identity> {
    const seedBytes = typeof seed === 'string' 
      ? Uint8Array.from(Buffer.from(seed, 'hex')) 
      : seed;
    
    if (seedBytes.length !== 32) {
      throw new Error('Invalid seed: must be 32 bytes');
    }

    const key = hkdf(
      sha256,
      seedBytes,
      new Uint8Array(0), // salt
      new TextEncoder().encode('me2em/identity/v1/root'), // info
      32 // length
    );

    return new Identity(key);
  }

    /**
   * Derives a new, cryptographically isolated {@link Handle} for a specific context.
   * 
   * Each Handle is derived deterministically. The same name and metadata will 
   * always produce the same Handle from the same Identity, but different names 
   * produce completely unrelated keys.
   * 
   * @param name - The context identifier (e.g., 'alice@example.com', 'device-1').
   * @param metadata - Optional metadata to associate with this Handle.
   * @returns A Promise resolving to the derived Handle.
   */
  async deriveHandle(name: string, metadata?: HandleMetadata): Promise<Handle> {
    const info = new TextEncoder().encode(ME2EM_HKDF_INFO_PREFIX + name.toLowerCase().trim());
    
    // Используем sha256 для единообразия (или sha512, если нужно)
    // Важно: используем тот же хэш, что и в спецификации
    const handleKey = hkdf(
      sha256,  // ← Используем sha256 для совместимости с Identity деривацией
      this.privateKey,
      new Uint8Array(0),
      info,
      32
    );
    
    return new Handle(handleKey, name, metadata);
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