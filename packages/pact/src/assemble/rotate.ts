// packages/pact/src/assemble/rotate.ts — ROTATE_KEY — parent + new key sign (D39) (PACTS §7.5).

import { buildEvent } from './common.js';
import { PactError } from '../errors.js';
import type { Clock, Event } from '../types.js';

export interface RotateInput {
  /** New pactPub of the member (≠ current). */
  np: string;
  /** CompromisedAt window (optional, D20): acts by the old key after `ca` reject. */
  ca?: number;
}

/** Assembles ROTATE_KEY — parent + new key sign (D39) against the verified prefix `events`. */
export function assembleRotate(events: Event[], input: RotateInput, signerKeys: Uint8Array[], clock?: Clock): Event {
  // D39: exactly parent + new key — rejected before building (distinct
  // keys are enforced by signaturesFor, §7.6).
  if (signerKeys.length !== 2) {
    throw new PactError('MALFORMED', 'assemble', 'ROTATE_KEY: exactly two signer keys — parent + new (D39)');
  }
  return buildEvent(events, 'ROTATE_KEY', {
    np: input.np,
    ...(input.ca !== undefined ? { ca: input.ca } : {}),
  }, signerKeys, clock);
}
