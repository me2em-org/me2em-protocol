// packages/pact/src/assemble/reverse-act.ts — REVERSE_ACT (D19) (PACTS §7.5).

import { buildEvent } from './common.js';
import type { Clock, Event } from '../types.js';

export interface ReverseActInput {
  /** evHash of the ACT being reversed. */
  ref: string;
  /** Reversal kind (D19). */
  k: 'supersede' | 'reversal';
  /** Reason (optional, ≤ 256 chars). */
  rs?: string;
}

/** Assembles REVERSE_ACT (D19) against the verified prefix `events`. */
export function assembleReverseAct(events: Event[], input: ReverseActInput, signerKeys: Uint8Array[], clock?: Clock): Event {
  return buildEvent(events, 'REVERSE_ACT', {
    ref: input.ref,
    k: input.k,
    ...(input.rs !== undefined ? { rs: input.rs } : {}),
  }, signerKeys, clock);
}
