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
  close(): Promise<void>;
  /** Set the persisted cache key (called at login). */
  setCacheKey(key: CryptoKey): void;
  /** Get the currently set cache key, or null. */
  getCacheKey(): CryptoKey | null;
}
