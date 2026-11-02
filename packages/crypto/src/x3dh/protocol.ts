// packages/crypto/src/x3dh/protocol.ts

import { hkdf } from '../core/hkdf.js';
import {
  generateX25519KeyPair,
  x25519SharedSecret,
  ed25519PrivToX25519,
  ed25519PubToX25519,
} from '../core/ecdh.js';
import { signRaw, verifyRaw } from '../core/signatures.js';
import { concat, toBase64 } from '../utils/binary.js';
import { throwCryptoError } from '../errors.js';
import { secureWipe } from '../core/wipe.js';
import type {
  PreKeyBundle,
  X3DHInitiationResult,
  SignedPreKey,
  IdentityKeys,
  OneTimePreKey,
} from './types.js';

const X3DH_INFO = new TextEncoder().encode('me2em/crypto/v1/x3dh');

/**
 * Generates a Signed Pre-Key: X25519 keypair + identity-key
 * signature over its public key.
 *
 * Why the signature?
 * The initiator downloads SPK from an untrusted server. Without
 * the signature, a malicious server could substitute its own SPK
 * and position itself as a man-in-the-middle. The signature
 * (by the long-lived identity key) lets the initiator verify
 * that the SPK is authentic.
 *
 * @param identity - Identity key pair (Ed25519).
 * @returns SignedPreKey with X25519 keypair and 64B signature.
 *
 * @example
 * ```ts
 * const spk = generateSignedPreKey(identity);
 * // spk.signature is Ed25519(pubKey, identity.priv)
 * ```
 */
export function generateSignedPreKey(identity: IdentityKeys): SignedPreKey {
  const keyPair = generateX25519KeyPair();
  const signature = signRaw(identity.privateKey, keyPair.publicKey);
  return { keyPair, signature };
}

/**
 * Verifies a Signed Pre-Key bundle against the identity public key.
 * MUST be called by the initiator BEFORE running X3DH — this is
 * the impersonation defense.
 *
 * @param bundle - PreKeyBundle whose SPK signature to verify.
 * @param identityPublicKey - Recipient's Ed25519 public key.
 * @throws {CryptoError} 'VERIFICATION_FAILED' if invalid.
 *
 * @example
 * ```ts
 * verifySignedPreKey(bundle, bobIdentityPub);
 * const result = await initiateX3DH(aliceIdentity, bundle);
 * ```
 */
export function verifySignedPreKey(
  bundle: PreKeyBundle,
  identityPublicKey: Uint8Array
): void {
  const ok = verifyRaw(
    identityPublicKey,
    bundle.signedPreKeyPublicKey,
    bundle.signedPreKeySignature
  );
  if (!ok) {
    throwCryptoError(
      'VERIFICATION_FAILED',
      'SIGNATURE',
      'Signed Pre-Key signature is invalid — possible MITM'
    );
  }
}

/**
 * Generates a batch of One-Time Pre-Keys (directly X25519).
 *
 * @param count - Number of OTKs to generate (1..1000).
 * @returns Array of OneTimePreKey objects.
 * @throws {CryptoError} 'INVALID_ARGUMENT' if count out of range.
 *
 * @example
 * ```ts
 * const otks = generateOneTimePreKeys(100);
 * // publish their public keys to the server
 * ```
 */
export function generateOneTimePreKeys(count: number): OneTimePreKey[] {
  if (count < 1 || count > 1000) {
    throwCryptoError(
      'INVALID_ARGUMENT',
      'KEY',
      'count must be 1..1000'
    );
  }
  return Array.from({ length: count }, () => {
    const kp = generateX25519KeyPair();
    return { keyPair: kp };
  });
}

/**
 * INITIATOR side of X3DH.
 *
 * Establishes a shared secret with an OFFLINE recipient using
 * their published PreKeyBundle. The recipient completes the same
 * computation later using their private pre-keys.
 *
 * CANONICAL DH ORDER (Signal spec §3.3) — DO NOT REORDER
 *
 *   DH1 = DH(IK_A,  SPK_B)   // initiator identity × recipient signed prekey
 *   DH2 = DH(EK_A,  IK_B)    // ephemeral × recipient identity
 *   DH3 = DH(EK_A,  SPK_B)   // ephemeral × recipient signed prekey
 *   DH4 = DH(EK_A,  OPK_B)   // ephemeral × recipient one-time prekey
 *
 * All keys are converted Ed25519→X25519 (Montgomery) where needed.
 * DH4 uses the recipient's OPK public key with the initiator's
 * EPHEMERAL private key — zero-fallback is not allowed (enforces
 * forward secrecy).
 *
 * SK = HKDF(DH1 || DH2 || DH3 || DH4, salt=zero, info=X3DH_INFO)
 *
 * @param ourIdentity - Initiator's Ed25519 identity key pair.
 * @param theirBundle - Recipient's PreKeyBundle (MUST be verified
 *   via verifySignedPreKey BEFORE calling this function).
 * @returns X3DHInitiationResult with shared secret and ephemeral pubkey.
 *   The shared secret is the CALLER's responsibility — wipe it after
 *   use (see `wrapKeyForRecipient` for the pattern).
 * @throws {CryptoError} 'VERIFICATION_FAILED' if SPK signature invalid,
 *   'INVALID_ARGUMENT' if bundle lacks OTK.
 *
 * Memory hygiene: every DH intermediate, the IKM, the derived
 * Montgomery copy of the identity key and the ephemeral private key
 * are wiped on ALL exit paths (success or throw) — a failed DH
 * against a hostile bundle must not leak live key bytes.
 *
 * @example
 * ```ts
 * const bundle = await fetchPreKeyBundle(bobId);
 * verifySignedPreKey(bundle, bobIdentityPub);
 * const result = await initiateX3DH(aliceIdentity, bundle);
 * // send result.ephemeralPublicKey to Bob in first message
 * ```
 */
export async function initiateX3DH(
  ourIdentity: IdentityKeys,
  theirBundle: PreKeyBundle
): Promise<X3DHInitiationResult> {
  const spkOk = verifyRaw(
    theirBundle.identityPublicKey,
    theirBundle.signedPreKeyPublicKey,
    theirBundle.signedPreKeySignature
  );
  if (!spkOk) {
    throwCryptoError(
      'VERIFICATION_FAILED',
      'SIGNATURE',
      'SPK signature invalid'
    );
  }
  if (!theirBundle.oneTimePreKeyPublicKey) {
    throwCryptoError(
      'INVALID_ARGUMENT',
      'KEY',
      'recipient bundle must include a One-Time Pre-Key (zero-fallback not allowed)'
    );
  }

  const ek = generateX25519KeyPair();

  const ikA_x = ed25519PrivToX25519(ourIdentity.privateKey);
  const ikB_xPub = ed25519PubToX25519(theirBundle.identityPublicKey);
  const spkB_xPub = theirBundle.signedPreKeyPublicKey;
  const opkB_xPub = theirBundle.oneTimePreKeyPublicKey;

  // Memory hygiene: dh1..dh4, the IKM, the derived Montgomery copy
  // of our identity key and the ephemeral private key are wiped on
  // ALL paths. NOT wiped (caller-owned, reused across sessions):
  // the Ed25519 identity private key and the bundle's public keys.
  let dh1: Uint8Array | undefined;
  let dh2: Uint8Array | undefined;
  let dh3: Uint8Array | undefined;
  let dh4: Uint8Array | undefined;
  let ikm: Uint8Array | undefined;
  try {
    dh1 = x25519SharedSecret(ikA_x, spkB_xPub);
    // ikA_x is a derived single-use Montgomery copy (the Ed25519
    // identity key itself is untouched) — wiped after its only use;
    // the finally below re-wipes it idempotently if dh1 threw.
    secureWipe(ikA_x);
    dh2 = x25519SharedSecret(ek.privateKey, ikB_xPub);
    dh3 = x25519SharedSecret(ek.privateKey, spkB_xPub);
    dh4 = x25519SharedSecret(ek.privateKey, opkB_xPub);

    ikm = concat(dh1, dh2, dh3, dh4);
    const sharedSecret = await hkdf(ikm, new Uint8Array(32), X3DH_INFO, 32);

    const usedOneTimePreKeyId = toBase64(opkB_xPub);

    return { sharedSecret, ephemeralPublicKey: ek.publicKey, usedOneTimePreKeyId };
  } finally {
    secureWipe(ikA_x);
    secureWipe(ek.privateKey);
    for (const buf of [dh1, dh2, dh3, dh4, ikm]) {
      if (buf) secureWipe(buf);
    }
  }
}

/**
 * RECIPIENT side of X3DH: completes the same computation.
 *
 * DH1 = DH(SPK_B_priv, IK_A_pub)  // recipient SPK × initiator identity
 * DH2 = DH(IK_B_priv, EK_A_pub)   // recipient identity × initiator ephemeral
 * DH3 = DH(SPK_B_priv, EK_A_pub)  // recipient SPK × initiator ephemeral
 * DH4 = DH(OTK_B_priv, EK_A_pub)  // recipient OTK × initiator ephemeral
 *
 * → HKDF of the same 4 secrets in the same order → same 32B.
 *
 * ourOneTimePreKey is REQUIRED — the initiator MUST consume an OTK
 * (zero-fallback prohibited on both sides). Passing undefined would
 * produce a different shared secret, breaking the protocol.
 *
 * ⚠️ OTK CONSUMED: this function wipes
 * `ourOneTimePreKey.keyPair.privateKey` IN PLACE after the DH that
 * uses it (session-bound ephemeral-key model). Reusing the wiped
 * buffer derives a corrupted secret SILENTLY — no error is thrown.
 * Pass a copy if retention is needed. The identity and SPK private
 * keys are NOT touched (they are reused across sessions).
 *
 * @param ourIdentity - Recipient identity (private needed).
 * @param ourSignedPreKey - Recipient's SPK (private needed).
 * @param ourOneTimePreKey - The consumed OTK (private needed). Required.
 * @param theirIdentityPublicKey - Initiator identity public (32B Ed25519).
 * @param theirEphemeralPublicKey - From the first message (32B X25519).
 * @returns The same 32-byte shared secret as the initiator computed.
 *   The shared secret is the CALLER's responsibility — wipe it after
 *   use (see `unwrapKeyForMe` for the pattern).
 * @throws {CryptoError} 'INVALID_ARGUMENT' if ourOneTimePreKey is undefined.
 *
 * Memory hygiene: every DH intermediate, the IKM and the derived
 * Montgomery copy of the identity key are wiped on ALL exit paths
 * (success or throw); the OTK private key is wiped only after its
 * DH actually ran — an unconsumed OTK stays usable.
 *
 * @example
 * ```ts
 * const shared = await completeX3DH(
 *   bobIdentity,
 *   bobSPK,
 *   bobOTK,
 *   aliceIdentityPub,
 *   message.ephemeralPublicKey
 * );
 * ```
 */
export async function completeX3DH(
  ourIdentity: IdentityKeys,
  ourSignedPreKey: SignedPreKey,
  ourOneTimePreKey: OneTimePreKey,
  theirIdentityPublicKey: Uint8Array,
  theirEphemeralPublicKey: Uint8Array
): Promise<Uint8Array> {
  if (!ourOneTimePreKey) {
    throwCryptoError(
      'INVALID_ARGUMENT',
      'KEY',
      'ourOneTimePreKey is required — initiator always consumes an OTK'
    );
  }

  const ikB_x = ed25519PrivToX25519(ourIdentity.privateKey);
  const ikA_xPub = ed25519PubToX25519(theirIdentityPublicKey);
  const spkB_xPriv = ourSignedPreKey.keyPair.privateKey;
  const ekA_xPub = theirEphemeralPublicKey;

  // Memory hygiene: dh1..dh4 and the IKM are wiped on ALL paths;
  // the derived Montgomery copy of our identity key (ikB_x) is
  // wiped unconditionally. NOT wiped (caller-owned, reused across
  // sessions): the identity private key and the SPK private key.
  // The OTK private key is wiped in place ONLY after its DH ran —
  // an unconsumed OTK (earlier throw) stays usable.
  let dh1: Uint8Array | undefined;
  let dh2: Uint8Array | undefined;
  let dh3: Uint8Array | undefined;
  let dh4: Uint8Array | undefined;
  let ikm: Uint8Array | undefined;
  try {
    dh1 = x25519SharedSecret(spkB_xPriv, ikA_xPub);
    dh2 = x25519SharedSecret(ikB_x, ekA_xPub);
    dh3 = x25519SharedSecret(spkB_xPriv, ekA_xPub);
    dh4 = x25519SharedSecret(
      ourOneTimePreKey.keyPair.privateKey,
      ekA_xPub
    );
    secureWipe(ourOneTimePreKey.keyPair.privateKey);

    ikm = concat(dh1, dh2, dh3, dh4);
    const sharedSecret = await hkdf(ikm, new Uint8Array(32), X3DH_INFO, 32);

    return sharedSecret;
  } finally {
    secureWipe(ikB_x);
    for (const buf of [dh1, dh2, dh3, dh4, ikm]) {
      if (buf) secureWipe(buf);
    }
  }
}
