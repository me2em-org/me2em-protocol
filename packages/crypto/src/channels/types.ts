// packages/crypto/src/channels/types.ts

/**
 * Runtime brand attached to every Channel returned by
 * establishChannel/rotateChannel (D1). Non-enumerable and
 * non-writable: spread-clones and plain impostor objects fail the
 * brand check with INVALID_ARGUMENT instead of tripping the
 * internals WeakMap with a misleading INVALID_KEY.
 *
 * Module-internal: NOT exported from the package index.
 */
export const CHANNEL_BRAND: unique symbol = Symbol('Channel');

/**
 * A long-lived E2EE channel derived from an X3DH shared secret.
 *
 * Key representations coexist: the raw root material (32B) lives
 * in module-private internals (WeakMap) for message-key
 * derivation and rotation; a non-extractable CryptoKey is
 * derived from it for AEAD operations. The raw material is
 * wiped only at rotation or destroyChannel.
 *
 * Sequence counters are managed by the APPLICATION (immutable
 * design — React-friendly).
 *
 * The channel's internal state (rootKeyMaterial, replay window)
 * is stored in a module-private WeakMap keyed by the Channel object
 * reference. The application never sees or touches internals.
 *
 * Channel objects are FROZEN (D2): all fields are readonly and the
 * object is sealed with Object.freeze at creation — mutation
 * attempts throw in strict mode. Functions accepting a Channel
 * validate the runtime brand (D1) and reject impostor objects
 * with INVALID_ARGUMENT.
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
  readonly channelId: string;
  /** 0 after establish; grows on rotate. */
  readonly epoch: number;
  /** Direction role: affects nothing cryptographically (X3DH is
   * symmetric), but useful for application-side audit. Set on
   * establish, preserved through rotation. */
  readonly role: 'initiator' | 'recipient';
}

/** Internal mutable state that the application never sees. */
export interface ChannelInternals {
  rootKeyMaterial: Uint8Array;      // ⚠️ secret: wipe on rotate/destroy
  /** Sliding replay window (F7): the last REPLAY_WINDOW_SIZE
   *  successfully decrypted sequence numbers, insertion-ordered.
   *  Reset on rotate (fresh epoch → fresh sequence space). */
  seenSeqs: Set<number>;
}

export interface ChannelMessage {
  epoch: number;
  sequence: number;
  ciphertext: Uint8Array;           // includes GCM tag
  iv: Uint8Array;                   // 12B
}
