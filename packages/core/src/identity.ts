import { ed, sha512 } from './crypto/init.js';  // ← sha512 теперь импортируется из init
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Handle, type HandleMetadata } from './handle.js';

const ME2EM_HKDF_INFO_PREFIX = 'me2em/handle/v1/';

export class Identity {
  private readonly privateKey: Uint8Array;
  private readonly publicKey: Uint8Array;

  private constructor(privateKey: Uint8Array) {
    this.privateKey = privateKey;
    this.publicKey = ed.getPublicKey(privateKey);  // Теперь работает синхронно
  }

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

  getPublicKey(): Uint8Array {
    return this.publicKey;
  }
}