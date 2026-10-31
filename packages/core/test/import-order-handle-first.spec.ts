// import-order-handle-first.spec.ts
//
// D4 pin (PR-10): the module graph must load from ANY root. This file
// deliberately roots at `../src/handle.js` BEFORE anything else — the
// exact order that made the pre-PR-10 "static import + cycle" idea
// crash with "ReferenceError: Cannot access 'Handle' before
// initialization" (subhandle's `extends Handle` would evaluate before
// the Handle class declaration). With the Handle/SubHandle pair
// co-located in handle.ts this order is safe; this spec keeps it that
// way. Companion: import-order-subhandle-first.spec.ts.

import { expect, describe, it } from 'vitest';

// Graph root #1: handle.js — must not throw at import time.
import { Handle, SubHandle } from '../src/handle.js';
// Graph root #2 (after handle): the full public surface.
import { Identity } from '../src/index.js';
import { TEST_SEED } from './test-utils.js';

describe('module graph rooted at handle.js (D4)', () => {
  it('loads, exposes both classes from one module and derives a SubHandle', async () => {
    expect(typeof Handle).toBe('function');
    expect(typeof SubHandle).toBe('function');
    expect(SubHandle.prototype).toBeInstanceOf(Handle); // class pair relationship

    const identity = await Identity.fromSeed(TEST_SEED);
    const handle = await identity.deriveHandle('work');
    const sub = await handle.deriveSubHandle('connector-1');

    expect(sub).toBeInstanceOf(SubHandle);
    expect(sub.getPath()).toEqual(['work', 'connector-1']);
  });
});
