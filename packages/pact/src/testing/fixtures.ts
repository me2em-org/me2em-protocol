// packages/pact/src/testing/fixtures.ts
//
// Public test fixtures (ТЗ §2 testing/): deterministic members with real
// pact keys, a chained journal builder, real voucher chains (core
// attestations) — suitable for We2eM/AS integrations and downstream
// package test suites. Exported via the `@me2em/pact/testing` subpath
// since rc.5 (BL-58 follow-up decision, 2026-11-24). Not part of the
// protocol surface — deterministic reference material that may evolve
// within the rc line without a major bump.

import { Attestation, crypto } from '@me2em/core';
import { canonicalize, type JsonValue } from '@me2em/core';
import { b64urlEncode, evHash, tbsBytes, ZERO32 } from '../codec.js';
import { derivePactKey } from '../derive.js';
import type {
  Constitution,
  Event,
  EventType,
  Founder,
  Signature,
  Voucher,
  VoucherChain,
} from '../types.js';

export const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);
export const utf8 = (s: string) => new TextEncoder().encode(s);

/** Fixed reference time for all test journals (clock injection, C3). */
export const T0 = 1700000000;
export const clockAt = (t: number) => ({ now: () => t });

export const PID = b64urlEncode(bytes(16, 0x21));
export const CONTEXT = 'joint charging agreement';
export const CH = b64urlEncode(crypto.sha256(utf8(CONTEXT)));

const GRANT = { scopes: ['pact'], maxSessionTtl: 300 };

/** A journal participant: real pact key of a fixed anchor seed byte. */
export class Member {
  readonly seed: number;
  readonly gen: number;
  /** Anchor mode: identity (default) or handle (via {@link Member.handle}). */
  readonly anchor: 'identity' | 'handle';
  /** Raw anchor node key — the IKM of the pact key derivation (D2/D3). */
  readonly anchorKey: Uint8Array;
  /** Pub of the root Identity — `vc.rp` for voucher chains (§5.4). */
  readonly rootPub: string;
  readonly key: Uint8Array;
  readonly pub: string;
  /** Weight carried in founder entries when the constitution enables weights. */
  w = 1;

  constructor(seed: number, gen = 0, anchor: 'identity' | 'handle' = 'identity', handleName = 'pact-handle') {
    this.seed = seed;
    this.gen = gen;
    this.anchor = anchor;
    const rootKey = bytes(32, seed);
    this.rootPub = b64urlEncode(crypto.getPublicKey(rootKey));
    this.anchorKey = anchor === 'identity' ? rootKey : crypto.deriveHandleKey(rootKey, handleName);
    this.key = derivePactKey(this.anchorKey, PID, CH, gen);
    this.pub = b64urlEncode(crypto.getPublicKey(this.key));
  }

  /** A handle-anchored member: pact key from the real handle key (D2). */
  static handle(seed: number, name = 'pact-handle', gen = 0): Member {
    return new Member(seed, gen, 'handle', name);
  }

  /** The anchor node pub (pp): root pub for identity, handle pub for handle. */
  anchorPub(): string {
    return b64urlEncode(crypto.getPublicKey(this.anchorKey));
  }

  /** Signs the TBS with the pact key of `gen` — `p` always matches `gen`. */
  signEvent(raw: Omit<Event, 'sig'>, gen = this.gen): Signature {
    const key = gen === this.gen ? this.key : derivePactKey(this.anchorKey, PID, CH, gen);
    return { p: b64urlEncode(crypto.getPublicKey(key)), s: b64urlEncode(crypto.sign(tbsBytes(raw as Event), key)) };
  }

  /**
   * Real core attestation chain: `[A]` (identity — self-attestation by
   * the root) or `[A, B]` (handle — the root attests the handle pub,
   * then the handle self-attests: issuers differ, §5.4/D2). `pp` — the
   * anchor node pub; `vc.rp` — the root Identity pub. `timing` —
   * optional lifetime override (now/ttlSeconds) for alive-at-`act.iat`
   * tests.
   */
  async voucherChain(
    an: 'identity' | 'handle',
    jtis: string[],
    timing?: { now?: number; ttlSeconds?: number }
  ): Promise<{ chain: VoucherChain; vc: Voucher; pp: string }> {
    const anchorPubBytes = crypto.getPublicKey(this.anchorKey);
    const anchorPub = b64urlEncode(anchorPubBytes);
    const at = { now: T0, ...timing };
    const rootSigner = { sign: async (data: Uint8Array) => crypto.sign(data, bytes(32, this.seed)) };
    const chain: string[] = [];
    if (an === 'identity') {
      const root = await Attestation.issue(rootSigner, anchorPubBytes, 'pact-root', GRANT, { jti: jtis[0], ...at });
      chain.push(root.token);
    } else {
      const handleSigner = { sign: async (data: Uint8Array) => crypto.sign(data, this.anchorKey) };
      const root = await Attestation.issue(rootSigner, anchorPubBytes, 'pact-root', GRANT, { jti: jtis[0], ...at });
      const handle = await Attestation.issue(handleSigner, anchorPubBytes, 'pact-handle', GRANT, { jti: jtis[1], ...at });
      chain.push(root.token, handle.token);
    }
    const vc: Voucher = {
      rh: b64urlEncode(crypto.sha256(canonicalize(chain as unknown as JsonValue))),
      rp: this.rootPub,
    };
    return { chain: { chain }, vc, pp: anchorPub };
  }
}

/** Sorted founder entries for a member set (PACTS §7.3: sorted by p). */
export function foundersOf(members: Member[], cn: Constitution, vcs?: Map<Member, Voucher>): Founder[] {
  const list = members.map((m) => ({
    p: m.pub,
    pp: m.anchorPub(),
    an: m.anchor,
    ...(cn.w ? { w: m.w } : {}),
    ...(vcs?.has(m) ? { vc: vcs.get(m) } : {}),
  }));
  list.sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  return list;
}

/** Append-only journal builder with automatic sq/ph chaining. */
export class Journal {
  readonly events: Event[] = [];
  head = ZERO32;

  push(ty: EventType, pl: Record<string, unknown>, signers: Member[], iat = T0): Event {
    const raw: Omit<Event, 'sig'> = {
      typ: 'me2em/pact-event/v1',
      pid: PID,
      sq: this.events.length,
      ph: this.head,
      ty,
      pl,
      iat,
    };
    const event: Event = { ...raw, sig: signers.map((m) => m.signEvent(raw)) };
    this.events.push(event);
    this.head = evHash(event);
    return event;
  }

  /** Out-of-band evHash of an already pushed event. */
  hash(event: Event): string {
    return evHash(event);
  }
}

/** The 2-party constitution used across lifecycle tests (bearer: invites are open; pinned flows use their own constitution). */
export const CN2: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'bearer', w: false };
