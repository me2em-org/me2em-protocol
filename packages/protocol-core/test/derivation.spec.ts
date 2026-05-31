import { describe, it, expect } from 'vitest';
import { Identity } from '../src/identity.js';

describe('Identity derivation', () => {
  it('should derive same HandleId from same seed + name', async () => {
    const seed = new Uint8Array(32).fill(1); // детерминированный тестовый seed
    
    const identity1 = await Identity.fromSeed(seed);
    const handle1a = await identity1.deriveHandle('work');
    const handle1b = await identity1.deriveHandle('private');
    
    // Повторная деривация из того же seed должна дать те же HandleId
    const identity2 = await Identity.fromSeed(seed);
    const handle2a = await identity2.deriveHandle('work');
    
    expect(handle1a.getId()).toBe(handle2a.getId());
    expect(handle1a.getId()).not.toBe(handle1b.getId());
  });
});