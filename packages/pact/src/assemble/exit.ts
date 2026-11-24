// packages/pact/src/assemble/exit.ts — EXIT — self-event, the exiting member signs (D18a) (PACTS §7.5).

import { buildEvent } from './common.js';
import { PactError } from '../errors.js';
import type { Clock, Event } from '../types.js';

export interface ExitInput {
  /** Reason (optional, ≤ 256 chars). */
  rs?: string;
}

/** Assembles EXIT — self-event, the exiting member signs against the verified prefix `events`. */
export function assembleExit(events: Event[], input: ExitInput, signerKeys: Uint8Array[], clock?: Clock): Event {
  // D18a: exactly the exiting member's current key signs.
  if (signerKeys.length !== 1) {
    throw new PactError('MALFORMED', 'assemble', 'EXIT: exactly the exiting member signs (D18a)');
  }
  return buildEvent(events, 'EXIT', {
    ...(input.rs !== undefined ? { rs: input.rs } : {}),
  }, signerKeys, clock);
}
