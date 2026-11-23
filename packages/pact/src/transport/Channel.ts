// packages/pact/src/transport/Channel.ts — the transport contract (C4).
//
// OFFER/ACCEPT are wire types, NOT journal events — they never enter
// the journal (D8). The transport MUST be authenticated (X3DH in the
// reference adapter); the MITM window on `ch` finalization is a
// documented limitation (PACTS §8) — PactRoot blind comparison is an
// amplifier (BL-12), out of v0.1 (P9).

import type { Event } from '../types.js';

/** Invite offer: pid + context commitment (+ optional inline context). */
export interface Offer {
  typ: 'me2em/pact-offer/v1';
  /** Pact identifier — b64url(16). */
  pid: string;
  /** Context hash — b64url(32), the pact-key context (D4). */
  ch: string;
  /** Inline context (optional, ≤ 2048 B) — check-verifies against `ch`. */
  cx?: string;
  /** X25519 ephemeral public key of the initiator (b64url(32), X3DH). */
  ep?: string;
}

/** Offer acceptance: the authority's pact member public key. */
export interface Accept {
  typ: 'me2em/pact-accept/v1';
  pid: string;
  /** b64url(32) — the inviting member's pactPub. */
  pactPub: string;
}

/**
 * Injected transport (B2): the pact package depends on nothing but
 * core — real deployments wire their own Channel (server relay,
 * sneakernet, messenger). `genesis` returns the co-signed event.
 */
export interface Channel {
  offer(o: Offer): Promise<Accept>;
  /** Takes the authority-signed GENESIS, returns it co-signed. */
  genesis(g: Event): Promise<Event>;
}
