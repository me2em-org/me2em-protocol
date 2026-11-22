// packages/pact/src/assemble/genesis.ts — co-signed GENESIS (PACTS §7.5).

import { crypto } from '@me2em/core';
import { b64urlEncode } from '../codec.js';
import { PactError } from '../errors.js';
import { EVENT_TYPE, finalize, signaturesFor, systemClock, ZERO32 } from './common.js';
import type { Clock, Constitution, Event, Founder } from '../types.js';

export interface GenesisInput {
  /** Pact identifier — b64url(16). */
  pid: string;
  /** Context hash — b64url(32); `cx` check-verifies against it (D34). */
  ch: string;
  /** Inline context (optional, ≤ 2048 B). */
  cx?: string;
  /** The constitution (B-5 validated at assembly). */
  cn: Constitution;
  /** Founders, sorted by `p` (PACTS §7.3). */
  ft: Founder[];
  /**
   * Pact keys of the founders — every founder signs (co-signature);
   * derived pubs must cover `ft.p` exactly (no one extra, none missing).
   */
  founderKeys: Uint8Array[];
  /** Optional clock injection (Р4); defaults to the system clock. */
  clock?: Clock;
}

/** Assembles the first event of a pact: sq 0, ph ZERO32, all founders sign. */
export function assembleGenesis(input: GenesisInput): Event {
  const clock = input.clock ?? systemClock();
  const pubs = input.founderKeys.map((k) => b64urlEncode(crypto.getPublicKey(k)));
  const ftPubs = new Set(input.ft.map((f) => f.p));
  if (pubs.length !== ftPubs.size || !pubs.every((p) => ftPubs.has(p))) {
    throw new PactError('MALFORMED', 'assemble', 'founderKeys must cover ft.p exactly (co-signature)');
  }
  const raw: Omit<Event, 'sig'> = {
    typ: EVENT_TYPE,
    pid: input.pid,
    sq: 0,
    ph: ZERO32,
    ty: 'GENESIS',
    pl: { ch: input.ch, ...(input.cx !== undefined ? { cx: input.cx } : {}), cn: input.cn, ft: input.ft },
    iat: clock.now(),
  };
  const event: Event = { ...raw, sig: signaturesFor(raw, input.founderKeys) };
  return finalize([], event, clock);
}
