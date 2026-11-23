// packages/pact/src/assemble/invite.ts — INVITE (PACTS §7.5).

import { buildEvent } from './common.js';
import type { Clock, Event, Anchor } from '../types.js';

export interface InviteInput {
  /** Display name of the invitee (optional, ≤ 64 chars). */
  dn?: string;
  /** Weight assigned to the invitee (required when the constitution enables weights, B-6). */
  w?: number;
  /** Anchor type of the invitee (D12). */
  an: Anchor;
}

/** Assembles INVITE against the verified prefix `events`. */
export function assembleInvite(events: Event[], input: InviteInput, signerKeys: Uint8Array[], clock?: Clock): Event {
  return buildEvent(events, 'INVITE', {
    ...(input.dn !== undefined ? { dn: input.dn } : {}),
    ...(input.w !== undefined ? { w: input.w } : {}),
    an: input.an,
  }, signerKeys, clock);
}
