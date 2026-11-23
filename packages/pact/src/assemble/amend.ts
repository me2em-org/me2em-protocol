// packages/pact/src/assemble/amend.ts — AMEND — quorum from the constitution BEFORE the event (B-4/D23) (PACTS §7.5).

import { buildEvent } from './common.js';
import type { Clock, Event, Constitution } from '../types.js';

export interface AmendInput {
  /** The FULL new constitution (B-5 validated). */
  cn: Constitution;
  /** Note (optional, ≤ 32 chars). */
  no?: string;
}

/** Assembles AMEND — quorum from the constitution BEFORE the event (B-4/D23) against the verified prefix `events`. */
export function assembleAmend(events: Event[], input: AmendInput, signerKeys: Uint8Array[], clock?: Clock): Event {
  return buildEvent(events, 'AMEND', {
    cn: input.cn,
    ...(input.no !== undefined ? { no: input.no } : {}),
  }, signerKeys, clock);
}
