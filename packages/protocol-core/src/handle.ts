import { ed } from './crypto/init.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

export interface HandleMetadata {
  displayName?: string;
  avatar?: string;
  [key: string]: unknown;
}

export class Handle {
  private readonly privateKey: Uint8Array;
  private readonly publicKey: Uint8Array;
  private readonly _name: string;
  private readonly _metadata?: HandleMetadata;

  constructor(privateKey: Uint8Array, name: string, metadata?: HandleMetadata) {
    this.privateKey = privateKey;
    this.publicKey = ed.getPublicKey(privateKey);
    this._name = name;
    this._metadata = metadata;
  }

  getId(): string {
    return btoa(String.fromCharCode(...this.publicKey))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    return ed.sign(data, this.privateKey);
  }

  static async verify(signature: Uint8Array, data: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    return ed.verify(signature, data, publicKey);
  }

  getName(): string { return this._name; }
  getMetadata(): HandleMetadata | undefined { return this._metadata; }
  getPublicKey(): Uint8Array { return this.publicKey; }

  /**
   * Deterministically derives a secret (e.g., a password or API key) for a specific service context.
   * The private key NEVER leaves this class, ensuring maximum security.
   * 
   * @param context - A unique identifier for the service (e.g., 'google', 'github', 'wifi-router').
   * @param length - Length of the derived raw bytes (default: 16 bytes = ~22 chars base64url).
   * @returns A URL-safe base64 string suitable for use as a strong password.
   */
  derivePassword(context: string, length: number = 16): string {
    const salt = new TextEncoder().encode(`me2em/secret/${context.toLowerCase().trim()}`);
    const info = new TextEncoder().encode('me2em/secret/v1');
    
    // HKDF использует this.privateKey напрямую, не экспортируя его
    const secretBytes = hkdf(sha256, this.privateKey, salt, info, length);
    
    // Конвертация в URL-safe base64 (аналогично getId)
    return btoa(String.fromCharCode(...secretBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}