// packages/react/src/headless/identity-context-storage.ts
import { encryptContext, decryptContext, type ContextEnvelope } from './context-crypto.js';
import type { IdentityContextData, IdentityContextStorage } from './identity-context-types.js';
export type { IdentityContextData };

const DB_NAME_PREFIX = 'me2em_';
const STORE_NAME = 'context';
const KEYS_STORE_NAME = 'cryptoKeys';
const CACHE_KEY = 'cache';

function hashToHex(data: Uint8Array): string {
  const hexParts: string[] = [];
  for (const byte of data) {
    hexParts.push(byte.toString(16).padStart(2, '0'));
  }
  return hexParts.join('');
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const digest: ArrayBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return hashToHex(new Uint8Array(digest));
}

async function dbNameForIdentity(identityId: string): Promise<string> {
  const hash = await sha256Hex(new TextEncoder().encode(identityId));
  return DB_NAME_PREFIX + hash.slice(0, 16);
}

export class IdentityContextIDBStorage implements IdentityContextStorage {
  private db: IDBDatabase | null = null;
  private currentIdentityId: string | null = null;
  private cacheKey: CryptoKey | null = null;

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) {
      throw new Error('Storage not opened — call open() first');
    }
    return this.db;
  }

  async open(identityId: string): Promise<void> {
    if (this.currentIdentityId !== null && this.currentIdentityId !== identityId) {
      await this.close();
    }

    this.currentIdentityId = identityId;
    const name = await dbNameForIdentity(identityId);

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(KEYS_STORE_NAME)) {
          db.createObjectStore(KEYS_STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => {
        reject(new Error('IndexedDB open failed: ' + request.error?.message));
      };
    });
  }

  async openAndLoad(identityId: string): Promise<IdentityContextData | null> {
    await this.open(identityId);
    const key = this.cacheKey ?? await this.loadPersistedKey();
    if (!key) {
      return null;
    }
    this.cacheKey = key;
    return this.load();
  }

  async save(data: IdentityContextData): Promise<void> {
    const key = this.cacheKey;
    if (!key) {
      throw new Error('No cache key set — call setCacheKey before save');
    }
    const envelope = await encryptContext(key, data);
    const db = await this.getDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ key: CACHE_KEY, envelope });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Save failed: ' + tx.error?.message));
    });
  }

  async load(): Promise<IdentityContextData | null> {
    const db = await this.getDb();
    const key = this.cacheKey;
    if (!key) {
      return null;
    }
    return new Promise<IdentityContextData | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(CACHE_KEY);

      request.onsuccess = () => {
        const record = request.result;
        if (!record || !record.envelope) {
          resolve(null);
          return;
        }
        decryptContext(key, record.envelope)
          .then((data) => {
            if (data.identityId !== this.currentIdentityId) {
              resolve(null);
              return;
            }
            resolve(data);
          })
          .catch(() => {
            resolve(null);
          });
      };

      request.onerror = () => reject(new Error('Load failed: ' + request.error?.message));
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(CACHE_KEY);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Clear failed: ' + tx.error?.message));
    });
  }

  async close(): Promise<void> {
    const db = this.db;
    this.db = null;
    this.currentIdentityId = null;
    this.cacheKey = null;
    if (db) {
      db.close();
    }
  }

  setCacheKey(key: CryptoKey): void {
    this.cacheKey = key;
  }

  getCacheKey(): CryptoKey | null {
    return this.cacheKey;
  }

  async persistCacheKey(): Promise<void> {
    const key = this.cacheKey;
    if (!key) {
      throw new Error('No cache key to persist — call setCacheKey first');
    }
    const db = await this.getDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEYS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(KEYS_STORE_NAME);
      store.put({ key: 'cache', cryptoKey: key });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('persistCacheKey failed: ' + tx.error?.message));
    });
  }

  async loadPersistedKey(): Promise<CryptoKey | null> {
    const db = this.db;
    if (!db) {
      return null;
    }
    return new Promise<CryptoKey | null>((resolve, reject) => {
      const tx = db.transaction(KEYS_STORE_NAME, 'readonly');
      const store = tx.objectStore(KEYS_STORE_NAME);
      const request = store.get('cache');

      request.onsuccess = () => {
        const record = request.result;
        if (!record || !record.cryptoKey) {
          resolve(null);
          return;
        }
        resolve(record.cryptoKey);
      };

      request.onerror = () => {
        resolve(null);
      };
    });
  }
}
