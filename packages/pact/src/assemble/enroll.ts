// packages/pact/src/assemble/enroll.ts — ENROLL — self-event, the joiner signs (PACTS §7.5).

import { buildEvent } from './common.js';
import type { Clock, Event, Voucher } from '../types.js';

export interface EnrollInput {
  /** evHash of the INVITE being accepted (D14). */
  ref: string;
  /** Display name (optional, ≤ 64 chars). */
  dn?: string;
  /** Weight — must repeat the INVITE weight verbatim (B-6). */
  w?: number;
  /** Voucher hash-commit of the joiner (optional, D34). */
  vc?: Voucher;
}

/** Assembles ENROLL — self-event, the joiner signs against the verified prefix `events`. */
export function assembleEnroll(events: Event[], input: EnrollInput, signerKeys: Uint8Array[], clock?: Clock): Event {
  return buildEvent(events, 'ENROLL', {
    ref: input.ref,
    ...(input.dn !== undefined ? { dn: input.dn } : {}),
    ...(input.w !== undefined ? { w: input.w } : {}),
    ...(input.vc !== undefined ? { vc: input.vc } : {}),
  }, signerKeys, clock);
}
