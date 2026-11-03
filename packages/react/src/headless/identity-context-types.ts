// packages/react/src/headless/identity-context-types.ts
export interface IdentityContextData {
  /** base64url identity public key — владелец кэша. */
  identityId: string;
  /** Реестр Handle-контекстов этой Identity. */
  handles: Array<{
    name: string;
    subHandles?: string[];
    meta?: Record<string, unknown>;
  }>;
  savedAt: number;
}

export interface IdentityContextStorage {
  open(identityId: string): Promise<void>;
  save(data: IdentityContextData): Promise<void>;
  load(): Promise<IdentityContextData | null>;
  clear(): Promise<void>;
  /**
   * Closes the IDB connection. Caller-owned lifecycle (R5): close()
   * also drops the in-memory cache key and the open identity binding,
   * so every further operation throws "Storage not opened" until the
   * storage is reopened via open()/openAndLoad() and the cache key is
   * set again. open() with a different identityId closes the previous
   * connection automatically; same-identity open() after close()
   * simply opens a fresh connection.
   */
  close(): Promise<void>;
  /** Open storage for identity and atomically load cached context. */
  openAndLoad(identityId: string): Promise<IdentityContextData | null>;
  /** Set the persisted cache key (called at login). */
  setCacheKey(key: CryptoKey): void;
  /** Get the currently set cache key, or null. */
  getCacheKey(): CryptoKey | null;
  /** Persist the CryptoKey to IndexedDB for warm return after browser restart. */
  persistCacheKey(): Promise<void>;
  /** Load a previously persisted CryptoKey from IndexedDB. */
  loadPersistedKey(): Promise<CryptoKey | null>;
}
