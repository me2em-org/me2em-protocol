// packages/pact/src/transport/ReferenceX3DH.ts — optional reference adapter.
//
// A complete, real-crypto loopback implementation of the authenticated
// channel: the initiator runs X3DH against the authority's prekey
// bundle (@me2em/crypto 1.1.0-rc.2), the authority completes the
// handshake, and both derive the same channel secret. The GENESIS
// exchange: the authority signs first; the initiator verifies the
// signature and co-signs. `@me2em/crypto` is an OPTIONAL peer — the
// adapter loads it lazily and fails with a clear PactError when it is
// not installed (B2: pact itself depends only on core).

import { crypto } from '@me2em/core';
import { b64urlEncode, tbsBytes, ZERO32 } from '../codec.js';
import { PactError } from '../errors.js';
import { EVENT_TYPE } from '../assemble/common.js';
import type { Clock, Event, Signature } from '../types.js';
import type { Accept, Channel, Offer } from './Channel.js';

/** Deferred dynamic import — the optional peer is not a hard dependency. */
type CryptoModule = typeof import('@me2em/crypto');
let cachedCrypto: CryptoModule | undefined;

async function loadCrypto(): Promise<CryptoModule> {
  if (!cachedCrypto) {
    try {
      cachedCrypto = (await import('@me2em/crypto')) as CryptoModule;
    } catch {
      throw new PactError(
        'MALFORMED',
        'transport',
        'ReferenceX3DH requires @me2em/crypto >=1.1.0-rc.2 (optional peer) — install it or inject a custom Channel'
      );
    }
  }
  return cachedCrypto;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface ReferenceX3DHOptions {
  /** The authority (inviting founder) identity — Ed25519 keypair. */
  responder: { privateKey: Uint8Array; publicKey: Uint8Array };
  /** The initiator (invitee) identity — Ed25519 keypair. */
  initiator: { privateKey: Uint8Array; publicKey: Uint8Array };
  /** The authority's pact key (its member key in this pact). */
  responderPactKey: Uint8Array;
  /** The initiator's pact key (co-signs GENESIS). */
  initiatorPactKey: Uint8Array;
  /** Number of one-time prekeys to generate (default 10). */
  otkCount?: number;
}

/**
 * Reference Channel: X3DH-authenticated offer/accept + GENESIS
 * co-signing, both endpoints local (a test/integration double with
 * real cryptography — not a network transport).
 */
export class ReferenceX3DH implements Channel {
  private readonly opts: ReferenceX3DHOptions;
  private sessionSecret: Uint8Array | undefined;
  private accepted: Accept | undefined;

  constructor(opts: ReferenceX3DHOptions) {
    this.opts = opts;
  }

  async offer(o: Offer): Promise<Accept> {
    const x3dh = await loadCrypto();
    // D34 check-verification of inline context against the commitment:
    if (o.cx !== undefined && b64urlEncode(crypto.sha256(new TextEncoder().encode(o.cx))) !== o.ch) {
      throw new PactError('MALFORMED', 'transport', 'offer cx does not hash to ch (D34)');
    }

    const batch = x3dh.generatePreKeyBatch(this.opts.responder, this.opts.otkCount ?? 10);
    // The reference adapter publishes OTK #0; the initiator consumes it.
    const otkIndex = 0;
    const bundle = x3dh.publishableBundle(batch, this.opts.responder.publicKey, otkIndex);
    const initiated = await x3dh.initiateX3DH(this.opts.initiator, bundle);
    const otk = batch.oneTimePreKeys[otkIndex];
    if (!initiated.usedOneTimePreKeyId) {
      throw new PactError('MALFORMED', 'transport', 'X3DH initiation did not consume a one-time prekey');
    }
    const responderSecret = await x3dh.completeX3DH(
      this.opts.responder,
      batch.signedPreKey,
      otk,
      this.opts.initiator.publicKey,
      initiated.ephemeralPublicKey
    );
    if (!bytesEqual(initiated.sharedSecret, responderSecret)) {
      throw new PactError('MALFORMED', 'transport', 'X3DH secrets diverge — transport compromised');
    }
    this.sessionSecret = initiated.sharedSecret;

    this.accepted = {
      typ: 'me2em/pact-accept/v1',
      pid: o.pid,
      pactPub: b64urlEncode(crypto.getPublicKey(this.opts.responderPactKey)),
    };
    return this.accepted;
  }

  async genesis(g: Event): Promise<Event> {
    if (!this.sessionSecret || !this.accepted) {
      throw new PactError('MALFORMED', 'transport', 'offer() must complete before genesis()');
    }
    if (g.ty !== 'GENESIS' || g.typ !== EVENT_TYPE) {
      throw new PactError('MALFORMED', 'transport', 'genesis(): not a GENESIS event envelope');
    }
    if (g.pid !== this.accepted.pid) {
      throw new PactError('MALFORMED', 'transport', 'genesis(): pid does not match the offer');
    }
    if (g.ph !== ZERO32) {
      throw new PactError('MALFORMED', 'transport', 'genesis(): ph must be ZERO32');
    }
    // The authority's signature must verify against its pact key.
    const tbs = tbsBytes(g);
    const responderSig = g.sig[0];
    if (!responderSig) {
      throw new PactError('MALFORMED', 'transport', 'genesis(): the authority must sign first');
    }
    const responderPub = crypto.getPublicKey(this.opts.responderPactKey);
    if (responderSig.p !== b64urlEncode(responderPub)) {
      throw new PactError('SIGNATURE_INVALID', 'transport', 'genesis(): first signature is not the authority pact key');
    }
    if (!crypto.verify(b64urlDecode64(responderSig.s), tbs, responderPub)) {
      throw new PactError('SIGNATURE_INVALID', 'transport', 'genesis(): authority signature invalid');
    }
    // The initiator co-signs the same TBS.
    const initiatorSig: Signature = {
      p: b64urlEncode(crypto.getPublicKey(this.opts.initiatorPactKey)),
      s: b64urlEncode(crypto.sign(tbs, this.opts.initiatorPactKey)),
    };
    return { ...g, sig: [...g.sig, initiatorSig] };
  }
}

function b64urlDecode64(value: string): Uint8Array {
  // Minimal local decode of a 64-byte signature — the strict codec
  // lives in codec.ts, but this module only needs the raw bytes here.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const out = new Uint8Array(64);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < value.length; i++) {
    const idx = alphabet.indexOf(value[i]);
    if (idx === -1) throw new PactError('MALFORMED', 'transport', 'signature is not base64url');
    acc = ((acc << 6) | idx) & 0xffffff;
    bits += 6;
    if (bits >= 8 && o < out.length) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  if (o !== out.length) {
    throw new PactError('MALFORMED', 'transport', 'signature must decode to 64 bytes');
  }
  return out;
}

/** Clock passthrough for callers assembling over the channel (Р4). */
export function channelClock(now = Math.floor(Date.now() / 1000)): Clock {
  return { now: () => now };
}
