// packages/crypto/src/channels/types.ts

/**
 * A long-lived E2EE channel derived from an X3DH shared secret.
 *
 * Key representations coexist: the raw root material (32B) lives
 * in module-private internals (WeakMap) for message-key
 * derivation and rotation; a non-extractable CryptoKey is
 * derived from it for AEAD operations. The raw material is
 * wiped only at rotation.
 *
 * Sequence counters are managed by the APPLICATION (immutable
 * design — React-friendly).
 *
 * The channel's internal state (rootKeyMaterial, lastDecryptedSeq)
 * is stored in a module-private WeakMap keyed by the Channel object
 * reference. The application never sees or touches internals.
 *
 * @example
 * ```ts
 * const x3dh = await initiateX3DH(myIdentity, theirBundle);
 * const channel = await establishChannel(
 *   x3dh.sharedSecret, 'chat-42');
 * const msg = await encryptChannelMessage(channel, 0, plaintext);
 * ```
 */
export interface Channel {
  /** hex(SHA-256(sharedSecret ‖ salt)) — identical on both sides. */
  channelId: string;
  epoch: number;                    // 0 after establish; grows on rotate
  /** Direction role: affects nothing cryptographically (X3DH is
   * symmetric), but useful for application-side audit. Set on
   * establish, preserved through rotation. */
  role: 'initiator' | 'recipient';
}

/** Internal mutable state that the application never sees. */
export interface ChannelInternals {
  rootKeyMaterial: Uint8Array;      // ⚠️ secret: wipe on rotate
  lastDecryptedSeq: number;         // for replay protection per direction
}

export interface ChannelMessage {
  epoch: number;
  sequence: number;
  ciphertext: Uint8Array;           // includes GCM tag
  iv: Uint8Array;                   // 12B
}
