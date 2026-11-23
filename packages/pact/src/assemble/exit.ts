// packages/pact/src/assemble/exit.ts — EXIT — self-event, the exiting member signs (D18a) (PACTS §7.5).

import { buildEvent } from './common.js';
import type { Clock, Event } from '../types.js';

export interface ExitInput {
  /** Reason (optional, ≤ 256 chars). */
  rs?: string;
}

/** Assembles EXIT — self-event, the exiting member signs (D18a) against the verified prefix `events`. */
export function assembleExit(events: Event[], input: ExitInput, signerKeys: Uint8Array[], clock?: Clock): Event {
  return buildEvent(events, 'EXIT', {
    ...(input.rs !== undefined ? { rs: input.rs } : {}),
  }, signerKeys, clock);
}
