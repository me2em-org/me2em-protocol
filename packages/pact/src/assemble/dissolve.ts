// packages/pact/src/assemble/dissolve.ts — DISSOLVE — default threshold any (A2) (PACTS §7.5).

import { buildEvent } from './common.js';
import { PactError } from '../errors.js';
import type { Clock, Event } from '../types.js';

export interface DissolveInput {
  /** Reason (optional, ≤ 256 chars). */
  rs?: string;
}

/** Assembles DISSOLVE — default threshold any (A2) against the verified prefix `events`. */
export function assembleDissolve(events: Event[], input: DissolveInput, signerKeys: Uint8Array[], clock?: Clock): Event {
  // §7.5: ACTIVE members sign — at least one key is required.
  if (signerKeys.length < 1) {
    throw new PactError('MALFORMED', 'assemble', 'DISSOLVE: at least one signer is required');
  }
  return buildEvent(events, 'DISSOLVE', {
    ...(input.rs !== undefined ? { rs: input.rs } : {}),
  }, signerKeys, clock);
}
