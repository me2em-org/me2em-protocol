// packages/react/src/headless/context-key-store.ts
import type { IdentityContextData } from './identity-context-storage.js';

const KEYS_PREFIX = '__keys:';

export interface ContextKeyStore {
  /** Save a persisted CryptoKey for later use. */
  setCacheKey(key: CryptoKey): Promise<void>;
  /** Retrieve the persisted CryptoKey, or null if not found. */
  getCacheKey(): Promise<CryptoKey | null>;
  /** Delete the persisted CryptoKey (called on logout). */
  deleteCacheKey(): Promise<void>;
  /** Persist the CryptoKey to IndexedDB for warm return after browser restart. */
  persistCacheKey(): Promise<void>;
  /** Load a previously persisted CryptoKey from IndexedDB. */
  loadPersistedKey(): Promise<CryptoKey | null>;
}

/**
 * IndexedDB-backed key store. CryptoKey objects are structured-cloned
 * into an object store 'cryptoKeys' so they survive browser restarts.
 */
export class InMemoryKeyStore implements ContextKeyStore {
  private db: IDBDatabase | null = null;

  private getDbName(identityId: string): string {
    return `${KEYS_PREFIX}${identityId}`;
  }

  private async openOrCreate(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    const name = this.getDbName('default');
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('cryptoKeys')) {
          db.createObjectStore('cryptoKeys', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };

      request.onerror = () => reject(new Error('Keys DB open failed'));
    });
  }

  async setCacheKey(key: CryptoKey): Promise<void> {
    this.cacheKey = key;
    const db = await this.openOrCreate();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cryptoKeys', 'readwrite');
      const store = tx.objectStore('cryptoKeys');
      store.put({ key: 'cacheKey', cryptoKey: key });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('setCacheKey failed: ' + tx.error?.message));
    });
  }

  private cacheKey: CryptoKey | null = null;

  async getCacheKey(): Promise<CryptoKey | null> {
    if (this.cacheKey) return this.cacheKey;
    return this.loadPersistedKey();
  }

  async deleteCacheKey(): Promise<void> {
    this.cacheKey = null;
    const db = await this.openOrCreate();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cryptoKeys', 'readwrite');
      const store = tx.objectStore('cryptoKeys');
      store.delete('cacheKey');

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('deleteCacheKey failed: ' + tx.error?.message));
    });
  }

  async persistCacheKey(): Promise<void> {
    const key = this.cacheKey;
    if (!key) {
      throw new Error('No cache key to persist');
    }
    const db = await this.openOrCreate();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cryptoKeys', 'readwrite');
      const store = tx.objectStore('cryptoKeys');
      store.put({ key: 'cacheKey', cryptoKey: key });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('persistCacheKey failed: ' + tx.error?.message));
    });
  }

  async loadPersistedKey(): Promise<CryptoKey | null> {
    const db = await this.openOrCreate();
    return new Promise<CryptoKey | null>((resolve, reject) => {
      const tx = db.transaction('cryptoKeys', 'readonly');
      const store = tx.objectStore('cryptoKeys');
      const request = store.get('cacheKey');

      request.onsuccess = () => {
        const record = request.result;
        if (!record || !record.cryptoKey) {
          resolve(null);
          return;
        }
        resolve(record.cryptoKey);
      };

      request.onerror = () => resolve(null);
    });
  }
}
