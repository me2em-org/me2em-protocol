import { describe, it, expect } from 'vitest';
import {
  identityFlowReducer,
  initialIdentityFlowState,
} from '../../src/headless/identity-flow.js';
import type { IdentityFlowEvent } from '../../src/headless/types.js';

function makeSeed(n: number): Uint8Array {
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) arr[i] = (i + n) & 0xff;
  return arr;
}

function makeWords(n: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `word${i + n}`);
}

describe('identityFlowReducer', () => {
  it('generates: idle → seed-generated with words and seed', () => {
    const words = makeWords(1);
    const seed = makeSeed(1);
    const event: IdentityFlowEvent = { type: 'GENERATE', words, seed };
    const result = identityFlowReducer(initialIdentityFlowState, event);

    expect(result.status).toBe('seed-generated');
    expect(result.seedWords).toEqual(words);
    expect(result.identitySeed).toEqual(seed);
    expect(result.error).toBeNull();
  });

  it('confirms words: seedWords nullified, seed stays, status verified', () => {
    const words = makeWords(1);
    const seed = makeSeed(1);
    const generated: IdentityFlowEvent = { type: 'GENERATE', words, seed };
    const state = identityFlowReducer(initialIdentityFlowState, generated);

    const confirm: IdentityFlowEvent = { type: 'CONFIRM_WORDS' };
    const result = identityFlowReducer(state, confirm);

    expect(result.status).toBe('verified');
    expect(result.seedWords).toBeNull();
    expect(result.identitySeed).toEqual(seed);
    expect(result.error).toBeNull();
  });

  it('imports: status imported, seedWords null', () => {
    const seed = makeSeed(42);
    const event: IdentityFlowEvent = { type: 'IMPORT', seed };
    const result = identityFlowReducer(initialIdentityFlowState, event);

    expect(result.status).toBe('imported');
    expect(result.seedWords).toBeNull();
    expect(result.identitySeed).toEqual(seed);
    expect(result.error).toBeNull();
  });

  it('CONFIRM_WORDS from idle does not change state', () => {
    const original = { ...initialIdentityFlowState };
    const event: IdentityFlowEvent = { type: 'CONFIRM_WORDS' };
    const result = identityFlowReducer(initialIdentityFlowState, event);

    expect(result).toBe(initialIdentityFlowState);
    expect(result.status).toBe('idle');
  });

  it('FAIL from seed-generated clears everything and sets error', () => {
    const words = makeWords(1);
    const seed = makeSeed(1);
    const generated: IdentityFlowEvent = { type: 'GENERATE', words, seed };
    const state = identityFlowReducer(initialIdentityFlowState, generated);

    const fail: IdentityFlowEvent = { type: 'FAIL', message: 'user cancelled' };
    const result = identityFlowReducer(state, fail);

    expect(result.status).toBe('error');
    expect(result.seedWords).toBeNull();
    expect(result.identitySeed).toBeNull();
    expect(result.error).toBe('user cancelled');
  });

  it('RESET after verified returns to initial state', () => {
    const words = makeWords(1);
    const seed = makeSeed(1);
    const generated: IdentityFlowEvent = { type: 'GENERATE', words, seed };
    const afterGen = identityFlowReducer(initialIdentityFlowState, generated);
    const confirmed: IdentityFlowEvent = { type: 'CONFIRM_WORDS' };
    const afterConfirm = identityFlowReducer(afterGen, confirmed);

    const reset: IdentityFlowEvent = { type: 'RESET' };
    const result = identityFlowReducer(afterConfirm, reset);

    expect(result).toEqual(initialIdentityFlowState);
  });
});
