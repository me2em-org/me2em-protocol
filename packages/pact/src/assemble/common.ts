// packages/pact/src/assemble/common.ts
//
// Shared machinery of the event assemblers (ТЗ §3.4, PACTS §7.5):
// - signatures are computed over TBS = JCS(event without `sig`) with
//   the member pact keys, via core's raw `crypto.sign` (Р5 — the core
//   `Signer` interface is not consumed by the pact machine);
// - every assembled event is re-verified against the passed prefix
//   (B-7: assembly requires a verified prefix — the builder verifies
//   what it is given, fail-closed). Assembly does NOT write to the
//   store; the caller appends via JournalStore (C2).

import { crypto } from '@me2em/core';
import { b64urlEncode, evHash, tbsBytes, validateEvent, ZERO32 } from '../codec.js';
import { PactError } from '../errors.js';
import { verifyJournal } from '../verify.js';
import type { Clock, Event, EventType, Signature } from '../types.js';

export const EVENT_TYPE = 'me2em/pact-event/v1' as const;

export function systemClock(): Clock {
  return { now: () => Math.floor(Date.now() / 1000) };
}

/**
 * Signs the TBS of `raw` with each pact key. Duplicate keys reject
 * (signer distinctness is normative — PACTS §7.6).
 */
export function signaturesFor(raw: Omit<Event, 'sig'>, keys: Uint8Array[]): Signature[] {
  const tbs = tbsBytes(raw as Event);
  const seen = new Set<string>();
  return keys.map((key) => {
    const p = b64urlEncode(crypto.getPublicKey(key));
    if (seen.has(p)) {
      throw new PactError('MALFORMED', 'assemble', 'duplicate signer key');
    }
    seen.add(p);
    return { p, s: b64urlEncode(crypto.sign(tbs, key)) };
  });
}

/**
 * Fail-closed assembly (B-7): the extended journal must verify. Any
 * verification failure (chain, signatures, quorum, semantics) throws
 * the underlying {@link PactError} — the caller receives a usable
 * event only when the whole journal replays clean. Skew of the
 * historical prefix is intentionally out of scope (ТЗ §3.4: assembly
 * does not defend against skew — verify does, C3): the assembly clock
 * may legitimately be far from the prefix's era (a fresh event
 * appended to history).
 */
export function finalize(events: Event[], event: Event, clock: Clock): Event {
  validateEvent(event, 'assemble');
  const result = verifyJournal([...events, event], clock, { skewCheck: 'none' });
  if (!result.ok) {
    throw result.error ?? new PactError('MALFORMED', 'assemble', 'verification failed without an error');
  }
  return event;
}

/** Head position of a verified prefix: next sq, head hash, pid. */
export function positionOf(events: Event[]): { sq: number; ph: string; pid: string } {
  if (events.length === 0) {
    throw new PactError('MALFORMED', 'assemble', 'empty prefix — use assembleGenesis');
  }
  const last = events[events.length - 1];
  return { sq: last.sq + 1, ph: evHash(last), pid: events[0].pid };
}

/** Builds, signs and verifies a follow-up event against the prefix. */
export function buildEvent(
  events: Event[],
  ty: EventType,
  pl: Record<string, unknown>,
  keys: Uint8Array[],
  clock?: Clock
): Event {
  const c = clock ?? systemClock();
  const pos = positionOf(events);
  const raw: Omit<Event, 'sig'> = {
    typ: EVENT_TYPE,
    pid: pos.pid,
    sq: pos.sq,
    ph: pos.ph,
    ty,
    pl,
    iat: c.now(),
  };
  const event: Event = { ...raw, sig: signaturesFor(raw, keys) };
  return finalize(events, event, c);
}

export { ZERO32 };
