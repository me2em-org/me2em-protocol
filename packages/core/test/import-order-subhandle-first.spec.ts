// import-order-subhandle-first.spec.ts
//
// D4 pin (PR-10), companion of import-order-handle-first.spec.ts: the
// graph rooted at the `subhandle.js` facade — the public re-export
// path — must load first and hand out the SAME class object the
// package entry exposes (facade = re-export, not a subclass).

import { expect, describe, it } from 'vitest';

// Graph root #1: the subhandle facade.
import { SubHandle } from '../src/subhandle.js';
// Graph root #2 (after subhandle): the full public surface.
import { Identity, SubHandle as SubHandleViaIndex } from '../src/index.js';
import { TEST_SEED } from './test-utils.js';

describe('module graph rooted at subhandle.js (D4)', () => {
  it('facade re-exports the same class and the graph derives a SubHandle', async () => {
    expect(SubHandle).toBe(SubHandleViaIndex);

    const identity = await Identity.fromSeed(TEST_SEED);
    const sub = await identity.deriveSubHandle('work', 'connector-1');

    expect(sub).toBeInstanceOf(SubHandle);
    expect(sub.getPathString()).toBe('work/connector-1');
  });
});
