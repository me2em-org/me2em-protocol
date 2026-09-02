import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

/**
 * Configure @noble/ed25519 for synchronous operations.
 * Must be called before any ed25519 operation (sign, verify, getPublicKey).
 */
export function initEd25519(): void {
  // Configure sha512 for sync operations (required for @noble/ed25519 v3)
  if (!ed.hashes.sha512) {
    ed.hashes.sha512 = sha512;
  }
}

// Auto-init on module load
initEd25519();

export { ed, sha512 };