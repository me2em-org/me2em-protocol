// packages/pact/src/assemble/act.ts — ACT (PACTS §7.5).

import { buildEvent } from './common.js';
import type { Clock, Event } from '../types.js';

export interface ActInput {
  /** Document hash — b64url(32) commitment (D34). */
  dh?: string;
  /** Inline document (optional, ≤ 2048 B, requires `dh`). */
  doc?: string;
  /** Note (optional, ≤ 32 chars). */
  no?: string;
}

/** Assembles ACT against the verified prefix `events`. */
export function assembleAct(events: Event[], input: ActInput, signerKeys: Uint8Array[], clock?: Clock): Event {
  return buildEvent(events, 'ACT', {
    ...(input.dh !== undefined ? { dh: input.dh } : {}),
    ...(input.doc !== undefined ? { doc: input.doc } : {}),
    ...(input.no !== undefined ? { no: input.no } : {}),
  }, signerKeys, clock);
}
