// packages/pact/src/store/MemoryStore.ts — reference implementation (D42).

import { evHash, ZERO32 } from '../codec.js';
import { PactError } from '../errors.js';
import type { Event } from '../types.js';
import type { JournalStore } from './JournalStore.js';

/**
 * In-memory JournalStore: CAS-append with early chain checks (ph/sq
 * must chain onto the current head — cheap fail-closed defense before
 * the caller's verify), snapshot reads. The tail evHash is maintained
 * incrementally (F-rc3-2) — O(1) per append instead of re-deriving it
 * from the last event on every call.
 */
export class MemoryStore implements JournalStore {
  private readonly events: Event[] = [];
  /** Cached JournalHead (F-rc3-2): evHash of the tail, ZERO32 when empty. */
  private headHash: string = ZERO32;

  async append(expectedHead: string, event: Event): Promise<void> {
    if (expectedHead !== this.headHash) {
      throw new PactError('FORK_DETECTED', 'store', `expected head ${expectedHead} != current ${this.headHash}`);
    }
    if (event.ph !== this.headHash) {
      throw new PactError('FORK_DETECTED', 'store', `event ph ${event.ph} does not chain onto ${this.headHash}`);
    }
    if (event.sq !== this.events.length) {
      throw new PactError('FORK_DETECTED', 'store', `event sq ${event.sq} != expected ${this.events.length}`);
    }
    this.events.push(event);
    this.headHash = evHash(event);
  }

  async read(): Promise<Event[]> {
    return [...this.events];
  }

  async head(): Promise<string> {
    return this.headHash;
  }
}
