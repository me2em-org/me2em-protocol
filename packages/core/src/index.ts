export { Identity } from './identity.js';
export { Handle, type HandleMetadata } from './handle.js';
export { SubHandle, type SubHandleMetadata } from './subhandle.js';
export { Session, type SessionOptions, type SessionPayload, type RevocationChecker } from './session.js';
export { Attestation, AttestationError, ATTESTATION_TYPE, ATTESTATION_MAX_PAYLOAD, type AttestationGrant, type AttestationPayload, type AttestationErrorCode, type AttestationLevel } from './attestation.js';
export * as crypto from './crypto/index.js';

/**
 * @module @me2em/core
 * @packageDocumentation
 * 
 * Core cryptographic primitives for the Me2em authorization protocol.
 * 
 * This package provides the foundation for decentralized, multi-context 
 * identity management and secure, stateless authentication.
 * 
 * ## Key Features
 * - **Hierarchical Identities**: Derive multiple isolated {@link Handle}s from a single seed.
 * - **SubHandle Leaf Nodes**: Hierarchical access control with MAX_DEPTH = 2.
 * - **Stateless Auth**: Cryptographic proof without server-side session storage via {@link Session}.
 * - **Zero-Knowledge Secrets**: Deterministic password derivation without storage.
 * - **Revocation Support**: Optional {@link RevocationChecker} interface for session invalidation.
 * 
 * @example Basic usage
 * ```typescript
 * import { Identity } from '@me2em/core';
 * 
 * const identity = await Identity.fromSeed('your twelve word mnemonic phrase here...');
 * const handle = await identity.deriveHandle('user@example.com');
 * const signature = await handle.sign(new TextEncoder().encode('data'));
 * ```
 */
export {
  generateSeedPhrase,
  normalizeSeedPhrase,
  validateSeedPhrase,
  get32ByteSeedFromMnemonic,
  type SeedStrength
} from './seed.js';
