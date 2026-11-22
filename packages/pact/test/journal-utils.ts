// test/journal-utils.ts — deterministic journal construction for the
// verify/assemble test suites (migrates to src/testing/fixtures.ts at
// M1.7). Members derive real pact keys (derivePactKey), sign real
// Ed25519 over TBS, and voucher chains are real core attestations.

import { Attestation, crypto } from '@me2em/core';
import { canonicalize, type JsonValue } from '@me2em/core';
import { b64urlEncode, evHash, tbsBytes, ZERO32 } from '../src/codec.js';
import { derivePactKey } from '../src/derive.js';
import type {
  Constitution,
  Event,
  EventType,
  Founder,
  Signature,
  Voucher,
  VoucherChain,
} from '../src/types.js';

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
  readonly key: Uint8Array;
  readonly pub: string;
  /** Weight carried in founder entries when the constitution enables weights. */
  w = 1;

  constructor(seed: number, gen = 0) {
    this.seed = seed;
    this.gen = gen;
    this.key = derivePactKey(bytes(32, seed), PID, CH, gen);
    this.pub = b64urlEncode(crypto.getPublicKey(this.key));
  }

  /** The anchor node pub (pp): the pact key derives from this key. */
  anchorPub(): string {
    return b64urlEncode(crypto.getPublicKey(bytes(32, this.seed)));
  }

  signEvent(raw: Omit<Event, 'sig'>, gen = this.gen): Signature {
    return { p: this.pub, s: b64urlEncode(crypto.sign(tbsBytes(raw as Event), derivePactKey(bytes(32, this.seed), PID, CH, gen))) };
  }

  /**
   * Real core attestation chain issued over the anchor key: `[A]`
   * (identity — self-attestation) or `[A, B]` (handle attested by the
   * root). `pp` — the anchor node pub; `vc.rp` — the root pub.
   */
  async voucherChain(an: 'identity' | 'handle', jtis: string[]): Promise<{ chain: VoucherChain; vc: Voucher; pp: string }> {
    const anchorKey = bytes(32, this.seed);
    const anchorPubBytes = crypto.getPublicKey(anchorKey); // the anchor node's PUBLIC key
    const anchorPub = b64urlEncode(anchorPubBytes);
    const signer = { sign: async (data: Uint8Array) => crypto.sign(data, anchorKey) };
    const chain: string[] = [];
    if (an === 'identity') {
      const root = await Attestation.issue(signer, anchorPubBytes, 'pact-root', GRANT, { jti: jtis[0], now: T0 });
      chain.push(root.token);
    } else {
      const root = await Attestation.issue(signer, anchorPubBytes, 'pact-root', GRANT, { jti: jtis[0], now: T0 });
      const handle = await Attestation.issue(signer, anchorPubBytes, 'pact-handle', GRANT, { jti: jtis[1], now: T0 });
      chain.push(root.token, handle.token);
    }
    const vc: Voucher = {
      rh: b64urlEncode(crypto.sha256(canonicalize(chain as unknown as JsonValue))),
      rp: anchorPub,
    };
    return { chain: { chain }, vc, pp: anchorPub };
  }
}

/** Sorted founder entries for a member set (PACTS §7.3: sorted by p). */
export function foundersOf(members: Member[], cn: Constitution, vcs?: Map<Member, Voucher>): Founder[] {
  const list = members.map((m) => ({
    p: m.pub,
    pp: m.anchorPub(),
    an: 'identity' as const,
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

/** The 2-party constitution used across lifecycle tests. */
export const CN2: Constitution = { th: { DISSOLVE: { m: 'any' } }, im: 'pinned', w: false };
