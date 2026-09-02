export { Identity } from './identity.js';
export { Handle, type HandleMetadata } from './handle.js';
export { Session, type SessionOptions, type SessionToken } from './session.js';
export * as crypto from './crypto/index.js';

// Seed utilities for human-friendly key generation
export {
  generateSeedPhrase,
  normalizeSeedPhrase,
  validateSeedPhrase,
  get32ByteSeedFromMnemonic,
  type SeedStrength
} from './seed.js';

export const PROTOCOL_VERSION = '0.4.1-alpha.1';