// packages/solana/test/setup.ts
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.assign(globalThis, { crypto: webcrypto });
}
