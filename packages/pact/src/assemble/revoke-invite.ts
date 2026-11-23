// packages/pact/src/assemble/revoke-invite.ts — REVOKE_INVITE (D14) (PACTS §7.5).

import { buildEvent } from './common.js';
import type { Clock, Event } from '../types.js';

export interface RevokeInviteInput {
  /** evHash of the INVITE being cancelled. */
  ref: string;
  /** Reason (optional, ≤ 256 chars). */
  rs?: string;
}

/** Assembles REVOKE_INVITE (D14) against the verified prefix `events`. */
export function assembleRevokeInvite(events: Event[], input: RevokeInviteInput, signerKeys: Uint8Array[], clock?: Clock): Event {
  return buildEvent(events, 'REVOKE_INVITE', {
    ref: input.ref,
    ...(input.rs !== undefined ? { rs: input.rs } : {}),
  }, signerKeys, clock);
}
