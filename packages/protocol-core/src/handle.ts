import { ed } from './crypto/init.js';  // ← init уже настроил sha512

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
    this.publicKey = ed.getPublicKey(privateKey);  // Синхронно благодаря init
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
    return ed.sign(data, this.privateKey);  // Синхронно благодаря init
  }

  static async verify(signature: Uint8Array, data: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    return ed.verify(signature, data, publicKey);  // Синхронно благодаря init
  }

  getName(): string { return this._name; }
  getMetadata(): HandleMetadata | undefined { return this._metadata; }
  getPublicKey(): Uint8Array { return this.publicKey; }
}