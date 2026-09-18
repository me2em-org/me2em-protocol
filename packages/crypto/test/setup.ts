// packages/crypto/test/setup.ts
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  (globalThis as any).crypto = webcrypto;
}
