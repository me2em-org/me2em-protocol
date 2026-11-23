// packages/pact/src/store/MemoryStore.ts — reference implementation (D42).

import { evHash, ZERO32 } from '../codec.js';
import { PactError } from '../errors.js';
import type { Event } from '../types.js';
import type { JournalStore } from './JournalStore.js';

/**
 * In-memory JournalStore: CAS-append with early chain checks (ph/sq
 * must chain onto the current head — cheap fail-closed defense before
 * the caller's verify), snapshot reads.
 */
export class MemoryStore implements JournalStore {
  private readonly events: Event[] = [];

  private currentHead(): string {
    return this.events.length > 0 ? evHash(this.events[this.events.length - 1]) : ZERO32;
  }

  async append(expectedHead: string, event: Event): Promise<void> {
    const head = this.currentHead();
    if (expectedHead !== head) {
      throw new PactError('FORK_DETECTED', 'store', `expected head ${expectedHead} != current ${head}`);
    }
    if (event.ph !== head) {
      throw new PactError('FORK_DETECTED', 'store', `event ph ${event.ph} does not chain onto ${head}`);
    }
    if (event.sq !== this.events.length) {
      throw new PactError('FORK_DETECTED', 'store', `event sq ${event.sq} != expected ${this.events.length}`);
    }
    this.events.push(event);
  }

  async read(): Promise<Event[]> {
    return [...this.events];
  }

  async head(): Promise<string> {
    return this.currentHead();
  }
}
