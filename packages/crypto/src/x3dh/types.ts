// packages/crypto/src/x3dh/types.ts

/**
 * Identity key pair (Ed25519 in Me2em). Long-lived, deterministic
 * from the seed. In X3DH context: IK_A (initiator) / IK_B (recipient).
 *
 * @example
 * ```ts
 * const identity = await loadIdentityKeys();
 * const spk = generateSignedPreKey(identity);
 * ```
 */
export interface IdentityKeys {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * Signed Pre-Key: generated per login epoch, signed by the
 * identity key. Enables X3DH without OTK consumption.
 *
 * The keyPair contains an X25519 keypair (NOT Ed25519), and the
 * signature is an Ed25519 signature over the X25519 public key,
 * produced by the identity private key.
 *
 * @example
 * ```ts
 * const spk = generateSignedPreKey(identity);
 * const bundle = publishableBatch(batch, identityPub);
 * ```
 */
export interface SignedPreKey {
  keyPair: { privateKey: Uint8Array; publicKey: Uint8Array };
  signature: Uint8Array;
}

/**
 * One-Time Pre-Key: consumed exactly once per new chat.
 * Directly X25519 (NOT Ed25519 converted).
 *
 * @example
 * ```ts
 * const otks = generateOneTimePreKeys(100);
 * ```
 */
export interface OneTimePreKey {
  keyPair: { privateKey: Uint8Array; publicKey: Uint8Array };
}

/**
 * The PUBLIC bundle published to the server for X25519-initiation.
 * Exactly what an initiator needs to run their side of X3DH.
 *
 * - identityPublicKey: 32B Ed25519 public key of the recipient.
 * - signedPreKeyPublicKey: 32B X25519 public key of the SPK.
 * - signedPreKeySignature: 64B Ed25519 signature over SPK public key.
 * - oneTimePreKeyPublicKey: optional 32B X25519 public key of an OTK.
 *
 * @example
 * ```ts
 * const result = await initiateX3DH(aliceIdentity, bobBundle);
 * ```
 */
export interface PreKeyBundle {
  identityPublicKey: Uint8Array;
  signedPreKeyPublicKey: Uint8Array;
  signedPreKeySignature: Uint8Array;
  oneTimePreKeyPublicKey?: Uint8Array;
}

/** Result of the initiator-side X3DH. */
export interface X3DHInitiationResult {
  /** 32-byte shared secret — root of the chat channel. */
  sharedSecret: Uint8Array;
  /** The initiator's ephemeral public key (32B X25519) — MUST be
   * transmitted to the recipient in the first message. */
  ephemeralPublicKey: Uint8Array;
  /** Which OTK was consumed (base64 of its public key), if any. */
  usedOneTimePreKeyId?: string;
}
