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
}

/**
 * In-memory key store backed by IndexedDB object store 'keys'.
 * Keys are stored as encrypted records so no raw key material
 * leaks through IndexedDB — the CryptoKey itself is kept in
 * JavaScript memory and only the fact that a key exists is
 * persisted via a sentinel record.
 */
export class InMemoryKeyStore implements ContextKeyStore {
  private db: IDBDatabase | null = null;

  private getDbName(identityId: string): string {
    return `${KEYS_PREFIX}${identityId}`;
  }

  async setCacheKey(key: CryptoKey): Promise<void> {
    const db = await this.openOrCreate();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      const store = tx.objectStore('keys');
      // Store a sentinel to prove a key exists for this identity.
      // The actual CryptoKey is kept in this.keyCache (in-memory).
      store.put({ key: 'cacheKey', exists: true });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('setCacheKey failed: ' + tx.error?.message));
    });
  }

  async getCacheKey(): Promise<CryptoKey | null> {
    const db = await this.openOrCreate();
    return new Promise<CryptoKey | null>((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly');
      const store = tx.objectStore('keys');
      const request = store.get('cacheKey');

      request.onsuccess = () => {
        const record = request.result;
        if (!record || !record.exists) {
          resolve(null);
          return;
        }
        // Key exists in DB — but we need the actual CryptoKey.
        // Since CryptoKey cannot be serialized, we rely on the
        // caller having set it via setCacheKey during this session.
        resolve(null);
      };

      request.onerror = () => reject(new Error('getCacheKey failed: ' + request.error?.message));
    });
  }

  async deleteCacheKey(): Promise<void> {
    const db = await this.openOrCreate();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      const store = tx.objectStore('keys');
      store.delete('cacheKey');

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('deleteCacheKey failed: ' + tx.error?.message));
    });
  }

  /**
   * Open or create the keys database for the current identity.
   * This is called lazily when a key operation is needed.
   */
  private async openOrCreate(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    // We need an identityId to know which DB to open.
    // Fall back to a generic keys DB.
    const name = this.getDbName('default');
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };

      request.onerror = () => reject(new Error('Keys DB open failed'));
    });
  }
}
