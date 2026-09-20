// packages/crypto/src/index.ts

export { hkdf, hkdfWithInfo } from './core/hkdf.js';
export {
  generateX25519KeyPair,
  x25519SharedSecret,
  ed25519PrivToX25519,
  ed25519PubToX25519,
  deriveX25519PublicKey,
  type X25519KeyPair,
} from './core/ecdh.js';
export { importAeadKey, encryptAead, decryptAead, type AeadResult } from './core/aead.js';
export {
  signRaw,
  verifyRaw,
  signRawToBase64,
  verifyRawFromBase64,
} from './core/signatures.js';
export { secureWipe, secureWipeMultiple, withSecureWipe } from './core/wipe.js';
export { hashIdentityMaterial } from './kdf/hash-identity.js';
export {
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  concat,
  randomBytes,
  randomBytesB64,
  bytesEqual,
} from './utils/binary.js';
export { CryptoError, type CryptoErrorCode, type CryptoErrorLevel } from './errors.js';
export {
  validateSeedPhrase,
  normalizeSeedPhrase,
  type SeedValidationResult,
} from './validation/seed.js';
export {
  validatePasswordStrength,
  generateSecurePassword,
  quickPasswordValidation,
  type PasswordValidationResult,
} from './validation/password.js';
export {
  ARGON2_PROFILES,
  deriveKeyArgon2id,
  generateArgon2Salt,
  verifyArgon2,
  type Argon2Profile,
  type DeriveKeyResult,
} from './kdf/argon2.js';
export { establishChannel } from './channels/establish.js';
export { rotateChannel } from './channels/rotate.js';
export {
  encryptChannelMessage,
  decryptChannelMessage,
} from './channels/message-keys.js';
export type { Channel, ChannelMessage } from './channels/types.js';
export { wrapKeyForRecipient, unwrapKeyForMe } from './envelopes/key-wrapping.js';
export type { WrappedKey, WrapKeyParams, UnwrapKeyParams } from './envelopes/key-wrapping.js';
export type { PreKeyBundle, IdentityKeys, SignedPreKey, OneTimePreKey } from './x3dh/types.js';
export { generateFileKey, deriveChunkNonce, encryptMediaChunk, decryptMediaChunk } from './envelopes/media-chunks.js';
