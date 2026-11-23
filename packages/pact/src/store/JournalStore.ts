// packages/pact/src/store/JournalStore.ts — the storage contract (C1/D41).

import type { Event } from '../types.js';

/**
 * Append-only journal storage with optimistic CAS-append (C2).
 * Concurrency model: `append(expectedHead, event)` fails with
 * FORK_DETECTED when the store head has moved — the caller re-reads,
 * re-verifies and retries on the winning branch (history before the
 * split stays valid, D27). Implementations decide persistence; the
 * protocol only fixes the contract.
 */
export interface JournalStore {
  /**
   * CAS-append: `expectedHead` must equal the current JournalHead
   * (ZERO32 for an empty store) AND the event must chain onto it —
   * any divergence rejects with FORK_DETECTED.
   */
  append(expectedHead: string, event: Event): Promise<void>;
  /** All events in order (implementations return a snapshot). */
  read(): Promise<Event[]>;
  /** JournalHead — evHash of the last event, or ZERO32 when empty. */
  head(): Promise<string>;
}
